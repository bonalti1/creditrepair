"use client";

import Link from "next/link";
import {
  BOTH_OPTIONS_NOTE,
  COMPARISON,
  COMPARISON_LABEL,
  COMPARISON_ROWS,
  OPTION_FOR,
  OPTION_NAME,
  OPTION_SUBTITLE,
  PRICE_SET_BY_TEAM,
  SERVICE_OPTIONS,
  START_WITH_DIY,
  WHO_ITS_FOR,
  type ServiceOption,
} from "@/lib/service/options";

// The two options side by side (docs/SERVICE-OPTIONS.md): the same rows for
// both, Credalti Complete first, Credalti DIY second, "Who it's for" on each,
// the price from each option's offered plan (or "Price set by the team"), the
// monitoring subscription beside it, and "Start with DIY, upgrade anytime".
// Nothing is pre-selected, nothing is "recommended", no urgency.

export interface ComparisonPrice {
  headline: string;
  lines: string[];
}

export default function OptionComparison({
  locale,
  prices,
  monitoring,
  chosen = null,
  onChoose,
  startHref,
  busy = false,
  headingLevel = 2,
}: {
  locale: "en" | "es";
  prices: Record<ServiceOption, ComparisonPrice | null>;
  /** The monitoring note shown under the prices (site/plans.ts monitoringNote). */
  monitoring: string;
  /** The option already chosen, if any: marked, never pre-selected for someone who has not chosen. */
  chosen?: ServiceOption | null;
  /** Choose in place (the chat, More → My option). */
  onChoose?: (option: ServiceOption) => void;
  /** Or a link per option (the website): where "Start with …" goes. */
  startHref?: Record<ServiceOption, string>;
  busy?: boolean;
  headingLevel?: 2 | 3;
}) {
  const es = locale === "es";
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div data-testid="option-comparison" className="space-y-4">
      <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{es ? "Las dos opciones, lado a lado" : "The two options, side by side"}</caption>
          <thead>
            <tr className="align-top">
              <th scope="col" className="hidden p-4 sm:table-cell sm:w-[24%]">
                <span className="sr-only">{es ? "Qué comparamos" : "What we compare"}</span>
              </th>
              {SERVICE_OPTIONS.map((option) => (
                <th
                  key={option}
                  scope="col"
                  data-testid={`option-${option}`}
                  className={`p-3 sm:p-5 ${chosen === option ? "bg-amber-50" : ""} ${option === "diy" ? "border-l border-slate-200" : ""}`}
                >
                  <H className="font-display text-[17px] font-bold leading-tight text-blue-900 sm:text-[22px]">{OPTION_NAME[option][locale]}</H>
                  <p className="mt-0.5 text-[13px] font-medium leading-snug text-slate-600 sm:text-[15px]">{OPTION_SUBTITLE[option][locale]}</p>
                  {chosen === option && (
                    <p className="mt-1.5 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-[12px] font-semibold text-blue-900">{es ? "Tu elección" : "Your choice"}</p>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-[13px] leading-snug text-slate-700 sm:text-[15px]">
            <Row label={WHO_ITS_FOR[locale]} cells={SERVICE_OPTIONS.map((o) => OPTION_FOR[o][locale])} chosen={chosen} />
            {COMPARISON_ROWS.map((row) =>
              row === "price" ? (
                <tr key={row} className="border-t border-slate-100 align-top">
                  <th scope="row" className="hidden p-4 font-medium text-slate-500 sm:table-cell sm:p-5">
                    {COMPARISON_LABEL.price[locale]}
                  </th>
                  {SERVICE_OPTIONS.map((option) => {
                    const price = prices[option];
                    return (
                      <td key={option} data-testid={`price-${option}`} className={`p-3 sm:p-5 ${chosen === option ? "bg-amber-50" : ""} ${option === "diy" ? "border-l border-slate-200" : ""}`}>
                        <span className="mb-1 block text-[12px] font-medium text-slate-500 sm:hidden">{COMPARISON_LABEL.price[locale]}</span>
                        <span className="block font-semibold tabular-nums text-blue-900">{price ? price.headline : PRICE_SET_BY_TEAM[locale]}</span>
                        {price?.lines.map((line) => (
                          <span key={line} className="mt-1 block text-slate-600">
                            {line}
                          </span>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ) : (
                <Row key={row} label={COMPARISON_LABEL[row][locale]} cells={SERVICE_OPTIONS.map((o) => COMPARISON[o][row][locale])} chosen={chosen} />
              ),
            )}
          </tbody>
          {(onChoose || startHref) && (
            <tfoot>
              <tr className="border-t border-slate-100 align-top">
                <td className="hidden sm:table-cell" />
                {SERVICE_OPTIONS.map((option) => {
                  const label = es ? `Elegir ${OPTION_NAME[option].es}` : `Choose ${OPTION_NAME[option].en}`;
                  return (
                    <td key={option} className={`p-3 sm:p-5 ${option === "diy" ? "border-l border-slate-200" : ""}`}>
                      {onChoose ? (
                        <button
                          type="button"
                          disabled={busy}
                          aria-pressed={chosen === option}
                          onClick={() => onChoose(option)}
                          className="pressable flex min-h-12 w-full items-center justify-center rounded-full bg-blue-900 px-3 py-2 text-center text-[14px] font-semibold leading-tight text-white hover:bg-blue-800 disabled:opacity-60 sm:text-[16px]"
                        >
                          {label}
                        </button>
                      ) : (
                        <Link
                          href={startHref![option]}
                          className="pressable flex min-h-12 w-full items-center justify-center rounded-full bg-blue-900 px-3 py-2 text-center text-[14px] font-semibold leading-tight text-white hover:bg-blue-800 sm:text-[16px]"
                        >
                          {es ? `Empezar con ${OPTION_NAME[option].es}` : `Start with ${OPTION_NAME[option].en}`}
                        </Link>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="rounded-2xl bg-amber-50 px-4 py-3 text-[15px] font-medium leading-relaxed text-blue-900">{START_WITH_DIY[locale]}</p>
      <p className="px-1 text-[14px] leading-relaxed text-slate-600">{monitoring}</p>
      <p className="px-1 text-[14px] leading-relaxed text-slate-600">{BOTH_OPTIONS_NOTE[locale]}</p>
    </div>
  );
}

function Row({ label, cells, chosen }: { label: string; cells: string[]; chosen: ServiceOption | null }) {
  return (
    <tr className="border-t border-slate-100 align-top">
      <th scope="row" className="hidden p-4 font-medium text-slate-500 sm:table-cell sm:p-5">
        {label}
      </th>
      {SERVICE_OPTIONS.map((option, i) => (
        <td key={option} className={`p-3 sm:p-5 ${chosen === option ? "bg-amber-50" : ""} ${option === "diy" ? "border-l border-slate-200" : ""}`}>
          {/* On a phone the row's label sits above each cell. */}
          <span className="mb-1 block text-[12px] font-medium text-slate-500 sm:hidden">{label}</span>
          {cells[i]}
        </td>
      ))}
    </tr>
  );
}
