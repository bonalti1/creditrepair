import { daysSince, STAFF_TIME_ZONE } from "./stage";
import { dateLocale, type StaffLocale } from "./i18n/locale";

// How the console writes dates, times and phone numbers, on the Texas clock,
// in the console's language. Left out, the language is Spanish (what these
// always wrote): the console passes the member's.

/** "12 nov" / "Nov 12" — compact, for lists and timelines. */
export function shortDay(iso: string, locale: StaffLocale = "es"): string {
  return new Date(iso)
    .toLocaleDateString(dateLocale(locale), { day: "numeric", month: "short", timeZone: STAFF_TIME_ZONE })
    .replace(".", "");
}

/** "12 de noviembre de 2026" / "November 12, 2026". */
export function longDay(iso: string, locale: StaffLocale = "es"): string {
  return new Date(iso).toLocaleDateString(dateLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: STAFF_TIME_ZONE,
  });
}

/** "hoy", "ayer", "hace 6 días"; a date in the future reads "en 3 días". In English: "today", "yesterday", "6 days ago", "in 3 days". */
export function relativeDay(iso: string, now: Date, locale: StaffLocale = "es"): string {
  const days = daysSince(iso, now);
  const ahead = Math.ceil((new Date(iso).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (locale === "en") {
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days > 1) return `${days} days ago`;
    return ahead <= 1 ? "tomorrow" : `in ${ahead} days`;
  }
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days > 1) return `hace ${days} días`;
  return ahead <= 1 ? "mañana" : `en ${ahead} días`;
}

/** "+17135550142" → "(713) 555-0142". Anything else is shown as stored. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : phone;
}

/** "1 carta", "3 cartas". */
export function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "20 nov, 2:05 p.m." / "Nov 20, 2:05 PM" — a moment, for conversations. */
export function shortDateTime(iso: string, locale: StaffLocale = "es"): string {
  const time = new Date(iso).toLocaleTimeString(dateLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: STAFF_TIME_ZONE,
  });
  return `${shortDay(iso, locale)}, ${time}`;
}

/** "840 bytes", "12 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "TX" → "Texas"; any other state is written as its code. */
export function stateName(code: string): string {
  return code === "TX" ? "Texas" : code;
}
