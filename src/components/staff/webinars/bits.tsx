"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import type { WebinarPhase } from "@/lib/webinars/types";
import { Chip } from "@/components/staff/ui";

// Small shared pieces of the Webinars screens (the console's design system,
// docs/STAFF.md): a labelled field, a big-figure tile, the phase chip, money,
// and a copy button for the moderator's chat messages.

export const FIELD =
  "h-11 w-full min-w-0 rounded-[10px] border border-slate-300 bg-white px-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200";
export const AREA =
  "w-full min-w-0 rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-[15px] leading-snug text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200";

export function Labeled({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[13px] font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12.5px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

/** "$1,234" from cents; "—" when there is nothing behind it (never "$0.00" for an unknown). */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "−" : "";
  const v = Math.abs(cents) / 100;
  return `${sign}$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function Figure({ label, value, sub, testId, tone = "plain" }: { label: string; value: string | number | null; sub?: string; testId?: string; tone?: "plain" | "gold" }) {
  const t = useTx();
  return (
    <div className="min-w-0 rounded-[12px] bg-slate-50 px-3.5 py-3" data-testid={testId}>
      <p className="text-[11.5px] font-semibold uppercase leading-tight tracking-[0.06em] text-slate-500">{label}</p>
      {value === null ? (
        <p className="mt-1.5 text-[13px] font-semibold text-slate-500">{t("Todavía sin datos", "No data yet")}</p>
      ) : (
        <p className={`mt-0.5 font-display text-[26px] font-semibold leading-tight tabular-nums ${tone === "gold" ? "text-amber-700" : "text-blue-900"}`}>{value}</p>
      )}
      {sub && <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{sub}</p>}
    </div>
  );
}

const PHASE_TONE: Record<WebinarPhase, string> = {
  draft: "bg-slate-100 text-slate-700",
  upcoming: "bg-blue-50 text-blue-900",
  live: "bg-red-50 text-red-700",
  ended: "bg-emerald-50 text-emerald-800",
  cancelled: "bg-slate-100 text-slate-500",
};

export function PhaseChip({ phase, label }: { phase: WebinarPhase; label: string }) {
  return <Chip tone={PHASE_TONE[phase]}>{label}</Chip>;
}

/** Copies a chat message; says "Copied" for a moment (and keeps working where the clipboard is blocked: the text is selectable). */
export function CopyButton({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const t = useTx();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
      className="pressable inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border border-slate-300 bg-white px-3 text-[13.5px] font-semibold text-blue-900 hover:border-amber-500 md:h-9"
      aria-label={`${label}: ${t("copiar", "copy")}`}
      data-testid={testId}
    >
      <Icon name={done ? "check" : "clipboard"} size={15} />
      {done ? t("Copiado", "Copied") : t("Copiar", "Copy")}
    </button>
  );
}
