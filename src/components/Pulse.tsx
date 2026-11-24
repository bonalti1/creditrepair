"use client";

import { useState } from "react";
import type { CaseFacts, CaseState } from "@/lib/case/timeline";
import { useLocale } from "@/lib/i18n";
import { duePulse, PULSE_COMMENT_MAX, PULSE_COPY, PULSE_RATINGS, type PulseMoment, type PulseRating } from "@/lib/pulse/pulse";
import { usePulseStore } from "@/lib/pulse/store";
import { afterPulseFace, REVIEW_COPY } from "@/lib/reviews/reviews";
import { useReviewLinks } from "@/lib/reviews/store";
import { ReviewSiteButtons, TalkToTeam } from "@/components/reviews/ReviewLinks";

// "¿Cómo vamos?": three faces after a key moment, asked once. One tap saves
// the answer; a comment can follow, and "Ahora no" closes it for good.
// The faces are drawn here (no emoji: they render differently on every phone)
// and each one has its words written under it.

export function Face({ rating, size = 34 }: { rating: PulseRating; size?: number }) {
  const mouth = rating === 1 ? "M8.5 16.5c1.8-1.6 5.2-1.6 7 0" : rating === 2 ? "M8.5 15.5h7" : "M8.5 14.5c1.8 2 5.2 2 7 0";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10v.5M15 10v.5" strokeWidth="2.2" />
      <path d={mouth} />
    </svg>
  );
}

/**
 * What follows a face. The review sites are the SAME after every face (no
 * review gating: src/lib/reviews/reviews.ts); a sad or neutral face is also
 * offered the line to the team, first, never instead of the sites.
 */
function AfterFace({ rating, moment, platforms }: { rating: PulseRating; moment: PulseMoment; platforms: Parameters<typeof ReviewSiteButtons>[0]["platforms"] }) {
  const { locale } = useLocale();
  const r = REVIEW_COPY[locale];
  const { reviewLinks: links, talkToTeam } = afterPulseFace(rating, moment, platforms.length > 0);
  if (!talkToTeam) {
    if (!links) return null;
    return (
      <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-4" data-testid="pulse-review">
        <p className="text-[15px] leading-snug text-slate-700">{r.pulseHappy}</p>
        <div className="mt-3">
          <ReviewSiteButtons platforms={platforms} />
        </div>
        <p className="mt-3 text-[13px] leading-snug text-slate-500">{r.noIncentive}</p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-4" data-testid="pulse-talk">
      <p className="text-[15px] leading-snug text-slate-700">{r.pulseUnhappy}</p>
      <div className="mt-3">
        <TalkToTeam prominent />
      </div>
      {links && (
        <div data-testid="pulse-review">
          <p className="mt-4 text-[15px] leading-snug text-slate-700">{r.pulseUnhappyLinks}</p>
          <div className="mt-3">
            <ReviewSiteButtons platforms={platforms} />
          </div>
          <p className="mt-3 text-[13px] leading-snug text-slate-500">{r.noIncentive}</p>
        </div>
      )}
    </div>
  );
}

export default function Pulse({ state, facts }: { state: CaseState; facts: CaseFacts }) {
  const { locale } = useLocale();
  const c = PULSE_COPY[locale];
  const store = usePulseStore();
  const reviews = useReviewLinks();
  // The moment on screen stays put after it is answered, so the thanks and the comment can show.
  const [active, setActive] = useState<PulseMoment | null>(null);
  const [picked, setPicked] = useState<PulseRating | null>(null);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!store.ready) return null;
  const moment = active ?? duePulse(facts, state, store.done);
  if (!moment) return null;

  const pick = async (rating: PulseRating) => {
    if (busy || picked) return;
    setBusy(true);
    setActive(moment);
    const ok = await store.answer(moment, rating, locale);
    setBusy(false);
    if (ok) setPicked(rating);
  };

  const sendComment = async () => {
    setBusy(true);
    await store.comment(moment, text);
    setBusy(false);
    setSent(true);
  };

  return (
    <section className="card px-5 py-5" data-testid="pulse" aria-labelledby="pulse-title">
      <h2 id="pulse-title" className="font-display text-[20px] font-bold leading-tight text-blue-700">
        {c.title}
      </h2>
      {sent ? (
        <p role="status" className="mt-2 text-[16px] leading-relaxed text-slate-700">
          {c.thanks}
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[16px] leading-snug text-slate-700">{c.question[moment]}</p>
          <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label={c.title}>
            {PULSE_RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => pick(rating)}
                disabled={busy || (picked !== null && picked !== rating)}
                aria-pressed={picked === rating}
                data-testid={`pulse-${rating}`}
                className={`pressable flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-3 text-[14px] font-semibold leading-tight ${
                  picked === rating ? "bg-amber-400 text-blue-900" : "bg-slate-100 text-slate-800 hover:bg-slate-200 disabled:opacity-50"
                }`}
              >
                <Face rating={rating} />
                {c.ratings[rating]}
              </button>
            ))}
          </div>
          {picked ? (
            <div className="mt-4">
              <p role="status" className="text-[15px] font-medium text-slate-900">
                {c.thanks}
              </p>
              <AfterFace rating={picked} moment={moment} platforms={reviews.platforms} />
              <label htmlFor="pulse-comment" className="mt-3 block text-[15px] text-slate-700">
                {c.commentLabel}
              </label>
              <textarea
                id="pulse-comment"
                value={text}
                maxLength={PULSE_COMMENT_MAX}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="mt-2 w-full rounded-2xl bg-slate-100 px-4 py-3 text-[16px] text-slate-900 outline-none focus:ring-2 focus:ring-blue-300"
              />
              <button
                type="button"
                onClick={sendComment}
                disabled={busy || !text.trim()}
                className="pressable mt-2 flex h-12 w-full items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
              >
                {c.send}
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[13px] text-slate-500">{c.once}</p>
              <button
                type="button"
                onClick={() => store.skip(moment)}
                className="pressable inline-flex h-11 items-center rounded-full px-3 text-[15px] font-medium text-blue-700"
              >
                {c.skip}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
