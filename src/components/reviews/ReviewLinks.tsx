"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { PLATFORM_LONG_NAME, REVIEW_COPY, type ReviewPlatform } from "@/lib/reviews/reviews";
import { humanHelpHref } from "@/lib/ux/humanHelp";

// The review sites, every one that is set up, in the same order and the same
// size for everyone, and the line to the team. Used by the public page
// (/opina) and by the pulse after any face: the links never depend on how the
// client feels (src/lib/reviews/reviews.ts, no gating).

export function ReviewSiteButtons({ platforms }: { platforms: readonly ReviewPlatform[] }) {
  const { locale } = useLocale();
  const c = REVIEW_COPY[locale];
  if (platforms.length === 0) return <p className="text-[15px] text-slate-500">{c.none}</p>;
  return (
    <div className="grid gap-2" data-testid="review-sites">
      {platforms.map((p) => (
        <a
          key={p.key}
          href={p.url!}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`review-site-${p.key}`}
          className="pressable flex h-12 items-center justify-center rounded-full bg-slate-100 px-4 text-[15px] font-semibold text-blue-700 hover:bg-slate-200"
        >
          {c.leave(PLATFORM_LONG_NAME[p.key][locale])}
        </a>
      ))}
    </div>
  );
}

/** "Talk to the team": WhatsApp with a person when configured, else the in-app assistant hands over. */
export function TalkToTeam({ prominent = false }: { prominent?: boolean }) {
  const { locale } = useLocale();
  const c = REVIEW_COPY[locale];
  const href = humanHelpHref(locale);
  const cls = `pressable flex h-12 items-center justify-center rounded-full px-4 text-[15px] font-semibold ${prominent ? "bg-amber-400 text-blue-900 hover:bg-amber-500" : "bg-slate-100 text-blue-700 hover:bg-slate-200"}`;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls} data-testid="talk-to-team">
      {c.talkCta}
    </a>
  ) : (
    <Link href="/asistente" className={cls} data-testid="talk-to-team">
      {c.talkCta}
    </Link>
  );
}
