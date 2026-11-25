"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { answerLanguage, MAX_QUESTION_CHARS, mayChange, type SavedAnswer } from "@/lib/staff/answers";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { LANGUAGE_NAME, STAFF_LOCALES, type StaffLocale } from "@/lib/staff/i18n/locale";
import type { ReplyProblem } from "@/lib/staff/conversation";
import { shortDay } from "@/lib/staff/format";
import { deniedReason, type Viewer } from "@/lib/staff/permissions";
import { memberName } from "@/lib/staff/team";
import { useSavedAnswers, type AnswerResult } from "@/lib/staff/useSavedAnswers";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { Chip, EmptyState, NoAccess, PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SectionTitle } from "@/components/staff/ui";

// "Respuestas guardadas": the library of approved answers to the questions
// clients keep asking (src/lib/staff/answers.ts).
//
// An approved answer is offered first when a client asks something close to
// it, and Alti may send it to a client by itself (after the claim rules
// pass again). Only an administrator approves, edits or deletes; a specialist
// proposes (from «Guardar como respuesta» after a reply) and may edit or
// withdraw their own proposal until it is approved.
//
// Each answer is written in one language and goes only to clients who read
// it: the console suggests the one in the client's language.

const FIELD = "w-full rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

function Problems({ result }: { result: { message: string; problems?: ReplyProblem[] } | null }) {
  if (!result) return null;
  return (
    <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[13.5px] leading-snug text-red-700" role="alert">
      <p className="font-semibold">{result.message}</p>
      {result.problems && (
        <ul className="mt-0.5 space-y-0.5">
          {result.problems.map((p) => (
            <li key={`${p.phrase}|${p.why}`}>
              «{p.phrase}»: {p.why}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Editor({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { question: string; answer: string; language: StaffLocale };
  submitLabel: string;
  onSubmit: (input: { question: string; answer: string; language: StaffLocale }) => Promise<AnswerResult>;
  onCancel: () => void;
}) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const [language, setLanguage] = useState<StaffLocale>(initial.language);
  const [question, setQuestion] = useState(initial.question);
  const [answer, setAnswer] = useState(initial.answer);
  const [error, setError] = useState<{ message: string; problems?: ReplyProblem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2" data-testid="answer-editor">
      <label className="block text-[13px] font-medium text-slate-700">
        {t("La pregunta, como la escribiría un cliente", "The question, as a client would write it")}
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={MAX_QUESTION_CHARS} className={`${FIELD} mt-1 h-11`} />
      </label>
      <label className="block text-[13px] font-medium text-slate-700">
        {t("La respuesta", "The answer")}
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} className={`${FIELD} mt-1 resize-y py-2.5`} />
      </label>
      <label className="block text-[13px] font-medium text-slate-700">
        {t("Idioma de la respuesta (se sugiere solo a clientes que lo leen)", "Language of the answer (only suggested to clients who read it)")}
        <select value={language} onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "es")} className={`${FIELD} mt-1 h-11 max-w-xs`}>
          {STAFF_LOCALES.map((option) => (
            <option key={option} value={option}>
              {LANGUAGE_NAME[locale][option]}
            </option>
          ))}
        </select>
      </label>
      <Problems result={error} />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await onSubmit({ question, answer, language });
            setBusy(false);
            if (result.ok) onCancel();
            else setError(result);
          }}
          className={`${PRIMARY_BUTTON_COMPACT} px-5`}
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
          {t("Cancelar", "Cancel")}
        </button>
      </div>
    </div>
  );
}

function AnswerRow({
  answer,
  viewer,
  memberLabel,
  onChange,
}: {
  answer: SavedAnswer;
  viewer: Viewer;
  memberLabel: (handle: string) => string;
  onChange: (id: string, action: "edit" | "approve" | "delete", input?: { question: string; answer: string; language?: StaffLocale }) => Promise<AnswerResult>;
}) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const language = answerLanguage(answer);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<{ message: string; problems?: ReplyProblem[] } | null>(null);
  const may = (action: "edit" | "approve" | "delete") => mayChange(viewer.role, viewer.handle, answer, action);
  const act = async (action: "approve" | "delete") => {
    const result = await onChange(answer.id, action);
    if (!result.ok) setError(result);
  };

  return (
    <li className="border-t hairline px-5 py-4 first:border-t-0" data-testid="saved-answer">
      {editing ? (
        <Editor
          initial={{ question: answer.question, answer: answer.answer, language }}
          submitLabel={t("Guardar cambios", "Save changes")}
          onSubmit={(input) => onChange(answer.id, "edit", input)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 text-[15px] font-semibold text-slate-900">«{answer.question}»</p>
            {answer.status === "proposed" ? (
              <Chip tone="bg-amber-100 text-blue-900">{t("Por aprobar", "To approve")}</Chip>
            ) : (
              <Chip tone="bg-green-50 text-green-700">{t("Aprobada", "Approved")}</Chip>
            )}
            <span data-testid="answer-language">
              <Chip tone="bg-slate-100 text-slate-600">{LANGUAGE_NAME[locale][language]}</Chip>
            </span>
          </div>
          <p className="mt-1.5 whitespace-pre-line text-[14.5px] leading-snug text-slate-700">{answer.answer}</p>
          <p className="mt-1.5 text-[12.5px] text-slate-500">
            {t(
              `Propuesta por ${memberLabel(answer.createdBy)} el ${shortDay(answer.createdAt, "es")}`,
              `Proposed by ${memberLabel(answer.createdBy)} on ${shortDay(answer.createdAt, "en")}`,
            )}
            {answer.approvedBy && answer.approvedAt
              ? t(
                  ` · aprobada por ${memberLabel(answer.approvedBy)} el ${shortDay(answer.approvedAt, "es")}`,
                  ` · approved by ${memberLabel(answer.approvedBy)} on ${shortDay(answer.approvedAt, "en")}`,
                )
              : ""}
          </p>
          <Problems result={error} />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {answer.status === "proposed" && may("approve") && (
              <button type="button" onClick={() => act("approve")} className={`${PRIMARY_BUTTON_COMPACT} px-4`}>
                {t("Aprobar", "Approve")}
              </button>
            )}
            {may("edit") && (
              <button type="button" onClick={() => setEditing(true)} className={QUIET_BUTTON}>
                {t("Editar", "Edit")}
              </button>
            )}
            {may("delete") &&
              (confirmDelete ? (
                <>
                  <button type="button" onClick={() => act("delete")} className={`${QUIET_BUTTON} text-red-700`}>
                    {answer.status === "proposed" ? t("Sí, retirarla", "Yes, withdraw it") : t("Sí, borrarla", "Yes, delete it")}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className={QUIET_BUTTON}>
                    {t("No", "No")}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className={QUIET_BUTTON}>
                  {answer.status === "proposed" && viewer.role !== "admin" ? t("Retirar", "Withdraw") : t("Borrar", "Delete")}
                </button>
              ))}
          </div>
        </>
      )}
    </li>
  );
}

export default function SavedAnswers() {
  const { ready, viewer, members, can, locale } = useStaff();
  const t = useTx();
  const library = useSavedAnswers(viewer, locale);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  if (!ready || !library.ready || !viewer) return null;
  if (!can("clients.reply")) return <NoAccess title={t("Respuestas guardadas", "Saved answers")} reason={deniedReason("clients.reply", locale)} />;

  const words = query.trim().toLowerCase();
  const shown = library.answers.filter((a) => !words || `${a.question} ${a.answer}`.toLowerCase().includes(words));
  const proposed = shown.filter((a) => a.status === "proposed");
  const approved = shown.filter((a) => a.status === "approved");
  const label = (handle: string) => memberName(members, handle, locale);
  const admin = viewer.role === "admin";

  return (
    <main className="animate-rise">
      <h1 className="page-title">{t("Respuestas guardadas", "Saved answers")}</h1>
      <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
        {t(
          `Respuestas a preguntas que se repiten. Una aprobada aparece primero cuando un cliente pregunta algo parecido, y ${BRAND.assistant} puede usarla para responderle sin pasar la pregunta al equipo, siempre que vuelva a pasar las reglas. Solo un administrador aprueba. Cada respuesta va solo a clientes que leen su idioma.`,
          `Answers to questions that keep coming up. An approved one shows first when a client asks something similar, and ${BRAND.assistant} can use it to answer without passing the question to the team, as long as it passes the rules again. Only an administrator approves. Each answer only goes to clients who read its language.`,
        )}
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("Buscar", "Search")}</span>
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" size={18} />
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Buscar por palabra", "Search by word")} className={`${FIELD} h-11 pl-10`} />
        </label>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-5`} data-testid="new-answer">
            <Icon name="plus" size={16} />
            {admin ? t("Nueva respuesta", "New answer") : t("Proponer una respuesta", "Propose an answer")}
          </button>
        )}
      </div>

      {adding && (
        <div className="card mt-4 px-5 py-4">
          <Editor
            initial={{ question: "", answer: "", language: "en" }}
            submitLabel={admin ? t("Guardar y aprobar", "Save and approve") : t("Proponer", "Propose")}
            onSubmit={(input) => library.save(input)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {(proposed.length > 0 || admin) && (
        <section className="mt-7" aria-labelledby="por-aprobar">
          <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{proposed.length}</span>}>
            <span id="por-aprobar">{admin ? t("Por aprobar", "To approve") : t("Tus propuestas", "Your proposals")}</span>
          </SectionTitle>
          {proposed.length === 0 ? (
            <p className="card px-5 py-4 text-[14px] text-slate-500">{t("Nada por aprobar.", "Nothing to approve.")}</p>
          ) : (
            <ul className="card overflow-hidden">
              {proposed.map((a) => (
                <AnswerRow key={a.id} answer={a} viewer={viewer} memberLabel={label} onChange={library.change} />
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-7" aria-labelledby="aprobadas">
        <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{approved.length}</span>}>
          <span id="aprobadas">{t("Aprobadas", "Approved")}</span>
        </SectionTitle>
        {approved.length === 0 ? (
          <div className="card">
            <EmptyState pose={words ? "thinking" : "envelope"} title={words ? t("Ninguna coincide con esa búsqueda.", "None match that search.") : t("Todavía no hay respuestas aprobadas.", "No approved answers yet.")} />
          </div>
        ) : (
          <ul className="card overflow-hidden" data-testid="approved-answers">
            {approved.map((a) => (
              <AnswerRow key={a.id} answer={a} viewer={viewer} memberLabel={label} onChange={library.change} />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
        {t(
          "Una respuesta guardada no lleva el nombre de un cliente, montos, números de cuenta, teléfonos ni correos, y pasa las mismas reglas que cualquier respuesta del equipo. Cada cambio queda registrado.",
          "A saved answer has no client's name, amounts, account numbers, phones or emails, and passes the same rules as any reply from the team. Every change is recorded.",
        )}
        {library.demo && t(" En la demo se guardan solo en este navegador.", " In the demo they're saved only in this browser.")}
      </p>
    </main>
  );
}
