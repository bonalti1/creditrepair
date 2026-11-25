"use client";

import { formatCents } from "@/lib/accounting/money";
import type { NextInsight } from "@/lib/ads/report";
import { ADS_TEXT } from "@/lib/ads/text";
import { AD_RULES } from "@/lib/ads/verdict";
import { useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { useCtaLabel } from "./bits";

// «What to make next» (ALTO's): what the winners have in common, in counts a
// person can check, and the rules every verdict follows, written with the
// numbers the code uses.

export function NextPanel({ next, onDraft }: { next: NextInsight[]; onDraft: (() => void) | null }) {
  const t = useTx();
  const text = useText(ADS_TEXT);
  const cta = useCtaLabel();
  const line = (n: NextInsight): string => {
    switch (n.code) {
      case "too_few":
        return text.next.too_few(n.winners, n.need);
      case "format":
        return text.next.format(n.format, n.count, n.of, n.overall, n.overallOf);
      case "language":
        return text.next.language(n.language, n.count, n.of);
      case "cta":
        return text.next.cta(cta(n.cta), n.count, n.of);
      case "length":
        return text.next.length(n.words, n.others ?? 0);
      case "words":
        return text.next.words(n.words.map((w) => `“${w}”`).join(", "), n.of);
      case "goal":
        return text.next.goal(text.resultKind[n.kind], n.count, n.of);
    }
  };
  return (
    <section className="card flex flex-col px-5 py-4" aria-labelledby="next-title" data-testid="ads-next">
      <h2 id="next-title" className="flex items-center gap-2 font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
          <Icon name="sparkle" size={17} />
        </span>
        {t("Qué hacer después", "What to make next")}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">{t("Lo que tienen en común los ganadores de estas fechas. Solo cuentas: tú decides qué hacer con ellas.", "What the winners in these dates have in common. Counts only: you decide what to do with them.")}</p>
      <ul className="mt-3 space-y-2">
        {next.map((n) => (
          <li key={n.code} className="flex items-start gap-2.5 rounded-[10px] bg-slate-50 px-3 py-2.5 text-[14px] leading-snug text-slate-800">
            <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>{line(n)}</span>
          </li>
        ))}
      </ul>
      {onDraft && (
        <button type="button" onClick={onDraft} className={`${PRIMARY_BUTTON_COMPACT} mt-4 gap-1.5 self-start px-4`} data-testid="next-draft">
          <Icon name="sparkle" size={16} />
          {t("Escribir el siguiente con Alti", "Draft the next one with Alti")}
        </button>
      )}
    </section>
  );
}

export function RulesCard() {
  const text = useText(ADS_TEXT);
  const r = AD_RULES;
  const lines = [
    text.rules.noSpend,
    text.rules.noResult(formatCents(r.noResultCutCents)),
    text.rules.testDays(r.testDays),
    text.rules.signed(r.winSigned, formatCents(r.winSignedCostCents)),
    text.rules.expensive(formatCents(r.okCostCents), formatCents(r.judgeAfterCents)),
    text.rules.testResults(r.testResults),
    text.rules.winner(formatCents(r.goodCostCents)),
    text.rules.good(formatCents(r.okCostCents)),
  ];
  return (
    <section className="card px-5 py-4" aria-labelledby="rules-title" data-testid="ads-rules">
      <h2 id="rules-title" className="flex items-center gap-2 font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
          <Icon name="clipboard" size={17} />
        </span>
        {text.rules.title}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">{text.rules.intro}</p>
      <ol className="mt-3 space-y-1.5">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-slate-800">
            <span className="w-5 shrink-0 text-right font-mono text-[12px] leading-[1.6] text-slate-500">{i + 1}.</span>
            <span>{l}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 rounded-[10px] bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-600">{text.rules.basis}</p>
    </section>
  );
}
