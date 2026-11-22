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
import { STAFF_MESSAGE_RULE_TEXT } from "@/lib/staff/messages";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { clientLanguage } from "@/lib/staff/i18n/locale";
import type { StaffClient } from "@/lib/staff/types";
import { bestMatch } from "@/lib/staff/answers";
import { questionToAnswer } from "@/lib/staff/drafts";
import type { Viewer } from "@/lib/staff/permissions";
import { useSavedAnswers } from "@/lib/staff/useSavedAnswers";
import { rememberStaffName, staffName } from "@/lib/staff/useStaff";
import { messageVoice } from "@/lib/ux/chatMessages";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import TeamMessage from "@/components/TeamMessage";
import { ClientLanguageTag, DeniedNote, PRIMARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import ReplyAssist, { useDraft } from "@/components/staff/ReplyAssist";
import SaveAnswer from "@/components/staff/SaveAnswer";

// The client's conversation in the app, and a box to answer in it.
//
// Every message is labelled with who wrote it: the client, the assistant (always
// marked as AI) or a teammate by name. A reply written here is stored as a
// person's message, signed with the teammate's name. It is checked against
// the claim rules first: a reply that promises a result is not sent, and the
// teammate is shown the phrase and the reason.
//
// When a question is waiting (one the assistant passed to the team, or the
// client's last message), the box opens with help: the approved saved answer
// that matches it, then the assistant's draft, checked against the same rules
// on the server (ReplyAssist). Either goes with one tap, through the same send
// and the same checks as a reply typed here. After a reply goes out,
// «Guardar como respuesta» offers it to the library (SaveAnswer).
//
// Only the assistant's messages carry a character (the robot's head beside
// its "(IA)" label). A teammate's message is labelled with that person's own
// name and never with the team character: a mascot must never look like the
// author of words a real person wrote.
//
// The screen is in the member's language; the reply goes to the client, so
// the box says which language the client reads (ClientLanguageTag), and the
// saved answer and the draft offered are in that language.

const BUBBLE: Record<ThreadVoice, string> = {
  client: "bg-slate-100 text-slate-900",
  assistant: "border border-slate-200 bg-white text-slate-700",
  team: "border border-blue-200 bg-blue-50 text-blue-900",
};

const FIELD =
  "w-full rounded-2xl bg-slate-50 px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

export default function Conversation({
  client,
  data,
  now,
  onSent,
  replyDenied = null,
  viewer = null,
}: {
  client: StaffClient;
  data: StaffData;
  now: Date;
  onSent: () => void | Promise<void>;
  /** Who is answering: their role decides the draft's facts and whether a saved answer goes in approved. */
  viewer?: Viewer | null;
  /** Set when the viewer's role may read the conversation but not answer in it: the reason, shown instead of the box. */
  replyDenied?: string | null;
}) {
  const id = useId();
  const { locale } = useStaffLocale();
  const t = useTx();
  const language = clientLanguage(client);
  const threadRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<ReplyProblem[] | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  // What was just sent, and the question it answered: what «Guardar como respuesta» offers.
  const [justSent, setJustSent] = useState<{ question: string; answer: string } | null>(null);

  const thread = client.conversation ?? [];
  const waiting = openQuestions(client);
  const lastReply = lastTeamMessage(thread);

  // The question to help with, and the help: a saved answer first, then the assistant's draft.
  const question = replyDenied ? null : questionToAnswer(client);
  const questionKey = question ? (waiting[0]?.id ?? thread[thread.length - 1]?.id ?? question) : null;
  const library = useSavedAnswers(viewer, locale);
  // Only an answer in the client's language: it goes to the client.
  const match = question ? bestMatch(question, library.answers, undefined, language) : null;
  const [draft, retryDraft] = useDraft(client.id, questionKey, viewer?.role ?? null, data.demo, locale);

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

  /** The one send: typed here, or a saved answer or draft sent with one tap. Checked here, and again by the data layer and the route. */
  const send = async (words: string = text) => {
    if (!words.trim() || signature.length < 2 || busy) return;
    setSent(false);
    setJustSent(null);
    const found = checkStaffReply(words, locale);
    if (found.length > 0) {
      setText(words);
      setProblems(found);
      return;
    }
    setBusy(true);
    try {
      rememberStaffName(signature);
      const result = await data.sendReply(client.id, words, signature);
      if (!result.sent) {
        setText(words);
        setProblems(result.problems);
        return;
      }
      setText("");
      setProblems(null);
      setEditingName(false);
      setSent(true);
      // Offered to the library without the client's name in the greeting: a saved answer is for anyone.
      const first = client.firstName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const general = first
        ? result.message.text.replace(new RegExp(`^(hola|buenos días|buenas tardes|hi|hello)\\s*,?\\s+${first}\\s*[.,!]?\\s*`, "i"), language === "en" ? "Hi. " : "Hola. ")
        : result.message.text;
      setJustSent({ question: question ?? "", answer: general });
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
              {thread.length === 1 ? t("1 mensaje en la app", "1 message in the app") : t(`${thread.length} mensajes en la app`, `${thread.length} messages in the app`)}
            </span>
          ) : undefined
        }
      >
        <span id="conversacion" className="scroll-mt-28">
          {t("Conversación", "Conversation")}
        </span>
      </SectionTitle>

      {!client.signedUpAt ? (
        <div className="card px-5 py-6 text-[15px] leading-snug text-slate-500">
          {t(
            "Todavía no tiene cuenta, así que no hay conversación en la app. Ventas sigue con esta persona por WhatsApp.",
            "No account yet, so there's no conversation in the app. Sales follows up with this person on WhatsApp.",
          )}
        </div>
      ) : (
        <div className="card overflow-hidden" data-testid="conversation">
          {thread.length === 0 ? (
            <p className="px-5 py-5 text-[15px] leading-snug text-slate-500">
              {t(`Todavía no hay mensajes en su conversación con ${BRAND.assistant}.`, `No messages yet in their conversation with ${BRAND.assistant}.`)}
            </p>
          ) : (
            <div ref={threadRef} className="max-h-[26rem] space-y-3 overflow-y-auto px-4 py-4 sm:px-5" data-testid="thread">
              {thread.map((message) => {
                const author = threadAuthor(message, locale);
                const ours = author.voice !== "client";
                return (
                  <div key={message.id} data-voice={author.voice} className={`flex flex-col ${ours ? "items-end" : "items-start"}`}>
                    <p className="mb-1 flex items-center gap-1.5 px-1 text-xs text-slate-500">
                      {author.voice === "assistant" && <CharacterAvatar character="assistant" size={20} decorative />}
                      <span className="font-semibold text-slate-700">{author.label}</span>
                      <span>
                        {author.voice === "team" && t(" · equipo", " · team")} · {shortDateTime(message.at, locale)}
                      </span>
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
                <span className="group-open:hidden">{t("Demo: ver cómo lo ve el cliente en su chat", "Demo: see how the client sees it in their chat")}</span>
                <span className="hidden group-open:inline">{t("Ocultar la vista del cliente", "Hide the client's view")}</span>
              </summary>
              <div className="mt-3 max-w-sm rounded-3xl bg-slate-50 p-4">
                <TeamMessage
                  byline={
                    messageVoice({ role: "assistant", text: lastReply.text, author: { kind: "team", name: lastReply.authorName ?? "" } }, language)
                      .byline ?? ""
                  }
                  text={lastReply.text}
                />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                {t(
                  `Así aparece el último mensaje del equipo en el chat del cliente: con el nombre de quien escribe y «del equipo», distinto de los mensajes de ${BRAND.assistant} y sin la etiqueta de IA. En la demo el chat del cliente no está conectado con esta consola, así que el mensaje no le llega a nadie.`,
                  `This is how the team's last message shows in the client's chat: with the writer's name and “from the team”, unlike ${BRAND.assistant}'s messages and without the AI label. In the demo the client's chat isn't connected to this console, so the message doesn't reach anyone.`,
                )}
              </p>
            </details>
          )}

          {replyDenied ? (
            <div className="border-t hairline px-5 py-3.5">
              <DeniedNote>{replyDenied}</DeniedNote>
            </div>
          ) : (
          <div className="border-t hairline px-5 py-4">
            {waiting.map((question) => (
              <p
                key={question.id}
                data-testid="open-question"
                className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900"
              >
                <span className="font-semibold">
                  {t(`Pregunta que ${BRAND.assistant} pasó al equipo`, `Question ${BRAND.assistant} passed to the team`)} ({relativeDay(question.askedAt, now, locale)}):
                </span>{" "}
                «{question.text}» {t("Tu respuesta aquí la contesta y quita el aviso.", "Your reply here answers it and clears the notice.")}
              </p>
            ))}

            {question && (
              <ReplyAssist
                match={match}
                draft={draft}
                onSend={(words) => void send(words)}
                onEdit={(words) => {
                  setText(words);
                  setProblems(null);
                  setSent(false);
                  document.getElementById(`${id}-reply`)?.focus();
                }}
                onRetry={retryDraft}
                sendDisabled={busy || signature.length < 2}
              />
            )}

            {editingName ? (
              <div className="mb-3">
                <label htmlFor={`${id}-name`} className="block text-[14px] font-medium text-slate-900">
                  {t("Tu nombre, como lo verá el cliente", "Your name, as the client will see it")}
                </label>
                <input
                  id={`${id}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  autoComplete="given-name"
                  placeholder={t("Por ejemplo, Ana", "For example, Ana")}
                  className={`${FIELD} mt-1.5 h-11 max-w-xs`}
                />
              </div>
            ) : (
              <p className="mb-2 text-[13px] leading-snug text-slate-500">
                {t("Respondes como", "You're replying as")} <span className="font-semibold text-slate-900">{signature}</span>.{" "}
                {t("El cliente verá tu nombre y «del equipo».", "The client sees your name and “from the team”.")}{" "}
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  // Inside the sentence, so the hit area grows instead of the line.
                  className="relative font-medium after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] text-blue-700 underline-offset-2 hover:underline"
                >
                  {t("Cambiar", "Change")}
                </button>
              </p>
            )}

            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor={`${id}-reply`} className="text-[13px] font-medium text-slate-700">
                {t("Tu respuesta", "Your reply")}
              </label>
              <ClientLanguageTag client={client} />
            </div>
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
              placeholder={t("Escribe tu respuesta al cliente", "Write your reply to the client")}
              className={`${FIELD} resize-y py-2.5`}
            />

            {problems && problems.length > 0 && (
              <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700" role="alert" data-testid="reply-blocked">
                <p className="font-semibold">{t("No se envió. El equipo no puede prometer resultados por escrito.", "Not sent. The team can't promise results in writing.")}</p>
                <ul className="mt-1 space-y-1">
                  {problems.map((problem) => (
                    <li key={`${problem.phrase}|${problem.why}`} className="break-words">
                      «{problem.phrase}»: {problem.why}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">{t("Cambia esa frase y vuelve a enviar.", "Change that phrase and send again.")}</p>
              </div>
            )}

            {sent && (
              <p className="mt-3 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status">
                <Icon name="check" size={18} className="mt-px shrink-0" />
                <span>
                  {t("Respuesta guardada en su conversación.", "Reply saved in their conversation.")}
                  {data.demo && t(" En la demo no le llega a nadie: los clientes son inventados.", " In the demo it doesn't reach anyone: the clients are made up.")}
                </span>
              </p>
            )}
            {sent && justSent && viewer && (viewer.role === "admin" || viewer.role === "specialist") && (
              <SaveAnswer
                key={justSent.answer}
                role={viewer.role}
                question={justSent.question}
                answer={justSent.answer}
                clientFirstName={client.firstName}
                language={language}
                onSave={library.save}
              />
            )}

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => void send()} disabled={!canSend} className={`${PRIMARY_BUTTON} shrink-0`}>
                {t("Enviar respuesta", "Send reply")}
              </button>
              <ul className="min-w-0 space-y-0.5 text-xs leading-relaxed text-slate-500 sm:text-right">
                {STAFF_MESSAGE_RULE_TEXT[locale].map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          </div>
          )}
        </div>
      )}
    </section>
  );
}
