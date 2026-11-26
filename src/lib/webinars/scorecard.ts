import { addDays } from "../ads/window";
import { reportUploaded, signupStarted, type FunnelLead, type VideoEvents } from "./live";
import { SERVICE_OPTIONS, type Campaign, type CampaignCost, type PurchaseKind, type Registration, type ServiceOption, type Webinar } from "./types";

// The campaign scorecard (docs/WEBINARS.md, «The scorecard and its formulas»).
//
// A campaign ("Webinar test #1", with dates and a budget) groups Meta
// campaigns (from the Ads Manager's cached data), webinars, keywords and
// organic sources. Its funnel counts the LEADS THAT ARRIVED IN ITS DATES
// (a cohort, like the Ads Manager), and how far each has come so far.
//
// A lead belongs to the campaign by its first touch, checked in this order,
// and counts once, under the first that matches:
//   1. ads       its Meta campaign (ads/attribution.ts, or the Meta ad on the
//                webinar registration with its phone) is one of the campaign's;
//   2. webinar   it came from one of the campaign's webinars (their id or
//                tag, or a registrant's phone);
//   3. keyword   it typed one of the campaign's keywords;
//   4. organic   its utm_source or channel is one of the organic sources.
//
// CAC, two ways (each written on the screen with its formula):
//   ads-only = Meta spend on the campaign's Meta campaigns in its dates
//              ÷ signed clients credited to those ads
//   blended  = (that Meta spend + every cost recorded on the campaign)
//              ÷ every signed client the campaign brought
// Below MIN_SIGNED_FOR_CAC signed clients, a CAC reads "Not enough data yet".
//
// Client value, per signed client: the money actually collected so far
// (THE MONEY RULE, accounting/ledger.ts, read only: refunds, voids and lost
// chargebacks counted against it; test charges never), the IdentityIQ
// commissions recorded for them (/equipo/monitoreo), and what they bought
// later (hand-marked purchases with an amount). DIY → Complete upgrades
// show as their own number and inside the value (the money collected after
// the upgrade). Split by package (packages.ts): Complete and DIY. Nothing
// here shows a client's credit data; a client is a first name and an initial.

export const MIN_SIGNED_FOR_CAC = 3;

export type Channel = "ads" | "webinar" | "keyword" | "organic";

export interface ClientValueFacts {
  clientId: string;
  /** "Rosa G." */
  name: string;
  option: ServiceOption;
  collectedCents: number;
  /** Of the collected, what came in after a DIY → Complete upgrade. */
  collectedAfterUpgradeCents: number;
  commissionsCents: number;
  /** Hand-marked later purchases with an amount. */
  purchasesCents: number;
  purchaseCounts: Partial<Record<PurchaseKind, number>>;
  upgrades: number;
  /** Read from the records where they exist (household members added, loan officer requests). */
  households: number;
  loanOfficer: number;
}

export interface CacFigure {
  cents: number | null;
  state: "ok" | "not_enough" | "no_cost";
  costCents: number;
  signed: number;
}

export interface ClientValueRow extends ClientValueFacts {
  channel: Channel;
  totalCents: number;
}

export interface PackageSplit {
  option: ServiceOption;
  signed: number;
  collectedCents: number;
  valueCents: number;
  averageValueCents: number | null;
  /** All campaign costs ÷ this package's signed clients (as if the campaign brought only these). */
  cac: CacFigure;
  /** Ad spend ÷ this package's ad-credited signed clients. */
  adsCac: CacFigure;
  /** This package's average value ÷ the campaign's blended CAC. */
  valueOverCac: number | null;
  upgrades: number;
}

export interface Scorecard {
  campaign: Campaign;
  window: { since: string; until: string };
  spend: { metaCents: number; otherCents: number; totalCents: number; budgetCents: number | null; leftCents: number | null };
  funnel: {
    registered: number;
    attended: number;
    leads: number;
    reportsUploaded: number;
    videosSent: number | null;
    videosWatched: number | null;
    signupsStarted: number;
    signed: number;
  };
  byChannel: Record<Channel, { leads: number; signed: number }>;
  cac: { adsOnly: CacFigure; blended: CacFigure };
  value: {
    clients: ClientValueRow[];
    totalCents: number;
    averageCents: number | null;
    valueOverCac: number | null;
    upgrades: number;
    collectedAfterUpgradeCents: number;
  };
  byPackage: Record<ServiceOption, PackageSplit>;
}

export interface ScorecardInput {
  campaign: Campaign;
  costs: readonly CampaignCost[];
  /** Meta's spend per campaign per day (the ad account's days), from the Ads Manager's cache. */
  adDays: ReadonlyArray<{ campaignId: string; day: string; spendCents: number }>;
  webinars: readonly Webinar[];
  registrations: readonly Registration[];
  leads: readonly FunnelLead[];
  /** Client ids with a report on file (counts only: nothing of the report is read). */
  reportClients: ReadonlySet<string>;
  videos: VideoEvents | null;
  values: ReadonlyMap<string, ClientValueFacts>;
  /** A lead's day on Texas's calendar. */
  dayOf: (iso: string) => string;
}

export function cacFigure(costCents: number, signed: number, min = MIN_SIGNED_FOR_CAC): CacFigure {
  if (costCents <= 0) return { cents: null, state: "no_cost", costCents, signed };
  if (signed < min) return { cents: null, state: "not_enough", costCents, signed };
  return { cents: Math.round(costCents / signed), state: "ok", costCents, signed };
}

const inDates = (day: string, c: Pick<Campaign, "startDay" | "endDay">) => day >= c.startDay && day <= c.endDay;

/** The channel a lead came to this campaign through, or null when it is not the campaign's. */
export function channelOf(
  lead: FunnelLead,
  campaign: Campaign,
  ctx: { webinars: readonly Webinar[]; registrantByPhone: ReadonlyMap<string, Registration>; inWindow: boolean },
): Channel | null {
  if (!ctx.inWindow) return null;
  const meta = new Set(campaign.metaCampaignIds);
  const reg = lead.phone ? ctx.registrantByPhone.get(lead.phone) : undefined;
  const regAd = reg?.attribution && typeof reg.attribution === "object" ? ((reg.attribution as { ad?: { campaignId?: unknown } }).ad?.campaignId ?? null) : null;
  if ((lead.adCampaignId && meta.has(lead.adCampaignId)) || (typeof regAd === "string" && meta.has(regAd))) return "ads";
  const webinarIds = new Set(campaign.webinarIds);
  const tags = new Set(ctx.webinars.filter((w) => webinarIds.has(w.id) && w.campaignTag).map((w) => w.campaignTag!.toLowerCase()));
  if ((lead.webinarId && webinarIds.has(lead.webinarId)) || (reg && webinarIds.has(reg.webinarId)) || (lead.campaign && tags.has(lead.campaign.toLowerCase()))) return "webinar";
  const keywords = new Set(campaign.keywords.map((k) => k.toUpperCase()));
  if (lead.keyword && keywords.has(lead.keyword)) return "keyword";
  const organic = new Set(campaign.organicSources.map((s) => s.toLowerCase()));
  const src = (lead.utmSource ?? "").toLowerCase();
  if ((src && organic.has(src)) || organic.has(lead.source.toLowerCase())) return "organic";
  return null;
}

export function valueTotal(v: Pick<ClientValueFacts, "collectedCents" | "commissionsCents" | "purchasesCents">): number {
  return v.collectedCents + v.commissionsCents + v.purchasesCents;
}

export function buildScorecard(input: ScorecardInput): Scorecard {
  const { campaign } = input;
  const meta = new Set(campaign.metaCampaignIds);
  const webinarIds = new Set(campaign.webinarIds);
  const metaCents = input.adDays.filter((d) => meta.has(d.campaignId) && inDates(d.day, campaign)).reduce((s, d) => s + d.spendCents, 0);
  const otherCents = input.costs.filter((c) => c.campaignId === campaign.id).reduce((s, c) => s + c.amountCents, 0);
  const totalCents = metaCents + otherCents;

  const registrations = input.registrations.filter((r) => webinarIds.has(r.webinarId));
  const registrantByPhone = new Map(registrations.map((r) => [r.phone, r]));
  const webinars = input.webinars.filter((w) => webinarIds.has(w.id));

  const members: Array<{ lead: FunnelLead; channel: Channel }> = [];
  for (const lead of input.leads) {
    const channel = channelOf(lead, campaign, { webinars, registrantByPhone, inWindow: inDates(input.dayOf(lead.createdAt), campaign) });
    if (channel) members.push({ lead, channel });
  }
  const signedMembers = members.filter((m) => m.lead.signedAt);
  const byChannel = Object.fromEntries((["ads", "webinar", "keyword", "organic"] as const).map((c) => [c, { leads: members.filter((m) => m.channel === c).length, signed: signedMembers.filter((m) => m.channel === c).length }])) as Scorecard["byChannel"];

  const adsSigned = byChannel.ads.signed;
  const adsOnly = cacFigure(metaCents, adsSigned);
  const blended = cacFigure(totalCents, signedMembers.length);

  const clients: ClientValueRow[] = signedMembers.flatMap(({ lead, channel }) => {
    const v = lead.clientUserId ? input.values.get(lead.clientUserId) : undefined;
    const facts: ClientValueFacts = v ?? { clientId: lead.clientUserId ?? lead.id, name: lead.name ?? "—", option: "complete", collectedCents: 0, collectedAfterUpgradeCents: 0, commissionsCents: 0, purchasesCents: 0, purchaseCounts: {}, upgrades: 0, households: 0, loanOfficer: 0 };
    return [{ ...facts, channel, totalCents: valueTotal(facts) }];
  });
  const total = clients.reduce((s, c) => s + c.totalCents, 0);
  const average = clients.length > 0 ? Math.round(total / clients.length) : null;
  const ratio = (avg: number | null) => (avg !== null && blended.cents !== null && blended.cents > 0 ? avg / blended.cents : null);

  const byPackage = Object.fromEntries(
    SERVICE_OPTIONS.map((option) => {
      const mine = clients.filter((c) => c.option === option);
      const valueCents = mine.reduce((s, c) => s + c.totalCents, 0);
      const avg = mine.length > 0 ? Math.round(valueCents / mine.length) : null;
      const split: PackageSplit = {
        option,
        signed: mine.length,
        collectedCents: mine.reduce((s, c) => s + c.collectedCents, 0),
        valueCents,
        averageValueCents: avg,
        cac: cacFigure(totalCents, mine.length),
        adsCac: cacFigure(metaCents, mine.filter((c) => c.channel === "ads").length),
        valueOverCac: ratio(avg),
        upgrades: mine.reduce((s, c) => s + c.upgrades, 0),
      };
      return [option, split];
    }),
  ) as Record<ServiceOption, PackageSplit>;

  const memberLeads = members.map((m) => m.lead);
  return {
    campaign,
    window: { since: campaign.startDay, until: campaign.endDay },
    spend: { metaCents, otherCents, totalCents, budgetCents: campaign.budgetCents, leftCents: campaign.budgetCents === null ? null : campaign.budgetCents - totalCents },
    funnel: {
      registered: registrations.length,
      attended: registrations.filter((r) => r.attended).length,
      leads: members.length,
      reportsUploaded: memberLeads.filter((l) => reportUploaded(l, input.reportClients, input.videos)).length,
      videosSent: input.videos ? memberLeads.filter((l) => input.videos!.sent.has(l.id)).length : null,
      videosWatched: input.videos ? memberLeads.filter((l) => input.videos!.watched.has(l.id)).length : null,
      signupsStarted: memberLeads.filter((l) => signupStarted(l, input.videos)).length,
      signed: signedMembers.length,
    },
    byChannel,
    cac: { adsOnly, blended },
    value: {
      clients,
      totalCents: total,
      averageCents: average,
      valueOverCac: ratio(average),
      upgrades: clients.reduce((s, c) => s + c.upgrades, 0),
      collectedAfterUpgradeCents: clients.reduce((s, c) => s + c.collectedAfterUpgradeCents, 0),
    },
    byPackage,
  };
}

/** The window's days, for the screen ("Nov 30 to Dec 14 · 15 days"). */
export function campaignDays(c: Pick<Campaign, "startDay" | "endDay">): number {
  let n = 0;
  for (let d = c.startDay; d <= c.endDay && n < 400; d = addDays(d, 1)) n += 1;
  return n;
}
