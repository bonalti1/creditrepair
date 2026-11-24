"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { useLocale } from "@/lib/i18n";

// What a real client sees where their report will be, while the team has not
// imported it yet. It says what is happening and what (nothing) they need to
// do, and promises no date and no outcome (compliance/guardrails.ts). The
// team is doing the work, so the team character stands beside it.

export const REPORT_PENDING_COPY = {
  es: {
    title: "Tu equipo está importando tu reporte",
    body: "En cuanto tu reporte de los 3 burós esté en tu cuenta, aquí vas a ver cada elemento para revisarlo. Por ahora no tienes que hacer nada más aquí.",
    cta: "Volver al inicio",
  },
  en: {
    title: "Your team is importing your report",
    body: "As soon as your 3-bureau report is in your account, you will see each item here to review it. For now there is nothing else to do here.",
    cta: "Back to Home",
  },
} as const;

export default function ReportPending({ compact = false, showLink = true }: { compact?: boolean; showLink?: boolean }) {
  const { locale } = useLocale();
  const c = REPORT_PENDING_COPY[locale === "en" ? "en" : "es"];
  return (
    <section className={`card ${compact ? "px-5 py-4" : "px-6 py-7 text-center"}`} data-testid="report-pending" role="status">
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 ${compact ? "h-12 w-12" : "mx-auto h-[72px] w-[72px]"}`}>
        <Icon name="clock" size={compact ? 22 : 32} />
      </span>
      <h2 className={`${compact ? "mt-3 text-[17px]" : "mt-4 text-[20px]"} font-semibold leading-snug text-slate-900`}>{c.title}</h2>
      <p className={`mt-2 text-[15px] leading-relaxed text-slate-500 ${compact ? "" : "mx-auto max-w-sm"}`}>{c.body}</p>
      {showLink && (
        <Link href="/dashboard" className="mt-4 inline-block text-[15px] font-medium text-blue-700">
          {c.cta}
        </Link>
      )}
    </section>
  );
}
