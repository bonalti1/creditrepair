"use client";

import { useCallback, useEffect, useState } from "react";
import { isDemoMode } from "../supabase/config";
import { answerInputError, answerInputSchema, answerProblems, DEMO_SAVED_ANSWERS, mayChange, statusOnSave, type SavedAnswer } from "./answers";
import type { ReplyProblem } from "./conversation";
import type { Viewer } from "./permissions";
import { staffMessage } from "./i18n/messages";
import type { StaffLocale } from "./i18n/locale";

// The saved answers for the console. With a database: /api/staff/answers
// (the route checks the role and the rules again). In the demo: the invented
// library plus what was done in this browser, under the same rules.
//
// Every message comes back in the console's language (`locale`). Each answer
// keeps the language it is written in (answers.ts), which the screen asks for.

const KEY = "bonalti.staffDemo.answers.v1";

export type AnswerResult = { ok: true; answer?: SavedAnswer } | { ok: false; message: string; problems?: ReplyProblem[] };

function readDemo(): SavedAnswer[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    // Kept before answers had a language: those were all Spanish.
    if (raw) return (JSON.parse(raw) as SavedAnswer[]).map((a) => ({ ...a, language: a.language === "en" ? "en" : "es" }));
  } catch {
    // Storage unavailable: the invented library.
  }
  return [...DEMO_SAVED_ANSWERS];
}

function writeDemo(answers: SavedAnswer[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(answers));
  } catch {
    // Kept for this visit only.
  }
}

export function resetDemoAnswers(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

async function post(body: unknown, locale: StaffLocale): Promise<AnswerResult> {
  try {
    const res = await fetch("/api/staff/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { answer?: SavedAnswer; message?: string; error?: string; problems?: ReplyProblem[] };
    if (res.ok) return { ok: true, answer: data.answer };
    return { ok: false, message: staffMessage(data.message ?? (typeof data.error === "string" ? data.error : "No se pudo guardar."), locale), problems: data.problems };
  } catch {
    return { ok: false, message: staffMessage("No pudimos conectar. Revisa tu conexión e intenta de nuevo.", locale) };
  }
}

export function useSavedAnswers(viewer: Viewer | null, locale: StaffLocale = "en") {
  const say = (message: string) => staffMessage(message, locale);
  const demo = isDemoMode();
  const [answers, setAnswers] = useState<SavedAnswer[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (demo) {
      setAnswers(readDemo());
      setReady(true);
      return;
    }
    try {
      const res = await fetch("/api/staff/answers", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { answers?: SavedAnswer[] };
      setAnswers(res.ok ? (data.answers ?? []) : []);
    } finally {
      setReady(true);
    }
  }, [demo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** In the demo, the role's view of the library, as the read policies give it. */
  const visible = demo && viewer
    ? answers.filter((a) => (viewer.role === "sales" ? false : a.status === "approved" || viewer.role === "admin" || a.createdBy === viewer.handle))
    : answers;

  const save = async (input: { question: string; answer: string; language: StaffLocale }, clientFirstName?: string): Promise<AnswerResult> => {
    if (!demo) {
      const result = await post({ action: "save", ...input, clientFirstName }, locale);
      await reload();
      return result;
    }
    if (!viewer) return { ok: false, message: say("Nadie ha iniciado sesión.") };
    const status = statusOnSave(viewer.role);
    if (!status) return { ok: false, message: say("Tu rol no responde a clientes.") };
    const parsed = answerInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: answerInputError(input, locale) ?? say("Revisa la pregunta y la respuesta.") };
    const problems = answerProblems(parsed.data, clientFirstName, locale);
    if (problems.length > 0) return { ok: false, message: say("No se guardó: rompe una regla."), problems };
    const at = new Date().toISOString();
    const answer: SavedAnswer = {
      id: crypto.randomUUID(),
      ...parsed.data,
      language: input.language,
      status,
      createdBy: viewer.handle,
      createdAt: at,
      approvedBy: status === "approved" ? viewer.handle : null,
      approvedAt: status === "approved" ? at : null,
      updatedAt: at,
    };
    const next = [answer, ...readDemo()];
    writeDemo(next);
    setAnswers(next);
    return { ok: true, answer };
  };

  const change = async (id: string, action: "edit" | "approve" | "delete", input?: { question: string; answer: string; language?: StaffLocale }): Promise<AnswerResult> => {
    if (!demo) {
      const result = await post({ action, id, ...(input ?? {}) }, locale);
      await reload();
      return result;
    }
    const all = readDemo();
    const current = all.find((a) => a.id === id);
    if (!current || !viewer) return { ok: false, message: say("Esa respuesta ya no existe.") };
    if (!mayChange(viewer.role, viewer.handle, current, action)) {
      return { ok: false, message: say(action === "approve" ? "Solo un administrador aprueba respuestas." : "Solo un administrador cambia una respuesta aprobada o la de otra persona.") };
    }
    let next: SavedAnswer[];
    const at = new Date().toISOString();
    if (action === "delete") next = all.filter((a) => a.id !== id);
    else if (action === "approve") next = all.map((a) => (a.id === id ? { ...a, status: "approved" as const, approvedBy: viewer.handle, approvedAt: at, updatedAt: at } : a));
    else {
      const parsed = answerInputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, message: (input && answerInputError(input, locale)) ?? say("Revisa la pregunta y la respuesta.") };
      const problems = answerProblems(parsed.data, null, locale);
      if (problems.length > 0) return { ok: false, message: say("No se guardó: rompe una regla."), problems };
      next = all.map((a) => (a.id === id ? { ...a, ...parsed.data, ...(input?.language ? { language: input.language } : {}), updatedAt: at } : a));
    }
    writeDemo(next);
    setAnswers(next);
    return { ok: true };
  };

  return { ready, answers: visible, reload, save, change, demo };
}
