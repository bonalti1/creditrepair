"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { CharacterAvatar } from "@/components/Character";

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
      <CharacterAvatar character="team" size={compact ? 48 : 72} className={compact ? "" : "mx-auto"} />
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
