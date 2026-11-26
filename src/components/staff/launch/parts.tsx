"use client";

import { useState } from "react";
import Link from "next/link";
import { ago } from "@/lib/control/overview";
import { WHATSAPP_TEMPLATE_NAMES, type ItemState, type Note, type ProbeService } from "@/lib/launch/checklist";
import type { ServiceHealth, ServiceState, SystemHealth } from "@/lib/launch/health";
import type { ItemReport, LaunchReport } from "@/lib/launch/status";
import { LAUNCH_TEXT, type LaunchText } from "@/lib/launch/text";
import type { StaffLocale } from "@/lib/staff/i18n/locale";
import { useStaffLocale, useText } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { Chip, GOLD_ROW_BUTTON, QUIET_BUTTON, ROW_BUTTON, SectionTitle } from "@/components/staff/ui";

// The pieces of Launch readiness (/equipo/lanzamiento): the navy summary band
// (ALTO's KPI band), the next steps and what is blocked, one row per item
// with its details, and the system health cards and jobs. Every word comes
// from src/lib/launch/text.ts; nothing here ever receives a secret.

export const STATE_TONE: Record<ItemState, string> = {
  ready: "bg-green-50 text-green-800",
  missing: "bg-amber-100 text-blue-900",
  check: "bg-blue-50 text-blue-700",
  manual: "bg-slate-100 text-slate-700",
  failing: "bg-red-50 text-red-700",
};

const SERVICE_TONE: Record<ServiceState, string> = {
  not_configured: "bg-slate-100 text-slate-700",
  configured: "bg-blue-50 text-blue-700",
  working: "bg-green-50 text-green-800",
  failing: "bg-red-50 text-red-700",
};

const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** One note in words: dates as "3 h ago", item keys as their names, probe codes in plain words. */
export function noteText(note: Note, tx: LaunchText, locale: StaffLocale, now: Date): string {
  const args = (note.args ?? []).map((a) => {
    if (typeof a === "string" && ISO.test(a)) return ago(a, now, locale);
    if (note.code === "waits_on" && typeof a === "string") return a in tx.items ? tx.items[a as keyof LaunchText["items"]].title : a;
    if (note.code === "probe_failed" && typeof a === "string" && a in tx.probeCodes) return tx.probeCodes[a as keyof LaunchText["probeCodes"]];
    return a;
  });
  const value = tx.notes[note.code];
  return typeof value === "function" ? (value as (...x: Array<string | number>) => string)(...args) : value;
}

export function StateChip({ state }: { state: ItemState }) {
  const tx = useText(LAUNCH_TEXT);
  return <Chip tone={STATE_TONE[state]}>{tx.states[state]}</Chip>;
}

/** ALTO's navy KPI band: how many required items are ready, and whether the business can go live. */
export function SummaryBand({ report }: { report: LaunchReport }) {
  const tx = useText(LAUNCH_TEXT);
  const { required, recommended, later, live, failing } = report.summary;
  const pct = required.total > 0 ? Math.round((required.ready / required.total) * 100) : 0;
  return (
    <section className="overflow-hidden rounded-[14px] bg-blue-900 text-white shadow-[0_6px_20px_rgba(18,33,58,0.12)]" data-testid="launch-summary" aria-labelledby="launch-summary-title">
      <div className="px-5 py-5 md:px-6">
        <p id="launch-summary-title" className="text-[12px] font-semibold uppercase tracking-[0.08em] text-blue-200">
          {tx.summaryTitle}
        </p>
        <p className="mt-1 font-display text-[30px] font-semibold leading-tight text-amber-400 tabular-nums" data-on-navy data-testid="launch-count">
          {tx.readyCount(required.ready, required.total)}
        </p>
        <p className="mt-0.5 text-[13px] text-blue-100">{tx.requiredLine}</p>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={required.total} aria-valuenow={required.ready} aria-label={tx.readyCount(required.ready, required.total)}>
          <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 flex items-start gap-2 text-[14.5px] leading-snug text-white" data-testid={live ? "launch-live" : "launch-not-live"}>
          <Icon name={live ? "check" : "info"} size={18} className="mt-0.5 shrink-0" />
          {live ? tx.live : tx.notLive}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-3">
        <div className="bg-blue-900 px-5 py-3 md:px-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-blue-200">{tx.needed.recommended}</p>
          <p className="font-display text-[20px] font-semibold tabular-nums">
            {recommended.ready}/{recommended.total}
          </p>
        </div>
        <div className="bg-blue-900 px-5 py-3 md:px-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-blue-200">{tx.needed.later}</p>
          <p className="font-display text-[20px] font-semibold tabular-nums">
            {later.ready}/{later.total}
          </p>
        </div>
        <div className="col-span-2 bg-blue-900 px-5 py-3 sm:col-span-1 md:px-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-blue-200">{tx.states.failing}</p>
          <p className="font-display text-[20px] font-semibold tabular-nums">{failing}</p>
        </div>
      </div>
    </section>
  );
}

/** The next three things, and what is blocked by what. */
export function NextAndBlocked({ report, onOpen }: { report: LaunchReport; onOpen: (key: string) => void }) {
  const tx = useText(LAUNCH_TEXT);
  const byKey = new Map(report.items.map((i) => [i.key, i]));
  return (
    <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
      <section className="card px-5 py-4" aria-labelledby="launch-next" data-testid="launch-next">
        <h2 id="launch-next" className="console-label">
          {tx.nextTitle}
        </h2>
        {report.summary.next.length === 0 ? (
          <p className="mt-2 text-[14px] text-slate-600">{tx.nextNone}</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {report.summary.next.map((key, i) => {
              const item = byKey.get(key)!;
              return (
                <li key={key} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-900 text-[12.5px] font-semibold text-white tabular-nums">{i + 1}</span>
                  <div className="min-w-0">
                    <button type="button" onClick={() => onOpen(key)} className="min-h-11 text-left text-[15px] font-semibold text-blue-900 underline-offset-2 hover:underline md:min-h-0">
                      {tx.items[key as keyof LaunchText["items"]].title}
                    </button>
                    <p className="mt-0.5 text-[13.5px] leading-snug text-slate-600 [overflow-wrap:anywhere]">{tx.items[key as keyof LaunchText["items"]].next}</p>
                    <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{tx.who[item.who]}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section className="card px-5 py-4" aria-labelledby="launch-blocked" data-testid="launch-blocked">
        <h2 id="launch-blocked" className="console-label">
          {tx.blockedTitle}
        </h2>
        {report.summary.blocked.length === 0 ? (
          <p className="mt-2 text-[14px] text-slate-600">{tx.blockedNone}</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {report.summary.blocked.map((b) => (
              <li key={b.outcome} className="py-2.5">
                <p className="text-[14px] font-semibold text-slate-900">{tx.outcomes[b.outcome]}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {b.by.slice(0, 6).map((key) => (
                    <button key={key} type="button" onClick={() => onOpen(key)} className="pressable inline-flex min-h-11 md:min-h-9 max-w-full items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-left text-[12.5px] font-medium leading-snug text-slate-700 hover:border-amber-500">
                      {tx.items[key as keyof LaunchText["items"]].title}
                    </button>
                  ))}
                  {b.by.length > 6 && <span className="inline-flex min-h-9 items-center px-1 text-[12.5px] text-slate-500">+{b.by.length - 6}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One checklist item: its status, and on opening, why, the next step, the notes and its controls. */
export function ItemRow({
  item,
  now,
  open,
  onToggle,
  onTick,
  onProbe,
  probing,
  templatesListed,
}: {
  item: ItemReport;
  now: Date;
  open: boolean;
  onToggle: () => void;
  onTick: (done: boolean, note: string) => Promise<void>;
  onProbe: (service: ProbeService) => Promise<void>;
  probing: boolean;
  templatesListed: readonly string[] | null;
}) {
  const tx = useText(LAUNCH_TEXT);
  const { locale } = useStaffLocale();
  const words = tx.items[item.key as keyof LaunchText["items"]];
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <li id={`item-${item.key}`} className="border-t hairline first:border-t-0" data-testid={`launch-item-${item.key}`} data-state={item.state}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug text-slate-900">{words.title}</span>
          <span className="mt-0.5 block text-[12.5px] text-slate-500">
            {tx.needed[item.needed]} · {tx.whoShort[item.who]}
          </span>
        </span>
        <StateChip state={item.state} />
        <Icon name="chevron" size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 text-[14px] leading-relaxed text-slate-700 sm:px-5">
          {item.notes.length > 0 && (
            <p className={`rounded-[10px] px-3 py-2 text-[13.5px] ${item.state === "failing" ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700"} [overflow-wrap:anywhere]`} data-testid="launch-note">
              {item.notes.map((n) => noteText(n, tx, locale, now)).join(" ")}
            </p>
          )}
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-x-4">
            <dt className="console-label pt-0.5 text-[11.5px] text-slate-500">{tx.labels.why}</dt>
            <dd>{words.why}</dd>
            <dt className="console-label pt-0.5 text-[11.5px] text-slate-500">{tx.labels.next}</dt>
            <dd className="font-medium text-slate-900 [overflow-wrap:anywhere]">{words.next}</dd>
            <dt className="console-label pt-0.5 text-[11.5px] text-slate-500">{tx.labels.who}</dt>
            <dd>{tx.who[item.who]}</dd>
            {item.missingEnv.length > 0 && (
              <>
                <dt className="console-label pt-0.5 text-[11.5px] text-slate-500">{tx.labels.variables}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {item.missingEnv.map((name) => (
                    <code key={name} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[12.5px] text-slate-800 [overflow-wrap:anywhere]">
                      {name}
                    </code>
                  ))}
                </dd>
              </>
            )}
            {item.waitingOn.length > 0 && (
              <>
                <dt className="console-label pt-0.5 text-[11.5px] text-slate-500">{tx.labels.waitsOn}</dt>
                <dd>{item.waitingOn.map((k) => tx.items[k as keyof LaunchText["items"]]?.title ?? k).join(" · ")}</dd>
              </>
            )}
            {item.blocks.length > 0 && (
              <>
                <dt className="console-label pt-0.5 text-[11.5px] text-slate-500">{tx.labels.blocks}</dt>
                <dd>{item.blocks.map((o) => tx.outcomes[o]).join(" · ")}</dd>
              </>
            )}
            <dt className="console-label pt-0.5 text-[11.5px] text-slate-500">{tx.labels.docs}</dt>
            <dd className="[overflow-wrap:anywhere]">
              <code className="text-[12.5px] text-slate-800">{item.docs.file}</code> · {item.docs.section}
            </dd>
          </dl>
          {item.key === "whatsapp_templates_meta" && (
            <details className="rounded-[10px] border border-slate-200 bg-white">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13.5px] font-semibold text-blue-700">
                {tx.labels.templatesTitle} · {WHATSAPP_TEMPLATE_NAMES.length}
              </summary>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-4 px-3 pb-3 sm:grid-cols-2" data-testid="launch-templates">
                {WHATSAPP_TEMPLATE_NAMES.map((name) => {
                  const listed = templatesListed?.includes(name) ?? false;
                  return (
                    <li key={name} className="flex items-center justify-between gap-2 border-t hairline py-1.5 text-[12.5px]">
                      <code className="min-w-0 truncate text-slate-800">{name}</code>
                      <span className={listed ? "shrink-0 text-green-700" : "shrink-0 text-slate-500"}>{listed ? tx.labels.listed : tx.labels.notListed}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {item.kind === "manual" && (
              <>
                {!item.tick?.done && (
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={300}
                    placeholder={tx.labels.tickNote}
                    aria-label={tx.labels.tickNote}
                    className="h-11 min-w-0 flex-1 rounded-[10px] border border-slate-300 bg-white px-3 text-[14px] sm:max-w-sm"
                  />
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    await onTick(!item.tick?.done, note);
                    setNote("");
                    setSaving(false);
                  }}
                  className={item.tick?.done ? ROW_BUTTON : GOLD_ROW_BUTTON}
                  data-testid={`tick-${item.key}`}
                >
                  {item.tick?.done ? tx.labels.untick : tx.labels.tick}
                </button>
              </>
            )}
            {item.probe && (
              <button type="button" disabled={probing} onClick={() => onProbe(item.probe!)} className={ROW_BUTTON} data-testid={`probe-${item.key}`}>
                {probing ? tx.labels.checking : tx.labels.checkNow}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function when(iso: string | null, tx: LaunchText, locale: StaffLocale, now: Date): string {
  return iso ? ago(iso, now, locale) : tx.health.never;
}

function minutesWord(minutes: number, tx: LaunchText): string {
  if (minutes >= 7 * 24 * 60) return tx.health.week;
  if (minutes >= 60) return tx.health.hours(Math.round(minutes / 60));
  return `${minutes} min`;
}

function ServiceCard({ service, now, onProbe, probing }: { service: ServiceHealth; now: Date; onProbe: (s: ProbeService) => void; probing: boolean }) {
  const tx = useText(LAUNCH_TEXT);
  const { locale } = useStaffLocale();
  const words = tx.health.services[service.key];
  return (
    <section className="card flex flex-col px-5 py-4" data-testid={`service-${service.key}`} data-state={service.state} aria-labelledby={`service-${service.key}-title`}>
      <div className="flex items-start justify-between gap-3">
        <h3 id={`service-${service.key}-title`} className="min-w-0 font-display text-[15px] font-semibold uppercase leading-tight tracking-[0.04em] text-blue-900">
          {words.title}
        </h3>
        <Chip tone={SERVICE_TONE[service.state]}>{tx.health.states[service.state]}</Chip>
      </div>
      <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{words.what}</p>
      <dl className="mt-3 space-y-1 text-[13px]">
        {service.mode && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{tx.health.mode}</dt>
            <dd className="text-right font-semibold text-slate-800">{noteText(service.mode, tx, locale, now)}</dd>
          </div>
        )}
        {(service.key === "lob" || service.key === "whatsapp" || service.key === "highlevel") && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{tx.health.lastActivity}</dt>
            <dd className="text-right font-semibold text-slate-800 tabular-nums">{when(service.lastActivityAt, tx, locale, now)}</dd>
          </div>
        )}
        {service.key !== "database" && service.key !== "email" && service.key !== "error_alerts" && service.key !== "phone_alerts" && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{tx.health.lastError}</dt>
            <dd className={`text-right font-semibold tabular-nums ${service.lastErrorAt ? "text-red-700" : "text-slate-800"}`}>{when(service.lastErrorAt, tx, locale, now)}</dd>
          </div>
        )}
        {service.probe && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{tx.health.lastCheck}</dt>
            <dd className="text-right font-semibold text-slate-800">
              {service.lastProbe ? `${ago(service.lastProbe.checkedAt, now, locale)} · ${tx.probeCodes[service.lastProbe.code as keyof LaunchText["probeCodes"]] ?? service.lastProbe.code}` : tx.health.never}
            </dd>
          </div>
        )}
      </dl>
      {service.probe && service.state !== "not_configured" && (
        <button type="button" disabled={probing} onClick={() => onProbe(service.probe!)} className={`${ROW_BUTTON} mt-3 self-start`} data-testid={`service-probe-${service.key}`}>
          {probing ? tx.labels.checking : tx.labels.checkNow}
        </button>
      )}
    </section>
  );
}

export function HealthView({ health, now, onProbe, probing }: { health: SystemHealth; now: Date; onProbe: (s: ProbeService) => void; probing: ProbeService | null }) {
  const tx = useText(LAUNCH_TEXT);
  const { locale } = useStaffLocale();
  return (
    <div data-testid="launch-health">
      <p className="px-1 text-[14px] leading-relaxed text-slate-600">{tx.health.intro}</p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
        {health.services.map((s) => (
          <ServiceCard key={s.key} service={s} now={now} onProbe={onProbe} probing={probing !== null && probing === s.probe} />
        ))}
      </div>
      <p className="mt-2 px-1 text-xs leading-relaxed text-slate-500">{tx.health.errorsNote}</p>

      <section className="mt-7" aria-labelledby="launch-jobs">
        <SectionTitle>
          <span id="launch-jobs">{tx.health.jobsTitle}</span>
        </SectionTitle>
        <p className="mb-3 px-1 text-[13.5px] leading-relaxed text-slate-600">{tx.health.jobsIntro}</p>
        <ul className="card overflow-hidden" data-testid="launch-jobs-list">
          {health.jobs.map((job, i) => (
            <li key={job.job} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 ${i > 0 ? "border-t hairline" : ""}`} data-testid={`job-${job.job}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold text-slate-900">{tx.items[`job_${job.job.replace(/-/g, "_")}` as keyof LaunchText["items"]].title}</p>
                <p className="text-[12.5px] text-slate-500 [overflow-wrap:anywhere]">
                  <code>{job.path}</code> · {tx.health.every(minutesWord(job.everyMinutes, tx))} · {tx.needed[job.needed]}
                </p>
                {job.heartbeat?.lastError && job.state === "failing" && (
                  <p className="mt-1 rounded-[8px] bg-red-50 px-2 py-1 text-[12.5px] text-red-800 [overflow-wrap:anywhere]">
                    {tx.health.error}: {job.heartbeat.lastError}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[12.5px] text-slate-600 tabular-nums">
                <span>
                  {tx.health.lastOk}: <span className="font-semibold text-slate-800">{when(job.heartbeat?.lastOkAt ?? null, tx, locale, now)}</span>
                </span>
                <StateChip state={job.state} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The compact card on the Overview, for an administrator while the business is not live. */
export function LaunchOverviewCard({ report }: { report: LaunchReport }) {
  const tx = useText(LAUNCH_TEXT);
  const { ready, total } = report.summary.required;
  const next = report.summary.next[0];
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
  return (
    <section className="card mt-5 flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" data-testid="overview-launch-card" aria-labelledby="overview-launch-title">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
        <Icon name="rocket" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="overview-launch-title" className="font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
          <span className="text-slate-500">9 · </span>
          {tx.overviewCard.title}: <span className="tabular-nums">{tx.overviewCard.line(ready, total)}</span>
          {report.sample && <span className="ml-2 align-middle text-[11px] font-semibold normal-case tracking-normal text-slate-500">({tx.overviewCard.sample})</span>}
        </h2>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full rounded-full bg-blue-700" style={{ width: `${pct}%` }} />
        </div>
        {next && (
          <p className="mt-1.5 text-[13.5px] leading-snug text-slate-600">
            <span className="font-semibold text-slate-800">{tx.overviewCard.next}</span> {tx.items[next as keyof LaunchText["items"]].title}
          </p>
        )}
      </div>
      <Link href="/equipo/lanzamiento" className={`${QUIET_BUTTON} shrink-0 self-start font-semibold text-blue-700 sm:self-center`} data-testid="overview-launch-open">
        {tx.overviewCard.open}
        <Icon name="chevron" size={15} />
      </Link>
    </section>
  );
}
