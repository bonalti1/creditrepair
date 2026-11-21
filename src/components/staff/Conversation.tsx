"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import {
  checkStaffReply,
  displayName,
  lastTeamMessage,
  MAX_REPLY_CHARS,
  openQuestions,
  threadAuthor,
  type ReplyProblem,
  type ThreadVoice,
} from "@/lib/staff/conversation";
import type { StaffData } from "@/lib/staff/data";
import { relativeDay, shortDateTime } from "@/lib/staff/format";
import { STAFF_MESSAGE_RULES } from "@/lib/staff/messages";
import type { StaffClient } from "@/lib/staff/types";
import { rememberStaffName, staffName } from "@/lib/staff/useStaff";
import { messageVoice } from "@/lib/ux/chatMessages";
import Icon from "@/components/Icon";
import TeamMessage from "@/components/TeamMessage";
import { PRIMARY_BUTTON, SectionTitle } from "@/components/staff/ui";

// The client's conversation in the app, and a box to answer in it.
//
// Every message is labelled with who wrote it: the client, Capi (always
// marked as AI) or a teammate by name. A reply written here is stored as a
// person's message, signed with the teammate's name. It is checked against
// the claim rules first: a reply that promises a result is not sent, and the
// teammate is shown the phrase and the reason.

const BUBBLE: Record<ThreadVoice, string> = {
  client: "bg-slate-100 text-slate-900",
  capi: "border border-slate-200 bg-white text-slate-700",
  team: "border border-blue-200 bg-blue-50 text-blue-900",
};

const FIELD =
  "w-full rounded-2xl bg-slate-50 px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

export default function Conversation({
  client,
  data,
  now,
  onSent,
}: {
  client: StaffClient;
  data: StaffData;
  now: Date;
  onSent: () => void | Promise<void>;
}) {
  const id = useId();
  const threadRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<ReplyProblem[] | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const thread = client.conversation ?? [];
  const waiting = openQuestions(client);
  const lastReply = lastTeamMessage(thread);

  useEffect(() => {
    const stored = staffName();
    setName(stored);
    setEditingName(!stored);
  }, []);

  // The newest message is the one that matters: the thread opens at its end.
  useEffect(() => {
    const box = threadRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [thread.length]);

  const signature = displayName(name);
  const canSend = text.trim().length > 0 && signature.length >= 2 && !busy;

  const send = async () => {
    if (!canSend) return;
    setSent(false);
    // Checked before anything is sent; the data layer checks again.
    const found = checkStaffReply(text);
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    setBusy(true);
    try {
      rememberStaffName(signature);
      const result = await data.sendReply(client.id, text, signature);
      if (!result.sent) {
        setProblems(result.problems);
        return;
      }
      setText("");
      setProblems(null);
      setEditingName(false);
      setSent(true);
      await onSent();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="conversacion" className="scroll-mt-28">
      <SectionTitle
        aside={
          thread.length > 0 ? (
            <span className="text-[13px] text-slate-500">
              {thread.length === 1 ? "1 mensaje" : `${thread.length} mensajes`} en la app
            </span>
          ) : undefined
        }
      >
        <span id="conversacion" className="scroll-mt-28">
          Conversación
        </span>
      </SectionTitle>

      {!client.signedUpAt ? (
        <div className="card px-5 py-6 text-[15px] leading-snug text-slate-500">
          Todavía no tiene cuenta, así que no hay conversación en la app. Ventas sigue con esta persona por WhatsApp.
        </div>
      ) : (
        <div className="card overflow-hidden" data-testid="conversation">
          {thread.length === 0 ? (
            <p className="px-5 py-5 text-[15px] leading-snug text-slate-500">
              Todavía no hay mensajes en su conversación con {BRAND.assistant}.
            </p>
          ) : (
            <div ref={threadRef} className="max-h-[26rem] space-y-3 overflow-y-auto px-4 py-4 sm:px-5" data-testid="thread">
              {thread.map((message) => {
                const author = threadAuthor(message);
                const ours = author.voice !== "client";
                return (
                  <div key={message.id} data-voice={author.voice} className={`flex flex-col ${ours ? "items-end" : "items-start"}`}>
                    <p className="mb-1 px-1 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">{author.label}</span>
                      {author.voice === "team" && " · equipo"} · {shortDateTime(message.at)}
                    </p>
                    <div
                      className={`max-w-[85%] whitespace-pre-line break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${BUBBLE[author.voice]}`}
                    >
                      {message.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {data.demo && lastReply && (
            <details className="group border-t hairline px-5 py-3" data-testid="client-view">
              <summary className="cursor-pointer list-none text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Demo: ver cómo lo ve el cliente en su chat</span>
                <span className="hidden group-open:inline">Ocultar la vista del cliente</span>
              </summary>
              <div className="mt-3 max-w-sm rounded-3xl bg-slate-50 p-4">
                <TeamMessage
                  byline={
                    messageVoice({ role: "assistant", text: lastReply.text, author: { kind: "team", name: lastReply.authorName ?? "" } }, "es")
                      .byline ?? ""
                  }
                  text={lastReply.text}
                />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Así aparece el último mensaje del equipo en el chat del cliente: con el nombre de quien escribe y «del
                equipo», distinto de los mensajes de Capi y sin la etiqueta de IA. En la demo el chat del cliente no
                está conectado con esta consola, así que el mensaje no le llega a nadie.
              </p>
            </details>
          )}

          <div className="border-t hairline px-5 py-4">
            {waiting.map((question) => (
              <p
                key={question.id}
                data-testid="open-question"
                className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900"
              >
                <span className="font-semibold">Pregunta que Capi pasó al equipo ({relativeDay(question.askedAt, now)}):</span>{" "}
                «{question.text}» Tu respuesta aquí la contesta y quita el aviso.
              </p>
            ))}

            {editingName ? (
              <div className="mb-3">
                <label htmlFor={`${id}-name`} className="block text-[14px] font-medium text-slate-900">
                  Tu nombre, como lo verá el cliente
                </label>
                <input
                  id={`${id}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  autoComplete="given-name"
                  placeholder="Por ejemplo, Ana"
                  className={`${FIELD} mt-1.5 h-11 max-w-xs`}
                />
              </div>
            ) : (
              <p className="mb-2 text-[13px] leading-snug text-slate-500">
                Respondes como <span className="font-semibold text-slate-900">{signature}</span>. El cliente verá tu
                nombre y «del equipo».{" "}
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                >
                  Cambiar
                </button>
              </p>
            )}

            <label htmlFor={`${id}-reply`} className="sr-only">
              Tu respuesta
            </label>
            <textarea
              id={`${id}-reply`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setProblems(null);
                setSent(false);
              }}
              rows={3}
              maxLength={MAX_REPLY_CHARS}
              placeholder="Escribe tu respuesta al cliente"
              className={`${FIELD} resize-y py-2.5`}
            />

            {problems && problems.length > 0 && (
              <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700" role="alert" data-testid="reply-blocked">
                <p className="font-semibold">No se envió. El equipo no puede prometer resultados por escrito.</p>
                <ul className="mt-1 space-y-1">
                  {problems.map((problem) => (
                    <li key={`${problem.phrase}|${problem.why}`} className="break-words">
                      «{problem.phrase}»: {problem.why}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">Cambia esa frase y vuelve a enviar.</p>
              </div>
            )}

            {sent && (
              <p className="mt-3 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status">
                <Icon name="check" size={18} className="mt-px shrink-0" />
                <span>
                  Respuesta guardada en su conversación.
                  {data.demo && " En la demo no le llega a nadie: los clientes son inventados."}
                </span>
              </p>
            )}

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={send} disabled={!canSend} className={`${PRIMARY_BUTTON} shrink-0`}>
                Enviar respuesta
              </button>
              <ul className="min-w-0 space-y-0.5 text-xs leading-relaxed text-slate-500 sm:text-right">
                {STAFF_MESSAGE_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
