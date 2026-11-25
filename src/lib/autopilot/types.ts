// Piloto automático: the shapes the follow-up engine, the status messages,
// the automatic send and the work queue share. Standalone on purpose (no
// imports from the console), so the staff types can carry these fields
// without an import cycle.
//
// What runs by itself and what still needs a person is written down in
// docs/AUTOPILOT.md.

/**
 * Situations where the system writes to the client by itself, on a short
 * schedule, before anyone on the team has to. Each one maps to one or more of
 * the console's "needs a person" notices (followups.ts: FOLLOWUP_SCHEDULES).
 */
export const FOLLOWUP_KINDS = [
  "agreement_unsigned",
  "documents_missing",
  "review_unfinished",
  "monitoring_inactive",
  "payment_method_missing",
  "identity_theft_report_missing",
  // Things that used to wait for a person and now go to the client first (docs/AUTOPILOT.md, "Lo que se arregla solo"):
  // the address on file the post office does not recognise, and a document the AI could not accept.
  "address_unconfirmed",
  "document_reupload",
] as const;

export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

/** The moments the client is told about by themselves (status.ts). */
export const STATUS_KINDS = [
  "letters_mailed",
  "certified_delivered",
  "report_changes",
  "next_round_prepared",
  "payment_receipt",
  // Billing's notices, now through the outbound log (opt-out, quiet hours, the cap, dedupe), each with the link to «Actualizar mi tarjeta».
  "payment_declined",
  "payment_method_needed",
  // A letter that came back went out again to the corrected address.
  "letter_remailed",
  // The one review request per client, at a milestone everyone reaches (src/lib/reviews, migration 0029).
  "review_request",
] as const;

export type StatusKind = (typeof STATUS_KINDS)[number];

// WhatsApp first, then email. Never SMS: carriers reject credit-repair text
// campaigns, so SMS is used only for login codes (Supabase Auth), never by the
// autopilot. A test holds this (autopilot.test.ts).
export const CHANNELS = ["whatsapp", "email"] as const;

export type Channel = (typeof CHANNELS)[number];

export type MessageLocale = "es" | "en";

/**
 * Where a message is in its life. `queued`: a status message waiting for the
 * next run. `sending`: claimed by a run (it went out once, or the run stopped
 * part way; it is never tried again, so a crash never sends twice). `sent`:
 * the provider took it. `simulated`: the demo, nothing left the building.
 * `failed`: the provider refused it. `cancelled`: it never went (the client
 * opted out, or it expired waiting for a channel).
 */
export type OutboundStatus = "queued" | "sending" | "sent" | "simulated" | "failed" | "cancelled";

/** One automatic message to a client, as the outbound log records it (migration 0015). */
export interface OutboundMessage {
  id: string;
  /** Unique across the log: a run that repeats never writes the same message twice. */
  dedupeKey: string;
  kind: "followup" | "status";
  topic: FollowupKind | StatusKind;
  /** 1-based step of a follow-up schedule; null for a status message. */
  step: number | null;
  /** Null only while a status message is still queued. */
  channel: Channel | null;
  /**
   * The message's template (templates.ts). It goes as that WhatsApp template
   * outside the 24-hour window, as plain text with the same words inside it,
   * or as an email.
   */
  template: string | null;
  /** The template's values, {{1}} first. */
  params?: string[];
  locale: MessageLocale;
  body: string;
  /** The screen in the app that fixes it. */
  link: string | null;
  status: OutboundStatus;
  queuedAt: string;
  sentAt: string | null;
  /** Why it did not go (cancelled, failed). */
  note?: string | null;
}

/** The client's answer to automatic messages, as recorded (BAJA / STOP, or a teammate on their behalf). */
export interface OptOutRecord {
  at: string;
  /** "BAJA", "STOP", or "equipo" when a teammate recorded it for the client. */
  keyword: string;
  channel: Channel | "staff" | "app";
}

/** "Hold": the system sends no round and no reminder for this client on its own. */
export interface ClientHold {
  id: string;
  at: string;
  /** Handle of the teammate who held it. */
  by: string;
  reason: string;
  releasedAt?: string | null;
  releasedBy?: string | null;
}

/** The team's switches (one row, migration 0015: autopilot_settings). */
export interface AutopilotSettings {
  /** Rounds that pass every gate go out by themselves after the review window. Off until the owner turns it on. */
  roundsEnabled: boolean;
  /** Hours a prepared round sits in "Listas para enviar" before it may go by itself. */
  reviewWindowHours: number;
  /** Automatic reminders to the client. Off until the owner turns it on. */
  followupsEnabled: boolean;
  /** Each situation on or off (applies while followupsEnabled is on). */
  followups: Record<FollowupKind, boolean>;
  /** Factual updates (letters mailed, delivered, new report, receipt). These were already automatic. */
  statusEnabled: boolean;
  /** No message from this hour (client's local time)… */
  quietStartHour: number;
  /** …until this hour. */
  quietEndHour: number;
  /** At most this many automatic messages to one client in one local day. */
  dailyCap: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const ALL_FOLLOWUPS_ON: Record<FollowupKind, boolean> = Object.fromEntries(FOLLOWUP_KINDS.map((k) => [k, true])) as Record<
  FollowupKind,
  boolean
>;

/** As the database starts: nothing new runs by itself until an administrator turns it on. */
export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  roundsEnabled: false,
  reviewWindowHours: 24,
  followupsEnabled: false,
  followups: ALL_FOLLOWUPS_ON,
  statusEnabled: true,
  quietStartHour: 21,
  quietEndHour: 8,
  dailyCap: 2,
  updatedAt: null,
  updatedBy: null,
};

export const REVIEW_WINDOW_CHOICES = [12, 24, 48, 72] as const;
export const DAILY_CAP_RANGE = { min: 1, max: 5 } as const;

/** Which channels can reach a client right now (from the server's settings, or the demo). */
export interface ChannelAvailability {
  whatsapp: boolean;
  email: boolean;
  /** WhatsApp template names approved in Meta, or "all" (the demo). */
  approvedTemplates: readonly string[] | "all";
  /** True in the demo: nothing is really sent. */
  simulated: boolean;
}

export const NO_CHANNELS: ChannelAvailability = { whatsapp: false, email: false, approvedTemplates: [], simulated: false };

/** Everything the rules need besides the client. */
export interface AutopilotEnv {
  settings: AutopilotSettings;
  channels: ChannelAvailability;
}

/** Settings read from anywhere (a row, a stored demo record), made whole and kept inside their limits. */
export function normalizeSettings(input: Partial<AutopilotSettings> | null | undefined): AutopilotSettings {
  const s = { ...DEFAULT_AUTOPILOT, ...(input ?? {}) };
  const hour = (v: unknown, fallback: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? (v as number) : fallback);
  const followups = { ...ALL_FOLLOWUPS_ON };
  for (const kind of FOLLOWUP_KINDS) {
    const v = (input?.followups as Record<string, unknown> | undefined)?.[kind];
    if (typeof v === "boolean") followups[kind] = v;
  }
  const window = Number(s.reviewWindowHours);
  const cap = Number(s.dailyCap);
  return {
    roundsEnabled: s.roundsEnabled === true,
    reviewWindowHours: Number.isInteger(window) && window >= 1 && window <= 168 ? window : DEFAULT_AUTOPILOT.reviewWindowHours,
    followupsEnabled: s.followupsEnabled === true,
    followups,
    statusEnabled: s.statusEnabled !== false,
    quietStartHour: hour(s.quietStartHour, DEFAULT_AUTOPILOT.quietStartHour),
    quietEndHour: hour(s.quietEndHour, DEFAULT_AUTOPILOT.quietEndHour),
    dailyCap: Number.isInteger(cap) && cap >= DAILY_CAP_RANGE.min && cap <= DAILY_CAP_RANGE.max ? cap : DEFAULT_AUTOPILOT.dailyCap,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : null,
    updatedBy: typeof s.updatedBy === "string" ? s.updatedBy : null,
  };
}
