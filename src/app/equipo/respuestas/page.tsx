"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { MAX_QUESTION_CHARS, mayChange, type SavedAnswer } from "@/lib/staff/answers";
import type { ReplyProblem } from "@/lib/staff/conversation";
import { shortDay } from "@/lib/staff/format";
import { deniedReason, type Viewer } from "@/lib/staff/permissions";
import { memberName } from "@/lib/staff/team";
import { useSavedAnswers, type AnswerResult } from "@/lib/staff/useSavedAnswers";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { Chip, NoAccess, PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SectionTitle } from "@/components/staff/ui";

// "Respuestas guardadas": the library of approved answers to the questions
// clients keep asking (src/lib/staff/answers.ts).
//
// An approved answer is offered first when a client asks something close to
// it, and AltiBot may send it to a client by itself (after the claim rules
// pass again). Only an administrator approves, edits or deletes; a specialist
// proposes (from «Guardar como respuesta» after a reply) and may edit or
// withdraw their own proposal until it is approved.

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
  initial: { question: string; answer: string };
  submitLabel: string;
  onSubmit: (input: { question: string; answer: string }) => Promise<AnswerResult>;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(initial.question);
  const [answer, setAnswer] = useState(initial.answer);
  const [error, setError] = useState<{ message: string; problems?: ReplyProblem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2" data-testid="answer-editor">
      <label className="block text-[13px] font-medium text-slate-700">
        La pregunta, como la escribiría un cliente
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={MAX_QUESTION_CHARS} className={`${FIELD} mt-1 h-11`} />
      </label>
      <label className="block text-[13px] font-medium text-slate-700">
        La respuesta
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} className={`${FIELD} mt-1 resize-y py-2.5`} />
      </label>
      <Problems result={error} />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await onSubmit({ question, answer });
            setBusy(false);
            if (result.ok) onCancel();
            else setError(result);
          }}
          className={`${PRIMARY_BUTTON_COMPACT} px-5`}
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
          Cancelar
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
  onChange: (id: string, action: "edit" | "approve" | "delete", input?: { question: string; answer: string }) => Promise<AnswerResult>;
}) {
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
        <Editor initial={answer} submitLabel="Guardar cambios" onSubmit={(input) => onChange(answer.id, "edit", input)} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 text-[15px] font-semibold text-slate-900">«{answer.question}»</p>
            {answer.status === "proposed" ? <Chip tone="bg-amber-100 text-blue-900">Por aprobar</Chip> : <Chip tone="bg-green-50 text-green-700">Aprobada</Chip>}
          </div>
          <p className="mt-1.5 whitespace-pre-line text-[14.5px] leading-snug text-slate-700">{answer.answer}</p>
          <p className="mt-1.5 text-[12.5px] text-slate-500">
            Propuesta por {memberLabel(answer.createdBy)} el {shortDay(answer.createdAt)}
            {answer.approvedBy && answer.approvedAt ? ` · aprobada por ${memberLabel(answer.approvedBy)} el ${shortDay(answer.approvedAt)}` : ""}
          </p>
          <Problems result={error} />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {answer.status === "proposed" && may("approve") && (
              <button type="button" onClick={() => act("approve")} className={`${PRIMARY_BUTTON_COMPACT} px-4`}>
                Aprobar
              </button>
            )}
            {may("edit") && (
              <button type="button" onClick={() => setEditing(true)} className={QUIET_BUTTON}>
                Editar
              </button>
            )}
            {may("delete") &&
              (confirmDelete ? (
                <>
                  <button type="button" onClick={() => act("delete")} className={`${QUIET_BUTTON} text-red-700`}>
                    Sí, {answer.status === "proposed" ? "retirarla" : "borrarla"}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className={QUIET_BUTTON}>
                    No
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className={QUIET_BUTTON}>
                  {answer.status === "proposed" && viewer.role !== "admin" ? "Retirar" : "Borrar"}
                </button>
              ))}
          </div>
        </>
      )}
    </li>
  );
}

export default function SavedAnswers() {
  const { ready, viewer, members, can } = useStaff();
  const library = useSavedAnswers(viewer);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  if (!ready || !library.ready || !viewer) return null;
  if (!can("clients.reply")) return <NoAccess title="Respuestas guardadas" reason={deniedReason("clients.reply")} />;

  const words = query.trim().toLowerCase();
  const shown = library.answers.filter((a) => !words || `${a.question} ${a.answer}`.toLowerCase().includes(words));
  const proposed = shown.filter((a) => a.status === "proposed");
  const approved = shown.filter((a) => a.status === "approved");
  const label = (handle: string) => memberName(members, handle);
  const admin = viewer.role === "admin";

  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Respuestas guardadas</h1>
      <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
        Respuestas a preguntas que se repiten. Una aprobada aparece primero cuando un cliente pregunta algo parecido, y {BRAND.assistant} puede usarla
        para responderle sin pasar la pregunta al equipo, siempre que vuelva a pasar las reglas. Solo un administrador aprueba.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar</span>
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" size={18} />
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por palabra" className={`${FIELD} h-11 pl-10`} />
        </label>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-5`} data-testid="new-answer">
            <Icon name="plus" size={16} />
            {admin ? "Nueva respuesta" : "Proponer una respuesta"}
          </button>
        )}
      </div>

      {adding && (
        <div className="card mt-4 px-5 py-4">
          <Editor
            initial={{ question: "", answer: "" }}
            submitLabel={admin ? "Guardar y aprobar" : "Proponer"}
            onSubmit={(input) => library.save(input)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {(proposed.length > 0 || admin) && (
        <section className="mt-7" aria-labelledby="por-aprobar">
          <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{proposed.length}</span>}>
            <span id="por-aprobar">{admin ? "Por aprobar" : "Tus propuestas"}</span>
          </SectionTitle>
          {proposed.length === 0 ? (
            <p className="card px-5 py-4 text-[14px] text-slate-500">Nada por aprobar.</p>
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
          <span id="aprobadas">Aprobadas</span>
        </SectionTitle>
        {approved.length === 0 ? (
          <p className="card px-5 py-4 text-[14px] text-slate-500">{words ? "Ninguna coincide con esa búsqueda." : "Todavía no hay respuestas aprobadas."}</p>
        ) : (
          <ul className="card overflow-hidden" data-testid="approved-answers">
            {approved.map((a) => (
              <AnswerRow key={a.id} answer={a} viewer={viewer} memberLabel={label} onChange={library.change} />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
        Una respuesta guardada no lleva el nombre de un cliente, montos, números de cuenta, teléfonos ni correos, y pasa las mismas reglas que cualquier
        respuesta del equipo. Cada cambio queda registrado.
        {library.demo && " En la demo se guardan solo en este navegador."}
      </p>
    </main>
  );
}
