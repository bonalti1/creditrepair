// The Ads Manager (/equipo/anuncios, docs/ADS.md, migration 0037): what an ad
// account, its campaigns, ad sets and ads are, and the numbers per ad per day,
// as Meta reports them. Read only: nothing in the app changes Meta. Money is
// whole cents in the account's currency; days are calendar days in the AD
// ACCOUNT's time zone (the days Ads Manager shows).

export type AdLevel = "campaign" | "adset" | "ad";

/** Meta's account_status, in our words. */
export type AccountStatus = "active" | "disabled" | "unsettled" | "review" | "grace" | "closing" | "closed" | "unknown";

export interface AdAccount {
  /** "act_1234567890". */
  id: string;
  name: string;
  /** ISO 4217, "USD". */
  currency: string;
  /** IANA, "America/Chicago": the days of every number. */
  timeZone: string;
  status: AccountStatus;
  statusCode: number | null;
}

/** What Meta counts as a "result" for an ad set (its optimization goal). */
export type ResultKind = "leads_form" | "conversations" | "website_leads" | "website_other" | "link_clicks" | "landing_page_views" | "results";

export interface AdCampaign {
  id: string;
  name: string;
  /** Meta's effective_status: ACTIVE, PAUSED, CAMPAIGN_PAUSED, ARCHIVED, WITH_ISSUES… */
  status: string;
  objective: string | null;
  /** Meta's special_ad_categories: a credit offer must declare one (CREDIT, or FINANCIAL_PRODUCTS_SERVICES). */
  specialAdCategories: string[];
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  createdAt: string | null;
}

export interface AdSet {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  optimizationGoal: string | null;
  /** The action type in Meta's `actions` that is this ad set's result; null: not known (the first lead-type action is used). */
  resultAction: string | null;
  resultKind: ResultKind;
  createdAt: string | null;
}

export interface AdCreative {
  title: string | null;
  /** The primary text. */
  body: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  /** A video ad's video (played on demand through the server). */
  videoId: string | null;
  /** Meta's call_to_action type: LEARN_MORE, WHATSAPP_MESSAGE, SIGN_UP… */
  callToAction: string | null;
  /** Where the ad sends people. */
  link: string | null;
}

export interface Ad {
  id: string;
  adsetId: string;
  campaignId: string;
  name: string;
  status: string;
  createdAt: string | null;
  creative: AdCreative;
  /** Meta's shareable preview, when it gave one. */
  previewUrl: string | null;
}

/** One ad's numbers on one day, as Meta reports them. */
export interface AdDay {
  adId: string;
  adsetId: string;
  campaignId: string;
  /** "YYYY-MM-DD", in the ad account's time zone. */
  day: string;
  spendCents: number;
  impressions: number;
  /** Link clicks (Meta's inline_link_clicks). */
  clicks: number;
  /** Meta's own results for the ad set's goal; null when Meta gave none we could read. */
  results: number | null;
}

export interface SyncRun {
  at: string;
  ok: boolean;
  since: string | null;
  until: string | null;
  rows: number;
  error: string | null;
}

/** Everything the Ads Manager knows about the account, as cached in the database (or the demo's sample). */
export interface AdsSnapshot {
  platform: "meta";
  account: AdAccount | null;
  campaigns: AdCampaign[];
  adsets: AdSet[];
  ads: Ad[];
  days: AdDay[];
  /** The last sync that worked. */
  syncedAt: string | null;
  lastRun: SyncRun | null;
}

/**
 * What a lead's first touch says about the ad it came from (leads.first_touch,
 * migration 0034; the `ad` key from migration 0037). Marketing tags only:
 * never a name, a phone or anything from the credit file. `fbclid` is kept as
 * "there was one", never its value.
 */
export interface AdTouch {
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  fbclid?: boolean;
  /** "link": a tagged link to the website; "ctwa": a click-to-WhatsApp ad (Meta's referral); "form": a HighLevel form. */
  via?: "link" | "ctwa" | "form" | null;
}

export interface AttributionUtm {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

/** A lead, as the Ads Manager needs it (no phone, no message). */
export interface AdLead {
  id: string;
  /** First name and last initial at most ("Rosa G."), or null. */
  name: string | null;
  createdAt: string;
  /** The service agreement was signed: a verified signed client. */
  signedAt: string | null;
  source: string;
  utm: AttributionUtm | null;
  ad: AdTouch | null;
}

/** The variables the Ads Manager needs on the server to read Meta (names only; the values never leave the server). */
export const META_ADS_ENV = ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] as const;

export const PLATFORMS = ["meta", "google", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** A video brief made from an ad copy draft (ads_briefs), for Video Studio. */
export interface AdBrief {
  id: string;
  createdAt: string;
  by: string;
  title: string;
  sourceAdId: string | null;
  format: string;
  goal: string;
  language: string;
  status: string;
}

/** What GET /api/staff/ads returns (and what the demo builds): everything the screen needs for one window. */
export interface AdsPayload {
  window: { since: string; until: string; days: number; preset: 7 | 14 | 30 | 90 | "custom" };
  snapshot: AdsSnapshot;
  leads: AdLead[];
  /** Meta's spend per month, the last 13 months. */
  monthly: Array<{ month: string; spendCents: number }>;
  /** Whether the server can read Meta; the variables missing when it cannot (names only, never values). */
  meta: { configured: boolean; missing: string[] };
  briefs: AdBrief[];
  /** True in the demo: every number on the screen is sample data. */
  sample: boolean;
}
