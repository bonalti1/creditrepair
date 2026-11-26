// Webinars and the campaign scorecard (docs/WEBINARS.md, migration 0044).
// Pure types, shared by the server (server.ts), the demo (demo.ts), the
// public registration page and the console's screens.

export const PLATFORMS = ["zoom", "facebook", "youtube", "instagram", "tiktok"] as const;
export type WebinarPlatform = (typeof PLATFORMS)[number];

export const WEBINAR_LANGUAGES = ["en", "es", "both"] as const;
export type WebinarLanguage = (typeof WEBINAR_LANGUAGES)[number];

/** Stored status. "Live" and "ended" are not stored: they follow from the clock (phaseOf). */
export const WEBINAR_STATUSES = ["draft", "published", "cancelled"] as const;
export type WebinarStatus = (typeof WEBINAR_STATUSES)[number];

/** Where a webinar is in time. */
export type WebinarPhase = "draft" | "upcoming" | "live" | "ended" | "cancelled";

export interface Webinar {
  id: string;
  /** The public page: /webinar/<slug>. */
  slug: string;
  title: { en: string; es: string };
  /** The person who presents (the owner's sister, today). */
  host: string;
  /** ISO instant. Entered and shown on Texas time (America/Chicago). */
  startsAt: string;
  durationMinutes: number;
  language: WebinarLanguage;
  topic: string;
  /** A short tag that marks the leads and links it to a campaign ("webinar-test-1"). */
  campaignTag: string | null;
  /** The word people type in the live chat or on WhatsApp ("CREDIT"). */
  keyword: string;
  links: Partial<Record<WebinarPlatform, string>>;
  replayUrl: string | null;
  status: WebinarStatus;
  campaignId: string | null;
  createdAt: string;
  createdBy: string;
}

export const GOALS = ["home", "car", "understand", "learning"] as const;
export type RegistrantGoal = (typeof GOALS)[number];

export const TIMELINES = ["now", "months_3", "months_6", "months_12", "learning"] as const;
export type RegistrantTimeline = (typeof TIMELINES)[number];

/** Texas is served; any other state may register to learn and is marked out of state; Georgia never registers. */
export type Served = "texas" | "out_of_state";

export interface Registration {
  id: string;
  webinarId: string;
  firstName: string;
  lastName: string | null;
  /** E.164. Shown only to members who work leads (leads.work). */
  phone: string;
  email: string | null;
  state: string;
  served: Served;
  locale: "en" | "es";
  goal: RegistrantGoal;
  timeline: RegistrantTimeline;
  question: string | null;
  /** They ticked the box: reminders by WhatsApp or email. Never pre-ticked. */
  remindersConsent: boolean;
  optedOutAt: string | null;
  attended: boolean;
  attendedMinutes: number | null;
  attendanceSource: "zoom_csv" | "manual" | null;
  createdAt: string;
  /** Marketing tags only (src/lib/ads/capture.ts): utm_*, ad id, "fbclid: true". */
  attribution: Record<string, unknown> | null;
}

/** The reminders, in order. */
export const REMINDER_KINDS = ["week", "day", "hour", "live", "replay", "followup_2", "followup_5"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export interface ReminderRecord {
  registrationId: string;
  kind: ReminderKind;
  channel: "whatsapp" | "email";
  status: "sending" | "sent" | "failed" | "skipped";
  at: string;
}

// ── Campaigns ─────────────────────────────────────────────────────────────

export const COST_KINDS = ["ads_other", "content", "tools", "people", "other"] as const;
export type CostKind = (typeof COST_KINDS)[number];

export interface CampaignCost {
  id: string;
  campaignId: string;
  label: string;
  kind: CostKind;
  amountCents: number;
  /** The day the money was spent. */
  day: string;
  by: string;
  /** A cost recorded by mistake is voided, never deleted. */
  voidedAt: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  /** YYYY-MM-DD, inclusive, Texas days. */
  startDay: string;
  endDay: string;
  /** What the owner plans to spend (all of it, Meta and the rest). */
  budgetCents: number | null;
  /** Meta campaign ids from the Ads Manager's cached data. */
  metaCampaignIds: string[];
  webinarIds: string[];
  /** Keywords people type ("CREDIT"), uppercase. */
  keywords: string[];
  /** utm_source values or channels counted as organic ("instagram", "tiktok", "youtube"). */
  organicSources: string[];
  note: string | null;
  createdAt: string;
}

/** What a client bought after signing, marked by hand (or read from the records where they exist). */
export const PURCHASE_KINDS = ["upgrade", "household_addon", "partner_offer", "loan_officer", "home_purchase", "other"] as const;
export type PurchaseKind = (typeof PURCHASE_KINDS)[number];

export interface ClientPurchase {
  id: string;
  clientId: string;
  kind: PurchaseKind;
  /** Money that came to Credalti from it, when there was any (a referral fee, an upgrade's price). */
  amountCents: number | null;
  day: string;
  note: string | null;
  by: string;
  voidedAt: string | null;
}

/**
 * The two packages (owner's decision, 2026-11-25), built in parallel by
 * another helper: "Credalti Complete" (done for you; monthly, charged right
 * after each month's letters are mailed) and "Credalti DIY" (do it yourself,
 * guided by Alti; a monthly subscription from the start). A client with no
 * package recorded is Complete (the full service every client had before).
 */
export const SERVICE_OPTIONS = ["complete", "diy"] as const;
export type ServiceOption = (typeof SERVICE_OPTIONS)[number];

/** A client moving from DIY to Complete (the packages' upgrade event). */
export interface PackageUpgrade {
  clientId: string;
  at: string;
  from: ServiceOption;
  to: ServiceOption;
}
