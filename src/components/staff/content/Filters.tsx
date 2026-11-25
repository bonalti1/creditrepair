"use client";

import { AUDIENCE_LABEL, CHANNEL_LABEL, LANGUAGE_LABEL } from "@/lib/content/labels";
import type { ContentFilters } from "@/lib/content/rules";
import { AUDIENCES, CHANNELS, LANGUAGES, type ContentPiece } from "@/lib/content/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { FIELD } from "./ui";

// Filters for the board and the calendar: channel, language, audience, owner
// and a word. Each is a labelled select (keyboard and screen readers).

export function Filters({ value, onChange, pieces }: { value: ContentFilters; onChange: (next: ContentFilters) => void; pieces: readonly ContentPiece[] }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const owners = [...new Set(pieces.map((p) => p.owner).filter((o): o is string => Boolean(o)))].sort();
  const set = (patch: Partial<ContentFilters>) => onChange({ ...value, ...patch });
  const active = Boolean(value.channel || value.language || value.audience || value.owner || value.q);
  const select = `${FIELD} h-11 pr-8`;
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]" role="search" aria-label={t("Filtrar piezas", "Filter pieces")}>
      <label className="col-span-2 sm:col-span-3 lg:col-span-1">
        <span className="sr-only">{t("Buscar", "Search")}</span>
        <input value={value.q ?? ""} onChange={(e) => set({ q: e.target.value })} placeholder={t("Buscar por título o gancho", "Search title or hook")} className={`${FIELD} h-11`} />
      </label>
      <label>
        <span className="sr-only">{t("Canal", "Channel")}</span>
        <select value={value.channel ?? ""} onChange={(e) => set({ channel: e.target.value as ContentFilters["channel"] })} className={select}>
          <option value="">{t("Todos los canales", "All channels")}</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[locale][c]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">{t("Idioma", "Language")}</span>
        <select value={value.language ?? ""} onChange={(e) => set({ language: e.target.value as ContentFilters["language"] })} className={select}>
          <option value="">{t("Todos los idiomas", "All languages")}</option>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_LABEL[locale][l]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">{t("Público", "Audience")}</span>
        <select value={value.audience ?? ""} onChange={(e) => set({ audience: e.target.value as ContentFilters["audience"] })} className={select}>
          <option value="">{t("Todo público", "All audiences")}</option>
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {AUDIENCE_LABEL[locale][a]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">{t("Responsable", "Owner")}</span>
        <select value={value.owner ?? ""} onChange={(e) => set({ owner: e.target.value })} className={select}>
          <option value="">{t("Cualquier responsable", "Any owner")}</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      {active ? (
        <button type="button" onClick={() => onChange({})} className="h-11 rounded-full px-3 text-[14px] font-medium text-blue-700 hover:bg-blue-50">
          {t("Quitar filtros", "Clear filters")}
        </button>
      ) : null}
    </div>
  );
}
