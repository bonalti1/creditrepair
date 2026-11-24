import type { Locale } from "../i18n/dictionaries";
import { LOCALE_QUERY } from "../i18n/detect";

// The public website's pages, in one list: the header and footer menus, the
// sitemap, robots and every page's canonical and hreflang links read it.
//
// One URL per page, Spanish route names (the brand's own words: /precios,
// /preguntas), and one language system for both languages: the existing one
// (src/lib/i18n/detect.ts). `?lang=en` and `?lang=es` are each page's
// language-specific URLs (the proxy saves the choice in the cookie and the
// server renders that language on the first paint); the bare path is the
// x-default, which follows the visitor's saved choice or browser language.

export const SITE_PAGES = [
  { key: "home", path: "/" },
  { key: "pricing", path: "/precios" },
  { key: "how", path: "/como-funciona" },
  { key: "faq", path: "/preguntas" },
  { key: "partners", path: "/socios" },
  { key: "about", path: "/nosotros" },
  { key: "rights", path: "/derechos" },
  { key: "privacy", path: "/privacidad" },
  { key: "terms", path: "/terminos" },
] as const;

export type SitePageKey = (typeof SITE_PAGES)[number]["key"];

export const SITE_LOCALES: readonly Locale[] = ["en", "es"];

/** The path of a page. */
export function sitePath(key: SitePageKey): string {
  return SITE_PAGES.find((p) => p.key === key)!.path;
}

/**
 * The site's public origin, without a trailing slash: NEXT_PUBLIC_SITE_URL,
 * else the app's own URL (they are the same site today), else localhost for
 * development. The owner sets it before launch (docs/WEBSITE.md).
 */
export function siteUrl(env: Partial<Record<string, string | undefined>> = process.env): string {
  const raw = (env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").trim();
  return raw.replace(/\/+$/, "");
}

/** A page's URL in one language: "https://site/precios?lang=es". */
export function localizedUrl(path: string, locale: Locale, base: string = siteUrl()): string {
  return `${base}${path}?${LOCALE_QUERY}=${locale}`;
}

/** The hreflang set for a page: one URL per language and the bare path as x-default. */
export function hreflangAlternates(path: string, base: string = siteUrl()): Record<string, string> {
  return {
    en: localizedUrl(path, "en", base),
    es: localizedUrl(path, "es", base),
    "x-default": `${base}${path}`,
  };
}

/** The language switch's target: the same page in the other language. */
export function otherLanguageHref(path: string, current: Locale): string {
  const other: Locale = current === "es" ? "en" : "es";
  return `${path || "/"}?${LOCALE_QUERY}=${other}`;
}

/** Kept out of search engines (robots.ts): the signed-in app, the staff console, the partner portal, the API and one-time links. */
export const PRIVATE_PATHS = [
  "/api/",
  "/equipo",
  "/socios/portal",
  "/dashboard",
  "/asistente",
  "/audit",
  "/items",
  "/attack",
  "/rounds",
  "/goal",
  "/caso",
  "/aprende",
  "/acuerdo",
  "/pagos",
  "/mas",
  "/documentos",
  "/confirmar-direccion",
  "/onboarding",
  "/login",
  "/auth/",
  "/baja",
  "/r/",
];
