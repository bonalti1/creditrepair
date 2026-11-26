"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CharacterAvatar } from "@/components/Character";
import { aiByline, teamByline } from "@/lib/brand";
import { altiPaused, hadNumberRemoved, LIVE_CHAT_COPY, POLL_MS, systemLine, type LiveChatThread } from "@/lib/signup/liveChat";
import { demoAutoJoin, demoPersonSend, demoRequest, demoThread, DEMO_CHATS_EVENT } from "@/lib/signup/liveChatDemo";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { PersonIcon } from "./TalkToPerson";

// A person joins the signup chat (docs/SIGNUP-CHAT.md, «A person joins the
// chat»). Shown under the signup's own thread once the person asks for a
// human: their messages, Alti's (labelled "Alti · AI assistant", his face),
// and the teammate's (labelled "Rolando · Credalti team", a person icon,
// never a character). While a teammate is in the chat, Alti is paused. The
// signup itself carries on above. Polls every few seconds (no realtime in
// the app); in the demo the thread lives in this browser.

export const LIVE_PERSON_KEY = "bonalti.signupChat.person.v1";

export function rememberLivePerson(caseRef: string): void {
  try {
    window.localStorage.setItem(LIVE_PERSON_KEY, caseRef);
  } catch {
    // This visit only.
  }
}

export function livePersonOpen(caseRef: string): boolean {
  try {
    return window.localStorage.getItem(LIVE_PERSON_KEY) === caseRef;
  } catch {
    return false;
  }
}

async function call(body: Record<string, unknown>): Promise<{ thread: LiveChatThread | null; removed?: boolean } | null> {
  try {
    const res = await fetch("/api/signup/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    return (await res.json()) as { thread: LiveChatThread | null; removed?: boolean };
  } catch {
    return null;
  }
}

export default function LivePerson({
  caseRef,
  token,
  locale,
  step,
  state,
  requested,
  onStatus,
}: {
  caseRef: string;
  token: string | null;
  locale: "en" | "es";
  step: string;
  state: string | null;
  requested: boolean;
  /** Told the thread's status, so the signup pauses Alti's own answers while a teammate is in. */
  onStatus?: (status: LiveChatThread["status"] | null) => void;
}) {
  const c = LIVE_CHAT_COPY[locale];
  const live = isSupabaseConfigured();
  const [thread, setThread] = useState<LiveChatThread | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const [removed, setRemoved] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    if (!live) {
      setThread(demoAutoJoin(caseRef) ?? demoThread(caseRef));
      return;
    }
    const out = await call({ action: "read", caseRef, token });
    if (out) setThread(out.thread);
  }, [live, caseRef, token]);

  // Ask for a person once, when the panel opens from the button; a reopened page only reads.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!requested) {
      void refresh();
      return;
    }
    if (!live) {
      setThread(demoRequest({ caseRef, locale, step, state }));
      return;
    }
    void call({ action: "request", caseRef, token, locale }).then((out) => {
      if (out) setThread(out.thread);
      else setError(true);
    });
  }, [requested, live, caseRef, token, locale, step, state, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS.person);
    const again = () => void refresh();
    window.addEventListener("storage", again);
    window.addEventListener(DEMO_CHATS_EVENT, again);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", again);
      window.removeEventListener(DEMO_CHATS_EVENT, again);
    };
  }, [refresh]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.messages.length]);

  const status = thread?.status ?? null;
  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setError(false);
    setRemoved(hadNumberRemoved(value));
    if (!live) {
      setThread(demoPersonSend(caseRef, value, locale));
      setText("");
      return;
    }
    const out = await call({ action: "send", caseRef, token, locale, text: value });
    if (!out) {
      setError(true);
      return;
    }
    setThread(out.thread);
    setText("");
  };

  return (
    <section className="card p-4" aria-labelledby="live-person-title" data-testid="live-person">
      <div className="flex items-center gap-3">
        <PersonIcon size={36} />
        <div className="min-w-0">
          <h2 id="live-person-title" className="text-[17px] font-semibold text-slate-900">
            {c.title}
          </h2>
          {thread && altiPaused(thread.status) && (
            <p className="text-[13px] text-slate-500" data-testid="alti-paused">
              {c.altiPaused}
            </p>
          )}
        </div>
      </div>
      <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-[13.5px] leading-snug text-blue-900">{c.personalInfo}</p>
      <div className="mt-3 space-y-2" role="log" aria-live="polite" data-testid="live-person-thread">
        {(thread?.messages ?? []).map((m) =>
          m.author === "system" ? (
            <p key={m.id} className="mx-auto max-w-sm rounded-full bg-slate-100 px-3 py-1 text-center text-[13px] text-slate-600">
              {systemLine(m, locale)}
            </p>
          ) : m.author === "person" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-line break-words rounded-[22px] rounded-br-md bg-blue-700 px-4 py-2.5 text-[16px] leading-snug text-white">{m.text}</p>
            </div>
          ) : (
            <div key={m.id}>
              <p className={`mb-1 ml-9 text-xs font-semibold ${m.author === "staff" ? "text-blue-700" : "text-slate-500"}`} data-testid={m.author === "staff" ? "team-byline" : "ai-byline"}>
                {m.author === "staff" ? teamByline(m.staffName ?? "", locale) : aiByline(locale)}
              </p>
              <div className="flex items-end gap-1.5">
                {m.author === "staff" ? <PersonIcon size={28} /> : <CharacterAvatar character="assistant" size={28} decorative className="mb-0.5" />}
                <p className={`max-w-[85%] whitespace-pre-line break-words rounded-[22px] rounded-bl-md px-4 py-2.5 text-[16px] leading-snug ${m.author === "staff" ? "bg-blue-50 text-blue-950" : "bg-slate-100 text-slate-900"}`}>
                  <span className="sr-only">{m.author === "staff" ? teamByline(m.staffName ?? "", locale) : aiByline(locale)}: </span>
                  {m.text}
                </p>
              </div>
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      {removed && <p className="mt-2 text-[13px] text-slate-600">{c.numberRemoved}</p>}
      {error && (
        <p className="mt-2 text-[14px] text-red-700" role="alert">
          {c.error}
        </p>
      )}
      <form onSubmit={send} className="mt-3 flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{c.placeholder}</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={c.placeholder}
            className="h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
            data-testid="live-person-input"
          />
        </label>
        <button type="submit" disabled={!text.trim()} className="pressable h-12 shrink-0 rounded-full bg-amber-400 px-5 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500" data-testid="live-person-send">
          {c.send}
        </button>
      </form>
    </section>
  );
}
