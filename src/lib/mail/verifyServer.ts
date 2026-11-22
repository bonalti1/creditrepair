import type { SupabaseClient } from "@supabase/supabase-js";
import { recordResolution } from "../autopilot/resolutions";
import { verifyWithLob } from "../integrations/lobVerify";
import { addressKey, VERIFICATION_CACHE_DAYS, verificationPasses, type VerifiedAddress } from "./verify";

// Address verification on the server: the cache and the record
// (address_verifications, migration 0022), the round's gate (used by
// rounds/send.ts, step 5b), and what a failed check sets in motion:
//   - the client's own address: a one-tap confirmation request
//     (address_confirmations), which the autopilot follows up on;
//   - a creditor's address: its address book entry stops counting as
//     verified, for every client, and the company is a missing address.
// Service role only; the callers have already checked who is asking.

type Row = Record<string, unknown>;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How one address is checked. Default: Lob (or "unchecked" without a key). Tests pass their own. */
export type Verifier = (lines: readonly string[]) => Promise<VerifiedAddress>;

export interface VerifySubject {
  lines: readonly string[];
  subject: "client" | "bureau" | "furnisher";
  subjectKey: string | null;
  userId: string | null;
  roundNumber?: number | null;
  letterId?: string | null;
  /** Check again even if a recent check is on record (a letter came back: that is new evidence). */
  fresh?: boolean;
}

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

/**
 * One address, checked once per VERIFICATION_CACHE_DAYS: a recent real
 * check of the same address is reused (provider "cache", no cost); otherwise
 * the verifier is asked and the answer recorded. A database without migration
 * 0022 still checks; it just keeps no record.
 */
export async function verifyAddress(db: SupabaseClient, input: VerifySubject, verifier: Verifier, now: Date): Promise<VerifiedAddress> {
  const key = addressKey(input.lines);
  const since = new Date(now.getTime() - VERIFICATION_CACHE_DAYS * DAY_MS).toISOString();
  const cached = await db
    .from("address_verifications")
    .select("result, deliverability, standardized_lines, input_lines")
    .eq("address_key", key)
    .eq("provider", "lob")
    .gte("checked_at", since)
    .order("checked_at", { ascending: false })
    .limit(1);
  const hit = !cached.error && !input.fresh ? ((cached.data as Row[] | null) ?? [])[0] : undefined;
  if (hit) {
    const result = String(hit.result) as VerifiedAddress["result"];
    const standard = lines(hit.standardized_lines);
    const passes = verificationPasses(result);
    return {
      result,
      deliverability: String(hit.deliverability ?? ""),
      lines: passes && standard.length >= 2 ? standard : [...input.lines],
      suggestion: passes ? [] : standard,
      provider: "cache",
      costMills: 0,
    };
  }

  const checked = await verifier(input.lines);
  const passes = verificationPasses(checked.result);
  await db.from("address_verifications").insert({
    user_id: input.userId,
    subject: input.subject,
    subject_key: input.subjectKey?.slice(0, 120) ?? null,
    input_lines: [...input.lines].slice(0, 6),
    address_key: key,
    result: checked.result,
    deliverability: checked.deliverability.slice(0, 60),
    standardized_lines: (passes ? (checked.result === "unchecked" ? [] : checked.lines) : checked.suggestion).slice(0, 6),
    provider: checked.provider === "lob" ? "lob" : "stub",
    cost_mills: checked.costMills,
    round_number: input.roundNumber ?? null,
    letter_id: input.letterId ?? null,
    checked_at: now.toISOString(),
  });
  return checked;
}

/** Ask the client to confirm their address with one tap. Once: a request already open stays the one. */
export async function requestAddressConfirmation(
  db: SupabaseClient,
  input: { userId: string; reason: "verification" | "returned_letter"; check: VerifiedAddress; inputLines: readonly string[]; roundNumber?: number | null; letterId?: string | null },
  now: Date,
): Promise<"requested" | "already_open" | "skipped"> {
  const finding = input.check.result === "undeliverable" ? "undeliverable" : "ambiguous";
  const { error } = await db.from("address_confirmations").insert({
    user_id: input.userId,
    reason: input.reason,
    finding,
    input_lines: [...input.inputLines].slice(0, 6),
    suggestion_lines: input.check.suggestion.slice(0, 6),
    letter_id: input.letterId ?? null,
    round_number: input.roundNumber ?? null,
    requested_at: now.toISOString(),
  });
  if (!error) {
    await db.from("events").insert({ user_id: input.userId, kind: "address_confirmation_requested", payload: { reason: input.reason, finding, roundNumber: input.roundNumber ?? null } });
    return "requested";
  }
  if (error.code === "23505") return "already_open";
  return "skipped";
}

/**
 * A creditor's dispute address the post office does not deliver to: the
 * entry stops counting as verified (verified_on cleared, a note added), so
 * no letter goes there and the company shows as a missing address, once,
 * for every client waiting on it. The book's history trigger records the
 * change as "sistema".
 */
export async function markFurnisherAddressBad(db: SupabaseClient, entryId: string, why: string, now: Date): Promise<boolean> {
  const { data } = await db.from("furnishers").select("notes, verified_on").eq("id", entryId).maybeSingle();
  if (!data || !(data as Row).verified_on) return false;
  const day = now.toISOString().slice(0, 10);
  const line = `${day}: ${why} Se quitó la verificación; hace falta otra dirección para disputas.`;
  const notes = [String((data as Row).notes ?? "").trim(), line].filter(Boolean).join("\n").slice(-1000);
  const { error } = await db.from("furnishers").update({ verified_on: null, notes, updated_by: null, updated_by_name: "sistema" }).eq("id", entryId);
  return !error;
}

export interface Recipient {
  /** The planned letter's key (target type|key|template), to match the answer back. */
  ref: string;
  type: "bureau" | "secondary_bureau" | "furnisher";
  key: string;
  name: string;
  lines: readonly string[];
  /** The address book entry, for a furnisher. */
  entryId?: string | null;
}

export type RoundVerification =
  | { ok: true; from: string[]; to: Map<string, string[]>; costMills: number; corrected: number }
  | { ok: false; status: number; code: "client_address_unverified" | "furnisher_address_undeliverable" | "recipient_address_undeliverable"; message: string };

/**
 * The round's gate: the client's return address and every recipient's,
 * checked before anything is mailed. All of them are checked (so one pass
 * sets everything in motion), then the round is refused if any failed.
 */
export async function verifyRoundAddresses(
  db: SupabaseClient,
  input: { userId: string; roundNumber: number; from: readonly string[]; recipients: readonly Recipient[] },
  verifier: Verifier = (l) => verifyWithLob(l),
  now: Date = new Date(),
): Promise<RoundVerification> {
  let costMills = 0;
  let corrected = 0;
  const problems: Array<{ code: Extract<RoundVerification, { ok: false }>["code"]; message: string }> = [];

  const client = await verifyAddress(db, { lines: input.from, subject: "client", subjectKey: input.userId, userId: input.userId, roundNumber: input.roundNumber }, verifier, now);
  costMills += client.costMills;
  if (!verificationPasses(client.result)) {
    await requestAddressConfirmation(db, { userId: input.userId, reason: "verification", check: client, inputLines: input.from, roundNumber: input.roundNumber }, now);
    problems.push({
      code: "client_address_unverified",
      message: "El correo no pudo confirmar la dirección del cliente. Se le pidió confirmarla con un toque; la ronda sale cuando la confirme.",
    });
  } else if (client.result === "corrected") {
    corrected += 1;
    await recordResolution(db, {
      userId: input.userId,
      kind: "address_corrected",
      detail: { subject: "client", lines: client.lines.join(", "), roundNumber: input.roundNumber },
      dedupeKey: `address_corrected:${input.userId}:r${input.roundNumber}:client:${addressKey(input.from)}`,
      at: now,
    });
  }

  const to = new Map<string, string[]>();
  for (const recipient of input.recipients) {
    const check = await verifyAddress(
      db,
      { lines: recipient.lines, subject: recipient.type === "furnisher" ? "furnisher" : "bureau", subjectKey: recipient.entryId ?? recipient.key, userId: input.userId, roundNumber: input.roundNumber },
      verifier,
      now,
    );
    costMills += check.costMills;
    if (!verificationPasses(check.result)) {
      if (recipient.type === "furnisher") {
        if (recipient.entryId) await markFurnisherAddressBad(db, recipient.entryId, `La verificación del correo dijo «${check.deliverability}» para ${recipient.lines.join(", ")}.`, now);
        problems.push({
          code: "furnisher_address_undeliverable",
          message: `El correo no entrega en la dirección de ${recipient.name} que hay en la libreta. Quedó como dirección faltante para todos los clientes que la esperan.`,
        });
      } else {
        problems.push({
          code: "recipient_address_undeliverable",
          message: `El correo no pudo confirmar la dirección de ${recipient.name} del registro. Una persona la revisa antes de enviar.`,
        });
      }
      continue;
    }
    if (check.result === "corrected") {
      corrected += 1;
      await recordResolution(db, {
        userId: input.userId,
        kind: "address_corrected",
        detail: { subject: recipient.type, name: recipient.name, lines: check.lines.join(", "), roundNumber: input.roundNumber },
        dedupeKey: `address_corrected:${input.userId}:r${input.roundNumber}:${recipient.ref}:${addressKey(recipient.lines)}`,
        at: now,
      });
    }
    to.set(recipient.ref, check.lines);
  }

  if (problems.length > 0) return { ok: false, status: 409, code: problems[0]!.code, message: problems.map((p) => p.message).join(" ") };
  return { ok: true, from: client.lines, to, costMills, corrected };
}
