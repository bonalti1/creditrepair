import type { LeadMessage } from "./types";

// Reading a lead's conversation from HighLevel (its Conversations API), for
// leads whose chat happens in HighLevel's own inbox. OFF by default: the app
// sits on top of HighLevel and never rebuilds it, so this only READS, never
// sends, and only when the owner turns it on:
//
//   LEAD_CONVERSATIONS_PROVIDER=highlevel
//   HIGHLEVEL_API_TOKEN=<a Private Integration token with conversations.readonly>
//   HIGHLEVEL_LOCATION_ID=<the Credalti sub-account's location id>
//
// Anything else (unset, "none", a missing token) means no call is ever made.
// What was checked: the endpoints and the Version header follow HighLevel's
// public API v2 documentation as remembered at build time; the build machine
// could not open it, so this is UNVERIFIED against a live account (docs/CONTROL.md).
// Tests run it against a mocked fetch only.

export type ConversationProviderName = "none" | "highlevel";

export interface ConversationProvider {
  name: Exclude<ConversationProviderName, "none">;
  /** The contact's recent messages, oldest first, or why there are none. */
  messages(contactId: string): Promise<{ ok: true; messages: LeadMessage[] } | { ok: false; reason: string }>;
}

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-04-15";
const CONTACT_ID = /^[A-Za-z0-9_-]{4,64}$/;

export function conversationProviderName(env: Record<string, string | undefined> = process.env): ConversationProviderName {
  return env.LEAD_CONVERSATIONS_PROVIDER === "highlevel" && env.HIGHLEVEL_API_TOKEN && env.HIGHLEVEL_LOCATION_ID ? "highlevel" : "none";
}

type Fetch = typeof fetch;

export function highlevelConversations(env: Record<string, string | undefined>, fetcher: Fetch = fetch): ConversationProvider {
  const token = env.HIGHLEVEL_API_TOKEN ?? "";
  const location = env.HIGHLEVEL_LOCATION_ID ?? "";
  const get = async (path: string) => {
    const res = await fetcher(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HighLevel ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  return {
    name: "highlevel",
    async messages(contactId) {
      if (!CONTACT_ID.test(contactId)) return { ok: false, reason: "bad_contact" };
      try {
        const search = await get(`/conversations/search?locationId=${encodeURIComponent(location)}&contactId=${encodeURIComponent(contactId)}&limit=1`);
        const conversation = (search.conversations as Array<Record<string, unknown>> | undefined)?.[0];
        if (!conversation?.id) return { ok: true, messages: [] };
        const page = await get(`/conversations/${encodeURIComponent(String(conversation.id))}/messages?limit=40`);
        const raw = ((page.messages as Record<string, unknown> | undefined)?.messages ?? page.messages ?? []) as Array<Record<string, unknown>>;
        const messages = (Array.isArray(raw) ? raw : [])
          .filter((m) => typeof m.body === "string" && m.body.trim())
          .map(
            (m): LeadMessage => ({
              id: `hl-${String(m.id ?? Math.random())}`,
              at: new Date(String(m.dateAdded ?? m.createdAt ?? Date.now())).toISOString(),
              role: m.direction === "inbound" ? "user" : "assistant",
              source: "highlevel",
              text: String(m.body).slice(0, 4000),
            }),
          )
          .sort((a, b) => a.at.localeCompare(b.at));
        return { ok: true, messages };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message.slice(0, 80) : "error" };
      }
    },
  };
}

/** The provider the server uses, or null (the default: no external calls). */
export function conversationProvider(env: Record<string, string | undefined> = process.env, fetcher: Fetch = fetch): ConversationProvider | null {
  return conversationProviderName(env) === "highlevel" ? highlevelConversations(env, fetcher) : null;
}
