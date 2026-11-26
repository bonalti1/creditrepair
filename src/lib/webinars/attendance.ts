import { parseCsv } from "../accounting/csv";
import { normalizeEmail, normalizePhone } from "../staff/team";
import type { Registration } from "./types";

// Who attended (docs/WEBINARS.md, «Attendance»): Zoom's attendee report as a
// CSV (Zoom → Reports → Usage → the webinar → Attendee report, or a meeting's
// Participants export), read in the browser, matched to the registrants by
// email first and phone second, and shown as a preview before anything is
// saved. Or a teammate marks a registrant by hand. Facebook, YouTube,
// Instagram and TikTok give no list of viewers, so those count only as the
// keyword messages and leads they bring (live.ts).
//
// Zoom's files start with a summary block (topic, ID, totals) before the
// table, and list a person once per join, so the header row is found by its
// columns and the minutes of each person's rows are added up.

const ALIASES = {
  email: ["email", "user email", "attendee email", "correo", "correo electrónico", "email address"],
  phone: ["phone", "phone number", "teléfono", "telefono"],
  minutes: ["time in session (minutes)", "duration (minutes)", "duration", "minutes", "time in session", "duración (minutos)"],
  attended: ["attended", "asistió"],
  name: ["user name (original name)", "name (original name)", "name", "user name", "first name", "nombre"],
} as const;

type Field = keyof typeof ALIASES;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The header row (the first one with an email or phone column) and where each column is. */
export function findAttendeeHeader(rows: readonly (readonly string[])[]): { index: number; columns: Partial<Record<Field, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cells = rows[i]!.map(norm);
    const columns: Partial<Record<Field, number>> = {};
    for (const field of Object.keys(ALIASES) as Field[]) {
      const at = cells.findIndex((c) => (ALIASES[field] as readonly string[]).includes(c));
      if (at >= 0) columns[field] = at;
    }
    if (columns.email !== undefined || columns.phone !== undefined) return { index: i, columns };
  }
  return null;
}

export interface Attendee {
  email: string | null;
  phone: string | null;
  name: string | null;
  minutes: number;
}

/** One entry per person who attended (a "No" in Attended is left out), minutes added up across their joins. */
export function readAttendees(csv: string): { ok: true; attendees: Attendee[] } | { ok: false; reason: "no_header" | "empty" } {
  const rows = parseCsv(csv);
  const header = findAttendeeHeader(rows);
  if (!header) return { ok: false, reason: "no_header" };
  const { columns } = header;
  const people = new Map<string, Attendee>();
  for (const row of rows.slice(header.index + 1)) {
    const cell = (f: Field) => (columns[f] === undefined ? "" : (row[columns[f]!] ?? "").trim());
    if (columns.attended !== undefined && /^(no|false|0)$/i.test(cell("attended"))) continue;
    const email = normalizeEmail(cell("email"));
    const phone = normalizePhone(cell("phone"));
    if (!email && !phone) continue;
    const minutes = Number.parseFloat(cell("minutes").replace(",", "."));
    const key = email ?? phone!;
    const prior = people.get(key);
    const add = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
    if (prior) prior.minutes += add;
    else people.set(key, { email, phone, name: cell("name").slice(0, 80) || null, minutes: add });
  }
  const attendees = [...people.values()].map((a) => ({ ...a, minutes: Math.round(a.minutes) }));
  return attendees.length > 0 ? { ok: true, attendees } : { ok: false, reason: "empty" };
}

export interface AttendanceMatch {
  registrationId: string;
  minutes: number;
  by: "email" | "phone";
}

export interface AttendancePlan {
  matches: AttendanceMatch[];
  /** People in the file who did not register (or registered with another email and phone). */
  unmatched: Attendee[];
}

/** The file matched to the registrants: email first, phone second; each registrant once. */
export function matchAttendance(attendees: readonly Attendee[], registrations: readonly Pick<Registration, "id" | "email" | "phone">[]): AttendancePlan {
  const byEmail = new Map(registrations.filter((r) => r.email).map((r) => [r.email!.toLowerCase(), r]));
  const byPhone = new Map(registrations.map((r) => [r.phone, r]));
  const seen = new Map<string, AttendanceMatch>();
  const unmatched: Attendee[] = [];
  for (const a of attendees) {
    const viaEmail = a.email ? byEmail.get(a.email) : undefined;
    const viaPhone = !viaEmail && a.phone ? byPhone.get(a.phone) : undefined;
    const reg = viaEmail ?? viaPhone;
    if (!reg) {
      unmatched.push(a);
      continue;
    }
    const prior = seen.get(reg.id);
    if (prior) prior.minutes += a.minutes;
    else seen.set(reg.id, { registrationId: reg.id, minutes: a.minutes, by: viaEmail ? "email" : "phone" });
  }
  return { matches: [...seen.values()], unmatched };
}
