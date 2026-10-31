"use client";

import Link from "next/link";
import { DEMO_REPORT, DEMO_SCORE_HISTORY } from "@/lib/demo";
import { useLocale } from "@/lib/i18n";
import type { ReportItem } from "@/lib/domain/types";

// The Credit Audit — Credit Repair Cloud's conversion weapon, handed directly
// to the consumer instead of to an agency closing a sale. Severity-ranked
// findings, per-bureau scores, and a cross-bureau matrix (an item appearing
// inconsistently across bureaus is the classic inaccuracy signal). Copy
// discipline: it shows WHERE TO LOOK and never says an item IS wrong.

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
  const items = DEMO_REPORT.items;
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
    <main>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{d.audit.title}</h1>
          <p className="mt-1 text-slate-600">{d.audit.subtitle(fmtDate)}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 print:hidden"
        >
          {d.audit.print}
        </button>
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <p className="font-semibold">{d.audit.scores}</p>
        <div className="mt-3 grid grid-cols-3 gap-4">
          {BUREAUS.map((b) => {
            const score = DEMO_REPORT.scores[b];
            const delta = score && first?.[b] ? score - first[b] : null;
            return (
              <div key={b} className="text-center">
                <p className="text-sm text-slate-500">{BUREAU_LABEL[b]}</p>
                <p className="text-3xl font-bold text-slate-900">{score ?? "—"}</p>
                {delta !== null && (
                  <p className={`text-xs font-semibold ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {d.scores.trend(delta)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">{d.audit.scoreNote}</p>
      </section>

      <AuditSection
        title={d.audit.severityHigh}
        note={d.audit.severityHighNote}
        items={high}
        tone="red"
        emptyText={d.audit.clean}
      />
      <AuditSection title={d.audit.severityMed} note={d.audit.severityMedNote} items={medium} tone="amber" />
      <AuditSection title={d.audit.severityInfo} note={d.audit.severityInfoNote} items={info} tone="blue" />

      {byName.size > 0 && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-semibold">{d.audit.matrix}</p>
          <p className="mt-1 text-sm text-slate-600">{d.audit.matrixNote}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-4 font-medium"> </th>
                  {BUREAUS.map((b) => (
                    <th key={b} className="px-3 py-2 text-center font-medium">
                      {BUREAU_LABEL[b]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...byName.entries()].map(([name, bureaus]) => (
                  <tr key={name} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-medium">{name}</td>
                    {BUREAUS.map((b) => (
                      <td key={b} className="px-3 py-2 text-center">
                        {bureaus.has(b) ? (
                          <span className="text-red-600">●</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="mt-8 rounded-xl border border-blue-200 bg-blue-50 p-5 text-center print:hidden">
        <Link
          href="/items"
          className="inline-block rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800"
        >
          {d.audit.cta}
        </Link>
        <p className="mt-2 text-xs text-blue-800">{d.audit.ctaNote}</p>
      </div>
    </main>
  );
}

function AuditSection({
  title,
  note,
  items,
  tone,
  emptyText,
}: {
  title: string;
  note: string;
  items: ReportItem[];
  tone: "red" | "amber" | "blue";
  emptyText?: string;
}) {
  if (items.length === 0 && !emptyText) return null;
  const toneBorder = { red: "border-red-200", amber: "border-amber-200", blue: "border-blue-200" }[tone];

  return (
    <section className={`mt-6 rounded-xl border ${toneBorder} bg-white p-5`}>
      <p className="font-semibold">
        {title} {items.length > 0 && <span className="text-slate-400">({items.length})</span>}
      </p>
      <p className="mt-1 text-sm text-slate-600">{note}</p>
      {items.length === 0 && emptyText ? (
        <p className="mt-3 text-sm font-medium text-green-700">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm text-slate-800">
          {items.map((i) => (
            <li key={i.fingerprint} className="flex items-baseline justify-between gap-3">
              <span>{i.name}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {BUREAU_LABEL[i.bureau]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
