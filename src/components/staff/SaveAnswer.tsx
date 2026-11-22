"use client";

import { useId, useState } from "react";
import { MAX_QUESTION_CHARS } from "@/lib/staff/answers";
import type { ReplyProblem } from "@/lib/staff/conversation";
import type { StaffRole } from "@/lib/staff/types";
import type { AnswerResult } from "@/lib/staff/useSavedAnswers";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON_COMPACT, QUIET_BUTTON } from "@/components/staff/ui";

// «Guardar como respuesta»: right after a reply goes out, offer it to the
// library of saved answers. An administrator's is approved at once; a
// specialist's waits for an administrator. The words are checked again: no
// promises, nothing of this one client (their name, an amount, a number).

const FIELD = "w-full rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

export default function SaveAnswer({
  role,
  question: initialQuestion,
  answer: initialAnswer,
  clientFirstName,
  onSave,
}: {
  role: StaffRole;
  question: string;
  answer: string;
  clientFirstName: string;
  onSave: (input: { question: string; answer: string }, clientFirstName: string) => Promise<AnswerResult>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState(initialAnswer);
  const [problems, setProblems] = useState<ReplyProblem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const admin = role === "admin";

  if (saved) {
    return (
      <p className="mt-2 flex items-start gap-2 text-[14px] leading-snug text-green-700" role="status" data-testid="answer-saved">
        <Icon name="check" size={16} className="mt-0.5 shrink-0" />
        {admin
          ? "Guardada y aprobada. Aparece primero cuando otro cliente pregunte algo parecido."
          : "Propuesta enviada. Un administrador la revisa antes de que se use."}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${QUIET_BUTTON} mt-1 px-0 text-blue-700 hover:bg-transparent`} data-testid="save-as-answer">
        <Icon name="plus" size={16} />
        Guardar como respuesta
      </button>
    );
  }

  const save = async () => {
    setBusy(true);
    setProblems(null);
    setMessage(null);
    try {
      const result = await onSave({ question, answer }, clientFirstName);
      if (result.ok) setSaved(true);
      else {
        setMessage(result.message);
        setProblems(result.problems ?? null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3" data-testid="save-answer-form">
      <p className="text-[14px] font-semibold text-slate-900">Guardar como respuesta</p>
      <p className="mt-0.5 text-[13px] leading-snug text-slate-600">
        Para que sirva a cualquier cliente: sin su nombre, montos ni datos de su caso.
        {admin ? " Como administrador, queda aprobada al guardarla." : " Un administrador la aprueba antes de que se use."}
      </p>
      <label htmlFor={`${id}-q`} className="mt-3 block text-[13px] font-medium text-slate-700">
        La pregunta, como la escribiría un cliente
      </label>
      <input id={`${id}-q`} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={MAX_QUESTION_CHARS} className={`${FIELD} mt-1 h-11`} />
      <label htmlFor={`${id}-a`} className="mt-3 block text-[13px] font-medium text-slate-700">
        La respuesta
      </label>
      <textarea id={`${id}-a`} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} className={`${FIELD} mt-1 resize-y py-2.5`} />
      {(message || problems) && (
        <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[13.5px] leading-snug text-red-700" role="alert">
          {message && <p className="font-semibold">{message}</p>}
          {problems && (
            <ul className="mt-0.5 space-y-0.5">
              {problems.map((p) => (
                <li key={`${p.phrase}|${p.why}`} className="break-words">
                  «{p.phrase}»: {p.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className={`${PRIMARY_BUTTON_COMPACT} px-5`}>
          {admin ? "Guardar y aprobar" : "Proponer"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={QUIET_BUTTON}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
