import { liveCounters, type FunnelLead, type LiveCounters, type VideoEvents } from "./live";
import { shortName } from "./register";
import { buildScorecard, type ClientValueFacts, type Scorecard } from "./scorecard";
import { phaseOf } from "./time";
import { REMINDER_KINDS, type Campaign, type CampaignCost, type ClientPurchase, type Registration, type ReminderKind, type Webinar, type WebinarPhase } from "./types";

// What the console's screens receive, built the same way from the database
// (server.ts) and from the demo (demo.ts). Pure.

export interface WebinarSummary {
  webinar: Webinar;
  phase: WebinarPhase;
  registered: number;
  attended: number;
  outOfState: number;
  reminders: number;
}

export interface RegistrantView {
  id: string;
  /** The full name for members who work leads; "Rosa G." for the others. */
  name: string;
  phone: string | null;
  email: string | null;
  state: string;
  served: Registration["served"];
  locale: "en" | "es";
  goal: Registration["goal"];
  timeline: Registration["timeline"];
  question: string | null;
  remindersConsent: boolean;
  optedOut: boolean;
  attended: boolean;
  attendedMinutes: number | null;
  attendanceSource: Registration["attendanceSource"];
  createdAt: string;
  fromAd: boolean;
}

export interface ReminderStat {
  kind: ReminderKind;
  sent: number;
  failed: number;
}

export interface WebinarLinks {
  page: string;
  signup: string;
}

export interface WebinarDetail {
  webinar: Webinar;
  phase: WebinarPhase;
  links: WebinarLinks;
  registrants: RegistrantView[];
  /** The member may see names in full, phones and emails (leads.work). */
  contact: boolean;
  /** Administrators only. */
  reminders: ReminderStat[] | null;
  counters: LiveCounters;
  sample: boolean;
}

export interface LiveLeadView {
  id: string;
  name: string;
  at: string;
  source: string;
  keyword: string | null;
  stage: "message" | "signup" | "signed";
  excerpt: string | null;
}

export interface LiveView {
  webinar: Webinar;
  phase: WebinarPhase;
  links: WebinarLinks;
  counters: LiveCounters;
  leads: LiveLeadView[];
  sample: boolean;
}

export interface CampaignsView {
  campaigns: Campaign[];
  costs: CampaignCost[];
  purchases: ClientPurchase[];
  scorecards: Scorecard[];
  metaCampaigns: Array<{ id: string; name: string }>;
  webinars: Array<{ id: string; title: string; startsAt: string }>;
  /** Meta's numbers are read (the Ads Manager is connected and synced). */
  adsConnected: boolean;
  sample: boolean;
}

export function webinarLinks(webinar: Pick<Webinar, "slug" | "campaignTag">, origin: string): WebinarLinks {
  const base = origin.replace(/\/+$/, "");
  const tag = encodeURIComponent(webinar.campaignTag ?? webinar.slug);
  return { page: `${base}/webinar/${webinar.slug}`, signup: `${base}/registro?utm_source=webinar&utm_medium=live&utm_campaign=${tag}` };
}

export function summarize(webinars: readonly Webinar[], registrations: readonly Registration[], now: Date): WebinarSummary[] {
  return [...webinars]
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map((webinar) => {
      const mine = registrations.filter((r) => r.webinarId === webinar.id);
      return {
        webinar,
        phase: phaseOf(webinar, now),
        registered: mine.length,
        attended: mine.filter((r) => r.attended).length,
        outOfState: mine.filter((r) => r.served === "out_of_state").length,
        reminders: mine.filter((r) => r.remindersConsent && !r.optedOutAt).length,
      };
    });
}

/** The next webinar to come (or the one live now), for the Overview's card. */
export function nextWebinar(summaries: readonly WebinarSummary[]): WebinarSummary | null {
  const open = summaries.filter((s) => s.phase === "live" || s.phase === "upcoming");
  return open.sort((a, b) => (a.phase === "live" ? -1 : b.phase === "live" ? 1 : a.webinar.startsAt.localeCompare(b.webinar.startsAt)))[0] ?? null;
}

export function registrantView(r: Registration, contact: boolean): RegistrantView {
  const ad = r.attribution && typeof r.attribution === "object" ? (r.attribution as { ad?: unknown }).ad : null;
  return {
    id: r.id,
    name: contact ? [r.firstName, r.lastName].filter(Boolean).join(" ") : shortName(r.firstName, r.lastName),
    phone: contact ? r.phone : null,
    email: contact ? r.email : null,
    state: r.state,
    served: r.served,
    locale: r.locale,
    goal: r.goal,
    timeline: r.timeline,
    question: contact ? r.question : null,
    remindersConsent: r.remindersConsent,
    optedOut: Boolean(r.optedOutAt),
    attended: r.attended,
    attendedMinutes: r.attendedMinutes,
    attendanceSource: r.attendanceSource,
    createdAt: r.createdAt,
    fromAd: Boolean(ad),
  };
}

export function reminderStats(messages: ReadonlyArray<{ kind: ReminderKind; status: string }>): ReminderStat[] {
  return REMINDER_KINDS.map((kind) => ({ kind, sent: messages.filter((m) => m.kind === kind && m.status === "sent").length, failed: messages.filter((m) => m.kind === kind && m.status === "failed").length }));
}

export function liveLeadViews(leads: readonly FunnelLead[], limit = 40): LiveLeadView[] {
  return [...leads]
    .sort((a, b) => (b.lastMessage?.at ?? b.createdAt).localeCompare(a.lastMessage?.at ?? a.createdAt))
    .slice(0, limit)
    .map((l) => ({
      id: l.id,
      name: l.name ?? "—",
      at: l.lastMessage?.at ?? l.createdAt,
      source: l.source,
      keyword: l.keyword,
      stage: l.signedAt ? "signed" : l.signupStarted ? "signup" : "message",
      excerpt: l.lastMessage?.excerpt ?? null,
    }));
}

export function countersFor(webinar: Webinar, registrations: readonly Registration[], leads: readonly FunnelLead[], reportClients: ReadonlySet<string>, videos: VideoEvents | null): LiveCounters {
  return liveCounters({ registrations: registrations.filter((r) => r.webinarId === webinar.id), leads, keyword: webinar.keyword, reportClients, videos });
}

/**
 * The Ideas center's numbers (ideas/signals.ts WEBINARS): the classes of the
 * last 30 days and the newest campaign's CAC and client value. A CAC below
 * the threshold is null ("no data"), never a made-up figure.
 */
export function webinarsSignal(input: { webinars: readonly Webinar[]; registrations: readonly Registration[]; leads: readonly FunnelLead[]; scorecards: readonly Scorecard[]; now: Date }): import("../ideas/signals").WebinarsSignalInput {
  const since = input.now.getTime() - 30 * 24 * 3_600_000;
  const recent = input.webinars.filter((w) => Date.parse(w.startsAt) >= since && Date.parse(w.startsAt) <= input.now.getTime() + 60 * 24 * 3_600_000 && w.status === "published");
  const ended = recent.filter((w) => phaseOf(w, input.now) === "ended");
  const regs = (ws: readonly Webinar[]) => input.registrations.filter((r) => ws.some((w) => w.id === r.webinarId));
  const recentLeads = input.leads.filter((l) => Date.parse(l.createdAt) >= since && (l.source === "webinar" || l.webinarId || l.keyword));
  const newest = [...input.scorecards].sort((a, b) => b.campaign.startDay.localeCompare(a.campaign.startDay))[0] ?? null;
  return {
    registered30d: input.registrations.filter((r) => Date.parse(r.createdAt) >= since).length,
    endedRegistered30d: regs(ended).length,
    endedAttended30d: regs(ended).filter((r) => r.attended).length,
    keywordLeads30d: recentLeads.filter((l) => l.keyword).length,
    signed30d: recentLeads.filter((l) => l.signedAt).length,
    campaign: newest
      ? { cacBlendedCents: newest.cac.blended.cents, cacAdsCents: newest.cac.adsOnly.cents, valuePerClientCents: newest.value.averageCents, valueOverCac: newest.value.valueOverCac, upgrades: newest.value.upgrades }
      : null,
  };
}

export function scorecardsFor(input: {
  campaigns: readonly Campaign[];
  costs: readonly CampaignCost[];
  adDays: ReadonlyArray<{ campaignId: string; day: string; spendCents: number }>;
  webinars: readonly Webinar[];
  registrations: readonly Registration[];
  leads: readonly FunnelLead[];
  reportClients: ReadonlySet<string>;
  videos: VideoEvents | null;
  values: ReadonlyMap<string, ClientValueFacts>;
  dayOf: (iso: string) => string;
}): Scorecard[] {
  const live = input.costs.filter((c) => !c.voidedAt);
  return input.campaigns.map((campaign) => buildScorecard({ ...input, campaign, costs: live.filter((c) => c.campaignId === campaign.id) }));
}
