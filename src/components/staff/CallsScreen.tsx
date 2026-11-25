"use client";

import { useMemo, useState } from "react";
import { CallItem } from "@/components/staff/CallsQueue";
import { DeniedNote, PRIMARY_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { CALL_TIME_ZONE, QUESTIONS_ONLY, STAFF_CALL_RULES } from "@/lib/calls/config";
import { callQueue } from "@/lib/calls/queue";
import { openSlots, SLOT_MINUTES, slotDay, slotTime, zoneLabel, type WindowProblem } from "@/lib/calls/slots";
import { useCalls } from "@/lib/calls/useCalls";
import { deniedReason } from "@/lib/staff/permissions";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { useStaff } from "@/lib/staff/useStaff";

// Calls (/equipo/llamadas; off by default). When the team takes calls, and
// the calls booked, each with its case reference. A member with
// "calls.manage" (administrators and sales) adds or removes call hours and
// closes each call. The rule is at the top and on every call: questions only.
// Signing up and any payment happen afterwards, in writing, in the app.

const PROBLEM: Record<WindowProblem | string, [string, string]> = {
  invalid_time: ["Revisa el día y las horas.", "Check the day and the times."],
  end_before_start: ["La hora de fin va después de la de inicio.", "The end time comes after the start time."],
  too_long: ["Máximo 12 horas seguidas.", "At most 12 hours in a row."],
  in_the_past: ["Ese horario ya pasó.", "That time has already passed."],
  too_far: ["Demasiado lejos: agrega horarios de las próximas semanas.", "Too far ahead: add hours for the coming weeks."],
  slot_length: ["Elige una duración de la lista.", "Pick a length from the list."],
  not_whole_slots: ["El horario debe dividirse en llamadas completas.", "The hours must split into whole calls."],
  error: ["No se pudo guardar.", "It could not be saved."],
  network: ["Sin conexión. No se guardó nada.", "No connection. Nothing was saved."],
};

export default function CallsScreen() {
  const t = useTx();
  const { ready, can, locale } = useStaff();
  const calls = useCalls();
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("12:00");
  const [minutes, setMinutes] = useState<number>(20);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => new Date(), []);

  if (!ready || !calls.ready) return null;
  const allowed = can("calls.manage");
  const items = callQueue(calls.bookings, now, locale);
  const free = openSlots(calls.windows, calls.bookings.filter((b) => b.status === "booked").map((b) => b.slotStart), now).length;
  const closed = calls.bookings.filter((b) => b.status !== "booked");
  const zone = CALL_TIME_ZONE;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await calls.addWindow({ day, from, to, slotMinutes: minutes, timeZone: zone });
    setBusy(false);
    setProblems(result.ok ? [] : result.problems);
  };

  return (
    <main className="animate-rise">
      <h1 className="page-title">{t("Llamadas", "Calls")}</h1>
      <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
        {t(
          "Cuándo atiende llamadas el equipo y las llamadas reservadas. La persona elige una hora libre en la app y acepta que la llamemos a ese número.",
          "When the team takes calls, and the calls booked. The person picks a free time in the app and agrees to be called at that number.",
        )}
      </p>
      <section className="mt-4 max-w-3xl rounded-2xl bg-blue-700 px-5 py-4 text-white" data-testid="staff-questions-only">
        <h2 className="text-[16px] font-semibold">{QUESTIONS_ONLY[locale].title}</h2>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] leading-snug text-blue-100">
          {STAFF_CALL_RULES[locale].map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
      {!allowed && (
        <div className="mt-3">
          <DeniedNote>{deniedReason("calls.manage", locale)}</DeniedNote>
        </div>
      )}
      {!calls.live && (
        <p className="mt-3 max-w-3xl rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
          {t("Demo: horarios de ejemplo y una reserva de ejemplo. Lo que agregues se guarda solo en este navegador.", "Demo: example hours and one example booking. What you add is saved only in this browser.")}
        </p>
      )}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section aria-labelledby="reservadas">
          <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{items.length}</span>}>
            <span id="reservadas">{t("Por hacer", "To do")}</span>
          </SectionTitle>
          {items.length === 0 ? (
            <p className="card px-5 py-4 text-[15px] text-slate-600">{t("No hay llamadas reservadas.", "No calls booked.")}</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <CallItem key={item.id} item={item} onClose={allowed ? calls.closeBooking : undefined} />
              ))}
            </ul>
          )}
          {closed.length > 0 && (
            <>
              <h3 className="mt-6 px-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Cerradas", "Closed")}</h3>
              <ul className="card mt-2 divide-y divide-slate-100">
                {closed.map((b) => (
                  <li key={b.id} className="px-4 py-3 text-[14px] text-slate-700">
                    <span className="font-semibold text-slate-900">{b.firstName}</span>
                    {b.caseRef ? ` · ${b.caseRef}` : ""} · {slotDay(b.slotStart, zone, locale)}, {slotTime(b.slotStart, zone, locale)} ·{" "}
                    {b.status === "completed" ? t("hecha", "done") : b.status === "no_answer" ? t("no contestó", "no answer") : t("cancelada", "cancelled")}
                    {b.closedByName ? ` (${b.closedByName})` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section aria-labelledby="horarios">
          <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{t(`${free} libres`, `${free} free`)}</span>}>
            <span id="horarios">{t("Horarios de llamadas", "Call hours")}</span>
          </SectionTitle>
          {allowed && (
            <form onSubmit={add} className="card space-y-3 p-4" data-testid="add-window">
              <p className="text-[14px] text-slate-600">{t("Horas de Texas (centro). A la persona se le muestran en su propia hora.", "Texas (Central) time. The person sees them on their own clock.")}</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[13px] font-medium text-slate-700">
                  {t("Día", "Day")}
                  <input type="date" required value={day} onChange={(e) => setDay(e.target.value)} className="mt-1 h-11 w-full rounded-xl bg-slate-50 px-3 text-[15px] ring-1 ring-slate-200" />
                </label>
                <label className="block text-[13px] font-medium text-slate-700">
                  {t("Desde", "From")}
                  <input type="time" required value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-11 w-full rounded-xl bg-slate-50 px-3 text-[15px] ring-1 ring-slate-200" />
                </label>
                <label className="block text-[13px] font-medium text-slate-700">
                  {t("Hasta", "To")}
                  <input type="time" required value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-11 w-full rounded-xl bg-slate-50 px-3 text-[15px] ring-1 ring-slate-200" />
                </label>
                <label className="block text-[13px] font-medium text-slate-700">
                  {t("Cada llamada", "Each call")}
                  <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="mt-1 h-11 w-full rounded-xl bg-slate-50 px-3 text-[15px] ring-1 ring-slate-200">
                    {SLOT_MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {problems.length > 0 && (
                <ul role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[14px] text-red-700">
                  {problems.map((p) => (
                    <li key={p}>{t(...(PROBLEM[p] ?? PROBLEM.error!))}</li>
                  ))}
                </ul>
              )}
              <button type="submit" disabled={busy || !day} className={PRIMARY_BUTTON}>
                {t("Agregar horario", "Add hours")}
              </button>
            </form>
          )}
          <ul className="mt-3 space-y-2" data-testid="windows">
            {calls.windows.length === 0 && <li className="card px-4 py-3 text-[14px] text-slate-600">{t("Sin horarios: nadie puede reservar.", "No hours: nobody can book.")}</li>}
            {calls.windows.map((w) => (
              <li key={w.id} className="card flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[14px] text-slate-800">
                  <span className="font-semibold capitalize">{slotDay(w.startsAt, zone, locale)}</span>
                  {", "}
                  {slotTime(w.startsAt, zone, locale)}–{slotTime(w.endsAt, zone, locale)} ({zoneLabel(w.startsAt, zone, locale)}) · {w.slotMinutes} min
                </span>
                {allowed && (
                  <button type="button" onClick={() => void calls.removeWindow(w.id)} className={SECONDARY_BUTTON_COMPACT}>
                    {t("Quitar", "Remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
