"use client";

import { useState } from "react";
import Link from "next/link";
import { callQueue, type CallQueueItem } from "@/lib/calls/queue";
import { STAFF_CALL_RULES } from "@/lib/calls/config";
import type { CallStatus } from "@/lib/calls/queue";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useCalls } from "@/lib/calls/useCalls";
import { formatPhone } from "@/lib/staff/format";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON_COMPACT, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";

// Booked calls in the team's queue (src/lib/calls/queue.ts): the case
// reference, when, what the person wants to ask, what the system sent, and
// the rule on every item: questions only, no signup and no payment on the
// call. Shown only when calls are turned on (off by default).

export function CallItem({ item, onClose }: { item: CallQueueItem; onClose?: (id: string, outcome: Exclude<CallStatus, "booked">, note: string | null) => Promise<unknown> }) {
  const t = useTx();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const close = async (outcome: Exclude<CallStatus, "booked">) => {
    if (!onClose) return;
    setBusy(true);
    await onClose(item.booking.id, outcome, note.trim() || null);
    setBusy(false);
  };
  return (
    <li className="card p-4" data-testid="call-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-slate-900">{item.title}</p>
          <p className={`text-[14px] ${item.overdue ? "font-semibold text-amber-700" : "text-slate-600"}`}>{item.when}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] font-semibold text-slate-600">
          ~{item.minutes} min
        </span>
      </div>
      <p className="mt-2 text-[14px] leading-snug text-slate-700">{item.why}</p>
      <p className="mt-1 text-[13px] text-slate-500">{item.tried}</p>
      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-snug text-blue-900" data-testid="call-rule">
        {item.rule}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={item.action.href} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5`}>
          <Icon name="person" size={16} />
          {item.action.label} {formatPhone(item.booking.phone)}
        </a>
        {onClose && (
          <>
            <button type="button" disabled={busy} onClick={() => void close("completed")} className={SECONDARY_BUTTON_COMPACT}>
              {t("Hecha", "Done")}
            </button>
            <button type="button" disabled={busy} onClick={() => void close("no_answer")} className={SECONDARY_BUTTON_COMPACT}>
              {t("No contestó", "No answer")}
            </button>
            <button type="button" disabled={busy} onClick={() => void close("cancelled")} className={SECONDARY_BUTTON_COMPACT}>
              {t("Cancelada", "Cancelled")}
            </button>
          </>
        )}
      </div>
      {onClose && (
        <label className="mt-2 block text-[13px] text-slate-600">
          {t("Nota (opcional)", "Note (optional)")}
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} className="mt-1 h-10 w-full rounded-xl bg-slate-50 px-3 text-[14px] text-slate-900 ring-1 ring-slate-200" />
        </label>
      )}
    </li>
  );
}

/** The home page's card: the next calls, with a link to the calls screen. */
export default function CallsQueueCard({ bookings, now, onClose }: { bookings: Parameters<typeof callQueue>[0]; now: Date; onClose?: (id: string, outcome: Exclude<CallStatus, "booked">, note: string | null) => Promise<unknown> }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const items = callQueue(bookings, now, locale);
  return (
    <section aria-labelledby="llamadas" className="mt-6" data-testid="calls-queue">
      <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{items.length}</span>}>
        <span id="llamadas">{t("Llamadas reservadas", "Booked calls")}</span>
      </SectionTitle>
      <p className="mb-2 px-1 text-[13px] leading-snug text-slate-500">{STAFF_CALL_RULES[locale][0]}</p>
      {items.length === 0 ? (
        <p className="card px-5 py-4 text-[15px] text-slate-600">{t("No hay llamadas reservadas.", "No calls booked.")}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <CallItem key={item.id} item={item} onClose={onClose} />
          ))}
        </ul>
      )}
      <p className="px-1 pt-2">
        <Link href="/equipo/llamadas" className="text-[14px] font-semibold text-blue-700 underline-offset-2 hover:underline">
          {t("Horarios y todas las llamadas", "Call hours and every call")}
        </Link>
      </p>
    </section>
  );
}

/** On the team's home, under "Needs a person": nothing at all while calls are off, or for a role that does not handle them. */
export function HomeCalls({ allowed, now }: { allowed: boolean; now: Date }) {
  const calls = useCalls();
  if (!calls.enabled || !allowed || !calls.ready) return null;
  return <CallsQueueCard bookings={calls.bookings} now={now} onClose={calls.closeBooking} />;
}
