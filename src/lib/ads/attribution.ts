import type { Ad, AdCampaign, AdLead, AdSet } from "./types";

// Which ad a lead came from, from what the lead and signup flow captured
// (docs/ADS.md, "Where each number comes from"). First touch only: a lead is
// credited to the first ad that brought them, never to a later one. In order:
//
//   1. The ad's id in the first touch: the `ad_id` tag on a link to the
//      website (Meta's {{ad.id}}), or the ad a click-to-WhatsApp message came
//      from (Meta's referral on the first message).          → that ad
//   2. utm_content is an ad's id, or the name of exactly one ad
//      ({{ad.id}} or {{ad.name}} in the ad's URL parameters). → that ad
//   3. The ad set's id in the first touch, or utm_term / utm_medium is an ad
//      set's id or the name of exactly one ad set.            → that ad set only
//   4. The campaign's id in the first touch, or utm_campaign is a campaign's
//      id or the name of exactly one campaign.                → that campaign only
//   5. Otherwise, a Facebook click id was present, or utm_source says
//      Facebook or Instagram                                  → "from Meta, ad unknown"
//   6. Anything else                                          → not from an ad
//
// A name that matches two ads is not guessed: the lead goes one level up.
// Pure: the same answer on the server, in the demo and in the tests.

export type AttributionLevel = "ad" | "adset" | "campaign" | "meta" | "none";
export type AttributionHow = "ad_id" | "ctwa" | "utm_content" | "adset_id" | "utm_term" | "campaign_id" | "utm_campaign" | "fbclid" | "utm_source";

export interface Attribution {
  level: AttributionLevel;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  how: AttributionHow | null;
}

export interface AttributionIndex {
  ads: ReadonlyMap<string, Ad>;
  adsets: ReadonlyMap<string, AdSet>;
  campaigns: ReadonlyMap<string, AdCampaign>;
  adByName: ReadonlyMap<string, Ad | null>;
  adsetByName: ReadonlyMap<string, AdSet | null>;
  campaignByName: ReadonlyMap<string, AdCampaign | null>;
}

const norm = (v: string | null | undefined) => (v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** Name → the one object with that name, or null when two share it (never guessed). */
function byName<T extends { name: string }>(items: readonly T[]): Map<string, T | null> {
  const out = new Map<string, T | null>();
  for (const item of items) {
    const key = norm(item.name);
    if (!key) continue;
    out.set(key, out.has(key) ? null : item);
  }
  return out;
}

export function attributionIndex(input: { ads: readonly Ad[]; adsets: readonly AdSet[]; campaigns: readonly AdCampaign[] }): AttributionIndex {
  return {
    ads: new Map(input.ads.map((a) => [a.id, a])),
    adsets: new Map(input.adsets.map((s) => [s.id, s])),
    campaigns: new Map(input.campaigns.map((c) => [c.id, c])),
    adByName: byName(input.ads),
    adsetByName: byName(input.adsets),
    campaignByName: byName(input.campaigns),
  };
}

const META_SOURCES = /^(facebook|fb|instagram|ig|meta|messenger|audience_network|an|facebook_ads|fb_ads|ig_ads)$/i;

const NONE: Attribution = { level: "none", adId: null, adsetId: null, campaignId: null, how: null };

export function attributeLead(lead: Pick<AdLead, "utm" | "ad">, index: AttributionIndex): Attribution {
  const touch = lead.ad ?? {};
  const utm = lead.utm ?? {};
  const toAd = (ad: Ad, how: AttributionHow): Attribution => ({ level: "ad", adId: ad.id, adsetId: ad.adsetId, campaignId: ad.campaignId, how });
  const toSet = (set: AdSet, how: AttributionHow): Attribution => ({ level: "adset", adId: null, adsetId: set.id, campaignId: set.campaignId, how });
  const toCampaign = (c: AdCampaign, how: AttributionHow): Attribution => ({ level: "campaign", adId: null, adsetId: null, campaignId: c.id, how });

  // 1. The ad's own id.
  const direct = touch.adId ? index.ads.get(touch.adId) : undefined;
  if (direct) return toAd(direct, touch.via === "ctwa" ? "ctwa" : "ad_id");
  // 2. utm_content: an ad's id or its (unique) name.
  const content = utm.content?.trim();
  if (content) {
    const ad = index.ads.get(content) ?? index.adByName.get(norm(content)) ?? null;
    if (ad) return toAd(ad, "utm_content");
  }
  // 3. The ad set.
  const set = (touch.adsetId ? index.adsets.get(touch.adsetId) : undefined) ?? null;
  if (set) return toSet(set, "adset_id");
  for (const value of [utm.term, utm.medium]) {
    const v = value?.trim();
    if (!v) continue;
    const found = index.adsets.get(v) ?? index.adsetByName.get(norm(v)) ?? null;
    if (found) return toSet(found, "utm_term");
  }
  // 4. The campaign.
  const campaign = (touch.campaignId ? index.campaigns.get(touch.campaignId) : undefined) ?? null;
  if (campaign) return toCampaign(campaign, "campaign_id");
  const tag = utm.campaign?.trim();
  if (tag) {
    const found = index.campaigns.get(tag) ?? index.campaignByName.get(norm(tag)) ?? null;
    if (found) return toCampaign(found, "utm_campaign");
  }
  // 5. From Meta, but no ad, ad set or campaign we know.
  if (touch.fbclid || touch.via === "ctwa" || touch.adId) return { ...NONE, level: "meta", how: "fbclid" };
  if (utm.source && META_SOURCES.test(utm.source.trim())) return { ...NONE, level: "meta", how: "utm_source" };
  return NONE;
}

export interface AttributedCounts {
  leads: number;
  signed: number;
}

export interface FunnelByObject {
  /** Leads credited to each ad (ad level only). */
  ads: Map<string, AttributedCounts & { leadIds: string[] }>;
  /** Leads credited to an ad set: its ads' leads plus the ones that reached only the ad set. */
  adsets: Map<string, AttributedCounts>;
  /** The same for campaigns. */
  campaigns: Map<string, AttributedCounts>;
  /** From Meta (a click id or a Meta utm_source) but no ad we know. */
  metaUnknown: AttributedCounts;
  /** Every lead from an ad, at any level, plus metaUnknown. */
  total: AttributedCounts;
}

/** The leads in a window, credited to ads, ad sets and campaigns. `inWindow` picks the leads to count (by their day). */
export function creditLeads(leads: readonly AdLead[], index: AttributionIndex, inWindow: (lead: AdLead) => boolean): FunnelByObject {
  const out: FunnelByObject = { ads: new Map(), adsets: new Map(), campaigns: new Map(), metaUnknown: { leads: 0, signed: 0 }, total: { leads: 0, signed: 0 } };
  const bump = (map: Map<string, AttributedCounts>, id: string, signed: boolean) => {
    const row = map.get(id) ?? { leads: 0, signed: 0 };
    row.leads += 1;
    if (signed) row.signed += 1;
    map.set(id, row);
  };
  for (const lead of leads) {
    if (!inWindow(lead)) continue;
    const a = attributeLead(lead, index);
    if (a.level === "none") continue;
    const signed = Boolean(lead.signedAt);
    out.total.leads += 1;
    if (signed) out.total.signed += 1;
    if (a.level === "meta") {
      out.metaUnknown.leads += 1;
      if (signed) out.metaUnknown.signed += 1;
      continue;
    }
    if (a.adId) {
      const row = out.ads.get(a.adId) ?? { leads: 0, signed: 0, leadIds: [] };
      row.leads += 1;
      if (signed) row.signed += 1;
      row.leadIds.push(lead.id);
      out.ads.set(a.adId, row);
    }
    if (a.adsetId) bump(out.adsets, a.adsetId, signed);
    if (a.campaignId) bump(out.campaigns, a.campaignId, signed);
  }
  return out;
}
