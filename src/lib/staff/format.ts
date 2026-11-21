import { daysSince, STAFF_TIME_ZONE } from "./stage";

// How the console writes dates, times and phone numbers. Spanish, Texas clock.

/** "12 nov" — compact, for lists and timelines. */
export function shortDay(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: STAFF_TIME_ZONE })
    .replace(".", "");
}

/** "12 de noviembre de 2026". */
export function longDay(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: STAFF_TIME_ZONE,
  });
}

/** "hoy", "ayer", "hace 6 días"; a date in the future reads "en 3 días". */
export function relativeDay(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days > 1) return `hace ${days} días`;
  const ahead = Math.ceil((new Date(iso).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
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
