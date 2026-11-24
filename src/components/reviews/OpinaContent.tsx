"use client";

import Link from "next/link";
import Logo from "@/components/Logo";
import { useLocale } from "@/lib/i18n";
import { REVIEW_COPY } from "@/lib/reviews/reviews";
import { useReviewLinks } from "@/lib/reviews/store";
import { ReviewSiteButtons, TalkToTeam } from "./ReviewLinks";

// /opina: where the review request links to. No sign-in, no question first:
// the sites, then the line to the team, the same for every visitor.

export default function OpinaContent() {
  const { locale, setLocale } = useLocale();
  const c = REVIEW_COPY[locale];
  const { ready, platforms } = useReviewLinks();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-6">
      <div className="flex items-center justify-between">
        <Link href="/" aria-label="Credalti">
          <Logo />
        </Link>
        <button type="button" onClick={() => setLocale(locale === "es" ? "en" : "es")} className="pressable h-10 rounded-full px-3 text-[14px] font-medium text-blue-700">
          {locale === "es" ? "English" : "Español"}
        </button>
      </div>
      <section className="card mt-6 px-5 py-6" data-testid="opina">
        <h1 className="font-display text-[28px] font-bold leading-tight text-blue-700">{c.pageTitle}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-700">{c.pageIntro}</p>
        <div className="mt-5">{ready && <ReviewSiteButtons platforms={platforms} />}</div>
        <p className="mt-4 text-[13px] leading-snug text-slate-500">{c.noIncentive}</p>
      </section>
      <section className="card mt-4 px-5 py-5">
        <h2 className="text-[18px] font-semibold text-slate-900">{c.talkTitle}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{c.talkBody}</p>
        <div className="mt-4">
          <TalkToTeam />
        </div>
      </section>
    </main>
  );
}
