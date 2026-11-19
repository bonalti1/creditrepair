"use client";

import Link from "next/link";
import { DEMO_REPORT, DEMO_SCORE_HISTORY } from "@/lib/demo";
import { useLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { ReportItem } from "@/lib/domain/types";
import { useFlags } from "@/lib/ux/flagsStore";
import { itemTitle } from "@/lib/ux/itemDisplay";
import { nextAction, sessionJourneyState } from "@/lib/ux/journey";
import Icon from "@/components/Icon";

// The Credit Audit — Credit Repair Cloud's conversion weapon, handed directly
// to the consumer instead of to an agency closing a sale. Severity-ranked
// findings, per-bureau scores, and a cross-bureau matrix (an item appearing
// inconsistently across bureaus is the classic inaccuracy signal). Copy
// discipline: it shows WHERE TO LOOK and never says an item IS wrong. The
// button at the end is the journey's one next step, the same one Home shows.

const BUREAUS = ["equifax", "experian", "transunion"] as const;
const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

const HIGH = /collection|charge.?off|repossess|foreclos/i;

function severity(item: ReportItem): "high" | "medium" | "info" | null {
  if (item.category === "public_record") return "high";
  if (item.category === "personal_info") return "info";
  const blob = JSON.stringify(item.data);
  if (HIGH.test(blob)) return "high";
  if (item.negative) return "medium";
  return null;
}

export default function Audit() {
  const { locale, d } = useLocale();
  const { flags, roundApproved, hydrated } = useFlags();
  const items = DEMO_REPORT.items;
  // Known only once the saved decisions are read; the audit itself shows right away.
  const step = hydrated ? nextAction(sessionJourneyState(items, flags, roundApproved), locale) : null;
  const high = items.filter((i) => severity(i) === "high");
  const medium = items.filter((i) => severity(i) === "medium");
  const info = items.filter((i) => severity(i) === "info");

  // Cross-bureau matrix for negative non-personal items, grouped by name.
  const byName = new Map<string, Set<string>>();
  for (const i of items) {
    if (!i.negative || i.category === "personal_info") continue;
    if (!byName.has(i.name)) byName.set(i.name, new Set());
    byName.get(i.name)!.add(i.bureau);
  }

  const first = DEMO_SCORE_HISTORY[0]?.scores;
  const fmtDate = new Date(DEMO_REPORT.pulledAt).toLocaleDateString(
    locale === "es" ? "es-MX" : "en-US",
  );

  return (
    <main className="animate-rise space-y-5">
      <header className="px-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{d.audit.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{d.audit.subtitle(fmtDate)}</p>
        <button
          onClick={() => window.print()}
          className="pressable -ml-1 mt-1 inline-flex h-11 items-center gap-2 rounded-full px-1 text-[15px] font-medium text-blue-700 print:hidden"
        >
          <Icon name="doc" size={18} />
          {d.audit.print}
        </button>
      </header>

      <section>
        <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{d.audit.scores}</h2>
        <div className="card overflow-hidden">
          {BUREAUS.map((b, index) => {
            const score = DEMO_REPORT.scores[b];
            const delta = score && first?.[b] ? score - first[b] : null;
            return (
              <div key={b} className={`flex items-center gap-3 px-5 py-4 ${index > 0 ? "border-t hairline" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-[17px] font-medium text-slate-900">{BUREAU_LABEL[b]}</p>
                  {delta !== null && (
                    <p className={`text-[13px] font-medium tabular-nums ${delta >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {d.scores.trend(delta)}
                    </p>
                  )}
                </div>
                <p className="text-[22px] font-semibold tabular-nums text-slate-900">{score ?? "—"}</p>
              </div>
            );
          })}
        </div>
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">{d.audit.scoreNote}</p>
      </section>

      <AuditSection
        title={d.audit.severityHigh}
        note={d.audit.severityHighNote}
        items={high}
        emptyText={d.audit.clean}
        locale={locale}
      />
      <AuditSection title={d.audit.severityMed} note={d.audit.severityMedNote} items={medium} locale={locale} />
      <AuditSection title={d.audit.severityInfo} note={d.audit.severityInfoNote} items={info} locale={locale} />

      {byName.size > 0 && (
        <section className="card overflow-hidden">
          <div className="px-5 pb-4 pt-5">
            <h2 className="text-[17px] font-semibold leading-snug text-slate-900">{d.audit.matrix}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{d.audit.matrixNote}</p>
          </div>
          <ul>
            {[...byName.entries()].map(([name, bureaus]) => (
              <li key={name} className="border-t hairline px-5 py-4">
                <p className="text-[15px] font-medium text-slate-900">{name}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BUREAUS.map((b) => (
                    <span
                      key={b}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        bureaus.has(b) ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {bureaus.has(b) ? (
                        <span className="text-[9px] leading-none text-red-600">●</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      {BUREAU_LABEL[b]}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step && (
        <div className="pt-1 print:hidden">
          <p className="px-4 pb-3 text-center text-[17px] font-semibold leading-snug text-slate-900">{step.title}</p>
          <Link
            href={step.href}
            className="pressable flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
          >
            {step.cta}
          </Link>
          <p className="px-4 pt-3 text-center text-xs leading-relaxed text-slate-500">{d.audit.ctaNote}</p>
        </div>
      )}
    </main>
  );
}

function AuditSection({
  title,
  note,
  items,
  emptyText,
  locale,
}: {
  title: string;
  note: string;
  items: ReportItem[];
  emptyText?: string;
  locale: Locale;
}) {
  if (items.length === 0 && !emptyText) return null;

  return (
    <section className="card overflow-hidden">
      <div className="px-5 pb-4 pt-5">
        <h2 className="text-[17px] font-semibold leading-snug text-slate-900">
          {title} {items.length > 0 && <span className="font-normal tabular-nums text-slate-400">({items.length})</span>}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{note}</p>
      </div>
      {items.length === 0 && emptyText ? (
        <p className="border-t hairline px-5 py-4 text-[15px] font-medium leading-snug text-green-700">{emptyText}</p>
      ) : (
        <ul>
          {items.map((i) => {
            const heading = itemTitle(i, locale);
            return (
              <li key={i.fingerprint} className="flex items-baseline justify-between gap-3 border-t hairline px-5 py-3.5">
                <span className="min-w-0 break-words text-[15px] text-slate-900">
                  {heading.kicker && <span className="block text-[13px] font-semibold text-slate-500">{heading.kicker}</span>}
                  {heading.title}
                </span>
                <span className="shrink-0 text-[13px] text-slate-500">{BUREAU_LABEL[i.bureau]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
