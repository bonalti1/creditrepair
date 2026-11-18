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

// The chat-first home: the client's entire journey lives in one conversation
// with their AI assistant. The assistant drives (proactive messages + action
// cards inline); the client decides, attests, and sends — the same three
// legally load-bearing taps, now inside the thread. Free-text questions go to
// the guardrailed coach. Every automated voice is labeled AI; human teammates
// join the same thread (via WhatsApp bridge in production) without the label.

interface Msg {
  role: "assistant" | "user";
  text: string;
}

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

const OFFLINE_ANSWERS_ES: Record<string, string> = {
  persona:
    "¡Claro! Te conecto con una persona del equipo — en producción, este mismo chat sigue en WhatsApp y un humano continúa la conversación (sin el 🤖). Mientras tanto, sigo yo: ¿en qué te ayudo?",
};

export default function Asistente() {
  const { locale, d } = useLocale();
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
    const es = locale === "es";
    const opening: Msg[] = [
      {
        role: "assistant",
        text: es
          ? `¡Hola! 👋 Soy tu asistente de crédito (IA 🤖). Ya importé tu reporte de los 3 burós: ${items.length} elementos, ${negatives} posiblemente negativos.`
          : `Hi! 👋 I'm your credit assistant (AI 🤖). I already imported your 3-bureau report: ${items.length} items, ${negatives} possibly negative.`,
      },
    ];
    if (phase === "review") {
      opening.push({
        role: "assistant",
        text: es
          ? `Vamos a revisarlos juntos, uno por uno. Yo te explico cada uno — tú decides. Quedan ${pending.length}. 👇`
          : `Let's review them together, one by one. I explain each — you decide. ${pending.length} left. 👇`,
      });
    } else if (phase === "attack") {
      opening.push({
        role: "assistant",
        text: es
          ? `Tu revisión está completa: ${counts.attested} elemento(s) atestiguados. Preparé tus cartas — revísalas y dame el OK. 👇`
          : `Your review is complete: ${counts.attested} attested item(s). I prepared your letters — review and give me the OK. 👇`,
      });
    } else if (phase === "waiting") {
      opening.push({
        role: "assistant",
        text: es
          ? "Tus cartas van en camino 📬. Los burós tienen ~30 días para responder — te aviso aquí con cualquier novedad. ¿Preguntas mientras tanto?"
          : "Your letters are on their way 📬. Bureaus have ~30 days to respond — I'll message you here with any news. Questions meanwhile?",
      });
    }
    setMessages(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase, flagging]);

  const say = (text: string) => setMessages((m) => [...m, { role: "assistant", text }]);
  const youSay = (text: string) => setMessages((m) => [...m, { role: "user", text }]);

  const decideCorrect = () => {
    if (!current) return;
    youSay(locale === "es" ? `✓ "${current.name}" se ve correcto` : `✓ "${current.name}" looks correct`);
    review(current.fingerprint, "correct");
    afterDecision(1);
  };

  const confirmFlag = () => {
    if (!current || !attestChecked) return;
    youSay(
      locale === "es"
        ? `⚠️ "${current.name}" — creo que es inexacto. ${ATTESTATION_TEXT.es}`
        : `⚠️ "${current.name}" — I believe it's inaccurate. ${ATTESTATION_TEXT.en}`,
    );
    review(current.fingerprint, "attested", { reason, attestedAt: new Date().toISOString() });
    setFlagging(false);
    setReason("");
    setAttestChecked(false);
    afterDecision(1);
  };

  const afterDecision = (justDone: number) => {
    const left = pending.length - justDone;
    if (left > 0) {
      say(
        locale === "es"
          ? `Anotado. ${left === 1 ? "Último elemento" : `Quedan ${left}`}: 👇`
          : `Noted. ${left === 1 ? "Last item" : `${left} left`}: 👇`,
      );
    } else {
      say(
        locale === "es"
          ? "¡Revisaste todo! 🎉 Dame un segundo… preparé tus cartas. Revísalas abajo y dame el OK cuando estés seguro(a)."
          : "You reviewed everything! 🎉 One second… I prepared your letters. Review below and give me the OK when you're sure.",
      );
    }
  };

  const approve = () => {
    youSay(locale === "es" ? "✅ Apruebo — envía mi ataque" : "✅ Approved — send my attack");
    setRoundApproved(true);
    say(
      locale === "es"
        ? "¡Hecho! 🚀📬 Tus cartas se imprimen y van por correo. Los burós tienen ~30 días; yo vigilo el calendario y te aviso aquí. No tienes que hacer nada más."
        : "Done! 🚀📬 Your letters are being printed and mailed. Bureaus have ~30 days; I watch the clock and message you here. Nothing else to do.",
    );
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    youSay(q);
    setInput("");
    setBusy(true);
    const fallback =
      locale === "es"
        ? /persona|humano|alguien/i.test(q)
          ? OFFLINE_ANSWERS_ES.persona
          : "🤖 Buena pregunta. El coach con IA completo se activa al conectar tu cuenta — mientras tanto, revisa las explicaciones junto a cada elemento, o pide hablar con una persona del equipo."
        : "🤖 Good question. The full AI coach activates once your account is connected — meanwhile, check the explanations next to each item, or ask for a human teammate.";
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
      });
      if (res.ok) {
        const { reply } = (await res.json()) as { reply: string };
        say(`🤖 ${reply}`);
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
    <main className="mx-auto -my-4 flex h-[calc(100dvh-170px)] max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:my-0 sm:h-[calc(100dvh-150px)]">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xl">🤖</div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight text-slate-900">
            {locale === "es" ? "Tu asistente" : "Your assistant"}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {locale === "es" ? "IA · disponible 24/7" : "AI · available 24/7"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => ask(locale === "es" ? "Quiero hablar con una persona" : "I want to talk to a person")}
          className="shrink-0 rounded-full border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800 hover:border-green-500"
        >
          🤝 {locale === "es" ? "Persona" : "Human"}
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex items-end gap-1.5 ${m.role === "user" ? "justify-end" : ""}`}>
            <div
              className={`max-w-[82%] whitespace-pre-line px-4 py-2.5 text-base leading-relaxed ${
                m.role === "user"
                  ? "rounded-2xl rounded-br-md bg-blue-700 text-white"
                  : "rounded-2xl rounded-bl-md border border-slate-200 bg-white text-slate-800"
              }`}
            >
              {m.text}
            </div>
            {m.role === "assistant" && <SpeakButton text={m.text} compact />}
          </div>
        ))}

        {phase === "review" && current && (
          <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {BUREAU_LABEL[current.bureau]}
              {current.negative && (
                <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] normal-case text-red-700">
                  {d.items.negativeBadge}
                </span>
              )}
            </p>
            <div className="mt-1 flex items-start justify-between gap-2">
              <p className="text-lg font-bold text-slate-900">{current.name}</p>
              {explainer && (
                <SpeakButton
                  text={`${current.name}. ${explainer.what} ${explainer.checkHints.slice(0, 3).join(" ")}`}
                  className="shrink-0"
                />
              )}
            </div>
            {explainer && <p className="mt-1.5 text-sm text-slate-600">{explainer.what}</p>}
            {explainer && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
                {explainer.checkHints.slice(0, 3).map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
            {!flagging ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  onClick={decideCorrect}
                  className="min-h-[52px] rounded-xl border-2 border-green-200 bg-green-50 px-3 py-3 text-base font-semibold text-green-800 hover:border-green-400"
                >
                  {d.items.looksCorrect}
                </button>
                <button
                  onClick={() => setFlagging(true)}
                  className="min-h-[52px] rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-3 text-base font-semibold text-blue-800 hover:border-blue-400"
                >
                  {d.items.looksWrong}
                </button>
              </div>
            ) : (
              <div className="mt-3">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={d.items.reasonPlaceholder}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <label className="mt-2 flex items-start gap-2 rounded-lg bg-blue-50 p-2.5 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={attestChecked}
                    onChange={(e) => setAttestChecked(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{ATTESTATION_TEXT[locale]}</span>
                </label>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={confirmFlag}
                    disabled={!attestChecked}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
                  >
                    {d.items.confirm}
                  </button>
                  <button
                    onClick={() => {
                      setFlagging(false);
                      setAttestChecked(false);
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
                  >
                    {d.items.back}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase === "attack" && (
          <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
            <p className="font-bold text-slate-900">{d.attack.title(hasPI ? 1 : 2)}</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {plan.letters.slice(0, 5).map((l, i) => (
                <li key={i}>📄 {l.target.name}</li>
              ))}
              {plan.letters.length > 5 && (
                <li className="text-slate-400">
                  +{plan.letters.length - 5} {locale === "es" ? "más" : "more"}
                </li>
              )}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={approve}
                className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
              >
                {d.attack.approveButton(plan.letters.length)}
              </button>
              <Link href="/attack" className="text-sm font-semibold text-blue-700 underline">
                {locale === "es" ? "Leer cada carta completa" : "Read each full letter"}
              </Link>
            </div>
            <p className="mt-2 text-xs text-slate-500">{d.attack.approveNote}</p>
          </div>
        )}

        {phase === "done-empty" && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
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
        className="flex items-center gap-2 border-t border-slate-100 bg-white p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={locale === "es" ? "Pregúntame lo que sea…" : "Ask me anything…"}
          className="min-h-[48px] flex-1 rounded-full border border-slate-300 bg-slate-50 px-5 text-base outline-none focus:border-blue-500 focus:bg-white"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={locale === "es" ? "Enviar" : "Send"}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-700 text-lg text-white disabled:bg-slate-300"
        >
          ➤
        </button>
      </form>
      <p className="bg-white px-3 pb-2 text-center text-[11px] text-slate-400">
        {locale === "es"
          ? "Respuestas automáticas marcadas con 🤖 son de IA. Pide una persona cuando quieras."
          : "Replies marked 🤖 are AI. Ask for a human anytime."}
      </p>
    </main>
  );
}
