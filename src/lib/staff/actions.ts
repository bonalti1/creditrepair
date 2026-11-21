import type { SupabaseClient } from "@supabase/supabase-js";
import { storeMessage } from "../chat/history";
import { importReportForUser } from "../domain/importReport";
import { furnisherFromRow } from "../mail/server";
import { roundMailPlan } from "../mail/sendPlan";
import type { MailClass } from "../mail/types";
import { mergeReport, planImport } from "../reports/merge";
import { getReportReader, ReportReadError } from "../reports/readers";
import { sendRound, type SendRoundOptions } from "../rounds/send";
import type { StaffMember } from "./access";
import { checkStaffReply, type ReplyProblem } from "./conversation";
import { plannedLetterKey } from "./fromRows";
import { exceptionKindOfKey } from "./guard";
import { loadStaffClients } from "./load";
import { exceptionVisibleTo } from "./permissions";
import { EXCEPTION_KINDS, sendableRound, sendBlockReason } from "./stage";
import type { StaffChatMessage, StaffClient } from "./types";

// What the staff routes do, apart from the HTTP around them, so the database
// tests can run each one against the real migrations (src/lib/__tests__/db).
//
// Every function takes two connections:
//   reader  the member's OWN connection (cookie-bound): every check of what
//           they may see goes through it, so the role-scoped read policies of
//           migration 0012 decide, exactly as they do for the screens;
//   db      the service role, which writes. Staff have no write policy on any
//           table; every write is here, after the checks.
// The member (who, which role) comes from requireCapability, from their own
// staff_members row, never from the request.

type Row = Record<string, unknown>;

export type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; message: string; code?: string; problems?: string[] | ReplyProblem[] };

const fail = (status: number, message: string, code?: string, problems?: string[] | ReplyProblem[]): ActionResult<never> => ({
  ok: false,
  status,
  message,
  ...(code ? { code } : {}),
  ...(problems ? { problems } : {}),
});

const NOT_YOURS = "Este cliente no está entre los tuyos.";

/**
 * Whether this member may see the client: the database's own answer, through
 * their own connection. "case" is the report, answers, letters and
 * conversation (not sales). A prospect (someone added by hand, no account)
 * is visible when the prospects read policy returns it.
 */
export async function memberCanSee(
  reader: SupabaseClient,
  clientId: string,
  scope: "client" | "case",
): Promise<"client" | "prospect" | null> {
  const fn = scope === "case" ? "staff_can_see_case" : "staff_can_see_client";
  const { data, error } = await reader.rpc(fn, { client: clientId });
  if (!error && data === true) {
    const { data: profile } = await reader.from("profiles").select("id").eq("id", clientId).maybeSingle();
    if (profile) return "client";
  }
  if (scope === "client") {
    const { data: prospect } = await reader.from("prospects").select("id").eq("id", clientId).is("converted_user_id", null).maybeSingle();
    if (prospect) return "prospect";
  }
  return null;
}

// ── Notes ───────────────────────────────────────────────────────────────

export async function addStaffNote(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: StaffMember,
  clientId: string,
  text: string,
): Promise<ActionResult<{ note: { id: string; at: string; author: string; text: string } }>> {
  const subject = await memberCanSee(reader, clientId, "client");
  if (!subject) return fail(404, NOT_YOURS, "not_visible");
  const body = text.replace(/\s+$/g, "").trim().slice(0, 2000);
  const { data, error } = await db
    .from("staff_notes")
    .insert({ [subject === "client" ? "user_id" : "prospect_id"]: clientId, author: member.userId, author_name: member.handle, body })
    .select("id, created_at, author_name, body")
    .single();
  if (error || !data) throw new Error(`staff_notes: ${error?.message ?? "no row"}`);
  const row = data as Row;
  return { ok: true, note: { id: String(row.id), at: new Date(String(row.created_at)).toISOString(), author: String(row.author_name), text: String(row.body) } };
}

// ── Handled marks ───────────────────────────────────────────────────────

const KNOWN_KINDS = new Set<string>([...EXCEPTION_KINDS, "question"]);

export async function markExceptionHandled(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: StaffMember,
  clientId: string,
  key: string,
): Promise<ActionResult> {
  const prefix = key.split(":")[0]!;
  if (!KNOWN_KINDS.has(prefix)) return fail(400, "Ese aviso no existe.", "unknown_exception");
  // Sales follows a person until the work starts; the rest is fulfillment's (permissions.ts).
  if (!exceptionVisibleTo(member.role, exceptionKindOfKey(key))) {
    return fail(403, "Este aviso lo atiende el equipo que trabaja el caso.", "forbidden_for_role");
  }
  if ((await memberCanSee(reader, clientId, "client")) !== "client") return fail(404, NOT_YOURS, "not_visible");
  const { error } = await db
    .from("exception_marks")
    .insert({ user_id: clientId, exception_key: key, handled_by: member.userId, handled_by_name: member.handle });
  if (error) throw new Error(`exception_marks: ${error.message}`);
  return { ok: true };
}

// ── Replies ─────────────────────────────────────────────────────────────

export async function sendStaffReply(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: StaffMember,
  clientId: string,
  text: string,
): Promise<ActionResult<{ message: StaffChatMessage }>> {
  const body = text.trim();
  // The same claim rules ads, WhatsApp and Capi pass (compliance/guardrails.ts).
  const problems = checkStaffReply(body);
  if (problems.length > 0) return fail(422, "La respuesta no se envió: rompe una regla.", "claim_rules", problems);
  if ((await memberCanSee(reader, clientId, "case")) !== "client") return fail(404, NOT_YOURS, "not_visible");
  // The client sees the teammate's first name, from their own staff record.
  const authorName = member.name.split(" ")[0] || member.handle;
  const stored = await storeMessage(db, { userId: clientId, channel: "app", role: "assistant", source: "human", text: body, authorName });
  if (!stored) throw new Error("chat_messages: the reply was not stored");
  return { ok: true, message: { id: `sent-${Date.now()}`, at: new Date().toISOString(), role: "assistant", source: "human", authorName, text: body } };
}

// ── Reports ─────────────────────────────────────────────────────────────

async function visibleClient(reader: SupabaseClient, clientId: string): Promise<StaffClient | null> {
  return (await loadStaffClients(reader, { clientId }))[0] ?? null;
}

/**
 * Read a report again on the server with the named reader (never trusting a
 * report parsed in the browser), check it may be saved (reports/merge.ts:
 * planImport), then save it through the import pipeline and record what
 * mergeReport says changes: who imported it, the round results, a round that
 * is now answered. Never writes an answer.
 */
export async function importStaffReport(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: StaffMember,
  input: { clientId: string; readerKey: string; source: string },
  now: Date = new Date(),
): Promise<ActionResult<{ pullId: string; itemCount: number }>> {
  const read = getReportReader(input.readerKey);
  if (!read) return fail(400, "Ese lector no existe.", "unknown_reader");
  if ((await memberCanSee(reader, input.clientId, "case")) !== "client") return fail(404, NOT_YOURS, "not_visible");
  let raw;
  try {
    raw = read.read(input.source);
  } catch (error) {
    if (error instanceof ReportReadError) return fail(422, "No se pudo leer el reporte.", "unreadable", error.problems);
    throw error;
  }
  const client = await visibleClient(reader, input.clientId);
  if (!client) return fail(404, NOT_YOURS, "not_visible");
  const at = now.toISOString();
  const plan = planImport(client, raw, at);
  if (plan.blocked) return fail(409, plan.blocked, "import_blocked");
  const merged = mergeReport(client, raw, { at, by: member.handle, readerKey: read.key });

  // The report as planImport dated it (a few hours ahead counts as now).
  const result = await importReportForUser(db, input.clientId, { ...raw, pulledAt: plan.report.pulledAt });
  const summary = {
    itemCount: plan.report.items.length,
    removed: plan.diff?.deleted.length ?? 0,
    added: plan.diff?.added.length ?? 0,
    changed: plan.diff?.changed.length ?? 0,
    closedRound: plan.round?.closes ? plan.round.number : null,
  };
  const { error: pullError } = await db
    .from("report_pulls")
    .update({ imported_by: member.userId, imported_by_name: member.handle, reader_key: read.key, import_summary: summary })
    .eq("id", result.pullId);
  if (pullError) throw new Error(`report_pulls: ${pullError.message}`);

  if (plan.round) {
    const round = merged.rounds.find((r) => r.number === plan.round!.number);
    const update: Row = { results: round?.results ?? [] };
    if (plan.round.closes) {
      update.status = "complete";
      update.responded_at = at;
    }
    const { error } = await db.from("attack_rounds").update(update).eq("user_id", input.clientId).eq("round_number", plan.round.number);
    if (error) throw new Error(`attack_rounds: ${error.message}`);
  }
  return { ok: true, pullId: result.pullId, itemCount: result.itemCount };
}

/** Keep a report page exactly as received, for a provider with no reader yet. Nothing is read from it. */
export async function saveStaffSample(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: StaffMember,
  input: { clientId: string; provider: string; text: string; fileName?: string | null },
): Promise<ActionResult<{ sample: { id: string; provider: string; savedAt: string; savedBy: string; fileName: string | null; text: string } }>> {
  if (!getReportReader(input.provider)) return fail(400, "Ese proveedor no existe.", "unknown_reader");
  if ((await memberCanSee(reader, input.clientId, "case")) !== "client") return fail(404, NOT_YOURS, "not_visible");
  const { data, error } = await db
    .from("report_samples")
    .insert({ user_id: input.clientId, provider: input.provider, file_name: input.fileName ?? null, body: input.text, saved_by: member.userId, saved_by_name: member.handle })
    .select("id, saved_at")
    .single();
  if (error || !data) throw new Error(`report_samples: ${error?.message ?? "no row"}`);
  const row = data as Row;
  return {
    ok: true,
    sample: { id: String(row.id), provider: input.provider, savedAt: new Date(String(row.saved_at)).toISOString(), savedBy: member.handle, fileName: input.fileName ?? null, text: input.text },
  };
}

// ── Sending rounds ──────────────────────────────────────────────────────

export interface RoundOutcome {
  clientId: string;
  roundNumber: number;
  sent: boolean;
  letters?: number;
  reason?: string;
  code?: string;
}

/**
 * Send prepared rounds. Each one is checked twice before a letter leaves:
 * with the console's own rules (stage.ts sendableRound and the send plan's
 * blockers, over what this member can see and the address book), then by
 * rounds/send.ts against the database with the service role (the agreement
 * gate, attestation on every item, the client's and every furnisher's
 * address). A round that may not go is left out, with the reason.
 */
export async function sendStaffRounds(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: StaffMember,
  input: { rounds: Array<{ clientId: string; roundNumber: number }>; via: "mail" | "print"; mailClasses?: Readonly<Record<string, MailClass>> },
  options: { now?: Date; deps?: SendRoundOptions["deps"] } = {},
): Promise<{ outcomes: RoundOutcome[] }> {
  const now = options.now ?? new Date();
  const { data: bookRows, error: bookError } = await reader.from("furnishers").select("*");
  if (bookError) throw new Error(`furnishers: ${bookError.message}`);
  const furnishers = ((bookRows as Row[] | null) ?? []).map(furnisherFromRow);
  const outcomes: RoundOutcome[] = [];
  const seen = new Set<string>();

  for (const ref of input.rounds) {
    const id = `${ref.clientId}#${ref.roundNumber}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const held = (reason: string, code: string): void => void outcomes.push({ ...ref, sent: false, reason, code });

    if ((await memberCanSee(reader, ref.clientId, "case")) !== "client") {
      held(NOT_YOURS, "not_visible");
      continue;
    }
    const client = await visibleClient(reader, ref.clientId);
    const round = client ? sendableRound(client, now, { furnishers }) : null;
    if (!client || !round || round.number !== ref.roundNumber) {
      held((client && sendBlockReason(client, now, { furnishers })) || "La ronda no se puede enviar ahora.", "not_sendable");
      continue;
    }
    const plan = roundMailPlan(client, round, furnishers, now, input.mailClasses);
    if (plan.blockers.length > 0) {
      held(plan.blockers.join(" "), "blocked");
      continue;
    }
    // The classes chosen on the send screen, by the letter's key.
    const classes: Record<string, MailClass> = {};
    for (const letter of plan.letters) {
      const key = plannedLetterKey(letter.letter.id, ref.clientId, ref.roundNumber);
      if (key) classes[key] = letter.mailClass;
    }
    const result = await sendRound(db, {
      userId: ref.clientId,
      roundNumber: ref.roundNumber,
      sender: { kind: "staff", userId: member.userId, name: member.handle },
      requireAgreement: true,
      via: input.via,
      mailClasses: classes,
      now,
      deps: options.deps,
    });
    if (result.ok) outcomes.push({ ...ref, sent: true, letters: result.letters.length });
    else held(result.error, result.code ?? `http_${result.status}`);
  }
  return { outcomes };
}
