"use client";

import { caseDay } from "@/lib/case/timeline";
import { goalLabel, partnerStage, partnerTimeline, SHARE_LEVEL_LABEL, type L, type PartnerProgress } from "@/lib/partners/sharing";
import { PARTNER_SHARING_COPY } from "@/lib/partners/sharingCopy";

// One client as a partner sees them: the stage in one sentence, what comes
// next, the goal, the two counts at the "summary" level, and the timeline of
// milestone dates. Used on the partner's client page and, with the client's
// own facts, as the preview next to the client's choice. Never anything else:
// PartnerProgress has nothing else in it.

export function StageChip({ progress, locale, now }: { progress: PartnerProgress; locale: L; now: Date }) {
  const stage = partnerStage(progress, locale, now);
  const tone = stage.key === "ended" ? "bg-slate-100 text-slate-600" : stage.key === "waiting_answers" || stage.key === "window_over" ? "bg-blue-50 text-blue-700" : "bg-amber-100 text-blue-900";
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{stage.label}</span>;
}

export default function ClientProgressView({ progress, locale, now, compact = false }: { progress: PartnerProgress; locale: L; now: Date; compact?: boolean }) {
  const c = PARTNER_SHARING_COPY[locale];
  const stage = partnerStage(progress, locale, now);
  const events = partnerTimeline(progress, locale, now);
  const goal = goalLabel(progress.goal, locale);
  return (
    <div className="space-y-4" data-testid="client-progress">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[19px] font-semibold leading-tight text-slate-900">{progress.name}</p>
            <p className="mt-1 text-[12.5px] font-medium text-slate-500">
              {c.sharedOn(caseDay(progress.sharedAt, locale))} · {SHARE_LEVEL_LABEL[locale][progress.level]}
              {progress.how === "added_by_code" ? ` · ${c.addedByCode}` : ""}
            </p>
          </div>
          <StageChip progress={progress} locale={locale} now={now} />
        </div>
        <p className="mt-3 text-[16px] leading-relaxed text-slate-800">{stage.sentence}</p>
        {(stage.next || goal) && (
          <dl className="mt-4 grid grid-cols-1 gap-3 border-t hairline pt-3 text-[14px] sm:grid-cols-2">
            {stage.next && (
              <div>
                <dt className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{c.next}</dt>
                <dd className="mt-0.5 text-slate-900">
                  {stage.next.label} {caseDay(stage.next.at, locale)}
                </dd>
              </div>
            )}
            {goal && (
              <div>
                <dt className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{c.goal}</dt>
                <dd className="mt-0.5 text-slate-900">{goal}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {progress.level === "summary" ? (
        <section className="card p-5" aria-label={c.summaryTitle} data-testid="client-summary">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{c.summaryTitle}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <dd className="text-[26px] font-semibold tabular-nums text-slate-900">{progress.disputingCount ?? 0}</dd>
              <dt className="text-[13px] leading-snug text-slate-600">{c.disputing}</dt>
            </div>
            <div>
              <dd className="text-[26px] font-semibold tabular-nums text-slate-900">{progress.noLongerReportedCount ?? 0}</dd>
              <dt className="text-[13px] leading-snug text-slate-600">{c.noLonger}</dt>
            </div>
          </dl>
          <p className="mt-3 text-[12.5px] leading-relaxed text-slate-500">{c.summaryNote}</p>
        </section>
      ) : (
        !compact && <p className="px-1 text-[13px] leading-relaxed text-slate-500">{c.progressOnlyNote}</p>
      )}

      <section aria-label={c.timelineTitle}>
        <h3 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.timelineTitle}</h3>
        <ol className="card overflow-hidden">
          {events.map((e, i) => (
            <li key={e.key} className={`flex items-start gap-3 px-5 py-3 ${i > 0 ? "border-t hairline" : ""}`}>
              <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${e.done ? "bg-blue-700" : "border-2 border-slate-300 bg-white"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] leading-snug ${e.done ? "text-slate-900" : "text-slate-500"}`}>{e.title}</span>
                <span className="block text-[12.5px] text-slate-500">
                  {e.done ? e.day : `${c.expected}: ${e.day}`}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
      {!compact && <p className="px-1 text-[12.5px] leading-relaxed text-slate-500">{c.privacyNote}</p>}
    </div>
  );
}
