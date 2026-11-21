import { AGREEMENT_TIME_ZONE } from "./businessDays";

// How the agreement screens write dates: in the reader's language, always on
// the Texas clock, and saying so wherever an hour is shown.

type L = "es" | "en";
const tag = (locale: L) => (locale === "es" ? "es-MX" : "en-US");

/** "miércoles 25 de noviembre de 2026" / "Wednesday, November 25, 2026". */
export function longDate(iso: string | Date, locale: L): string {
  return new Date(iso).toLocaleDateString(tag(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: AGREEMENT_TIME_ZONE,
  });
}

/** "11:59 p.m." / "11:59 PM". */
export function clockTime(iso: string | Date, locale: L): string {
  return new Date(iso).toLocaleTimeString(tag(locale), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: AGREEMENT_TIME_ZONE,
  });
}

/** "miércoles 25 de noviembre de 2026 a las 11:59 p.m. (hora de Texas)". */
export function deadlineMoment(iso: string | Date, locale: L): string {
  return locale === "es"
    ? `${longDate(iso, locale)} a las ${clockTime(iso, locale)} (hora de Texas)`
    : `${longDate(iso, locale)} at ${clockTime(iso, locale)} (Texas time)`;
}

/** "21 de noviembre de 2026, 3:42 p.m. (hora de Texas)" — a moment on record. */
export function recordMoment(iso: string | Date, locale: L): string {
  const day = new Date(iso).toLocaleDateString(tag(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: AGREEMENT_TIME_ZONE,
  });
  return `${day}, ${clockTime(iso, locale)} ${locale === "es" ? "(hora de Texas)" : "(Texas time)"}`;
}
