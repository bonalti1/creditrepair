import type { SupabaseClient } from "@supabase/supabase-js";
import { checkStaffReply, type ReplyProblem } from "../staff/conversation";
import type { StaffLocale } from "../staff/i18n/locale";
import { LIVE_CHAT_COPY, liveChatMessageFromRow, liveChatThreadFromRow, redactPersonText, type LiveChatThread } from "./liveChat";
import { altiLiveReply } from "./liveChatAlti";
import { ownedCase } from "./server";

// A person in Alti's signup chat, on the server (migration 0044). The person
// proves the case is theirs with its token (or the account it is linked to),
// exactly as /api/signup does; a teammate acts after requireCapability
// ("leads.work") and reads through their own connection.

type Row = Record<string, unknown>;

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

async function insertMessage(db: SupabaseClient, caseRef: string, m: { author: "person" | "staff" | "alti" | "system"; body: string; staffUser?: string | null; staffName?: string | null }) {
  const { error } = await db.from("signup_chat_messages").insert({ case_ref: caseRef, author: m.author, body: m.body, staff_user: m.staffUser ?? null, staff_name: m.staffName ?? null });
  if (error) throw new Error(`signup_chat_messages: ${error.message}`);
}

export async function loadThread(reader: SupabaseClient, caseRef: string): Promise<LiveChatThread | null> {
  const [thread] = await rows(reader.from("signup_chat_threads").select("*").eq("case_ref", caseRef).limit(1), "signup_chat_threads");
  if (!thread) return null;
  const [caseRow, messages] = await Promise.all([
    rows(reader.from("signup_cases").select("case_ref, step, state, locale").eq("case_ref", caseRef).limit(1), "signup_cases"),
    rows(reader.from("signup_chat_messages").select("id, author, staff_name, body, created_at").eq("case_ref", caseRef).order("created_at", { ascending: true }).limit(500), "signup_chat_messages"),
  ]);
  return liveChatThreadFromRow(thread, caseRow[0] ?? null, messages.map(liveChatMessageFromRow));
}

export type PersonResult = { ok: true; thread: LiveChatThread } | { ok: false; status: number; code: string };

/** "Chat with a person here": opens (or reopens) the thread for the team. */
export async function requestPerson(db: SupabaseClient, input: { caseRef: string; token: string | null; locale: "en" | "es" }, userId: string | null, now: Date = new Date()): Promise<PersonResult> {
  const owned = await ownedCase(db, input.caseRef, input.token, userId);
  if (!owned) return { ok: false, status: 404, code: "not_found" };
  const [existing] = await rows(db.from("signup_chat_threads").select("status").eq("case_ref", input.caseRef).limit(1), "signup_chat_threads");
  if (!existing || existing.status === "handed_back") {
    const { error } = await db
      .from("signup_chat_threads")
      .upsert({ case_ref: input.caseRef, status: "requested", requested_at: now.toISOString(), joined_at: null, joined_by: null, joined_by_name: null, handed_back_at: null, updated_at: now.toISOString() });
    if (error) throw new Error(`signup_chat_threads: ${error.message}`);
    await insertMessage(db, input.caseRef, { author: "system", body: "requested" });
    await insertMessage(db, input.caseRef, { author: "alti", body: LIVE_CHAT_COPY[input.locale].waiting });
  }
  if (owned.wants_person !== true) await db.from("signup_cases").update({ wants_person: true }).eq("case_ref", input.caseRef);
  return { ok: true, thread: (await loadThread(db, input.caseRef))! };
}

/** The person writes. While no teammate is in the chat, Alti answers from the website's library (no model). */
export async function personSend(db: SupabaseClient, input: { caseRef: string; token: string | null; text: string; locale: "en" | "es" }, userId: string | null, now: Date = new Date()): Promise<PersonResult & { removed?: boolean }> {
  const owned = await ownedCase(db, input.caseRef, input.token, userId);
  if (!owned) return { ok: false, status: 404, code: "not_found" };
  const [thread] = await rows(db.from("signup_chat_threads").select("status").eq("case_ref", input.caseRef).limit(1), "signup_chat_threads");
  if (!thread) return { ok: false, status: 409, code: "no_thread" };
  const clean = redactPersonText(input.text);
  if (!clean) return { ok: false, status: 400, code: "empty" };
  await insertMessage(db, input.caseRef, { author: "person", body: clean });
  await db.from("signup_chat_threads").update({ last_person_at: now.toISOString(), updated_at: now.toISOString() }).eq("case_ref", input.caseRef);
  const reply = altiLiveReply(clean, input.locale, thread.status === "joined" ? "joined" : "requested");
  if (reply) await insertMessage(db, input.caseRef, { author: "alti", body: reply });
  return { ok: true, thread: (await loadThread(db, input.caseRef))!, removed: clean !== input.text.replace(/\s+/g, " ").trim().slice(0, 1000) };
}

export async function personRead(db: SupabaseClient, input: { caseRef: string; token: string | null }, userId: string | null): Promise<PersonResult | { ok: true; thread: null }> {
  const owned = await ownedCase(db, input.caseRef, input.token, userId);
  if (!owned) return { ok: false, status: 404, code: "not_found" };
  return { ok: true, thread: await loadThread(db, input.caseRef) };
}

// ── The team ────────────────────────────────────────────────────────────

/** The open chats (waiting or with a teammate in them), and the ones handed back in the last day, newest first. */
export async function listThreads(reader: SupabaseClient, now: Date = new Date()): Promise<LiveChatThread[]> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const [open, recent] = await Promise.all([
    rows(reader.from("signup_chat_threads").select("*").in("status", ["requested", "joined"]).order("requested_at", { ascending: false }).limit(100), "signup_chat_threads"),
    rows(reader.from("signup_chat_threads").select("*").eq("status", "handed_back").gte("updated_at", since).order("requested_at", { ascending: false }).limit(50), "signup_chat_threads"),
  ]);
  const threads = [...open, ...recent].sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
  if (threads.length === 0) return [];
  const refs = threads.map((t) => String(t.case_ref));
  const [cases, messages] = await Promise.all([
    rows(reader.from("signup_cases").select("case_ref, step, state, locale").in("case_ref", refs), "signup_cases"),
    rows(reader.from("signup_chat_messages").select("id, case_ref, author, staff_name, body, created_at").in("case_ref", refs).order("created_at", { ascending: true }).limit(5000), "signup_chat_messages"),
  ]);
  const caseOf = new Map(cases.map((c) => [String(c.case_ref), c]));
  return threads.map((t) => liveChatThreadFromRow(t, caseOf.get(String(t.case_ref)) ?? null, messages.filter((m) => m.case_ref === t.case_ref).map(liveChatMessageFromRow)));
}

export type StaffChatResult = { ok: true; thread: LiveChatThread } | { ok: false; status: number; code: string; problems?: ReplyProblem[] };

const firstName = (name: string) => (name.trim().split(/\s+/)[0] ?? "").slice(0, 40) || "Equipo";

export async function staffJoin(db: SupabaseClient, caseRef: string, member: { userId: string; name: string }, now: Date = new Date()): Promise<StaffChatResult> {
  const [thread] = await rows(db.from("signup_chat_threads").select("status, joined_by").eq("case_ref", caseRef).limit(1), "signup_chat_threads");
  if (!thread) return { ok: false, status: 404, code: "not_found" };
  if (thread.status === "joined" && thread.joined_by === member.userId) return { ok: true, thread: (await loadThread(db, caseRef))! };
  const name = firstName(member.name);
  const { error } = await db.from("signup_chat_threads").update({ status: "joined", joined_at: now.toISOString(), joined_by: member.userId, joined_by_name: name, handed_back_at: null, updated_at: now.toISOString() }).eq("case_ref", caseRef);
  if (error) throw new Error(`signup_chat_threads: ${error.message}`);
  await insertMessage(db, caseRef, { author: "system", body: "joined", staffName: name, staffUser: member.userId });
  return { ok: true, thread: (await loadThread(db, caseRef))! };
}

/** A teammate's reply: the same claim checks as every staff reply, on the server, before it is saved. */
export async function staffReply(db: SupabaseClient, caseRef: string, member: { userId: string; name: string }, text: string, locale: StaffLocale, now: Date = new Date()): Promise<StaffChatResult> {
  const body = text.replace(/\s+\n/g, "\n").trim().slice(0, 2000);
  if (!body) return { ok: false, status: 400, code: "empty" };
  const problems = checkStaffReply(body, locale);
  if (problems.length > 0) return { ok: false, status: 422, code: "reply_rules", problems };
  const [thread] = await rows(db.from("signup_chat_threads").select("status").eq("case_ref", caseRef).limit(1), "signup_chat_threads");
  if (!thread) return { ok: false, status: 404, code: "not_found" };
  if (thread.status !== "joined") return { ok: false, status: 409, code: "join_first" };
  await insertMessage(db, caseRef, { author: "staff", body, staffName: firstName(member.name), staffUser: member.userId });
  await db.from("signup_chat_threads").update({ last_staff_at: now.toISOString(), updated_at: now.toISOString() }).eq("case_ref", caseRef);
  return { ok: true, thread: (await loadThread(db, caseRef))! };
}

export async function staffHandBack(db: SupabaseClient, caseRef: string, now: Date = new Date()): Promise<StaffChatResult> {
  const [thread] = await rows(db.from("signup_chat_threads").select("status").eq("case_ref", caseRef).limit(1), "signup_chat_threads");
  if (!thread) return { ok: false, status: 404, code: "not_found" };
  if (thread.status !== "joined") return { ok: false, status: 409, code: "not_joined" };
  const { error } = await db.from("signup_chat_threads").update({ status: "handed_back", handed_back_at: now.toISOString(), updated_at: now.toISOString() }).eq("case_ref", caseRef);
  if (error) throw new Error(`signup_chat_threads: ${error.message}`);
  await insertMessage(db, caseRef, { author: "system", body: "handed_back" });
  return { ok: true, thread: (await loadThread(db, caseRef))! };
}

/** The red circle: chats where a person is waiting for a teammate. */
export async function waitingCount(reader: SupabaseClient): Promise<number> {
  const { count, error } = await reader.from("signup_chat_threads").select("case_ref", { count: "exact", head: true }).eq("status", "requested");
  if (error) throw new Error(`signup_chat_threads: ${error.message}`);
  return count ?? 0;
}
