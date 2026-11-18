"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT } from "@/lib/demo";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { buildAttackPlan } from "@/lib/domain/attack";
import { getCategoryExplainers } from "@/lib/ux/explainers";
import { countByState, useFlags } from "@/lib/ux/flagsStore";
import { useLocale } from "@/lib/i18n";
import type { ItemFlag } from "@/lib/domain/types";
import SpeakButton from "@/components/SpeakButton";
import Icon from "@/components/Icon";

// The conversation. The client's whole journey lives in one thread with their
// AI assistant: it leads with proactive messages and action cards; the client
// decides, attests, and sends — the same three legally load-bearing taps, now
// inside the chat. Free-text questions go to the guardrailed coach. The
// assistant is always identified as AI; a human teammate is one tap away.

interface Msg {
  role: "assistant" | "user";
  text: string;
}

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

/** Button labels in the dictionary carry a leading symbol; the chat uses icons instead. */
const plain = (label: string) => label.replace(/^[^\p{L}]+/u, "");

export default function Asistente() {
  const { locale, d } = useLocale();
  const es = locale === "es";
  const { flags, review, roundApproved, setRoundApproved, hydrated } = useFlags();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");
  const [attestChecked, setAttestChecked] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const items = DEMO_REPORT.items;
  const counts = countByState(flags);
  const pending = useMemo(() => items.filter((i) => !flags[i.fingerprint]), [items, flags]);
  const current = pending[0];
  const negatives = items.filter((i) => i.negative).length;

  const attestedFlags: ItemFlag[] = useMemo(
    () =>
      Object.entries(flags)
        .filter(([, f]) => f.state === "attested" && f.attestedAt)
        .map(([fp, f]) => ({ fingerprint: fp, reason: f.reason ?? "", attested: true, attestedAt: f.attestedAt! })),
    [flags],
  );

  const hasPI = useMemo(
    () => items.some((i) => i.category === "personal_info" && attestedFlags.some((f) => f.fingerprint === i.fingerprint)),
    [items, attestedFlags],
  );
  const plan = useMemo(
    () => buildAttackPlan({ roundNumber: hasPI ? 1 : 2, items, flags: attestedFlags, history: {} }),
    [items, attestedFlags, hasPI],
  );

  const phase: "review" | "attack" | "waiting" | "done-empty" = !hydrated
    ? "review"
    : pending.length > 0
      ? "review"
      : roundApproved
        ? "waiting"
        : counts.attested > 0
          ? "attack"
          : "done-empty";

  // Seed the opening messages once per visit, matched to where the client is.
  useEffect(() => {
    if (!hydrated || messages.length > 0) return;
    const opening: Msg[] = [
      {
        role: "assistant",
        text: es
          ? `Hola 👋 Soy tu asistente de crédito con IA. Ya importé tu reporte de los 3 burós: ${items.length} elementos, ${negatives} posiblemente negativos.`
          : `Hi 👋 I'm your AI credit assistant. I already imported your 3-bureau report: ${items.length} items, ${negatives} possibly negative.`,
      },
    ];
    if (phase === "review") {
      opening.push({
        role: "assistant",
        text: es
          ? `Vamos a revisarlos juntos, uno por uno. Yo te explico cada uno y tú decides. Quedan ${pending.length}.`
          : `Let's review them together, one by one. I explain each and you decide. ${pending.length} left.`,
      });
    } else if (phase === "attack") {
      opening.push({
        role: "assistant",
        text: es
          ? `Tu revisión está completa: ${counts.attested} elemento(s) atestiguados. Preparé tus cartas. Revísalas y dame el OK.`
          : `Your review is complete: ${counts.attested} attested item(s). I prepared your letters. Review them and give me the OK.`,
      });
    } else if (phase === "waiting") {
      opening.push({
        role: "assistant",
        text: es
          ? "Tus cartas van en camino. Los burós tienen ~30 días para responder y yo te aviso aquí con cualquier novedad. ¿Tienes preguntas mientras tanto?"
          : "Your letters are on their way. Bureaus have ~30 days to respond and I'll message you here with any news. Any questions meanwhile?",
      });
    }
    setMessages(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, phase, flagging]);

  const say = (text: string) => setMessages((m) => [...m, { role: "assistant", text }]);
  const youSay = (text: string) => setMessages((m) => [...m, { role: "user", text }]);

  const afterDecision = () => {
    const left = pending.length - 1;
    if (left > 0) {
      say(es ? (left === 1 ? "Anotado. Último elemento:" : `Anotado. Quedan ${left}.`) : left === 1 ? "Noted. Last item:" : `Noted. ${left} left.`);
    } else {
      say(
        es
          ? "¡Revisaste todo! 🎉 Preparé tus cartas. Revísalas abajo y dame el OK cuando estés seguro(a)."
          : "You reviewed everything! 🎉 I prepared your letters. Review them below and give me the OK when you're sure.",
      );
    }
  };

  const decideCorrect = () => {
    if (!current) return;
    youSay(es ? `${current.name}: se ve correcto` : `${current.name}: looks correct`);
    review(current.fingerprint, "correct");
    afterDecision();
  };

  const confirmFlag = () => {
    if (!current || !attestChecked) return;
    youSay(`${current.name}: ${ATTESTATION_TEXT[locale]}`);
    review(current.fingerprint, "attested", { reason, attestedAt: new Date().toISOString() });
    setFlagging(false);
    setReason("");
    setAttestChecked(false);
    afterDecision();
  };

  const approve = () => {
    youSay(es ? "Apruebo. Envía mi ataque." : "Approved. Send my attack.");
    setRoundApproved(true);
    say(
      es
        ? "¡Hecho! 📬 Tus cartas se imprimen y van por correo. Los burós tienen ~30 días; yo vigilo el calendario y te aviso aquí. No tienes que hacer nada más."
        : "Done! 📬 Your letters are being printed and mailed. Bureaus have ~30 days; I watch the calendar and message you here. Nothing else to do.",
    );
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    youSay(q);
    setInput("");
    setBusy(true);
    const wantsHuman = /persona|humano|alguien|person|human/i.test(q);
    const fallback = es
      ? wantsHuman
        ? "¡Claro! Te conecto con una persona del equipo. En tu cuenta real, este mismo chat continúa en WhatsApp con alguien de nuestro equipo. Mientras tanto sigo yo: ¿en qué te ayudo?"
        : "Buena pregunta. El coach completo se activa al conectar tu cuenta. Mientras tanto, revisa las explicaciones junto a cada elemento, o pide hablar con una persona del equipo."
      : wantsHuman
        ? "Of course! I'll connect you with a teammate. On your real account this same chat continues on WhatsApp with someone from our team. Meanwhile I'm here: how can I help?"
        : "Good question. The full coach activates once your account is connected. Meanwhile, check the explanations next to each item, or ask for a human teammate.";
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
      });
      if (res.ok) {
        const { reply } = (await res.json()) as { reply: string };
        say(reply);
      } else {
        say(fallback);
      }
    } catch {
      say(fallback);
    } finally {
      setBusy(false);
    }
  };

  if (!hydrated) return null;
  const explainer = current ? getCategoryExplainers(locale)[current.category] : null;

  return (
    <main className="card animate-rise -mt-1 flex h-[calc(100dvh-9.75rem)] flex-col overflow-hidden sm:h-[calc(100dvh-8.5rem)]">
      <header className="flex items-center gap-3 border-b hairline px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-700 text-white">
          <Icon name="sparkle" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold leading-tight text-slate-900">
            {es ? "Tu asistente" : "Your assistant"}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            {es ? "Inteligencia artificial" : "Artificial intelligence"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => ask(es ? "Quiero hablar con una persona" : "I want to talk to a person")}
          className="pressable flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-3.5 text-[13px] font-semibold text-slate-900"
        >
          <Icon name="person" size={16} />
          {es ? "Persona" : "Human"}
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {messages.map((m, i) => (
          <div key={i} className={`animate-rise flex items-end gap-1.5 ${m.role === "user" ? "justify-end" : ""}`}>
            <div
              className={`max-w-[80%] whitespace-pre-line px-4 py-2.5 text-[16px] leading-snug ${
                m.role === "user"
                  ? "rounded-[22px] rounded-br-md bg-blue-700 text-white"
                  : "rounded-[22px] rounded-bl-md bg-slate-100 text-slate-900"
              }`}
            >
              {m.text}
            </div>
            {m.role === "assistant" && <SpeakButton text={m.text} compact />}
          </div>
        ))}

        {phase === "review" && current && (
          <div className="animate-rise mt-3 rounded-3xl border hairline bg-white p-5 shadow-[0_8px_24px_-14px_rgba(0,0,0,0.25)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {BUREAU_LABEL[current.bureau]}
                {current.negative && (
                  <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-red-700">
                    {d.items.negativeBadge}
                  </span>
                )}
              </p>
              {explainer && (
                <SpeakButton text={`${current.name}. ${explainer.what} ${explainer.checkHints.slice(0, 3).join(" ")}`} />
              )}
            </div>
            <p className="mt-2 text-[22px] font-semibold leading-tight text-slate-900">{current.name}</p>
            {explainer && <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{explainer.what}</p>}
            {explainer && (
              <ul className="mt-3 space-y-2">
                {explainer.checkHints.slice(0, 3).map((h, i) => (
                  <li key={i} className="flex gap-2 text-[14px] leading-snug text-slate-600">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    {h}
                  </li>
                ))}
              </ul>
            )}

            {!flagging ? (
              <div className="mt-5 grid gap-2.5">
                <button
                  onClick={decideCorrect}
                  className="pressable flex h-[52px] items-center justify-center gap-2 rounded-full bg-slate-100 text-[16px] font-semibold text-slate-900"
                >
                  <Icon name="check" size={18} className="text-green-600" strokeWidth={2.25} />
                  {plain(d.items.looksCorrect)}
                </button>
                <button
                  onClick={() => setFlagging(true)}
                  className="pressable flex h-[52px] items-center justify-center rounded-full bg-blue-50 text-[16px] font-semibold text-blue-700"
                >
                  {plain(d.items.looksWrong)}
                </button>
              </div>
            ) : (
              <div className="mt-5">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={d.items.reasonPlaceholder}
                  className="h-12 w-full rounded-2xl bg-slate-100 px-4 text-[15px] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
                />
                <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl bg-blue-50 p-4 text-[15px] leading-snug text-slate-900">
                  <input
                    type="checkbox"
                    checked={attestChecked}
                    onChange={(e) => setAttestChecked(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
                  />
                  <span>{ATTESTATION_TEXT[locale]}</span>
                </label>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2.5">
                  <button
                    onClick={confirmFlag}
                    disabled={!attestChecked}
                    className="pressable h-[52px] rounded-full bg-blue-700 text-[16px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    {d.items.confirm}
                  </button>
                  <button
                    onClick={() => {
                      setFlagging(false);
                      setAttestChecked(false);
                    }}
                    className="pressable h-[52px] rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-700"
                  >
                    {d.items.back}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase === "attack" && (
          <div className="animate-rise mt-3 rounded-3xl border hairline bg-white p-5 shadow-[0_8px_24px_-14px_rgba(0,0,0,0.25)]">
            <p className="text-[20px] font-semibold text-slate-900">{d.attack.title(hasPI ? 1 : 2)}</p>
            <ul className="mt-3 divide-y divide-slate-100">
              {plan.letters.slice(0, 4).map((l, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5 text-[15px] text-slate-700">
                  <Icon name="doc" size={18} className="shrink-0 text-slate-400" />
                  <span className="truncate">{l.target.name}</span>
                </li>
              ))}
            </ul>
            {plan.letters.length > 4 && (
              <p className="pt-1 text-[13px] text-slate-500">
                +{plan.letters.length - 4} {es ? "cartas más" : "more letters"}
              </p>
            )}
            <button
              onClick={approve}
              className="pressable mt-4 h-14 w-full rounded-full bg-blue-700 text-[17px] font-semibold text-white hover:bg-blue-800"
            >
              {es ? `Aprobar y enviar ${plan.letters.length} cartas` : `Approve and send ${plan.letters.length} letters`}
            </button>
            <Link href="/attack" className="mt-3 block text-center text-[15px] font-medium text-blue-700">
              {es ? "Leer cada carta completa" : "Read each full letter"}
            </Link>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">{d.attack.approveNote}</p>
          </div>
        )}

        {phase === "done-empty" && (
          <div className="animate-rise mt-3 rounded-3xl bg-green-50 p-5 text-[15px] leading-relaxed text-green-900">
            {d.items.doneNoItems}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex items-center gap-2 border-t hairline px-3 py-2.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={es ? "Pregúntame lo que sea" : "Ask me anything"}
          aria-label={es ? "Escribe tu mensaje" : "Type your message"}
          className="h-11 flex-1 rounded-full bg-slate-100 px-5 text-[16px] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={es ? "Enviar" : "Send"}
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          <Icon name="arrowUp" size={20} strokeWidth={2.25} />
        </button>
      </form>
    </main>
  );
}
