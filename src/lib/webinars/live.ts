import type { Registration, Webinar } from "./types";

// The keyword / live funnel, as the webinars read it (docs/WEBINARS.md,
// «How the live funnel plugs in»).
//
// Another helper builds the keyword funnel (migration 0043, src/lib/live/*):
// a keyword typed in a live chat or sent on WhatsApp gets an automatic
// reply, and the lead is tagged with source `webinar`, the keyword and the
// campaign. src/lib/live did not exist when this was written, so the
// webinars read those tags GENERICALLY from the lead inbox's own records
// (`leads`, migration 0034), whatever shape they land in:
//
//   - source "webinar" (or first_touch.channel "webinar", or the live
//     funnel's first_touch.funnel.tag "webinar");
//   - the keyword: first_touch.keyword (or .live.keyword, or the live
//     funnel's .funnel.keyword);
//   - the campaign: first_touch.campaign / .campaignTag / .live.campaign, or utm.campaign;
//   - the webinar: first_touch.webinarId (or .live.webinarId), or the lead's phone
//     matching one of the webinar's registrants.
//
// What only the live funnel knows (the report uploaded on /live, the short
// video sent after the keyword, whether it was watched, «Get started» tapped
// on the video page) comes through the LiveFunnelSource it registers
// (src/lib/live/webinarSource.ts, imported by server.ts). Without one,
// "videos sent" and "videos watched" read "No data yet", never 0.

export interface FunnelLead {
  id: string;
  /** "Rosa G.": never more of a lead's name on these screens. */
  name: string | null;
  /** E.164, server-side only: matched to registrants, never sent to a screen without leads.work. */
  phone: string | null;
  createdAt: string;
  source: string;
  /** Tagged as from a webinar or a keyword (leadTags), whatever its source. */
  fromWebinar?: boolean;
  keyword: string | null;
  campaign: string | null;
  webinarId: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  /** The Meta campaign it is credited to (ads/attribution.ts: first touch), or null. */
  adCampaignId: string | null;
  /** From Meta at all (a click id, utm_source facebook/instagram), even with no known campaign. */
  fromMeta: boolean;
  clientUserId: string | null;
  /** A chat signup or an account began. */
  signupStarted: boolean;
  signedAt: string | null;
  /** The last message, shortened, for the live console's list. */
  lastMessage: { at: string; excerpt: string; fromLead: boolean } | null;
}

export interface VideoEvents {
  sent: ReadonlySet<string>;
  watched: ReadonlySet<string>;
  /** Leads who uploaded their report on /live (before any account exists). */
  reports?: ReadonlySet<string>;
  /** Leads who tapped «Get started» on their video page. */
  started?: ReadonlySet<string>;
}

/** What the live funnel adds, by lead id: report uploaded, video sent, watched, «Get started» tapped. */
export interface LiveFunnelSource {
  id: string;
  videos(leadIds: readonly string[]): Promise<VideoEvents>;
}

let source: LiveFunnelSource | null = null;

export function registerLiveFunnelSource(next: LiveFunnelSource): void {
  source = next;
}

export function liveFunnelSource(): LiveFunnelSource | null {
  return source;
}

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 120) : null);

/** The webinar tags a lead's first touch carries, read generically. */
export function leadTags(source: string, firstTouch: unknown): { keyword: string | null; campaign: string | null; webinarId: string | null; fromWebinar: boolean } {
  const t = rec(firstTouch);
  const live = rec(t.live);
  // The live funnel's own shape (src/lib/live/server.ts ensureFunnelLead): { campaign, funnel: { tag, keyword, src, platform } }.
  const funnel = rec(t.funnel);
  const utm = rec(t.utm);
  const keyword = str(t.keyword) ?? str(live.keyword) ?? str(funnel.keyword);
  const campaign = str(t.campaign) ?? str(t.campaignTag) ?? str(live.campaign) ?? str(utm.campaign);
  const webinarId = str(t.webinarId) ?? str(live.webinarId);
  const fromWebinar = source === "webinar" || str(t.channel) === "webinar" || str(funnel.tag) === "webinar" || Boolean(webinarId) || Boolean(keyword);
  return { keyword: keyword ? keyword.toUpperCase() : null, campaign, webinarId, fromWebinar };
}

/** True when the lead came from this webinar: its id, its keyword or campaign tag during it, or a registrant's phone. */
export function leadFromWebinar(lead: FunnelLead, webinar: Pick<Webinar, "id" | "keyword" | "campaignTag" | "startsAt">, registrantPhones: ReadonlySet<string>): boolean {
  if (lead.webinarId === webinar.id) return true;
  if (lead.phone && registrantPhones.has(lead.phone)) return true;
  const sinceDayBefore = Date.parse(lead.createdAt) >= Date.parse(webinar.startsAt) - 24 * 3_600_000;
  if (!sinceDayBefore) return false;
  if (lead.keyword && lead.keyword === webinar.keyword.toUpperCase() && (lead.source === "webinar" || lead.fromWebinar)) return true;
  return Boolean(webinar.campaignTag && lead.campaign && lead.campaign.toLowerCase() === webinar.campaignTag.toLowerCase());
}

export interface LiveCounters {
  registered: number;
  attended: number;
  keywordMessages: number;
  reportsUploaded: number;
  /** Null: the live funnel is not connected (no data yet). */
  videosSent: number | null;
  videosWatched: number | null;
  signupsStarted: number;
  signed: number;
}

/** The live console's counters, from the registrants and the webinar's leads. */
export function liveCounters(input: {
  registrations: readonly Pick<Registration, "attended">[];
  leads: readonly FunnelLead[];
  keyword: string;
  reportClients: ReadonlySet<string>;
  videos: VideoEvents | null;
}): LiveCounters {
  return {
    registered: input.registrations.length,
    attended: input.registrations.filter((r) => r.attended).length,
    // The webinar's leads who sent a keyword: its own (CREDIT) or the Spanish one (CREDITO), whichever they typed.
    keywordMessages: input.leads.filter((l) => Boolean(l.keyword)).length,
    reportsUploaded: input.leads.filter((l) => reportUploaded(l, input.reportClients, input.videos)).length,
    videosSent: input.videos ? input.leads.filter((l) => input.videos!.sent.has(l.id)).length : null,
    videosWatched: input.videos ? input.leads.filter((l) => input.videos!.watched.has(l.id)).length : null,
    signupsStarted: input.leads.filter((l) => signupStarted(l, input.videos)).length,
    signed: input.leads.filter((l) => l.signedAt).length,
  };
}

/** A report is on file for the lead: their client's report, or the one they uploaded on /live (the live funnel). */
export function reportUploaded(lead: Pick<FunnelLead, "id" | "clientUserId">, reportClients: ReadonlySet<string>, videos: VideoEvents | null): boolean {
  return Boolean((lead.clientUserId && reportClients.has(lead.clientUserId)) || videos?.reports?.has(lead.id));
}

/** A signup began: a chat signup or an account, or «Get started» on their video page (the live funnel). */
export function signupStarted(lead: Pick<FunnelLead, "id" | "signupStarted">, videos: VideoEvents | null): boolean {
  return lead.signupStarted || Boolean(videos?.started?.has(lead.id));
}
