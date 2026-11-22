import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTeam } from "../agreement/server";
import { queueStatus } from "../autopilot/store";
import { BRAND } from "../brand";
import { afterAchReturn, returnAction, returnMeaning } from "./achReturns";
import { paymentFailedMessage } from "./dunning";
import type { GatewayEvent } from "./gateway";
import { billingDay, formatCents } from "./rules";
import { chargeFromRow } from "./server";

// What the processor tells us after a charge: an ACH debit came back, a
// chargeback was opened or decided. Each event is recorded once
// (gateway_events, unique by processor and event id), then applied:
//
//   ach_return         payment_returns row, then the charge goes back to
//                      'failed' on the dunning schedule (achReturns.ts). The
//                      database allows that only with the return on record.
//   chargeback_opened  a chargebacks row (open). The evidence pack is one
//                      click away in the console.
//   chargeback_closed  its status: won or lost.
//
// The same functions record what a member of staff reads off the
// processor's portal (source 'manual'), for processors without webhooks.

type Row = Record<string, unknown>;

export type ApplyOutcome = "applied" | "duplicate" | "ignored" | "no_charge" | "refused";

async function chargeByReference(db: SupabaseClient, reference: string): Promise<Row | null> {
  const { data } = await db.from("charges").select("*").eq("gateway_reference", reference).maybeSingle();
  return (data as Row | null) ?? null;
}

/** Apply one processor event, once. */
export async function applyGatewayEvent(db: SupabaseClient, gateway: string, event: GatewayEvent, now = new Date()): Promise<{ outcome: ApplyOutcome; detail?: string }> {
  const type = event.kind === "ignored" ? event.type : event.kind;
  const { error: seen } = await db.from("gateway_events").insert({ gateway, event_id: event.eventId.slice(0, 200), event_type: (type || "unknown").slice(0, 120) });
  if (seen) return { outcome: "duplicate" };
  const finish = async (outcome: ApplyOutcome, detail?: string) => {
    await db.from("gateway_events").update({ outcome: detail ? `${outcome}: ${detail}`.slice(0, 300) : outcome }).eq("gateway", gateway).eq("event_id", event.eventId.slice(0, 200));
    return { outcome, detail };
  };
  if (event.kind === "ignored" || event.kind === "charge_settled") return finish("ignored");

  const row = await chargeByReference(db, event.reference);
  if (!row) return finish("no_charge", event.reference);

  if (event.kind === "ach_return") {
    const result = await recordAchReturn(db, String(row.id), event.code, "webhook", new Date(event.at), now);
    return finish(result.ok ? "applied" : "refused", result.ok ? event.code : result.message);
  }
  if (event.kind === "chargeback_opened") {
    const result = await recordChargeback(db, String(row.id), { amountCents: event.amountCents, reasonCode: event.reasonCode, caseId: event.caseId, receivedAt: event.at, source: "webhook" });
    return finish(result.ok ? "applied" : "refused", result.ok ? undefined : result.message);
  }
  const { error } = await db
    .from("chargebacks")
    .update({ status: event.outcome, closed_at: now.toISOString() })
    .eq("charge_id", String(row.id))
    .eq("status", "open");
  return finish(error ? "refused" : "applied", error?.message);
}

/**
 * An ACH debit came back. The return is recorded, the charge goes back on
 * the dunning schedule (or stops, for a closed account or a revoked
 * authorization), and the client is told as for a declined card.
 */
export async function recordAchReturn(
  db: SupabaseClient,
  chargeId: string,
  code: string,
  source: "webhook" | "manual",
  returnedAt: Date,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: row } = await db.from("charges").select("*").eq("id", chargeId).maybeSingle();
  if (!row) return { ok: false, message: "charge not found" };
  const charge = chargeFromRow(row as Row);
  const clean = code.toUpperCase();
  if (!/^R[0-9A-Z]{2}$/.test(clean)) return { ok: false, message: "not a return code" };
  const { error: returnError } = await db.from("payment_returns").insert({
    charge_id: chargeId,
    user_id: (row as Row).user_id,
    code: clean,
    gateway_reference: (row as Row).gateway_reference,
    returned_at: returnedAt.toISOString(),
    source,
  });
  if (returnError) return { ok: false, message: returnError.message };
  const updated = afterAchReturn(charge, clean, now);
  const { error } = await db
    .from("charges")
    .update({
      status: updated.status,
      charged_at: null,
      gateway_reference: null,
      failure_code: updated.failureCode,
      return_code: clean,
      next_attempt_at: updated.nextAttemptAt,
      last_attempt_at: updated.lastAttemptAt,
    })
    .eq("id", chargeId);
  if (error) return { ok: false, message: error.message };

  const userId = String((row as Row).user_id);
  const action = returnAction(clean);
  await db.from("events").insert({ user_id: userId, kind: "ach_returned", payload: { chargeId, code: clean, action } });
  if (action === "revoked") {
    // The client's bank says the debit was not authorized: the account comes off file, and nothing is debited again.
    await db.from("payment_method_vault").delete().in("payment_method_id", (await activeMethodIds(db, userId)) ?? []);
    await db.from("payment_methods").update({ removed_at: now.toISOString() }).eq("user_id", userId).is("removed_at", null);
  }
  if (action !== "retry") {
    await notifyTeam(`${BRAND.name}: el banco devolvió un cobro por ACH (${clean}: ${returnMeaning(clean).es}). No se reintenta solo. Cuenta: ${userId}`);
  }
  await queueStatus(
    db,
    userId,
    {
      kind: "payment_declined",
      chargeId,
      attempts: updated.attempts,
      roundNumber: updated.roundNumber,
      amount: formatCents(updated.amountCents),
      retryOn: updated.nextAttemptAt ? { es: billingDay(updated.nextAttemptAt, "es"), en: billingDay(updated.nextAttemptAt, "en") } : null,
    },
    now,
  );
  const { data: profile } = await db.from("profiles").select("locale").eq("id", userId).maybeSingle();
  const message = paymentFailedMessage({ charge: updated });
  await db.from("chat_messages").insert({ user_id: userId, channel: "app", role: "assistant", source: "journey", body: (profile as Row | null)?.locale === "es" ? message.es : message.en });
  return { ok: true };
}

async function activeMethodIds(db: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data } = await db.from("payment_methods").select("id").eq("user_id", userId).is("removed_at", null);
  return ((data as Row[] | null) ?? []).map((r) => String(r.id));
}

export interface ChargebackInput {
  amountCents: number | null;
  reasonCode: string | null;
  caseId: string | null;
  receivedAt: string;
  source: "webhook" | "manual";
  note?: string | null;
  by?: { userId: string | null; name: string };
}

/** A chargeback on one charge: recorded open. The database refuses one for money that was never taken. */
export async function recordChargeback(db: SupabaseClient, chargeId: string, input: ChargebackInput): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const { data: row } = await db.from("charges").select("user_id, amount_cents, credit_cents").eq("id", chargeId).maybeSingle();
  if (!row) return { ok: false, message: "charge not found" };
  const collected = Number((row as Row).amount_cents) - Number((row as Row).credit_cents ?? 0);
  const { data, error } = await db
    .from("chargebacks")
    .insert({
      charge_id: chargeId,
      user_id: (row as Row).user_id,
      amount_cents: input.amountCents && input.amountCents > 0 ? input.amountCents : collected,
      reason_code: input.reasonCode,
      gateway_case_id: input.caseId,
      received_at: input.receivedAt,
      source: input.source,
      note: input.note ?? null,
      recorded_by: input.by?.userId ?? null,
      recorded_by_name: input.by?.name.slice(0, 80) ?? "",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: error?.message ?? "not recorded" };
  await db.from("events").insert({ user_id: (row as Row).user_id, kind: "chargeback_opened", payload: { chargeId, source: input.source } });
  await notifyTeam(`${BRAND.name}: se abrió un contracargo sobre un cobro. El paquete de evidencia está en la consola, en Cobros. Cuenta: ${String((row as Row).user_id)}`);
  return { ok: true, id: String((data as Row).id) };
}
