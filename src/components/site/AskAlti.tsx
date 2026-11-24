"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { CharacterAvatar } from "@/components/Character";
import type { LiveCopy } from "@/lib/site/live";
import { useReducedMotion } from "./motion";

// "Ask Alti": the website's chat (docs/WEBSITE.md). Visitors type real
// questions; /api/site/ask answers as Alti, the AI assistant (with a model
// key), or from the site's own library (without one). Every answer from Alti
// carries "Alti · AI assistant" beside his face, the header says so too, and
// the first message says he is AI, not a person (docs/BRAND.md, the
// disclosure rule). No personal data is asked for; nothing is stored here or
// on the server beyond counts. Each answer ends with the two gentle actions:
// start a review, or chat with the team on WhatsApp.
//
// Accessible: the thread is a polite live region (each new message is read
// once), the input has a label, Enter sends, the typing indicator is a status,
// and focus returns to the input after each answer.

export type AskCopy = LiveCopy["ask"];

export interface AskCtas {
  start: { href: string; external: boolean };
  whatsapp: string | null;
  faq: string;
}

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const MAX_SENT = 8;

export default function AskAltiChat({
  copy,
  locale,
  byline,
  ctas,
  variant = "panel",
  autoFocus = true,
}: {
  copy: AskCopy;
  locale: "es" | "en";
  /** "Alti · AI assistant", in the page's language. */
  byline: string;
  ctas: AskCtas;
  variant?: "panel" | "phone";
  autoFocus?: boolean;
}) {
  const reduced = useReducedMotion();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>(copy.suggestions);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages, busy, reduced]);

  const ask = async (raw: string) => {
    const text = raw.trim().slice(0, 500);
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    const started = Date.now();
    let reply = copy.error;
    let more: string[] | null = null;
    try {
      const res = await fetch("/api/site/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, messages: next.slice(-MAX_SENT).map((m) => ({ role: m.role, content: m.text })) }),
      });
      if (res.status === 429) reply = copy.rateLimited;
      else if (res.ok) {
        const data = (await res.json()) as { reply?: string; suggestions?: string[] };
        if (data.reply) reply = data.reply;
        if (Array.isArray(data.suggestions)) more = data.suggestions;
      }
    } catch {
      reply = copy.error;
    }
    // A short beat with the typing dots, so an instant answer doesn't jump (none with reduced motion).
    const wait = reduced ? 0 : Math.max(0, 650 - (Date.now() - started));
    window.setTimeout(() => {
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      if (more) setSuggestions(more);
      setBusy(false);
      field.current?.focus({ preventScroll: true });
    }, wait);
  };

  const phone = variant === "phone";
  const lastAnswer = messages.length > 0 && messages[messages.length - 1]!.role === "assistant" ? messages.length - 1 : -1;

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${phone ? "" : "h-full"}`} data-testid="ask-alti">
      <div ref={thread} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-4" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
        {/* Alti's first message: says he is AI, and asks for no personal details. */}
        <AltiMessage byline={byline} first>
          {copy.intro}
          <span className="mt-2 block text-[13px] leading-snug text-slate-500">{copy.privacy}</span>
        </AltiMessage>

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg-in flex justify-end">
              <p className="max-w-[82%] whitespace-pre-line break-words rounded-[20px] rounded-br-md bg-blue-900 px-3.5 py-2.5 text-[15px] text-white">{m.text}</p>
            </div>
          ) : (
            <div key={i}>
              <AltiMessage byline={byline} first>
                {m.text}
              </AltiMessage>
              {i === lastAnswer && (
                <div className="msg-in mt-2 flex flex-wrap gap-2 pl-10" data-testid="ask-ctas">
                  {ctas.start.external ? (
                    <a href={ctas.start.href} target="_blank" rel="noopener" className="pressable inline-flex h-10 items-center gap-1.5 rounded-full bg-amber-400 px-4 text-[14px] font-semibold text-blue-900 hover:bg-amber-500">
                      {copy.ctaStart}
                    </a>
                  ) : (
                    <Link href={ctas.start.href} className="pressable inline-flex h-10 items-center gap-1.5 rounded-full bg-amber-400 px-4 text-[14px] font-semibold text-blue-900 hover:bg-amber-500">
                      {copy.ctaStart}
                      <Icon name="chevron" size={16} strokeWidth={2.25} />
                    </Link>
                  )}
                  {ctas.whatsapp ? (
                    <a href={ctas.whatsapp} target="_blank" rel="noopener" className="pressable inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-semibold text-blue-900 ring-1 ring-inset ring-blue-200 hover:bg-blue-50">
                      <Icon name="chat" size={16} />
                      {copy.ctaWhatsapp}
                    </a>
                  ) : (
                    <Link href={ctas.faq} className="pressable inline-flex h-10 items-center rounded-full bg-white px-4 text-[14px] font-semibold text-blue-900 ring-1 ring-inset ring-blue-200 hover:bg-blue-50">
                      {copy.ctaFaq}
                    </Link>
                  )}
                </div>
              )}
            </div>
          ),
        )}

        {busy && (
          <div className="msg-in flex items-end gap-2" role="status">
            <CharacterAvatar character="assistant" size={30} decorative />
            <div className="flex gap-1 rounded-[20px] rounded-bl-md bg-white px-4 py-3.5 shadow-sm ring-1 ring-black/5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="typing-dot h-2 w-2 rounded-full bg-blue-300" style={{ animationDelay: `${i * 160}ms` }} />
              ))}
            </div>
            <span className="sr-only">{copy.typing}</span>
          </div>
        )}
      </div>

      {/* Suggested questions */}
      {!busy && suggestions.length > 0 && (
        <div className="border-t border-slate-200 bg-white px-3 pt-2.5">
          <p id={`ask-suggest-${variant}`} className="sr-only">
            {copy.suggestionsLabel}
          </p>
          <ul aria-labelledby={`ask-suggest-${variant}`} className="no-scrollbar flex gap-2 overflow-x-auto pb-2.5">
            {suggestions.slice(0, phone ? 3 : 4).map((s) => (
              <li key={s} className="shrink-0">
                <button
                  type="button"
                  onClick={() => ask(s)}
                  className="pressable h-9 whitespace-nowrap rounded-full bg-blue-50 px-3.5 text-[13.5px] font-semibold text-blue-700 hover:bg-blue-100"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className={`flex items-center gap-2 bg-white px-3 pb-3 ${!busy && suggestions.length > 0 ? "" : "border-t border-slate-200 pt-3"}`}
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label htmlFor={`ask-input-${variant}`} className="sr-only">
          {copy.inputLabel}
        </label>
        <input
          ref={field}
          id={`ask-input-${variant}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
          placeholder={copy.placeholder}
          className="h-11 min-w-0 flex-1 rounded-full bg-slate-100 px-4 text-[16px] text-slate-900 placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={copy.send}
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
        >
          <Icon name="chevron" size={20} strokeWidth={2.5} />
        </button>
      </form>
      <p className="bg-white px-4 pb-3 text-[11.5px] leading-snug text-slate-500">{copy.footnote}</p>
    </div>
  );
}

/** One of Alti's messages: his face and "Alti · AI assistant" above the bubble (and for screen readers). */
function AltiMessage({ children, byline, first }: { children: React.ReactNode; byline: string; first: boolean }) {
  return (
    <div className="msg-in" data-testid="ask-alti-message">
      {first && <p className="mb-1 ml-10 text-[11.5px] font-semibold text-slate-500">{byline}</p>}
      <div className="flex items-end gap-2">
        <CharacterAvatar character="assistant" size={30} decorative />
        <div className="max-w-[85%] whitespace-pre-line break-words rounded-[20px] rounded-bl-md bg-white px-3.5 py-2.5 text-[15px] leading-snug text-slate-800 shadow-sm ring-1 ring-black/5">
          <span className="sr-only">{byline}: </span>
          {children}
        </div>
      </div>
    </div>
  );
}
