import { z } from "zod";
import { DEFAULT_CLIENT_TIME_ZONE } from "../autopilot/clock";
import { normalizeStaffLocale, STAFF_LOCALES, type StaffLocale, staffLocaleFallback } from "./i18n/locale";

// A member's own settings (migration 0020: staff_preferences): the morning
// summary and the first-day checklist; and, since migration 0025, the
// language the console speaks to them (i18n/locale.ts). Each member sets their own on
// /equipo/perfil; nobody sets them for anyone else.

export const DIGEST_CHANNELS = ["whatsapp", "email"] as const;
export type DigestChannel = (typeof DIGEST_CHANNELS)[number];

export const DIGEST_CHANNEL_LABELS: Record<StaffLocale, Record<DigestChannel, string>> = {
  en: { whatsapp: "WhatsApp", email: "Email" },
  es: { whatsapp: "WhatsApp", email: "Correo" },
};

/** 8:30 a.m. on the member's clock (Texas unless they choose another zone). */
export const DEFAULT_DIGEST_TIME = "08:30";

export interface StaffPreferences {
  /** Off until the member turns it on (opt-in). */
  digestEnabled: boolean;
  digestChannel: DigestChannel;
  /** "HH:MM", 24-hour, on the member's clock. */
  digestTime: string;
  timeZone: string;
  /** When they closed the first-day checklist; null while it shows. */
  checklistDismissedAt: string | null;
  /** The console's language, as the member chose it; null until they choose (then: their browser's, else English). */
  locale: StaffLocale | null;
}

export const DEFAULT_PREFERENCES: StaffPreferences = {
  digestEnabled: false,
  digestChannel: "whatsapp",
  digestTime: DEFAULT_DIGEST_TIME,
  timeZone: DEFAULT_CLIENT_TIME_ZONE,
  checklistDismissedAt: null,
  locale: null,
};

/** Time zones a member may pick, the ones the business works in. */
export const STAFF_TIME_ZONES: ReadonlyArray<[string, string]> = [
  ["America/Chicago", "Texas (Centro)"],
  ["America/Denver", "Montaña"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacífico"],
  ["America/New_York", "Este"],
];

/** The same zones' names in each language. */
export const STAFF_TIME_ZONE_NAMES: Record<StaffLocale, Record<string, string>> = {
  en: {
    "America/Chicago": "Texas (Central)",
    "America/Denver": "Mountain",
    "America/Phoenix": "Arizona",
    "America/Los_Angeles": "Pacific",
    "America/New_York": "Eastern",
  },
  es: Object.fromEntries(STAFF_TIME_ZONES),
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What POST /api/staff/preferences accepts: any subset, each field checked. */
export const preferencesUpdateSchema = z
  .object({
    digestEnabled: z.boolean(),
    digestChannel: z.enum(DIGEST_CHANNELS),
    digestTime: z.string().regex(TIME),
    timeZone: z.enum(STAFF_TIME_ZONES.map(([zone]) => zone) as [string, ...string[]]),
    checklistDismissed: z.boolean(),
    locale: z.enum(STAFF_LOCALES),
  })
  .partial();
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;

/** Anything read back (a row, the demo's stored copy) made whole and within limits. */
export function normalizePreferences(input: Partial<StaffPreferences> | null | undefined): StaffPreferences {
  const p = { ...DEFAULT_PREFERENCES, ...(input ?? {}) };
  return {
    digestEnabled: p.digestEnabled === true,
    digestChannel: DIGEST_CHANNELS.includes(p.digestChannel) ? p.digestChannel : DEFAULT_PREFERENCES.digestChannel,
    digestTime: typeof p.digestTime === "string" && TIME.test(p.digestTime) ? p.digestTime : DEFAULT_DIGEST_TIME,
    timeZone: STAFF_TIME_ZONES.some(([zone]) => zone === p.timeZone) ? p.timeZone : DEFAULT_CLIENT_TIME_ZONE,
    checklistDismissedAt: typeof p.checklistDismissedAt === "string" ? p.checklistDismissedAt : null,
    locale: normalizeStaffLocale(p.locale),
  };
}

export function applyPreferencesUpdate(current: StaffPreferences, update: PreferencesUpdate, now: Date): StaffPreferences {
  return normalizePreferences({
    ...current,
    ...(update.digestEnabled !== undefined ? { digestEnabled: update.digestEnabled } : {}),
    ...(update.digestChannel ? { digestChannel: update.digestChannel } : {}),
    ...(update.digestTime ? { digestTime: update.digestTime } : {}),
    ...(update.timeZone ? { timeZone: update.timeZone } : {}),
    ...(update.checklistDismissed !== undefined ? { checklistDismissedAt: update.checklistDismissed ? now.toISOString() : null } : {}),
    ...(update.locale ? { locale: update.locale } : {}),
  });
}

/** A staff_preferences row as preferences. */
export function preferencesFromRow(row: Record<string, unknown> | null | undefined): StaffPreferences {
  if (!row) return DEFAULT_PREFERENCES;
  return normalizePreferences({
    digestEnabled: row.digest_enabled === true,
    digestChannel: row.digest_channel as DigestChannel,
    digestTime: row.digest_time as string,
    timeZone: row.time_zone as string,
    checklistDismissedAt: typeof row.checklist_dismissed_at === "string" ? new Date(row.checklist_dismissed_at).toISOString() : null,
    locale: normalizeStaffLocale(row.locale),
  });
}

/** The row to upsert for these preferences. */
export function preferencesToRow(userId: string, prefs: StaffPreferences, now: Date): Record<string, unknown> {
  return {
    user_id: userId,
    digest_enabled: prefs.digestEnabled,
    digest_channel: prefs.digestChannel,
    digest_time: prefs.digestTime,
    time_zone: prefs.timeZone,
    checklist_dismissed_at: prefs.checklistDismissedAt,
    locale: prefs.locale,
    updated_at: now.toISOString(),
  };
}

/** "08:30" → "8:30 AM" (English) or "8:30 a. m." (Spanish). */
export function formatDigestTime(time: string, locale: StaffLocale = staffLocaleFallback()): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = locale === "es" ? (h < 12 ? "a. m." : "p. m.") : h < 12 ? "AM" : "PM";
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}
