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
//   - source "webinar" (or first_touch.channel "webinar");
//   - the keyword: first_touch.keyword (or .live.keyword);
//   - the campaign: first_touch.campaign / .campaignTag / .live.campaign, or utm.campaign;
//   - the webinar: first_touch.webinarId (or .live.webinarId), or the lead's phone
//     matching one of the webinar's registrants.
//
// What only the live funnel knows (the short video sent after the keyword,
// and whether it was watched) comes through a LiveFunnelSource it registers
// (registerLiveFunnelSource). Until one is registered, "videos sent" and
// "videos watched" read "No data yet", never 0.

export interface FunnelLead {
  id: string;
  /** "Rosa G.": never more of a lead's name on these screens. */
  name: string | null;
  /** E.164, server-side only: matched to registrants, never sent to a screen without leads.work. */
  phone: string | null;
  createdAt: string;
  source: string;
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
}

/** What the live funnel adds: which leads got the video after the keyword, and which watched it. */
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
  const utm = rec(t.utm);
  const keyword = str(t.keyword) ?? str(live.keyword);
  const campaign = str(t.campaign) ?? str(t.campaignTag) ?? str(live.campaign) ?? str(utm.campaign);
  const webinarId = str(t.webinarId) ?? str(live.webinarId);
  const fromWebinar = source === "webinar" || str(t.channel) === "webinar" || Boolean(webinarId) || Boolean(keyword);
  return { keyword: keyword ? keyword.toUpperCase() : null, campaign, webinarId, fromWebinar };
}

/** True when the lead came from this webinar: its id, its keyword or campaign tag during it, or a registrant's phone. */
export function leadFromWebinar(lead: FunnelLead, webinar: Pick<Webinar, "id" | "keyword" | "campaignTag" | "startsAt">, registrantPhones: ReadonlySet<string>): boolean {
  if (lead.webinarId === webinar.id) return true;
  if (lead.phone && registrantPhones.has(lead.phone)) return true;
  const sinceDayBefore = Date.parse(lead.createdAt) >= Date.parse(webinar.startsAt) - 24 * 3_600_000;
  if (!sinceDayBefore) return false;
  if (lead.keyword && lead.keyword === webinar.keyword.toUpperCase() && lead.source === "webinar") return true;
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
  const kw = input.keyword.toUpperCase();
  return {
    registered: input.registrations.length,
    attended: input.registrations.filter((r) => r.attended).length,
    keywordMessages: input.leads.filter((l) => l.keyword === kw).length,
    reportsUploaded: input.leads.filter((l) => l.clientUserId && input.reportClients.has(l.clientUserId)).length,
    videosSent: input.videos ? input.leads.filter((l) => input.videos!.sent.has(l.id)).length : null,
    videosWatched: input.videos ? input.leads.filter((l) => input.videos!.watched.has(l.id)).length : null,
    signupsStarted: input.leads.filter((l) => l.signupStarted).length,
    signed: input.leads.filter((l) => l.signedAt).length,
  };
}
