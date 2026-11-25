"use client";

import { useEffect, useState } from "react";
import type { AdsSelection } from "@/lib/ads/data";
import { isDayKey, MAX_CUSTOM_DAYS, WINDOW_PRESETS } from "@/lib/ads/window";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { pillTab, ROW_BUTTON } from "@/components/staff/ui";
import { FIELD, LABEL } from "@/components/staff/content/ui";

// The dates the Ads Manager looks at: 7, 14, 30 or 90 days, or two dates
// (the ad account's days). The custom range applies when both dates are real,
// in order and not in the future.

export default function WindowPicker({ value, onChange, today }: { value: AdsSelection; onChange: (next: AdsSelection) => void; today: string }) {
  const t = useTx();
  const [since, setSince] = useState(value.since ?? "");
  const [until, setUntil] = useState(value.until ?? today);
  const custom = value.preset === "custom";
  useEffect(() => {
    if (value.since) setSince(value.since);
    if (value.until) setUntil(value.until);
  }, [value.since, value.until]);
  const valid = isDayKey(since) && isDayKey(until) && since <= until && until <= today;
  return (
    <div data-testid="window-picker">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Fechas", "Dates")}>
        {WINDOW_PRESETS.map((days) => (
          <button key={days} type="button" className={pillTab(value.preset === days)} aria-pressed={value.preset === days} onClick={() => onChange({ preset: days })} data-testid={`window-${days}`}>
            {t(`${days} días`, `${days} days`)}
          </button>
        ))}
        <button type="button" className={pillTab(custom)} aria-pressed={custom} onClick={() => onChange({ preset: "custom", since: since || undefined, until: until || today })} data-testid="window-custom">
          {t("Otras fechas", "Custom")}
        </button>
      </div>
      {custom && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onChange({ preset: "custom", since, until });
          }}
        >
          <label className="min-w-0">
            <span className={LABEL}>{t("Desde", "From")}</span>
            <input type="date" className={`${FIELD} mt-1 h-11 w-[11rem]`} value={since} max={until || today} onChange={(e) => setSince(e.target.value)} required />
          </label>
          <label className="min-w-0">
            <span className={LABEL}>{t("Hasta", "To")}</span>
            <input type="date" className={`${FIELD} mt-1 h-11 w-[11rem]`} value={until} min={since || undefined} max={today} onChange={(e) => setUntil(e.target.value)} required />
          </label>
          <button type="submit" className={ROW_BUTTON} disabled={!valid}>
            {t("Ver estas fechas", "Show these dates")}
          </button>
          <p className="w-full text-[12.5px] text-slate-500">{t(`Hasta ${MAX_CUSTOM_DAYS} días, en la zona horaria de la cuenta de anuncios.`, `Up to ${MAX_CUSTOM_DAYS} days, in the ad account's time zone.`)}</p>
        </form>
      )}
    </div>
  );
}
