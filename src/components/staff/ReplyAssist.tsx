"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import type { AnswerMatch } from "@/lib/staff/answers";
import type { ReplyProblem } from "@/lib/staff/conversation";
import type { StaffRole } from "@/lib/staff/types";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON_COMPACT, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import type { StaffLocale } from "@/lib/staff/i18n/locale";

// What waits above the reply box when a client's question is open: the
// approved saved answer that matches it, first; then Alti's draft
// (/api/staff/drafts), already checked against the reply rules on the server.
// Either one can be sent with one tap or copied into the box to edit. Sending
// goes through the conversation's own send, with its checks.
//
// The saved answer and the draft are in the CLIENT's language (they go to the
// client); everything around them is in the member's.

export type DraftState =
  | { status: "loading" }
  | { status: "ready"; draft: string; retried: boolean; demo?: boolean }
  | { status: "none"; message: string; problems?: ReplyProblem[] };

const CACHE_KEY = "bonalti.staff.drafts.v1";

function cached(key: string): DraftState | null {
  try {
    const all = JSON.parse(window.sessionStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, DraftState>;
    return all[key] ?? null;
  } catch {
    return null;
  }
}

function remember(key: string, state: DraftState): void {
  try {
    const all = JSON.parse(window.sessionStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, DraftState>;
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...all, [key]: state }));
  } catch {
    // Asked again next time.
  }
}

/**
 * Alti's draft for this client's waiting question. Asked once per question
 * (kept for this browser tab), so opening the page again does not spend
 * another model call.
 */
export function useDraft(clientId: string, questionKey: string | null, role: StaffRole | null, demo: boolean, locale: StaffLocale = "en"): [DraftState | null, () => void] {
  const [state, setState] = useState<DraftState | null>(null);
  const [nonce, setNonce] = useState(0);
  // The console's language is part of the key: the words about a draft (why there is none) are in it.
  const key = questionKey && role ? `${clientId}|${questionKey}|${role}|${locale}` : null;

  useEffect(() => {
    if (!key) {
      setState(null);
      return;
    }
    const hit = nonce === 0 ? cached(key) : null;
    if (hit) {
      setState(hit);
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch("/api/staff/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, locale, ...(demo && role ? { viewAs: role } : {}) }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          draft?: string;
          retried?: boolean;
          demoDraft?: boolean;
          message?: string;
          error?: string;
          problems?: ReplyProblem[];
        };
        const next: DraftState =
          res.ok && data.ok && data.draft
            ? { status: "ready", draft: data.draft, retried: Boolean(data.retried), demo: Boolean(data.demoDraft) }
            : {
                status: "none",
                message: data.message ?? (typeof data.error === "string" ? data.error : locale === "es" ? "No hay borrador ahora." : "No draft right now."),
                problems: data.problems,
              };
        if (!cancelled) {
          setState(next);
          // A missing key or a passing draft is worth keeping; a passing failure is asked again next time.
          if (next.status === "ready" || /ANTHROPIC_API_KEY/.test(next.status === "none" ? next.message : "")) remember(key, next);
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "none", message: locale === "es" ? "No pudimos conectar para preparar el borrador." : "We couldn't connect to prepare the draft." });
      });
    return () => {
      cancelled = true;
    };
  }, [key, clientId, demo, role, nonce, locale]);

  return [state, () => setNonce((n) => n + 1)];
}

function Card({ tone, children, testId }: { tone: "saved" | "draft"; children: React.ReactNode; testId: string }) {
  return (
    <div className={`mb-3 rounded-2xl px-4 py-3 ${tone === "saved" ? "bg-green-50" : "border border-amber-200 bg-amber-50/60"}`} data-testid={testId}>
      {children}
    </div>
  );
}

function Actions({ onSend, onEdit, sendDisabled }: { onSend: () => void; onEdit: () => void; sendDisabled: boolean }) {
  const t = useTx();
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <button type="button" onClick={onSend} disabled={sendDisabled} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 sm:px-5`}>
        <Icon name="check" size={16} />
        {t("Enviar así", "Send as is")}
      </button>
      <button type="button" onClick={onEdit} className={`${SECONDARY_BUTTON_COMPACT} sm:px-5`}>
        {t("Editar antes", "Edit first")}
      </button>
    </div>
  );
}

export default function ReplyAssist({
  match,
  draft,
  onSend,
  onEdit,
  onRetry,
  sendDisabled,
}: {
  match: AnswerMatch | null;
  draft: DraftState | null;
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
  onRetry: () => void;
  sendDisabled: boolean;
}) {
  const t = useTx();
  return (
    <div data-testid="reply-assist">
      {match && (
        <Card tone="saved" testId="saved-answer-suggestion">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-green-800">
            <Icon name="check" size={15} />
            {t("Respuesta guardada, aprobada por el equipo", "Saved answer, approved by the team")}
          </p>
          <p className="mt-0.5 text-[12.5px] text-slate-600">
            {t("Para", "For")} «{match.answer.question}» · {t("coinciden", "shared words")}: {match.shared.join(", ")}
          </p>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-snug text-slate-900">{match.answer.answer}</p>
          <Actions onSend={() => onSend(match.answer.answer)} onEdit={() => onEdit(match.answer.answer)} sendDisabled={sendDisabled} />
        </Card>
      )}

      {draft && (
        <Card tone="draft" testId="ai-draft">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-blue-900">
            <CharacterAvatar character="assistant" size={22} decorative />
            {t(`Borrador de ${BRAND.assistant} — revísalo antes de enviar`, `${BRAND.assistant}'s draft — review it before sending`)}
          </p>
          {draft.status === "loading" && (
            <p className="mt-2 text-[14px] text-slate-600" role="status">
              {t(`${BRAND.assistant} está preparando un borrador con los datos del caso…`, `${BRAND.assistant} is preparing a draft from the case details…`)}
            </p>
          )}
          {draft.status === "ready" && (
            <>
              <p className="mt-2 whitespace-pre-line text-[15px] leading-snug text-slate-900" data-testid="ai-draft-text">
                {draft.draft}
              </p>
              <p className="mt-2 text-[12.5px] leading-snug text-slate-600">
                {draft.demo
                  ? t(
                      "Demo: sin la clave de IA, este borrador de ejemplo solo acusa recibo, en el idioma del cliente. Ya pasó las reglas; tú respondes por lo que dice.",
                      "Demo: with no AI key, this sample draft only acknowledges the question, in the client's language. It already passed the rules; you're responsible for what it says.",
                    )
                  : t(
                      "Escrito con IA a partir de su pregunta y su caso. Ya pasó las reglas (sin promesas, el cliente decide qué marcar); tú respondes por lo que dice.",
                      "Written with AI from their question and their case. It already passed the rules (no promises, the client decides what to mark); you're responsible for what it says.",
                    )}
                {draft.retried && t(" Se escribió dos veces: la primera no pasó las reglas.", " It was written twice: the first one didn't pass the rules.")}
              </p>
              <Actions onSend={() => onSend(draft.draft)} onEdit={() => onEdit(draft.draft)} sendDisabled={sendDisabled} />
            </>
          )}
          {draft.status === "none" && (
            <div className="mt-2 text-[14px] leading-snug text-slate-700" data-testid="no-draft">
              <p>{draft.message}</p>
              {draft.problems && draft.problems.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-[13px] text-slate-600">
                  {draft.problems.map((p) => (
                    <li key={`${p.phrase}|${p.why}`}>
                      «{p.phrase}»: {p.why}
                    </li>
                  ))}
                </ul>
              )}
              {!/ANTHROPIC_API_KEY/.test(draft.message) && (
                <button type="button" onClick={onRetry} className="mt-1 inline-flex min-h-11 items-center text-[14px] font-medium text-blue-700">
                  {t("Intentar de nuevo", "Try again")}
                </button>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
