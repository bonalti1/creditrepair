import type { Locale } from "./dictionaries";

// Which language a visitor or client sees. English first, Spanish if needed.
// Pure functions, shared by the proxy, server components and the browser, so
// the first render on the server and the store in the browser agree.
//
// Order of precedence (first match wins):
//   1. The link says so: `?lang=es` or `?lang=en` (an invitation from a
//      salesperson who talked with the client in that language).
//   2. A choice saved on this device: the `credalti.locale` cookie (set by the
//      language button, by an invitation link, and mirrored in localStorage).
//   3. A choice saved on the client's profile (profiles.locale), once signed in
//      on a device with no choice of its own (LocaleProvider, real mode).
//   4. The browser's preferred language: Spanish when the visitor's first
//      language among Spanish and English is Spanish (Accept-Language on the
//      server, navigator.languages in the browser).
//   5. English.

export const DEFAULT_LOCALE: Locale = "en";

/** The cookie that keeps the visitor's choice. Readable by the server for the first render. */
export const LOCALE_COOKIE = "credalti.locale";

/** The same choice in localStorage (the key the app has always used). */
export const LOCALE_STORAGE_KEY = "bonalti.locale";

/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Set by the proxy on the request: the path, so the root layout can tell the staff console apart. */
export const PATH_HEADER = "x-credalti-path";

/** The query parameter an invitation link carries. */
export const LOCALE_QUERY = "lang";

/** Where the choice came from (see the order above). */
export type LocaleSource = "link" | "saved" | "profile" | "browser" | "default";

export interface LocaleChoice {
  locale: Locale;
  source: LocaleSource;
}

/** "es", "ES", "es-MX" and "es_US" are Spanish; "en…" is English; anything else is nothing. */
export function parseLocale(value: string | null | undefined): Locale | null {
  const v = (value ?? "").trim().toLowerCase();
  if (/^es(?:[-_][a-z0-9]+)*$/.test(v)) return "es";
  if (/^en(?:[-_][a-z0-9]+)*$/.test(v)) return "en";
  return null;
}

/**
 * The visitor's first language among Spanish and English, from the
 * browser's ordered list. "es-MX,es;q=0.9,en;q=0.8" is Spanish;
 * "en-US,en;q=0.9,es;q=0.8" is English; "fr-FR" is nothing (English applies).
 */
export function preferredFromLanguages(languages: readonly string[]): Locale | null {
  for (const tag of languages) {
    const locale = parseLocale(tag);
    if (locale) return locale;
  }
  return null;
}

/** The same, from an Accept-Language header, honouring the q weights. */
export function preferredFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((r) => r.tag && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return preferredFromLanguages(ranked.map((r) => r.tag));
}

/** The language for a request, from what the server can see (order 1, 2, 4, 5 above). */
export function resolveLocale(input: { query?: string | null; cookie?: string | null; acceptLanguage?: string | null }): LocaleChoice {
  const fromLink = parseLocale(input.query);
  if (fromLink) return { locale: fromLink, source: "link" };
  const saved = parseLocale(input.cookie);
  if (saved) return { locale: saved, source: "saved" };
  const browser = preferredFromAcceptLanguage(input.acceptLanguage);
  if (browser) return { locale: browser, source: "browser" };
  return { locale: DEFAULT_LOCALE, source: "default" };
}

/**
 * The same order in the browser, once the page is open: what the link says,
 * then the saved choice (cookie, or localStorage from before the cookie
 * existed), then the browser's languages. The server's guess is kept when the
 * browser adds nothing, so the first paint does not change.
 */
export function resolveClientLocale(input: {
  link: string | null;
  cookie: string | null;
  stored: string | null;
  languages: readonly string[];
  server?: LocaleChoice | null;
}): LocaleChoice {
  const fromLink = parseLocale(input.link);
  if (fromLink) return { locale: fromLink, source: "link" };
  const saved = parseLocale(input.cookie) ?? parseLocale(input.stored);
  if (saved) return { locale: saved, source: "saved" };
  if (input.server?.source === "browser") return input.server;
  const browser = preferredFromLanguages(input.languages);
  if (browser) return { locale: browser, source: "browser" };
  return { locale: DEFAULT_LOCALE, source: "default" };
}

/**
 * Signed in: the profile's language (profiles.locale) against the device's.
 * A choice made on this device (or in the link) wins and is written to the
 * profile, so automatic messages follow it. With no choice on this device,
 * the profile's language is used (the client chose it on another device).
 */
export function reconcileWithProfile(device: LocaleChoice, profile: string | null | undefined): { choice: LocaleChoice; writeProfile: Locale | null } {
  const fromProfile = parseLocale(profile);
  if (device.source === "link" || device.source === "saved") {
    return { choice: device, writeProfile: fromProfile === device.locale ? null : device.locale };
  }
  if (fromProfile) return { choice: { locale: fromProfile, source: "profile" }, writeProfile: null };
  return { choice: device, writeProfile: device.locale };
}

/** The cookie line for a choice (document.cookie in the browser). */
export function localeCookieString(locale: Locale, secure: boolean): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The same cookie for NextResponse.cookies.set (the proxy). */
export function localeCookie(locale: Locale, secure: boolean) {
  return { name: LOCALE_COOKIE, value: locale, path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax" as const, secure };
}
