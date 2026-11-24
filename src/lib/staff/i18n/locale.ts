// The staff console's language (docs/STAFF.md, "Language").
//
// English first, Spanish when the member wants it. Each member chooses on
// /equipo/perfil or from the menu under their initial; the choice is kept on
// their own preferences (migration 0025: staff_preferences.locale; in the
// demo, this browser). Until they choose: their browser's language if it is
// Spanish, otherwise English.
//
// This is the language the console speaks to the MEMBER. Anything the console
// writes to a CLIENT (a WhatsApp draft, an Alti draft, a saved answer, a
// reminder) is in the client's language instead: see clientLanguage below.

export const STAFF_LOCALES = ["en", "es"] as const;
export type StaffLocale = (typeof STAFF_LOCALES)[number];

export const DEFAULT_STAFF_LOCALE: StaffLocale = "en";

/** The name of each language, written in the language the console is showing. */
export const LANGUAGE_NAME: Record<StaffLocale, Record<StaffLocale, string>> = {
  en: { en: "English", es: "Spanish" },
  es: { en: "Inglés", es: "Español" },
};

/** Each language in its own words, for the switch: a Spanish speaker finds «Español» whatever is showing. */
export const LANGUAGE_SELF_NAME: Record<StaffLocale, string> = { en: "English", es: "Español" };

export function isStaffLocale(value: unknown): value is StaffLocale {
  return value === "en" || value === "es";
}

/** A stored value as a locale, or null when it is not one (nothing chosen yet). */
export function normalizeStaffLocale(value: unknown): StaffLocale | null {
  return isStaffLocale(value) ? value : null;
}

/**
 * The language a browser asks for: Spanish when its first language that is
 * English or Spanish is Spanish ("es", "es-MX", "es-419"…), else English.
 * Accepts navigator.languages or an Accept-Language header.
 */
export function localeFromBrowser(languages: readonly string[] | string | null | undefined): StaffLocale {
  const list =
    typeof languages === "string"
      ? languages
          .split(",")
          .map((part) => part.split(";")[0]!.trim())
          .filter(Boolean)
      : (languages ?? []);
  for (const tag of list) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return DEFAULT_STAFF_LOCALE;
}

let fallback: StaffLocale = DEFAULT_STAFF_LOCALE;

/**
 * The language a sentence builder uses when its caller names none: English.
 * The console always names the member's; the test files written against the
 * Spanish console set it to "es" (setStaffLocaleFallback) so they keep
 * checking the Spanish, word for word. Nothing in the app changes it.
 */
export function staffLocaleFallback(): StaffLocale {
  return fallback;
}

/** For tests only: the language used when a caller names none. */
export function setStaffLocaleFallback(locale: StaffLocale): void {
  fallback = locale;
}

/** The member's language: what they chose, else their browser's, else English. */
export function initialStaffLocale(saved: unknown, browser: readonly string[] | string | null | undefined): StaffLocale {
  return normalizeStaffLocale(saved) ?? localeFromBrowser(browser);
}

// ── The client's language ───────────────────────────────────────────────

/**
 * The language to write to a client in: theirs (profiles.locale), never the
 * staff member's. A client with no language on record is written to in
 * English, the product's first language (types.ts: StaffClient.locale);
 * fromRows.ts sets "es" for every client whose profile says Spanish.
 */
export function clientLanguage(client: { locale?: string | null } | null | undefined): StaffLocale {
  return client?.locale === "es" ? "es" : "en";
}

// ── Small shared words ──────────────────────────────────────────────────

/** "a, b y c" / "a, b and c". */
export function listJoin(parts: readonly string[], locale: StaffLocale, conjunction?: string): string {
  if (parts.length <= 1) return parts.join("");
  const and = conjunction ?? (locale === "es" ? "y" : "and");
  return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
}

/** "1 carta" / "3 cartas": the count with the right word. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The Intl locale the console's dates are written with. */
export function dateLocale(locale: StaffLocale): string {
  return locale === "es" ? "es-MX" : "en-US";
}
