import { cookies, headers } from "next/headers";
import type { Locale } from "./dictionaries";
import { LOCALE_COOKIE, PATH_HEADER, resolveLocale, type LocaleChoice } from "./detect";

// The language of a request, on the server, for the first render: the saved
// choice (cookie; the proxy writes it when a link carries ?lang=), then the
// browser's Accept-Language, then English. See detect.ts for the full order.
// Reading the request makes the page render per request, which is what lets a
// Spanish browser get Spanish in the first paint, with no flash of English.


export async function requestLocale(): Promise<LocaleChoice> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return resolveLocale({ cookie: c.get(LOCALE_COOKIE)?.value ?? null, acceptLanguage: h.get("accept-language") });
}

/**
 * The page's declared language (<html lang>). The staff console (/equipo) is
 * Spanish whatever the visitor's choice: it has no English text yet.
 */
export async function documentLang(): Promise<Locale> {
  const h = await headers();
  if ((h.get(PATH_HEADER) ?? "").startsWith("/equipo")) return "es";
  return (await requestLocale()).locale;
}

/** One of two texts, in the request's language (page metadata). */
export async function inRequestLocale<T>(text: { es: T; en: T }): Promise<T> {
  return text[(await requestLocale()).locale];
}
