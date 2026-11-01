"use client";

import { useEffect, useRef, useState } from "react";

// Floating AI Credit Coach (spec §4.3), available on every app page — Dispute
// Beast buries its coach; ours is one tap away with contextual quick questions.
// Falls back to canned educational answers when the API isn't configured, so
// the demo experience never dead-ends.

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const QUICK_QUESTIONS = [
  "¿Qué es un charge-off?",
  "¿Qué pasa después de enviar mis cartas?",
  "¿Debo disputar algo que sí es mío?",
];

const OFFLINE_ANSWERS: Record<string, string> = {
  "¿Qué es un charge-off?":
    "Un «charge-off» significa que el acreedor dio tu deuda por perdida en sus libros, normalmente tras ~6 meses sin pago. La deuda sigue existiendo y puede pasar a cobranza. En tu reporte, vale la pena verificar el saldo, las fechas y que no aparezca duplicada.",
  "¿Qué pasa después de enviar mis cartas?":
    "Los burós tienen ~30 días para investigar cada elemento que disputaste. Pueden verificarlo, corregirlo o eliminarlo, y deben responderte por escrito. Cuando tu reporte se actualice (~40 días), lo comparamos y te mostramos exactamente qué cambió.",
  "¿Debo disputar algo que sí es mío?":
    "No. Disputar es para elementos que crees inexactos, no verificables o desactualizados. Si una cuenta es tuya y los datos son correctos, hay caminos legítimos: pagarla, negociar, o dejar que envejezca — pregúntame y te los explico.",
};

const OFFLINE_FALLBACK =
  "El coach con IA se activa al conectar tu cuenta. Mientras tanto, prueba una de las preguntas rápidas de abajo, o revisa las explicaciones «¿Qué es esto?» junto a cada elemento de tu reporte.";

export default function CoachWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "¡Hola! Soy tu coach de crédito. Pregúntame lo que sea sobre tu reporte o el proceso de disputa. Recuerda: tú decides, yo explico. 🙂",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const nextMessages: Msg[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-10) }),
      });
      if (res.ok) {
        const { reply } = (await res.json()) as { reply: string };
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: OFFLINE_ANSWERS[question] ?? OFFLINE_FALLBACK },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: OFFLINE_ANSWERS[question] ?? OFFLINE_FALLBACK },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Coach de crédito"
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-700 text-2xl text-white shadow-lg transition hover:bg-blue-800 sm:bottom-6"
      >
        {open ? "×" : "💬"}
      </button>

      {open && (
        <div className="fixed bottom-36 right-4 z-40 flex h-[28rem] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:bottom-24">
          <div className="bg-blue-700 px-4 py-3 text-white">
            <p className="font-semibold">Coach de crédito</p>
            <p className="text-xs text-blue-100">Explica, no promete. Los resultados varían.</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-blue-700 text-white"
                    : "bg-slate-100 text-slate-800"
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && <div className="w-16 rounded-2xl bg-slate-100 px-3 py-2 text-sm">…</div>}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-slate-100 p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-800 hover:bg-blue-100"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escribe tu pregunta…"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              >
                Enviar
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
