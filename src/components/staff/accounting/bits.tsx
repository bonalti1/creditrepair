"use client";

import { formatCents } from "@/lib/accounting/money";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { Bilingual } from "@/lib/accounting/types";
import Definition from "@/components/staff/Definition";

// Small pieces the accounting screens share.

/** A control sized by its content (selects beside a title). */
export const CONTROL_INLINE =
  "h-11 min-w-0 max-w-full rounded-xl bg-white px-3 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300 md:h-10 md:text-[14px]";

/** A control that fills its column. */
export const CONTROL = `${CONTROL_INLINE} w-full`;

export function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A money figure, or "No data yet" when there is nothing behind it. */
export function Money({ cents, empty = false, signed = false, className = "" }: { cents: number | null; empty?: boolean; signed?: boolean; className?: string }) {
  const t = useTx();
  if (cents === null || empty) return <span className={`text-slate-400 ${className}`}>{t("Sin datos todavía", "No data yet")}</span>;
  const text = signed && cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
  return <span className={`tabular-nums ${cents < 0 ? "text-red-700" : ""} ${className}`}>{text}</span>;
}

export function Tile({ label, definition, children, note, testId }: { label: string; definition?: string; children: React.ReactNode; note?: React.ReactNode; testId?: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5 sm:px-5" data-testid={testId}>
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 text-[13px] leading-snug text-slate-500">{label}</p>
        {definition && <Definition label={label} text={definition} />}
      </div>
      <div className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-slate-900 tabular-nums sm:text-[24px]">{children}</div>
      {note && <div className="mt-1 text-[12.5px] leading-snug text-slate-500">{note}</div>}
    </div>
  );
}

export function TileGrid({ children, cols = "grid-cols-2 lg:grid-cols-4" }: { children: React.ReactNode; cols?: string }) {
  return <div className={`card grid overflow-hidden [&>*]:-mb-px [&>*]:-mr-px [&>*]:border-b [&>*]:border-r [&>*]:border-slate-900/[0.06] ${cols}`}>{children}</div>;
}

export function Note({ tone = "info", children, testId }: { tone?: "info" | "warn" | "ok" | "bad"; children: React.ReactNode; testId?: string }) {
  const cls = { info: "bg-blue-50 text-blue-900", warn: "bg-amber-100 text-blue-900", ok: "bg-green-50 text-green-800", bad: "bg-red-50 text-red-800" }[tone];
  return (
    <p role={tone === "bad" ? "alert" : undefined} className={`rounded-2xl px-4 py-2.5 text-[13.5px] leading-snug ${cls}`} data-testid={testId}>
      {children}
    </p>
  );
}

/** A message from a check or the server, in the console's language. */
export function useBi() {
  const { locale } = useStaffLocale();
  return (b: Bilingual | null | undefined) => (b ? b[locale] : "");
}

export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[12.5px] font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

/** A table that scrolls inside its card on a narrow screen, never the page. */
export function TableCard({ children, testId, minWidth = "min-w-[44rem]" }: { children: React.ReactNode; testId?: string; minWidth?: string }) {
  return (
    <div className="card overflow-x-auto" data-testid={testId}>
      <table className={`w-full ${minWidth} text-[13.5px]`}>{children}</table>
    </div>
  );
}

export const TH = "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 first:pl-5 last:pr-5";
export const TD = "px-3 py-2.5 align-top first:pl-5 last:pr-5";

export function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}
