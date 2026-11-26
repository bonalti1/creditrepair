import type { SupabaseClient } from "@supabase/supabase-js";
import { loadGoverningAgreementRow } from "../agreement/server";
import { readPlanSnapshot } from "../billing/plans";
import { sendWhatsApp } from "../integrations/whatsapp";
import { nextRoundDue } from "../rounds/timing";
import { optionOfTerms } from "../service/options";
import { mailedOnProblem, mailFeeCents, type MailedOnProblem } from "./rules";

// Credalti DIY on the server (migration 0042): the client's own "I mailed
// them", the "Mail them for me" request, and the prepared letters to print.
// Written with the service role after the route checked who is asking; the
// database checks it all again (mail_requests_guard, the charge trigger).

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");

export interface PreparedLetter {
  id: string;
  targetName: string;
  targetAddressLines: string[];
  templateKey: string;
  body: string;
  status: string;
  mailProvider: string | null;
  /** In an open or mailed "Mail them for me" request. */
  requested: boolean;
}

export interface DiyRound {
  roundId: string;
  roundNumber: number;
  status: string;
  preparedAt: string | null;
  mailedAt: string | null;
  letters: PreparedLetter[];
  /** The open request, if any. */
  request: { id: string; letterCount: number; totalCents: number; status: string; mailedAt: string | null } | null;
  /** The fee per letter in the signed plan; null when mailing is not offered. */
  feeCents: number | null;
}

async function agreementOfOption(db: SupabaseClient, userId: string): Promise<{ row: Row | null; diy: boolean }> {
  const row = await loadGoverningAgreementRow(db, userId);
  return { row, diy: Boolean(row?.signed_at && !row.cancelled_at && optionOfTerms(row.terms) === "diy") };
}

/** The newest round with prepared letters (or the newest round), as the DIY letters page reads it. */
export async function loadDiyRound(db: SupabaseClient, userId: string): Promise<DiyRound | null> {
  const [{ row }, rounds] = await Promise.all([
    agreementOfOption(db, userId),
    db.from("attack_rounds").select("id, round_number, status, mailed_at, created_at").eq("user_id", userId).order("round_number", { ascending: false }).limit(1),
  ]);
  const round = ((rounds.data as Row[] | null) ?? [])[0];
  if (!round) return null;
  const [letters, requests] = await Promise.all([
    db.from("letters").select("id, target_name, target_address_lines, template_key, body, status, mail_provider, created_at").eq("round_id", text(round.id)),
    db.from("mail_requests").select("*").eq("round_id", text(round.id)),
  ]);
  const requestRows = ((requests.data as Row[] | null) ?? []).filter((r) => r.status !== "cancelled");
  const requested = new Set(requestRows.flatMap((r) => (Array.isArray(r.letter_ids) ? (r.letter_ids as unknown[]).map(String) : [])));
  const open = requestRows.find((r) => r.status === "requested") ?? requestRows.find((r) => r.status === "mailed") ?? null;
  const letterRows = (letters.data as Row[] | null) ?? [];
  const plan = readPlanSnapshot((row?.terms as { plan?: unknown } | null)?.plan);
  return {
    roundId: text(round.id),
    roundNumber: Number(round.round_number),
    status: text(round.status),
    preparedAt: letterRows.map((l) => text(l.created_at)).sort()[0] || null,
    mailedAt: text(round.mailed_at) || null,
    letters: letterRows.map((l) => ({
      id: text(l.id),
      targetName: text(l.target_name),
      targetAddressLines: Array.isArray(l.target_address_lines) ? (l.target_address_lines as unknown[]).map(String) : [],
      templateKey: text(l.template_key),
      body: text(l.body),
      status: text(l.status),
      mailProvider: text(l.mail_provider) || null,
      requested: requested.has(text(l.id)),
    })),
    request: open ? { id: text(open.id), letterCount: Number(open.letter_count), totalCents: Number(open.total_cents), status: text(open.status), mailedAt: text(open.mailed_at) || null } : null,
    feeCents: mailFeeCents(plan),
  };
}

export type DiyResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string; error: string };

const refuse = (status: number, code: string, error: string): DiyResult<never> => ({ ok: false, status, code, error });

/**
 * "I mailed them": every prepared letter of the round that is not in a "Mail
 * them for me" request is recorded as mailed by the client on that date. The
 * round is mailed (by the client: mail_via 'client', never billed as our work)
 * when no letter is left, and the next round is due from that date.
 */
export async function recordClientMailed(db: SupabaseClient, userId: string, roundNumber: number, mailedOn: string, now: Date = new Date()): Promise<DiyResult<{ nextRoundDueAt: string | null; letters: number }>> {
  const { diy } = await agreementOfOption(db, userId);
  if (!diy) return refuse(409, "not_diy", "Under Credalti Complete the team mails your letters.");
  const round = await loadDiyRound(db, userId);
  if (!round || round.roundNumber !== roundNumber) return refuse(404, "round_not_found", "Prepare your letters first.");
  if (round.status !== "draft") return refuse(409, "already_mailed", "This round is already recorded as mailed.");
  const problem: MailedOnProblem | null = mailedOnProblem(mailedOn, now, round.preparedAt);
  if (problem) return refuse(422, `mailed_on_${problem}`, problem);
  const mine = round.letters.filter((l) => l.status === "draft" && !l.requested);
  if (mine.length === 0) return refuse(409, "nothing_to_mark", "No letter is left for you to mail.");
  const at = new Date(`${mailedOn}T17:00:00Z`);
  const mailedAt = (at.getTime() > now.getTime() ? now : at).toISOString();
  for (const letter of mine) {
    const { error } = await db
      .from("letters")
      .update({ status: "mailed", mailed_at: mailedAt, mail_provider: "client", mail_status: "in_transit", mail_updated_at: now.toISOString() })
      .eq("id", letter.id)
      .eq("status", "draft");
    if (error) throw new Error(`letters: ${error.message}`);
  }
  const stillOurs = round.letters.some((l) => l.requested && l.status === "draft");
  let nextRoundDueAt: string | null = null;
  if (!stillOurs) {
    nextRoundDueAt = nextRoundDue({ mailedAt }, mine.map(() => ({ mailedAt })))!.dueAt;
    const { error } = await db
      .from("attack_rounds")
      .update({ status: "mailed", approved_at: now.toISOString(), mailed_at: mailedAt, next_round_due_at: nextRoundDueAt, mail_via: "client" })
      .eq("id", round.roundId)
      .eq("status", "draft");
    if (error) throw new Error(`attack_rounds: ${error.message}`);
  }
  await db.from("events").insert({ user_id: userId, kind: "diy_round_mailed_by_client", payload: { roundNumber, letters: mine.length, mailedOn } });
  const { data: profile } = await db.from("profiles").select("phone_e164, locale").eq("id", userId).maybeSingle();
  if (profile?.phone_e164) {
    await sendWhatsApp(String(profile.phone_e164), { kind: "letters_mailed", roundNumber, letterCount: mine.length, by: "client" }, profile.locale === "es" ? "es" : "en", "diy").catch(() => undefined);
  }
  return { ok: true, value: { nextRoundDueAt, letters: mine.length } };
}

/**
 * "Mail them for me": the client asks Credalti to mail these prepared letters
 * (default: every one still theirs), at the fee per letter in their signed
 * plan, the total shown first. The team mails them from the send screen; the
 * charge is made after they are mailed (billing run, unit 'mailing').
 */
export async function createMailRequest(
  db: SupabaseClient,
  userId: string,
  input: { roundNumber: number; letterIds?: string[]; acceptedTotalCents: number; ip?: string | null; userAgent?: string | null },
): Promise<DiyResult<{ id: string; totalCents: number; letterCount: number }>> {
  const { row, diy } = await agreementOfOption(db, userId);
  if (!diy || !row) return refuse(409, "not_diy", "Under Credalti Complete the team mails your letters.");
  const deadline = row.cancellation_deadline ? new Date(String(row.cancellation_deadline)) : null;
  if (!deadline || deadline.getTime() >= Date.now()) return refuse(409, "in_cancellation_window", "Nothing is mailed during your 3 business days to cancel.");
  const fee = mailFeeCents(readPlanSnapshot((row.terms as { plan?: unknown } | null)?.plan));
  if (!fee) return refuse(409, "mailing_not_offered", "Your plan does not include mailing for you.");
  const round = await loadDiyRound(db, userId);
  if (!round || round.roundNumber !== input.roundNumber || round.status !== "draft") return refuse(404, "round_not_found", "Prepare your letters first.");
  if (round.request?.status === "requested") return refuse(409, "already_requested", "You already asked us to mail this round.");
  const available = round.letters.filter((l) => l.status === "draft" && !l.requested).map((l) => l.id);
  const ids = input.letterIds && input.letterIds.length > 0 ? input.letterIds.filter((id) => available.includes(id)) : available;
  if (ids.length === 0) return refuse(409, "nothing_to_mail", "No letter is left to mail.");
  const total = fee * ids.length;
  // What the client saw is what is recorded; a different total means the screen was out of date.
  if (input.acceptedTotalCents !== total) return refuse(409, "quote_changed", "The cost changed. Look at it again before confirming.");
  const { data, error } = await db
    .from("mail_requests")
    .insert({
      user_id: userId,
      round_id: round.roundId,
      letter_ids: ids,
      letter_count: ids.length,
      fee_cents: fee,
      total_cents: total,
      accepted_ip: input.ip?.slice(0, 80) ?? null,
      accepted_user_agent: input.userAgent?.slice(0, 400) ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return refuse(409, "refused", error?.message ?? "not saved");
  await db.from("events").insert({ user_id: userId, kind: "diy_mail_requested", payload: { roundNumber: input.roundNumber, letters: ids.length, totalCents: total } });
  return { ok: true, value: { id: text((data as Row).id), totalCents: total, letterCount: ids.length } };
}

/** Open "Mail them for me" requests, for the team's send queue: client, round, letters. */
export async function openMailRequests(db: SupabaseClient): Promise<Array<{ id: string; userId: string; roundId: string; letterIds: string[]; totalCents: number; acceptedAt: string }>> {
  const { data } = await db.from("mail_requests").select("id, user_id, round_id, letter_ids, total_cents, accepted_at").eq("status", "requested").order("accepted_at", { ascending: true }).limit(500);
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: text(r.id),
    userId: text(r.user_id),
    roundId: text(r.round_id),
    letterIds: Array.isArray(r.letter_ids) ? (r.letter_ids as unknown[]).map(String) : [],
    totalCents: Number(r.total_cents),
    acceptedAt: text(r.accepted_at),
  }));
}
