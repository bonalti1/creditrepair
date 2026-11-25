"use client";

import { formatCents } from "@/lib/accounting/money";
import { ADS_TEXT } from "@/lib/ads/text";
import type { Ad, ResultKind } from "@/lib/ads/types";
import type { Verdict, VerdictResult } from "@/lib/ads/verdict";
import { useStaffLocale, useText } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { Chip, WAITING_TONE } from "@/components/staff/ui";

// The Ads Manager's small pieces: verdict and delivery chips, the creative's
// thumbnail, whose number it is (Meta's or Credalti's), and the formatting.

export const VERDICT_TONE: Record<Verdict, string> = {
  winner: "bg-green-50 text-green-800",
  good: "bg-blue-50 text-blue-700",
  testing: WAITING_TONE,
  needs_data: "bg-slate-100 text-slate-600",
  turn_off: "bg-red-50 text-red-700",
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const t = useText(ADS_TEXT);
  return (
    <span data-testid="ad-verdict" data-verdict={verdict}>
      <Chip tone={VERDICT_TONE[verdict]}>{t.verdict[verdict]}</Chip>
    </span>
  );
}

/** Meta's delivery status in four words: on, paused, off, has issues. */
export function deliveryOf(status: string): "on" | "paused" | "off" | "issues" {
  if (status === "ACTIVE") return "on";
  if (/PAUSED/.test(status)) return "paused";
  if (/ARCHIVED|DELETED/.test(status)) return "off";
  return "issues";
}

export function DeliveryChip({ status }: { status: string }) {
  const t = useText(ADS_TEXT);
  const d = deliveryOf(status);
  const tone = d === "on" ? "bg-green-50 text-green-800" : d === "issues" ? WAITING_TONE : "bg-slate-100 text-slate-600";
  return <Chip tone={tone}>{t.delivery[d]}</Chip>;
}

/** Money, or "—" when there is nothing behind it (never "$0.00" for an unknown). */
export const money = (cents: number | null | undefined): string => (cents === null || cents === undefined ? "—" : formatCents(cents));

/** "$1,234" for big figures on a band (whole dollars), "$12.34" below $100. */
export const moneyShort = (cents: number | null | undefined): string => {
  if (cents === null || cents === undefined) return "—";
  if (Math.abs(cents) < 10_000) return formatCents(cents);
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
};

export function useNum() {
  const { locale } = useStaffLocale();
  return (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString(locale === "es" ? "es-US" : "en-US"));
}

/** "META" or "CREDALTI · VERIFIED": whose number it is, always beside it. */
export function SourceTag({ source, onNavy = false }: { source: "meta" | "credalti"; onNavy?: boolean }) {
  const t = useText(ADS_TEXT).source;
  const base = "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]";
  const label = source === "meta" ? t.meta : t.credalti;
  if (!onNavy) return <span className={`${base} ${source === "meta" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-blue-900"}`}>{label}</span>;
  // On the navy band only: gold text is allowed on navy.
  return <span className={`${base} ${source === "meta" ? "bg-white/10 text-blue-100" : "bg-amber-400/20 text-amber-300"}`} data-on-navy>{label}</span>;
}

/** The creative's picture: Meta's thumbnail (or the sample's), a play mark on videos; a navy tile when there is none. */
export function AdThumb({ ad, size = 56, className = "" }: { ad: Ad; size?: number; className?: string }) {
  const src = ad.creative.thumbnailUrl ?? ad.creative.imageUrl;
  return (
    <span className={`relative inline-flex shrink-0 overflow-hidden rounded-[10px] bg-blue-900 ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      {src ? (
        // Meta's CDN or the sample's own screenshots; no referrer goes to Meta.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-amber-300" data-on-navy>
          <Icon name="megaphone" size={Math.round(size * 0.42)} />
        </span>
      )}
      {ad.creative.videoId && (
        <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-900/80 text-white">
          <Icon name="play" size={12} strokeWidth={2} />
        </span>
      )}
    </span>
  );
}

/** The verdict's reason, in the member's language, with its numbers. */
export function useReason() {
  const t = useText(ADS_TEXT);
  return (v: VerdictResult): string => {
    const r = v.reason;
    switch (r.code) {
      case "no_spend":
        return t.reason.no_spend;
      case "no_result_spent":
        return t.reason.no_result_spent(formatCents(r.spentCents), formatCents(r.limitCents));
      case "testing_days":
        return t.reason.testing_days(r.day, r.of);
      case "too_expensive":
        return t.reason.too_expensive(formatCents(r.costCents), formatCents(r.limitCents));
      case "testing_results":
        return t.reason.testing_results(r.have, r.need);
      case "signed_winner":
        return t.reason.signed_winner(r.signed, formatCents(r.costCents), formatCents(r.limitCents));
      case "cheap":
        return t.reason.cheap(formatCents(r.costCents), formatCents(r.limitCents));
      case "ok":
        return t.reason.ok(formatCents(r.costCents), formatCents(r.limitCents));
      case "expensive":
        return t.reason.expensive(formatCents(r.costCents), formatCents(r.limitCents));
    }
  };
}

export function useResultLabel() {
  const t = useText(ADS_TEXT);
  return (kind: ResultKind) => t.resultKind[kind];
}

export function useCtaLabel() {
  const t = useText(ADS_TEXT);
  return (cta: string | null) => (cta ? ((t.cta as Record<string, string>)[cta] ?? cta.toLowerCase().replace(/_/g, " ")) : "—");
}
