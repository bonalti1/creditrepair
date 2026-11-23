import type { NormalizedReport } from "@/lib/domain/types";
import { AUDIT_GROUP_LABEL, auditView, BUREAU_LABEL } from "@/lib/reports/auditView";
import { itemFacts, itemTitle } from "@/lib/ux/itemDisplay";

// One report, printed as an audit: bureau by bureau, the items that read as
// negative first, each with what the report says. Shared by the staff Reports
// tab's page and the client's "My reports" page; the browser's "Print / Save
// as PDF" turns it into the PDF. No scores, and no word on what is accurate:
// only the client says that.

export default function ReportAudit({
  report,
  locale,
  reappeared,
}: {
  report: NormalizedReport;
  locale: "es" | "en";
  /** Items that came back after a round saw them gone: marked for review. */
  reappeared?: ReadonlySet<string>;
}) {
  const view = auditView(report);
  const es = locale === "es";
  return (
    <div className="space-y-5 print:space-y-4" data-testid="report-audit">
      <p className="text-[15px] leading-snug text-slate-600">
        {es
          ? `${view.total} ${view.total === 1 ? "punto" : "puntos"} en ${view.bureaus.length} ${view.bureaus.length === 1 ? "buró" : "burós"}. ${view.negative} ${view.negative === 1 ? "se ve negativo" : "se ven negativos"} (una lectura automática: no decide qué es inexacto).`
          : `${view.total} ${view.total === 1 ? "item" : "items"} across ${view.bureaus.length} ${view.bureaus.length === 1 ? "bureau" : "bureaus"}. ${view.negative} ${view.negative === 1 ? "looks" : "look"} negative (an automatic reading: it doesn't decide what's inaccurate).`}
      </p>
      {view.bureaus.map((b) => (
        <section key={b.bureau} className="card overflow-hidden print:break-inside-avoid-page print:rounded-none print:shadow-none" aria-label={BUREAU_LABEL[b.bureau]}>
          <div className="flex items-baseline justify-between gap-3 border-b hairline px-5 py-3">
            <h2 className="text-[17px] font-semibold text-slate-900">{BUREAU_LABEL[b.bureau]}</h2>
            <p className="text-[13px] tabular-nums text-slate-500">
              {es ? `${b.total} ${b.total === 1 ? "punto" : "puntos"}` : `${b.total} ${b.total === 1 ? "item" : "items"}`}
            </p>
          </div>
          {b.groups.map((group) => (
            <div key={group.key} className="px-5 py-3">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{AUDIT_GROUP_LABEL[locale][group.key]}</p>
              <ul className="mt-1 divide-y divide-slate-100">
                {group.items.map((item) => {
                  const { kicker, title } = itemTitle(item, locale);
                  const facts = itemFacts(item, locale).slice(0, 4);
                  return (
                    <li key={item.fingerprint} className="py-2 print:break-inside-avoid">
                      <p className="break-words text-[14px] font-medium leading-snug text-slate-900">
                        {kicker ? <span className="text-slate-500">{kicker} · </span> : null}
                        {title}
                        {reappeared?.has(item.fingerprint) && (
                          <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-blue-900">
                            {es ? "Volvió a aparecer" : "Reappeared"}
                          </span>
                        )}
                      </p>
                      {facts.length > 0 && (
                        <p className="mt-0.5 break-words text-[13px] leading-snug text-slate-500">{facts.map((f) => `${f.label}: ${f.value}`).join(" · ")}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
