import { NextResponse } from "next/server";
import { z } from "zod";
import { refundBodySchema } from "@/lib/billing/api";
import { getPaymentGateway } from "@/lib/billing/gateway";
import { formatCents } from "@/lib/billing/rules";
import { cleanRefundReason, refundEligibility } from "@/lib/billing/refunds";
import { chargeFromRow } from "@/lib/billing/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffAccess, requireCapability } from "@/lib/staff/access";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// Staff only: return a paid charge to the client, in full, with a written
// reason. This and /api/billing/pause are the only things a member of staff
// can do about money. There is no route that lets staff create a charge and
// none that changes an amount.
//
// The refund is recorded first (a row that is never deleted or edited:
// migration 0011), then the processor is asked with the refund row's id as the
// idempotency key, then the result is saved and the charge marked as refunded.
// If the processor fails, the row stays and asking again continues it.

export async function POST(req: Request) {
  const limited = rateLimit(req, "billing-refund", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const access = await getStaffAccess();
  if (access === "demo") return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  if (access !== "allowed") return NextResponse.json({ error: "Staff only" }, { status: 403 });
  // Staff is not enough: the role decides, here on the server (only an administrator returns money; src/lib/staff/permissions.ts).
  const role = await requireCapability("billing.refund");
  if (!role.ok) return role.response;
  const staff = await getSessionUser();
  const db = getAdminClient();
  if (!db || !staff) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await readJsonBody(req, 3_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = refundBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const reason = cleanRefundReason(parsed.data.reason);
  const by = (parsed.data.by ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

  const resolution = getPaymentGateway();
  if (!resolution.configured) {
    return NextResponse.json({ error: resolution.message, code: "gateway_not_configured" }, { status: 503 });
  }
  const gateway = resolution.gateway;

  try {
    const { data: row, error } = await db.from("charges").select("*").eq("id", parsed.data.chargeId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return NextResponse.json({ error: "Charge not found" }, { status: 404 });

    const { data: existing } = await db.from("refunds").select("*").eq("charge_id", row.id).maybeSingle();
    let refund = existing as Record<string, unknown> | null;
    if (refund?.completed_at) {
      return NextResponse.json({ error: "This charge was already refunded.", code: "already_refunded" }, { status: 409 });
    }

    if (!refund) {
      const allowed = refundEligibility(chargeFromRow(row as Record<string, unknown>), reason);
      if (!allowed.allowed) return NextResponse.json({ error: allowed.reason.en, code: allowed.code }, { status: 409 });
      // The money goes back through the processor that took it.
      if (row.gateway !== gateway.name) {
        return NextResponse.json(
          { error: `This charge was made with "${row.gateway}", which is not the processor configured now.`, code: "gateway_mismatch" },
          { status: 409 },
        );
      }
      const { data: inserted, error: insertError } = await db
        .from("refunds")
        .insert({
          charge_id: row.id,
          user_id: row.user_id,
          amount_cents: allowed.amountCents,
          reason,
          requested_by: staff.id,
          requested_by_name: by,
        })
        .select("*")
        .single();
      if (insertError || !inserted) throw new Error(insertError?.message ?? "insert returned no row");
      refund = inserted as Record<string, unknown>;
    }

    const result = await gateway.refund({
      chargeReference: row.gateway_reference as string,
      amountCents: refund.amount_cents as number,
      idempotencyKey: refund.id as string,
    });
    if (!result.ok) {
      await db.from("refunds").update({ failure_reason: result.message.slice(0, 500) }).eq("id", refund.id as string);
      await reportError(new Error(`refund failed: ${result.message}`), { where: "api/billing/refund", userId: row.user_id as string });
      return NextResponse.json(
        { error: "The processor did not complete the refund. It is recorded; try again in a moment.", code: "refund_failed" },
        { status: 502 },
      );
    }

    const now = new Date().toISOString();
    const { error: completeError } = await db
      .from("refunds")
      .update({ completed_at: now, gateway_reference: result.reference, failure_reason: null })
      .eq("id", refund.id as string);
    if (completeError) throw new Error(completeError.message);
    const { error: chargeError } = await db.from("charges").update({ status: "refunded", next_attempt_at: null }).eq("id", row.id);
    if (chargeError) throw new Error(chargeError.message);

    await db.from("events").insert({
      user_id: row.user_id,
      kind: "charge_refunded",
      payload: { chargeId: row.id, refundId: refund.id, roundNumber: row.round_number, amountCents: refund.amount_cents, by: staff.id },
    });
    return NextResponse.json({ ok: true, refunded: formatCents(refund.amount_cents as number), refundId: refund.id });
  } catch (error) {
    await reportError(error, { where: "api/billing/refund", userId: staff.id });
    return NextResponse.json({ error: "Could not record the refund. Nothing was returned; please try again." }, { status: 500 });
  }
}
