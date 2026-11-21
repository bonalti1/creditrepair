import type { SupabaseClient } from "@supabase/supabase-js";

// Server-side conversation history (table: chat_messages).

export type ChatRole = "user" | "assistant";
export type ChatSource = "journey" | "coach" | "human";
export type ChatChannel = "app" | "whatsapp";

export interface ChatTurn {
  role: ChatRole;
  text: string;
  at?: string;
  /** Who produced the turn. Present on turns loaded from the database. */
  source?: ChatSource;
  /** The teammate who wrote it. Only on a turn with source "human" that carries a name. */
  authorName?: string;
}

/** A chat_messages row, as far as a thread needs it. `author_name` exists from migration 0009 on. */
export interface ChatRow {
  role: string;
  body: string;
  created_at: string;
  source?: string | null;
  author_name?: string | null;
}

const SOURCES: readonly ChatSource[] = ["journey", "coach", "human"];

/**
 * One stored row as a turn. The author's name is passed on only for a row a
 * teammate wrote: a name on any other row is ignored, so nothing but a
 * "human" row can ever be shown as written by a person.
 */
export function rowToTurn(row: ChatRow): ChatTurn {
  const turn: ChatTurn = { role: row.role as ChatRole, text: row.body, at: row.created_at };
  const source = SOURCES.find((s) => s === row.source);
  if (source) turn.source = source;
  const name = typeof row.author_name === "string" ? row.author_name.trim() : "";
  if (source === "human" && name) turn.authorName = name;
  return turn;
}

const THREAD_COLUMNS = "role, body, created_at, source";

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_AUTHOR_NAME_CHARS = 80;

/** WhatsApp delivers senders as bare digits; profiles store E.164 with "+". */
export function toE164(waId: string): string {
  const digits = waId.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

/**
 * The Messages API needs the conversation to open with a user turn. Trim any
 * leading assistant lines (the scripted greeting) and cap the length.
 */
export function toModelMessages(turns: ChatTurn[], maxTurns = 12): Array<{ role: ChatRole; content: string }> {
  const recent = turns.filter((t) => t.text.trim().length > 0).slice(-maxTurns);
  const firstUser = recent.findIndex((t) => t.role === "user");
  if (firstUser === -1) return [];
  return recent.slice(firstUser).map((t) => ({ role: t.role, content: t.text.slice(0, MAX_MESSAGE_CHARS) }));
}

export async function loadAppThread(db: SupabaseClient, userId: string, limit = 100): Promise<ChatTurn[]> {
  const query = (columns: string) =>
    db
      .from("chat_messages")
      .select(columns)
      .eq("user_id", userId)
      .eq("channel", "app")
      .order("created_at", { ascending: false })
      .limit(limit);
  // A database that has not run migration 0009 yet has no author_name column:
  // the thread still loads, without names.
  const withAuthor = await query(`${THREAD_COLUMNS}, author_name`);
  const data = withAuthor.error ? (await query(THREAD_COLUMNS)).data : withAuthor.data;
  return ((data ?? []) as unknown as ChatRow[]).reverse().map(rowToTurn);
}

export async function loadWhatsAppThread(
  db: SupabaseClient,
  phoneE164: string,
  options: { limit?: number; sinceMs?: number } = {},
): Promise<ChatTurn[]> {
  const since = new Date(Date.now() - (options.sinceMs ?? 24 * 60 * 60 * 1000)).toISOString();
  const query = (columns: string) =>
    db
      .from("chat_messages")
      .select(columns)
      .eq("phone_e164", phoneE164)
      .eq("channel", "whatsapp")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(options.limit ?? 10);
  const withAuthor = await query(`${THREAD_COLUMNS}, author_name`);
  const data = withAuthor.error ? (await query(THREAD_COLUMNS)).data : withAuthor.data;
  return ((data ?? []) as unknown as ChatRow[]).reverse().map(rowToTurn);
}

export interface StoreRow {
  userId?: string | null;
  phoneE164?: string | null;
  channel: ChatChannel;
  role: ChatRole;
  source: ChatSource;
  text: string;
  externalId?: string | null;
  /** The teammate writing it. Stored only with source "human". */
  authorName?: string | null;
}

/** Returns false when the row was a duplicate (same external_id) or failed. */
export async function storeMessage(db: SupabaseClient, row: StoreRow): Promise<boolean> {
  const text = row.text.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text) return false;
  const authorName = row.source === "human" ? (row.authorName ?? "").trim().slice(0, MAX_AUTHOR_NAME_CHARS) : "";
  const { error } = await db.from("chat_messages").insert({
    user_id: row.userId ?? null,
    phone_e164: row.phoneE164 ?? null,
    channel: row.channel,
    role: row.role,
    source: row.source,
    body: text,
    external_id: row.externalId ?? null,
    // Sent only when there is a name, so rows written by Capi or the client
    // are stored the same way on a database without the column (before 0009).
    ...(authorName ? { author_name: authorName } : {}),
  });
  return !error;
}
