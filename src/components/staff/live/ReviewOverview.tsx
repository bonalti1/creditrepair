"use client";

const BUREAU_LABEL = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" } as const;
import { CHECK_KIND_LABEL } from "@/lib/domain/checks";
import type { ReviewOverview as Overview } from "@/lib/live/overview";
import { LIVE_SOURCES, LIVE_TEXT } from "@/lib/live/text";
import { shortDay } from "@/lib/staff/format";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";

// The review overview (docs/LIVE-FUNNEL.md, step 4), as the team reads it
// before recording: plain counts, what the law lets the person dispute, the
// § 605 time limits, what the data checks noticed (never a verdict), the
// credit-building basics, and which package may fit (Complete first). No
// score, no promise. Also what the recording view shares on screen, so it
// shows only this person's overview and nothing else.

export default function ReviewOverview({ overview, plans, compact = false }: { overview: Overview; plans: string[]; compact?: boolean }) {
  const x = useText(LIVE_TEXT);
  const t = useTx();
  const { locale } = useStaffLocale();
  const c = overview.counts;
  const figures: Array<[string, number]> = [
    [x.counts.accounts, c.accounts],
    [x.counts.collections, c.collections],
    [x.counts.latePayments, c.latePayments],
    [x.counts.inquiries, c.inquiries],
    [x.counts.publicRecords, c.publicRecords],
    [x.counts.chargeOffs, c.chargeOffs],
  ];
  const suggested = overview.fit.suggested;
  return (
    <div className="space-y-4" data-testid="review-overview">
      <section className="card px-4 py-4 sm:px-5">
        <h3 className="console-label">{x.counts.title}</h3>
        <p className="mt-1 text-[13px] text-slate-500">
          {overview.reportDate ? x.counts.reportDate(shortDay(overview.reportDate, locale)) : null}
          {overview.bureaus.length > 0 ? ` · ${overview.bureaus.map((b) => BUREAU_LABEL[b]).join(", ")}` : ` · ${x.counts.noBureau}`}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {figures.map(([label, value]) => (
            <div key={label} className="rounded-[12px] bg-slate-50 px-3 py-2.5">
              <dt className="text-[12.5px] leading-snug text-slate-600">{label}</dt>
              <dd className="font-display text-[26px] font-semibold leading-tight text-blue-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[12.5px] text-slate-500">{x.counts.onceNote}</p>
        {!compact && overview.bureaus.length > 1 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[13px]">
              <caption className="sr-only">{x.counts.perBureau}</caption>
              <thead>
                <tr className="bg-slate-50 text-[11.5px] uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1.5 font-semibold">{x.counts.perBureau}</th>
                  <th className="px-2 py-1.5 font-semibold">{x.counts.accounts}</th>
                  <th className="px-2 py-1.5 font-semibold">{x.counts.collections}</th>
                  <th className="px-2 py-1.5 font-semibold">{x.counts.latePayments}</th>
                  <th className="px-2 py-1.5 font-semibold">{x.counts.inquiries}</th>
                  <th className="px-2 py-1.5 font-semibold">{x.counts.publicRecords}</th>
                </tr>
              </thead>
              <tbody>
                {overview.bureaus.map((b) => {
                  const r = overview.byBureau[b];
                  return r ? (
                    <tr key={b} className="border-t hairline tabular-nums">
                      <th scope="row" className="px-2 py-1.5 font-semibold text-slate-900">{BUREAU_LABEL[b]}</th>
                      <td className="px-2 py-1.5">{r.accounts}</td>
                      <td className="px-2 py-1.5">{r.collections}</td>
                      <td className="px-2 py-1.5">{r.latePayments}</td>
                      <td className="px-2 py-1.5">{r.inquiries}</td>
                      <td className="px-2 py-1.5">{r.publicRecords}</td>
                    </tr>
                  ) : null;
                })}
              </tbody>
            </table>
          </div>
        )}
        {overview.doubtful > 0 && (
          <p className="mt-3 flex gap-2 rounded-[10px] bg-amber-50 px-3 py-2 text-[13px] leading-snug text-blue-900 ring-1 ring-inset ring-amber-200" data-testid="overview-doubtful">
            <Icon name="info" size={16} className="mt-0.5 shrink-0 text-amber-700" />
            {x.doubtful(overview.doubtful)}
          </p>
        )}
      </section>

      <section className="card px-4 py-4 sm:px-5">
        <h3 className="console-label">{x.law.title}</h3>
        <ul className="mt-2 space-y-1.5 text-[14px] leading-snug text-slate-700">
          {x.law.lines.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-slate-500">
          <a href={LIVE_SOURCES.disputes} target="_blank" rel="noreferrer" className="underline">
            {x.law.source}
          </a>
        </p>
      </section>

      <section className="card px-4 py-4 sm:px-5">
        <h3 className="console-label">{x.limits.title}</h3>
        <p className="mt-1 text-[13px] text-slate-500">{x.limits.intro}</p>
        {overview.timeLimits.length === 0 ? (
          <p className="mt-2 text-[14px] text-slate-600">{x.limits.none}</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-200">
            {overview.timeLimits.map((l) => (
              <li key={`${l.name}-${l.startedOn}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-[14px]">
                <span className="min-w-0">
                  <span className="font-semibold text-slate-900">{l.name}</span>
                  <span className="text-slate-500"> · {x.limits.types[l.type]} · {l.bureaus.map((b) => BUREAU_LABEL[b]).join(", ")}</span>
                </span>
                <span className={`tabular-nums ${l.passed ? "font-semibold text-blue-900" : "text-slate-600"}`}>{l.passed ? x.limits.passed(shortDay(l.until, locale)) : x.limits.until(shortDay(l.until, locale))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card px-4 py-4 sm:px-5">
        <h3 className="console-label">{x.checks.title}</h3>
        <p className="mt-1 text-[13px] text-slate-500">{x.checks.intro}</p>
        {overview.checks.length === 0 ? (
          <p className="mt-2 text-[14px] text-slate-600">{x.checks.none}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {overview.checks.slice(0, compact ? 6 : 40).map((check) => (
              <li key={check.id} className="rounded-[10px] bg-slate-50 px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-slate-900">
                  {CHECK_KIND_LABEL[check.kind][locale]}
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${check.strength === "objective" ? "bg-blue-100 text-blue-900" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200"}`}>
                    {check.strength === "objective" ? x.checks.objective : x.checks.worth}
                  </span>
                </p>
                <p className="mt-0.5 text-[13.5px] leading-snug text-slate-700">{check.explanation[locale]}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card px-4 py-4 sm:px-5">
        <h3 className="console-label">{x.building.title}</h3>
        <ul className="mt-2 space-y-1 text-[14px] leading-snug text-slate-700">
          {x.building.lines.map((line) => (
            <li key={line} className="flex gap-2">
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-green-700" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-slate-500">
          <a href={LIVE_SOURCES.building} target="_blank" rel="noreferrer" className="underline">
            {x.building.source}
          </a>
        </p>
      </section>

      <section className="card px-4 py-4 sm:px-5" data-testid="overview-fit">
        <h3 className="console-label">{x.fit.title}</h3>
        <p className="mt-1 text-[13px] text-slate-500">{x.fit.intro}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(["complete", "diy"] as const).map((key) => {
            const p = x.fit[key];
            const best = suggested === key;
            return (
              <div key={key} className={`rounded-[12px] px-3.5 py-3 ${best ? "bg-blue-900 text-white" : "bg-slate-50 text-slate-800"}`} data-package={key}>
                <p className="flex flex-wrap items-center gap-2 font-display text-[16px] font-semibold">
                  {p.name}
                  {best && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11.5px] font-semibold text-blue-900">{x.fit.suggested}</span>}
                </p>
                <p className={`mt-1 text-[13.5px] leading-snug ${best ? "text-blue-100" : "text-slate-600"}`}>{p.what}</p>
                <p className={`mt-1 text-[13.5px] font-semibold leading-snug ${best ? "text-white" : "text-slate-900"}`}>{p.who}</p>
                <p className={`mt-1 text-[12.5px] leading-snug ${best ? "text-blue-100" : "text-slate-500"}`}>{p.charged}</p>
              </div>
            );
          })}
        </div>
        {suggested === "either" && <p className="mt-2 text-[13px] font-semibold text-slate-700">{x.fit.either}</p>}
        {overview.fit.reasons.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {overview.fit.reasons.map((r) => (
              <li key={r} className="rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                {x.fit.reasons[r]}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[13.5px] leading-snug text-slate-700">{x.fit.upgrade}</p>
        <p className="mt-1 text-[13.5px] leading-snug text-slate-700">{x.fit.charges}</p>
        <p className="mt-2 text-[12.5px] text-slate-500">{plans.length > 0 ? `${x.fit.approvedPlans} ${plans.join(", ")}` : x.fit.noPlans}</p>
      </section>

      {!compact && overview.warnings.length > 0 && (
        <section className="card px-4 py-4 sm:px-5">
          <h3 className="console-label">{x.warnings}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-slate-600">
            {overview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-slate-500">{t("Las notas del lector están en español.", "The reader's notes are in Spanish.")}</p>
        </section>
      )}
    </div>
  );
}
