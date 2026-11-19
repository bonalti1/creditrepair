import type { SupabaseClient } from "@supabase/supabase-js";

// Server-side conversation history (table: chat_messages).

export type ChatRole = "user" | "assistant";
export type ChatSource = "journey" | "coach" | "human";
export type ChatChannel = "app" | "whatsapp";

export interface ChatTurn {
  role: ChatRole;
  text: string;
  at?: string;
}

export const MAX_MESSAGE_CHARS = 4000;

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
  const { data } = await db
    .from("chat_messages")
    .select("role, body, created_at")
    .eq("user_id", userId)
    .eq("channel", "app")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? [])
    .reverse()
    .map((row) => ({ role: row.role as ChatRole, text: row.body as string, at: row.created_at as string }));
}

export async function loadWhatsAppThread(
  db: SupabaseClient,
  phoneE164: string,
  options: { limit?: number; sinceMs?: number } = {},
): Promise<ChatTurn[]> {
  const since = new Date(Date.now() - (options.sinceMs ?? 24 * 60 * 60 * 1000)).toISOString();
  const { data } = await db
    .from("chat_messages")
    .select("role, body, created_at")
    .eq("phone_e164", phoneE164)
    .eq("channel", "whatsapp")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 10);
  return (data ?? [])
    .reverse()
    .map((row) => ({ role: row.role as ChatRole, text: row.body as string, at: row.created_at as string }));
}

export interface StoreRow {
  userId?: string | null;
  phoneE164?: string | null;
  channel: ChatChannel;
  role: ChatRole;
  source: ChatSource;
  text: string;
  externalId?: string | null;
}

/** Returns false when the row was a duplicate (same external_id) or failed. */
export async function storeMessage(db: SupabaseClient, row: StoreRow): Promise<boolean> {
  const text = row.text.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text) return false;
  const { error } = await db.from("chat_messages").insert({
    user_id: row.userId ?? null,
    phone_e164: row.phoneE164 ?? null,
    channel: row.channel,
    role: row.role,
    source: row.source,
    body: text,
    external_id: row.externalId ?? null,
  });
  return !error;
}
