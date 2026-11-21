"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fromServerTurn, readStoredThread, type ChatMsg, type ServerTurn } from "./chatMessages";

// The thread with Capi. Signed in: the server copy (chat_messages via
// /api/chat, RLS-scoped) is the source of truth, so the conversation follows
// the client across devices. Signed out / demo: localStorage only.
// Same shape as the review store in flagsStore.ts.

export { messageText, type ChatMsg } from "./chatMessages";

const STORAGE_KEY = "bonalti.chat.v1";
const MAX_LOCAL = 200;

function loadLocal(): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return readStoredThread(raw ? (JSON.parse(raw) as unknown) : []);
  } catch {
    return [];
  }
}

function saveLocal(messages: ChatMsg[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_LOCAL)));
  } catch {
    // localStorage unavailable (private mode) — thread stays in memory.
  }
}

export function useChatThread() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const synced = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const local = loadLocal();
    fetch("/api/chat")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { authenticated: boolean; messages: ServerTurn[] } | null) => {
        if (cancelled) return;
        if (data?.authenticated) {
          synced.current = true;
          setSignedIn(true);
          // The server keeps only the text. Where this browser still holds the
          // other-language version of the same line, put it back.
          const known = new Map(local.filter((m) => m.alt && !m.author).map((m) => [`${m.role}|${m.text}`, m]));
          const thread = data.messages.map((turn): ChatMsg => {
            // A teammate's message (source "human") keeps its author and is never a scripted line.
            const m = fromServerTurn(turn);
            if (m.author) return m;
            const mine = known.get(`${m.role}|${m.text}`);
            return mine ? { ...m, lang: mine.lang, alt: mine.alt } : m;
          });
          setMessages(thread);
          saveLocal(thread);
        } else {
          setMessages(local);
        }
      })
      .catch(() => {
        if (!cancelled) setMessages(local);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Add messages to the thread. `remote: false` keeps them out of /api/chat —
   * used for coach exchanges, which the server records itself.
   */
  const append = useCallback((added: ChatMsg[], options?: { remote?: boolean }) => {
    if (added.length === 0) return;
    setMessages((prev) => {
      const next = [...prev, ...added];
      saveLocal(next);
      return next;
    });
    if (synced.current && options?.remote !== false) {
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: added.map((m) => ({ role: m.role, text: m.text.slice(0, 4000) })) }),
      }).catch(() => undefined);
    }
  }, []);

  return { messages, append, hydrated, signedIn };
}
