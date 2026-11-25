import type { SearchRow, SearchTotals } from "./types";

// Search Console's numbers, read-only (docs/SEO.md): clicks, impressions,
// click-through rate and average position, per page and per query, for the
// dates chosen. Pure, for the screen, the demo and the route. The numbers come
// only from Google (src/lib/seo/searchConsole.ts); the demo's are labelled
// sample and appear only in the demo.

export type RangeKey = "7" | "28" | "90" | "custom";

export const MAX_RANGE_DAYS = 480;

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Google's numbers arrive about two days late, so a range ends two days ago. */
export function defaultRange(now: Date, days = 28): { from: string; to: string } {
  const to = new Date(now.getTime() - 2 * DAY);
  const from = new Date(to.getTime() - (days - 1) * DAY);
  return { from: iso(from), to: iso(to) };
}

export function validRange(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || (b - a) / DAY > MAX_RANGE_DAYS) return null;
  return { from, to };
}

export function inRange(rows: readonly SearchRow[], range: { from: string; to: string }): SearchRow[] {
  return rows.filter((r) => r.day >= range.from && r.day <= range.to);
}

/** Totals by page or by query: clicks and impressions added, position weighted by impressions. Most clicks first. */
export function totalsBy(rows: readonly SearchRow[], by: "page" | "query"): SearchTotals[] {
  const map = new Map<string, { clicks: number; impressions: number; weighted: number }>();
  for (const r of rows) {
    const key = by === "page" ? r.page : r.query;
    const t = map.get(key) ?? { clicks: 0, impressions: 0, weighted: 0 };
    t.clicks += r.clicks;
    t.impressions += r.impressions;
    t.weighted += r.position * r.impressions;
    map.set(key, t);
  }
  return [...map.entries()]
    .map(([key, t]) => ({ key, clicks: t.clicks, impressions: t.impressions, ctr: t.impressions ? t.clicks / t.impressions : null, position: t.impressions ? t.weighted / t.impressions : null }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.key.localeCompare(b.key));
}

export function grandTotal(rows: readonly SearchRow[]): SearchTotals {
  const all = totalsBy(rows.map((r) => ({ ...r, page: "all" })), "page")[0];
  return all ?? { key: "all", clicks: 0, impressions: 0, ctr: null, position: null };
}

/** "https://credalti.com/precios?lang=es" → "/precios?lang=es", for a narrow table. */
export function shortPage(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** The demo's sample numbers: 90 days on a few pages and Texas queries, from a fixed seed. Labelled sample on screen. */
export function demoSearchRows(now: Date, base = "https://credalti.example"): SearchRow[] {
  const pages = [
    { path: "/?lang=en", queries: ["credalti", "credit repair houston", "credit services texas"] },
    { path: "/?lang=es", queries: ["reparación de crédito en houston", "credalti"] },
    { path: "/precios?lang=en", queries: ["credit repair cost", "how much is credit repair texas"] },
    { path: "/como-funciona?lang=en", queries: ["how credit repair works", "credit dispute letters texas"] },
    { path: "/preguntas?lang=es", queries: ["cómo leer mi reporte de crédito", "cuánto tiempo dura una cobranza en el reporte"] },
    { path: "/preguntas?lang=en", queries: ["how long do collections stay on credit report", "credit repair san antonio"] },
  ];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const rows: SearchRow[] = [];
  const end = new Date(now.getTime() - 2 * DAY);
  for (let d = 89; d >= 0; d -= 1) {
    const day = iso(new Date(end.getTime() - d * DAY));
    pages.forEach((p, pi) => {
      p.queries.forEach((query, qi) => {
        const base_ = 3 + pi * 2 + qi * 3;
        const impressions = Math.max(0, Math.round(base_ * (0.6 + rand()) * (1 + (89 - d) / 120)));
        const position = Math.max(1, (query === "credalti" ? 1.4 : 6 + pi * 2.5 + qi * 3) + (rand() - 0.5) * 3);
        const clicks = Math.round(impressions * (position < 3 ? 0.35 : position < 10 ? 0.06 : 0.01) * (0.5 + rand()));
        if (impressions > 0) rows.push({ day, page: `${base}${p.path}`, query, clicks: Math.min(clicks, impressions), impressions, position: Math.round(position * 10) / 10 });
      });
    });
  }
  return rows;
}
