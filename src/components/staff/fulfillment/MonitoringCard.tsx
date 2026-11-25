"use client";

import { useState } from "react";
import { CHECK_METHODS, MONITORING_TEXT, monitoringSummary, sortChecks, type CheckMethod, type EnrolledViaLink, type MonitoringCheckStatus } from "@/lib/fulfillment/monitoring";
import { recordMonitoringCheck } from "@/lib/fulfillment/staffActions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { shortDay } from "@/lib/staff/format";
import type { StaffClient } from "@/lib/staff/types";
import { Chip, DeniedNote, ROW_BUTTON, SectionTitle } from "@/components/staff/ui";

// Credit monitoring for one client (fulfillment/monitoring.ts): the provider,
// whether they enrolled through our link, active / cancelled / unknown, the
// day and how it was checked, and when the next report is due. A teammate who
// works the client records what they saw; nothing here messages the client
// (the autopilot's monitoring reminder does, under its own rules).

const TONE = {
  active: "bg-green-50 text-green-700",
  cancelled: "bg-red-50 text-red-700",
  unknown: "bg-amber-100 text-blue-900",
  not_checked: "bg-slate-100 text-slate-600",
} as const;

const field = "h-11 w-full rounded-xl bg-white px-3 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none focus:ring-2 focus:ring-blue-300";

function texasToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export default function MonitoringCard({
  client,
  now,
  demo,
  canRecord,
  viewerName,
  onChanged,
}: {
  client: StaffClient;
  now: Date;
  demo: boolean;
  canRecord: boolean;
  viewerName: string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const T = MONITORING_TEXT[locale];
  const s = monitoringSummary(client, now);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    provider: "identityiq" as "identityiq" | "other",
    providerName: "",
    enrolledViaLink: (s.enrolledViaLink ?? "unknown") as EnrolledViaLink,
    status: "active" as MonitoringCheckStatus,
    checkedOn: texasToday(),
    method: "client_said" as CheckMethod,
    note: "",
  });
  if (!client.signedUpAt) return null;
  const history = sortChecks(client.monitoringChecks ?? []);
  const day = (d: string) => shortDay(`${d}T12:00:00.000Z`, locale);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await recordMonitoringCheck(
      demo,
      client.id,
      { ...form, providerName: form.provider === "other" ? form.providerName.trim() : null, note: form.note.trim() },
      viewerName,
    );
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setOpen(false);
    await onChanged();
  };

  return (
    <section aria-labelledby="monitoreo" data-testid="monitoring-card">
      <SectionTitle>
        <span id="monitoreo">{T.title}</span>
      </SectionTitle>
      <div className="card px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-medium text-slate-900">{s.provider ?? t("Proveedor sin registrar", "Provider not recorded")}</span>
          <Chip tone={TONE[s.standing]}>{T.standing[s.standing]}</Chip>
        </div>
        <dl className="mt-3 space-y-2 text-[14px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-slate-500">{T.enrolledLabel}</dt>
            <dd className="text-right font-medium text-slate-900">{T.enrolled[s.enrolledViaLink]}</dd>
          </div>
          {s.check && (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">{T.checkedLabel}</dt>
                <dd className="text-right font-medium text-slate-900">
                  {day(s.check.checkedOn)} · {s.check.by}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">{T.howLabel}</dt>
                <dd className="text-right font-medium text-slate-900">{T.method[s.check.method]}</dd>
              </div>
            </>
          )}
          {s.reportDueAt && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">{new Date(s.reportDueAt).getTime() < now.getTime() ? T.reportOverdue : T.reportDue}</dt>
              <dd className="text-right font-medium text-slate-900">{shortDay(s.reportDueAt, locale)}</dd>
            </div>
          )}
        </dl>
        {s.check?.note && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] leading-snug text-slate-700">“{s.check.note}”</p>}
        {s.provenByReport && s.evidenceDay && <p className="mt-3 text-[13px] leading-snug text-green-800">{T.provenByReport(day(s.evidenceDay))}</p>}
        {s.looksInactive && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] leading-snug text-red-800" data-testid="monitoring-inactive">{T.inactive}</p>}
        {s.stale && <p className="mt-3 text-[13px] leading-snug text-blue-900">{T.stale}</p>}
        {(s.standing === "unknown" || s.standing === "not_checked") && !s.provenByReport && <p className="mt-3 text-[13px] leading-snug text-slate-600">{T.unknownNote}</p>}

        {canRecord ? (
          open ? (
            <div className="mt-4 space-y-3 border-t hairline pt-4" data-testid="monitoring-form">
              <label className="block text-[13px] font-medium text-slate-700">
                {T.provider}
                <select className={`${field} mt-1`} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as "identityiq" | "other" })}>
                  <option value="identityiq">IdentityIQ</option>
                  <option value="other">{t("Otro", "Other")}</option>
                </select>
              </label>
              {form.provider === "other" && (
                <label className="block text-[13px] font-medium text-slate-700">
                  {T.otherName}
                  <input className={`${field} mt-1`} value={form.providerName} maxLength={60} onChange={(e) => setForm({ ...form, providerName: e.target.value })} />
                </label>
              )}
              <label className="block text-[13px] font-medium text-slate-700">
                {T.enrolledLabel}
                <select className={`${field} mt-1`} value={form.enrolledViaLink} onChange={(e) => setForm({ ...form, enrolledViaLink: e.target.value as EnrolledViaLink })}>
                  {(["yes", "no", "unknown"] as const).map((v) => (
                    <option key={v} value={v}>
                      {T.enrolled[v]}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className="text-[13px] font-medium text-slate-700">{t("Estado", "Status")}</legend>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(["active", "cancelled", "unknown"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={form.status === v}
                      onClick={() => setForm({ ...form, status: v })}
                      className={`pressable inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold ${form.status === v ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                    >
                      {T.status[v]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="block text-[13px] font-medium text-slate-700">
                {T.day}
                <input type="date" className={`${field} mt-1`} value={form.checkedOn} max={texasToday()} onChange={(e) => setForm({ ...form, checkedOn: e.target.value })} />
              </label>
              <label className="block text-[13px] font-medium text-slate-700">
                {T.howLabel}
                <select className={`${field} mt-1`} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as CheckMethod })}>
                  {CHECK_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {T.method[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[13px] font-medium text-slate-700">
                {T.note}
                <input className={`${field} mt-1`} value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
              {error && (
                <p role="alert" className="text-[13px] text-red-700">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || (form.provider === "other" && form.providerName.trim().length < 2)} onClick={save} className={ROW_BUTTON} data-testid="monitoring-save">
                  {busy ? T.saving : T.save}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="pressable inline-flex h-11 items-center px-3 text-[14px] font-medium text-slate-600">
                  {t("Cancelar", "Cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setOpen(true)} className={`${ROW_BUTTON} mt-4 w-full`} data-testid="monitoring-record">
              {T.record}
            </button>
          )
        ) : (
          <div className="mt-3">
            <DeniedNote>{T.denied}</DeniedNote>
          </div>
        )}

        {history.length > 1 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-medium text-blue-700">{T.history}</summary>
            <ul className="mt-2 space-y-1.5 text-[13px] text-slate-600">
              {history.slice(1).map((c) => (
                <li key={c.id}>
                  {day(c.checkedOn)} · {T.status[c.status]} · {T.method[c.method]} · {c.by}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-3 border-t hairline pt-3 text-xs leading-relaxed text-slate-500">{T.noAmounts}</p>
      </div>
    </section>
  );
}
