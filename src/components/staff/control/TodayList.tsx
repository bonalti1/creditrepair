"use client";

import { useState } from "react";
import Link from "next/link";
import type { TodayItem } from "@/lib/control/today";
import { ago } from "@/lib/control/overview";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { EmptyState, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";
import SafeBoundary from "./SafeBoundary";

// The Today list (src/lib/control/today.ts): one list, top to bottom. Each
// item: what it is and since when, its short procedure (folded), and its ends:
// open it, «Handled» where the work queue has one, «Escalate to the owner»
// (with a note), and for the owner «Resolved».

export interface TodayActions {
  onHandled?: (item: TodayItem) => Promise<void>;
  onEscalate: (item: TodayItem, note: string) => Promise<boolean>;
  onResolve?: (item: TodayItem) => Promise<void>;
  escalated: ReadonlySet<string>;
}

const KIND_TONE: Record<TodayItem["kind"], string> = {
  escalation: "bg-red-50 text-red-700",
  lead_handoff: "bg-red-50 text-red-700",
  lead_waiting: "bg-amber-100 text-blue-900",
  signup_person: "bg-amber-100 text-blue-900",
  lead_new: "bg-blue-50 text-blue-700",
  partner_note: "bg-blue-50 text-blue-700",
  queue: "bg-slate-100 text-slate-700",
  content_failed: "bg-red-50 text-red-700",
  content_review: "bg-blue-50 text-blue-700",
  content_changes: "bg-blue-50 text-blue-700",
  books_close: "bg-amber-100 text-blue-900",
  books_receipts: "bg-slate-100 text-slate-700",
};

function Row({ item, index, now, actions }: { item: TodayItem; index: number; now: Date; actions: TodayActions }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const [escalating, setEscalating] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const kindLabel: Record<TodayItem["kind"], string> = {
    escalation: t("Para el dueño", "For the owner"),
    lead_handoff: t("Prospecto · una persona", "Lead · needs a person"),
    lead_waiting: t("Prospecto esperando", "Lead waiting"),
    signup_person: t("Registro con Alti", "Chat signup"),
    lead_new: t("Prospecto nuevo", "New lead"),
    partner_note: t("Socio", "Partner"),
    queue: t("Cliente", "Client"),
    content_failed: t("Contenido · falló", "Content · failed"),
    content_review: t("Contenido · aprobar", "Content · approve"),
    content_changes: t("Contenido · cambios", "Content · changes"),
    books_close: t("Contabilidad", "Accounting"),
    books_receipts: t("Contabilidad", "Accounting"),
  };
  const escalated = actions.escalated.has(item.key);
  return (
    <li className="border-t hairline px-4 py-4 first:border-t-0 sm:px-5" data-testid="today-item" data-kind={item.kind}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[12px] font-semibold text-white tabular-nums">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${KIND_TONE[item.kind]}`}>{kindLabel[item.kind]}</span>
            {item.overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-semibold text-red-700">{t("Vencido", "Overdue")}</span>}
            <span className="text-[12.5px] text-slate-500 tabular-nums">
              {ago(item.since, now, locale)}
              {item.minutes ? ` · ~${item.minutes} min` : ""}
            </span>
          </p>
          <p className="mt-1 text-[15px] font-semibold leading-snug text-slate-900">{item.title}</p>
          {item.detail && <p className="mt-0.5 text-[13.5px] leading-snug text-slate-600">{item.detail}</p>}

          <details className="group mt-2">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13.5px] font-semibold text-blue-700 md:min-h-8 [&::-webkit-details-marker]:hidden">
              <Icon name="book" size={15} />
              <span className="group-open:hidden">{t("Paso a paso", "Step by step")}</span>
              <span className="hidden group-open:inline">{t("Ocultar los pasos", "Hide the steps")}</span>
            </summary>
            <ol className="mt-1 space-y-1.5 rounded-2xl border border-blue-100 bg-white px-4 py-3">
              {item.steps.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-slate-700">
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[12px] font-semibold text-blue-700 tabular-nums">{i + 1}</span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
              {item.doneWhen && (
                <li className="mt-1 flex gap-2 rounded-xl bg-green-50 px-3 py-2 text-[13.5px] leading-snug text-green-800">
                  <Icon name="check" size={16} className="mt-px shrink-0" />
                  <span>
                    <span className="font-semibold">{t("Hecho cuando… ", "Done when… ")}</span>
                    {item.doneWhen}
                  </span>
                </li>
              )}
            </ol>
          </details>

          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={item.href} className={ROW_BUTTON} data-testid="today-open">
              {t("Abrir", "Open")}
            </Link>
            {item.kind === "queue" && actions.onHandled && (
              <button
                type="button"
                disabled={busy}
                className={QUIET_BUTTON}
                onClick={async () => {
                  setBusy(true);
                  await actions.onHandled?.(item);
                  setBusy(false);
                }}
              >
                <Icon name="check" size={16} />
                {t("Atendido", "Handled")}
              </button>
            )}
            {item.kind === "escalation" && actions.onResolve ? (
              <button type="button" className={QUIET_BUTTON} onClick={() => actions.onResolve?.(item)}>
                <Icon name="check" size={16} />
                {t("Resuelto", "Resolved")}
              </button>
            ) : escalated ? (
              <span className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[13.5px] font-semibold text-green-700" data-testid="escalated">
                <Icon name="check" size={16} />
                {t("Se lo pasaste al dueño", "Sent to the owner")}
              </span>
            ) : (
              <button type="button" className={QUIET_BUTTON} onClick={() => setEscalating(!escalating)} aria-expanded={escalating} data-testid="escalate">
                <Icon name="arrowUp" size={16} />
                {t("Pasar al dueño", "Escalate to the owner")}
              </button>
            )}
          </div>
          {escalating && !escalated && (
            <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-3">
              <label htmlFor={`esc-${item.key}`} className="block text-[13px] font-medium text-slate-700">
                {t("¿Qué necesitas del dueño? (opcional, queda en el registro)", "What do you need from the owner? (optional, it goes on the record)")}
              </label>
              <textarea id={`esc-${item.key}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[15px]" />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={SECONDARY_BUTTON_COMPACT}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const ok = await actions.onEscalate(item, note.trim());
                    setBusy(false);
                    if (ok) setEscalating(false);
                  }}
                >
                  {t("Enviar al dueño", "Send to the owner")}
                </button>
                <button type="button" className={QUIET_BUTTON} onClick={() => setEscalating(false)}>
                  {t("Cancelar", "Cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default function TodayList({ items, now, actions }: { items: TodayItem[]; now: Date; actions: TodayActions }) {
  const t = useTx();
  if (items.length === 0) {
    return (
      <div className="card" data-testid="today-empty">
        <EmptyState pose="celebrate" title={t("Nada necesita una persona ahora.", "Nothing needs a person right now.")}>
          {t("Si te sobra tiempo, revisa los prospectos de la semana en Prospectos.", "If you have time, look over this week's leads in Leads.")}
        </EmptyState>
      </div>
    );
  }
  return (
    <ol className="card overflow-hidden" data-testid="today-list">
      {items.map((item, i) => (
        <SafeBoundary key={item.key}>
          <Row item={item} index={i} now={now} actions={actions} />
        </SafeBoundary>
      ))}
    </ol>
  );
}
