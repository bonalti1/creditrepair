"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { dueText, waitedText, type QueueItem } from "@/lib/autopilot/queue";
import { shortDateTime } from "@/lib/staff/format";
import type { AnswerMatch } from "@/lib/staff/answers";
import { EXCEPTION_LABEL } from "@/lib/staff/stage";
import { fullName } from "@/lib/staff/types";
import Icon from "@/components/Icon";
import { Chip, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON, SeverityDot } from "@/components/staff/ui";
import { PlaybookCard, PlaybookToggle } from "@/components/staff/PlaybookCard";

// The one-person work queue: each thing that needs a human, why, what the
// system already tried, about how long it takes, how long it has waited and
// when it is due, with one button. "Siguiente" walks it one item at a time.
// Every item carries its «Cómo se resuelve» card (src/lib/staff/playbook.ts):
// folded in the list, open in focus mode. A waiting question shows the saved
// answer that matches it, when there is one, and a way to answer in the app.

/** The approved saved answer that matches a waiting question, if any. */
export type AnswerFor = (item: QueueItem) => AnswerMatch | null;

/** For a client's question: answer it in the app, where the saved answer or AltiBot's draft is waiting. */
function AnswerHint({ item, answerFor }: { item: QueueItem; answerFor?: AnswerFor }) {
  if (item.exception.kind !== "question_waiting") return null;
  const match = answerFor?.(item) ?? null;
  return (
    <div className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-[13.5px] leading-snug text-blue-900" data-testid="answer-hint">
      {match ? (
        <p>
          <span className="font-semibold">Hay una respuesta guardada que coincide:</span> «{match.answer.question}»
        </p>
      ) : (
        <p>Al abrir su conversación hay un borrador para revisar.</p>
      )}
      <Link href={`/equipo/clientes/${item.client.id}#conversacion`} className="mt-1 inline-flex min-h-11 items-center gap-1 font-semibold text-blue-700 underline-offset-2 hover:underline">
        Responder en la app
        <Icon name="chevron" size={14} />
      </Link>
    </div>
  );
}

function ActionLink({ item, className, id }: { item: QueueItem; className: string; id?: string }) {
  const { action } = item;
  if (action.kind === "open") {
    return (
      <Link id={id} href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <a id={id} href={action.href} className={className} {...(action.kind === "whatsapp" ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {action.label}
    </a>
  );
}

/** What the system already did, as a short list with dates. */
export function TriedBox({ item, compact = false }: { item: QueueItem; compact?: boolean }) {
  if (!item.triedSummary && item.tried.length === 0) return null;
  return (
    <div className={`rounded-xl bg-green-50 px-3 py-2 ${compact ? "mt-2" : "mt-3"}`} data-testid="tried">
      <p className="text-[13px] font-semibold text-green-800">
        <span className="mr-1.5 inline-flex align-[-2px]">
          <Icon name="sparkle" size={14} />
        </span>
        Lo que ya hizo el sistema
      </p>
      {item.triedSummary && <p className="mt-0.5 text-[13px] leading-snug text-slate-700">{item.triedSummary}</p>}
      {item.tried.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {item.tried.map((line, i) => (
            <li key={i} className="text-[12px] leading-snug text-slate-600 tabular-nums">
              {shortDateTime(line.at)} · {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Meta({ item, now }: { item: QueueItem; now: Date }) {
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] tabular-nums text-slate-500">
      <span>~{item.minutes} min</span>
      <span>Espera {waitedText(item.since, now)}</span>
      <span className={item.overdue ? "font-semibold text-red-700" : ""}>{dueText(item.dueBy, now).replace(/^v/, "V")}</span>
    </p>
  );
}

export function QueueList({ items, now, onHandled, answerFor }: { items: QueueItem[]; now: Date; onHandled: (item: QueueItem) => void; answerFor?: AnswerFor }) {
  return (
    <ul className="card overflow-hidden" data-testid="work-queue">
      {items.map((item, index) => (
        <li key={item.id} className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-5 ${index > 0 ? "border-t hairline" : ""}`}>
          <div className="flex min-w-0 flex-1 gap-3">
            <SeverityDot severity={item.exception.severity} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={`/equipo/clientes/${item.client.id}`} className="inline-flex min-h-11 items-center text-[16px] font-semibold md:min-h-0 text-slate-900 underline-offset-2 hover:underline">
                  {fullName(item.client)}
                </Link>
                <Chip tone="bg-slate-100 text-slate-700">{EXCEPTION_LABEL[item.exception.kind]}</Chip>
              </div>
              <p className="mt-0.5 text-[14px] leading-snug text-slate-600">{item.why}</p>
              <AnswerHint item={item} answerFor={answerFor} />
              <TriedBox item={item} compact />
              <Meta item={item} now={now} />
              <PlaybookToggle kind={item.exception.kind} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 pl-[22px] sm:shrink-0 sm:flex-nowrap sm:pl-0 sm:pt-0.5">
            <ActionLink item={item} className={`${ROW_BUTTON} gap-1.5`} />
            <button type="button" onClick={() => onHandled(item)} className={QUIET_BUTTON} aria-label={`Marcar como atendido: ${fullName(item.client)}`}>
              <Icon name="check" size={16} />
              Atendido
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Focus mode: one item at a time, the keyboard does the rest.
 * J next · K previous · E open the action · H handled · Esc close.
 */
export function FocusMode({
  items,
  index,
  now,
  onIndex,
  onHandled,
  onClose,
  answerFor,
}: {
  items: QueueItem[];
  index: number;
  now: Date;
  onIndex: (index: number) => void;
  onHandled: (item: QueueItem) => void;
  onClose: () => void;
  answerFor?: AnswerFor;
}) {
  const item = items[Math.min(index, items.length - 1)];
  const panel = useRef<HTMLDivElement>(null);
  const at = Math.min(index, Math.max(items.length - 1, 0));

  const go = useCallback((delta: number) => onIndex(Math.max(0, Math.min(items.length - 1, at + delta))), [at, items.length, onIndex]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "escape") onClose();
      else if (key === "j") go(1);
      else if (key === "k") go(-1);
      else if (key === "e" && item) document.getElementById("focus-action")?.click();
      else if (key === "h" && item) onHandled(item);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, item, onClose, onHandled]);

  // On document.body: the page's own animation (a transform) would otherwise confine a fixed overlay to the page.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-6 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="focus-title" onClick={onClose}>
      <div ref={panel} tabIndex={-1} className="card w-full max-w-2xl px-5 py-5 outline-none sm:px-7 sm:py-6" onClick={(e) => e.stopPropagation()} data-testid="focus-mode">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500 tabular-nums">
            Siguiente · {items.length === 0 ? "0 de 0" : `${at + 1} de ${items.length}`}
          </p>
          <button type="button" onClick={onClose} className={QUIET_BUTTON} aria-label="Cerrar">
            Cerrar <kbd className="ml-1 hidden rounded border border-slate-300 px-1 text-[11px] sm:inline">Esc</kbd>
          </button>
        </div>

        {!item ? (
          <div className="py-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-700">
              <Icon name="check" size={22} />
            </span>
            <h2 id="focus-title" className="mt-3 text-[22px] font-semibold text-slate-900">
              Terminaste por hoy
            </h2>
            <p className="mt-1 text-[15px] text-slate-600">Nada más necesita una persona. Lo demás avanza solo.</p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-start gap-3">
              <SeverityDot severity={item.exception.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="focus-title" className="text-[22px] font-semibold leading-tight text-slate-900">
                    {fullName(item.client)}
                  </h2>
                  <Chip tone="bg-slate-100 text-slate-700">{EXCEPTION_LABEL[item.exception.kind]}</Chip>
                </div>
                <p className="mt-2 text-[16px] leading-relaxed text-slate-700">{item.why}</p>
                <AnswerHint item={item} answerFor={answerFor} />
                <TriedBox item={item} />
                <Meta item={item} now={now} />
              </div>
            </div>
            {/* On a phone the buttons come first and the card under them; on a laptop, read the card, then act. */}
            <div className="flex flex-col">
            <div className="order-last mt-4 sm:order-none">
              <PlaybookCard kind={item.exception.kind} />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ActionLink id="focus-action" item={item} className={`${PRIMARY_BUTTON} gap-2`} />
              <button type="button" onClick={() => onHandled(item)} className={`${SECONDARY_BUTTON} gap-1.5`}>
                <Icon name="check" size={16} />
                Atendido
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button type="button" onClick={() => go(-1)} disabled={at === 0} className={`${QUIET_BUTTON} disabled:opacity-40`}>
                ← Anterior
              </button>
              <Link href={`/equipo/clientes/${item.client.id}`} className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline">
                Abrir su caso
              </Link>
              <button type="button" onClick={() => go(1)} disabled={at >= items.length - 1} className={`${QUIET_BUTTON} disabled:opacity-40`}>
                Siguiente →
              </button>
            </div>
            </div>
          </>
        )}
        <p className="mt-4 hidden border-t hairline pt-3 text-[12px] text-slate-500 sm:block">
          Teclado: <Kbd>J</Kbd> siguiente · <Kbd>K</Kbd> anterior · <Kbd>E</Kbd> abrir la acción · <Kbd>H</Kbd> atendido · <Kbd>Esc</Kbd> cerrar
        </p>
      </div>
    </div>,
    document.body,
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-sans text-[11px] text-slate-700">{children}</kbd>;
}
