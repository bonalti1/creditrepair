"use client";

import Icon from "@/components/Icon";
import { CharacterFigure } from "@/components/Character";
import { MAIL_STOPS, mailProgress, type MailStop } from "@/lib/site/interactive";

// The letter-mailing animation in the home page's example: one of the two
// places the robot may appear, small, carrying the envelope (owner, 2026-11-24;
// docs/BRAND.md, "The cameo"). He never speaks: no speech balloon and no
// author label here, only the envelope's three stops (mailed, on the way,
// delivered) and a caption. The robot art moves as a whole picture
// (transforms only). With reduced motion the parent passes the last stop at
// once and nothing travels.

export interface MailCopy {
  caption: string;
  mailed: string;
  transit: string;
  delivered: string;
  label: string;
}

const TRAVELLER = 64; // px: the robot and the envelope, side by side

export default function MailCameo({ copy, stop }: { copy: MailCopy; stop: MailStop | null }) {
  const progress = mailProgress(stop);
  const reached = stop === null ? -1 : MAIL_STOPS.indexOf(stop);
  const delivered = stop === "delivered";
  return (
    <figure className="rounded-3xl bg-blue-900 px-4 pb-4 pt-3 text-white" aria-label={copy.label} data-testid="mail-cameo">
      <figcaption className="flex items-center justify-between gap-2 text-[12px] font-semibold text-blue-100">
        <span>{copy.caption}</span>
        {delivered && (
          <span data-on-navy className="delivered-in rounded-full bg-amber-400 px-2.5 py-0.5 text-[12px] font-semibold text-blue-900" data-testid="mail-delivered">
            {copy.delivered}
          </span>
        )}
      </figcaption>
      {/* The track: the traveller's box is as wide as the track, so translateX(%) follows it. */}
      <div className="relative mt-2 h-[64px]">
        <div aria-hidden className="absolute inset-x-[10px] bottom-[13px] border-t-2 border-dashed border-blue-400/60" />
        <div
          aria-hidden
          className="mail-traveller absolute inset-x-0 bottom-[18px]"
          style={{ transform: `translateX(calc(${progress} * (100% - ${TRAVELLER}px)))` }}
        >
          <div className="flex w-[64px] items-end gap-0.5">
            <CharacterFigure character="cameo" view="threeQuarter" height={40} decorative />
            <span className={`mb-1 flex h-6 w-6 items-center justify-center rounded-md bg-white text-blue-900 shadow ${stop && !delivered ? "char-idle" : ""}`}>
              <Icon name="mail" size={15} />
            </span>
          </div>
        </div>
        <ol className="absolute inset-x-0 bottom-0 flex justify-between">
          {MAIL_STOPS.map((s, i) => (
            <li key={s} className="flex w-0 flex-col items-center">
              <span
                className={`flex h-[26px] w-[26px] items-center justify-center rounded-full ring-2 ring-blue-900 ${
                  i <= reached ? "stop-pop bg-amber-400 text-blue-900" : "bg-blue-800 text-blue-300"
                }`}
              >
                {i <= reached ? <Icon name="check" size={13} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-semibold">
        {MAIL_STOPS.map((s, i) => (
          <span key={s} className={i <= reached ? "text-white" : "text-blue-300"}>
            {s === "delivered" ? copy.delivered.replace(/\s*✓$/, "") : copy[s]}
          </span>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {stop ? (stop === "delivered" ? copy.delivered : copy[stop]) : ""}
      </p>
    </figure>
  );
}
