import { attributeLead, attributionIndex, creditLeads, type Attribution } from "./attribution";
import type { Ad, AdCampaign, AdDay, AdLead, AdSet, AdsSnapshot, ResultKind } from "./types";
import { AD_RULES, adVerdict, VERDICT_RANK, type AdRules, type VerdictResult } from "./verdict";
import { addDays, dayInZone, inWindow, type AdWindow } from "./window";

// The Ads Manager's numbers for one window (docs/ADS.md). Pure: built from
// the cached Meta data (or the demo's sample) and Credalti's own leads, the
// same way on the server, in the demo and in the tests.
//
// Every number says whose it is. Spend, impressions, link clicks, results and
// cost per result are META's (what Ads Manager shows). Leads, signed clients,
// cost per lead and cost per signed client are CREDALTI's, verified in our own
// records: a lead is a row in the lead inbox credited to the ad by its first
// touch (attribution.ts), counted on the day it arrived (in the ad account's
// time zone); a signed client is one of those leads whose service agreement
// is signed. A number with nothing behind it is null ("—"), never 0 dollars.

export interface Metrics {
  spendCents: number;
  impressions: number;
  clicks: number;
  /** Link clicks per impression, in percent with one decimal; null with no impressions. */
  ctr: number | null;
  /** Meta's results; null when Meta reported none we could read. */
  results: number | null;
  costPerResultCents: number | null;
  /** Credalti's verified leads and signed clients. */
  leads: number;
  signed: number;
  costPerLeadCents: number | null;
  costPerSignedCents: number | null;
  daysWithSpend: number;
}

export interface AdRow {
  ad: Ad;
  adset: AdSet | null;
  campaign: AdCampaign | null;
  metrics: Metrics;
  verdict: VerdictResult;
  /** What Meta's results mean for this ad (its ad set's goal). */
  resultKind: ResultKind;
  /** On in Meta and spent on the last day of data or the day before. */
  stillSpending: boolean;
  /** "Turn off" and still spending: a person should look today. */
  needsYou: boolean;
  /** The day it last spent anything (in all the data, not only the window). */
  lastSpendDay: string | null;
  /** Its spend per day in the window, oldest first (for the drawer's small chart). */
  daily: Array<{ day: string; spendCents: number; results: number | null }>;
}

export interface AdSetRow {
  adset: AdSet;
  metrics: Metrics;
  ads: AdRow[];
}

export interface CampaignRow {
  campaign: AdCampaign;
  metrics: Metrics;
  adsets: AdSetRow[];
  /** Meta's Special Ad Category for credit (or financial products and services) is declared. */
  specialCategory: boolean;
}

export type NextInsight =
  | { code: "too_few"; winners: number; need: number }
  | { code: "format"; format: "video" | "image"; count: number; of: number; overall: number; overallOf: number }
  | { code: "language"; language: "es" | "en"; count: number; of: number }
  | { code: "cta"; cta: string; count: number; of: number }
  | { code: "length"; words: number; others: number | null }
  | { code: "words"; words: string[]; of: number }
  | { code: "goal"; kind: ResultKind; count: number; of: number };

export interface AdsReport {
  window: AdWindow;
  /** The last day with any Meta data (the sync's "until"). */
  dataUntil: string | null;
  totals: Metrics & { metaUnknownLeads: number; metaUnknownSigned: number };
  campaigns: CampaignRow[];
  /** Every ad that spent in the window or is on, best first. */
  ads: AdRow[];
  /** Winner and Looking good, best first, at most six. */
  winners: AdRow[];
  /** "Turn off" and still spending. */
  needsYou: AdRow[];
  next: NextInsight[];
  /** Campaigns on in Meta without the Special Ad Category a credit offer needs. */
  missingCategory: AdCampaign[];
  /** Each lead credited to an ad, for the drawer: lead id → its attribution. */
  leadsByAd: Map<string, AdLead[]>;
}

/** Meta's Special Ad Category names that cover credit: the old one and the one Meta merged it into. */
export const CREDIT_CATEGORIES = ["CREDIT", "FINANCIAL_PRODUCTS_SERVICES"] as const;

const per = (cents: number, n: number | null): number | null => (n !== null && n > 0 && cents > 0 ? Math.round(cents / n) : null);

function metricsOf(days: readonly AdDay[], leads: number, signed: number): Metrics {
  let spendCents = 0;
  let impressions = 0;
  let clicks = 0;
  let results: number | null = null;
  const spentOn = new Set<string>();
  for (const d of days) {
    spendCents += d.spendCents;
    impressions += d.impressions;
    clicks += d.clicks;
    if (d.results !== null) results = (results ?? 0) + d.results;
    if (d.spendCents > 0) spentOn.add(d.day);
  }
  return {
    spendCents,
    impressions,
    clicks,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : null,
    results,
    costPerResultCents: per(spendCents, results),
    leads,
    signed,
    costPerLeadCents: per(spendCents, leads),
    costPerSignedCents: per(spendCents, signed),
    daysWithSpend: spentOn.size,
  };
}

const ON = (status: string) => status === "ACTIVE";

/** The goals whose Meta results are people reaching out: the verdict may use them. */
export const LEAD_LIKE: readonly ResultKind[] = ["leads_form", "conversations", "website_leads", "results"];

export function buildReport(snapshot: AdsSnapshot, leads: readonly AdLead[], window: AdWindow, rules: AdRules = AD_RULES): AdsReport {
  const tz = snapshot.account?.timeZone ?? "America/Chicago";
  const index = attributionIndex(snapshot);
  const credited = creditLeads(leads, index, (l) => inWindow(dayInZone(l.createdAt, tz), window));
  const dataUntil = snapshot.days.reduce<string | null>((max, d) => (max === null || d.day > max ? d.day : max), null);
  const recent = dataUntil ? addDays(dataUntil, -1) : null;

  const windowDays = snapshot.days.filter((d) => inWindow(d.day, window));
  const byAd = new Map<string, AdDay[]>();
  for (const d of windowDays) byAd.set(d.adId, [...(byAd.get(d.adId) ?? []), d]);
  const lastSpend = new Map<string, string>();
  for (const d of snapshot.days) if (d.spendCents > 0 && (lastSpend.get(d.adId) ?? "") < d.day) lastSpend.set(d.adId, d.day);

  const adsets = new Map(snapshot.adsets.map((s) => [s.id, s]));
  const campaigns = new Map(snapshot.campaigns.map((c) => [c.id, c]));

  const rows: AdRow[] = [];
  for (const ad of snapshot.ads) {
    const days = byAd.get(ad.id) ?? [];
    const counts = credited.ads.get(ad.id) ?? { leads: 0, signed: 0 };
    const metrics = metricsOf(days, counts.leads, counts.signed);
    // An ad with nothing in the window and off in Meta is history: not listed.
    if (metrics.spendCents === 0 && counts.leads === 0 && !ON(ad.status)) continue;
    const adset = adsets.get(ad.adsetId) ?? null;
    const resultKind = adset?.resultKind ?? "results";
    // Meta's results judge an ad only when they are leads or conversations; clicks and page views are not leads.
    const verdict = adVerdict({ spendCents: metrics.spendCents, results: LEAD_LIKE.includes(resultKind) ? metrics.results : null, leads: metrics.leads, signed: metrics.signed, daysWithSpend: metrics.daysWithSpend }, rules);
    const campaign = campaigns.get(ad.campaignId) ?? null;
    const last = lastSpend.get(ad.id) ?? null;
    const delivering = ON(ad.status) && (!adset || ON(adset.status)) && (!campaign || ON(campaign.status));
    const stillSpending = delivering && last !== null && recent !== null && last >= recent;
    rows.push({
      ad,
      adset,
      campaign,
      metrics,
      verdict,
      resultKind,
      stillSpending,
      needsYou: verdict.verdict === "turn_off" && stillSpending,
      lastSpendDay: last,
      daily: [...days].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ day: d.day, spendCents: d.spendCents, results: d.results })),
    });
  }
  rows.sort(
    (a, b) =>
      VERDICT_RANK[a.verdict.verdict] - VERDICT_RANK[b.verdict.verdict] ||
      (a.verdict.costPerResultCents ?? Number.MAX_SAFE_INTEGER) - (b.verdict.costPerResultCents ?? Number.MAX_SAFE_INTEGER) ||
      b.metrics.signed - a.metrics.signed ||
      b.metrics.spendCents - a.metrics.spendCents,
  );

  // The tree: campaigns → ad sets → ads, the way Ads Manager shows them.
  const tree: CampaignRow[] = [];
  for (const campaign of snapshot.campaigns) {
    const sets: AdSetRow[] = [];
    for (const adset of snapshot.adsets.filter((s) => s.campaignId === campaign.id)) {
      const adRows = rows.filter((r) => r.ad.adsetId === adset.id);
      const days = windowDays.filter((d) => d.adsetId === adset.id);
      const counts = credited.adsets.get(adset.id) ?? { leads: 0, signed: 0 };
      if (adRows.length === 0 && days.length === 0 && counts.leads === 0) continue;
      sets.push({ adset, metrics: metricsOf(days, counts.leads, counts.signed), ads: adRows });
    }
    if (sets.length === 0) continue;
    const counts = credited.campaigns.get(campaign.id) ?? { leads: 0, signed: 0 };
    tree.push({
      campaign,
      metrics: metricsOf(windowDays.filter((d) => d.campaignId === campaign.id), counts.leads, counts.signed),
      adsets: sets.sort((a, b) => b.metrics.spendCents - a.metrics.spendCents),
      specialCategory: campaign.specialAdCategories.some((c) => (CREDIT_CATEGORIES as readonly string[]).includes(c)),
    });
  }
  tree.sort((a, b) => b.metrics.spendCents - a.metrics.spendCents);

  const totals = metricsOf(windowDays, credited.total.leads, credited.total.signed);
  const leadsByAd = new Map<string, AdLead[]>();
  const byId = new Map(leads.map((l) => [l.id, l]));
  for (const [adId, row] of credited.ads) leadsByAd.set(adId, row.leadIds.map((id) => byId.get(id)!).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  const winners = rows.filter((r) => r.verdict.verdict === "winner" || r.verdict.verdict === "good").slice(0, 6);
  return {
    window,
    dataUntil,
    totals: { ...totals, metaUnknownLeads: credited.metaUnknown.leads, metaUnknownSigned: credited.metaUnknown.signed },
    campaigns: tree,
    ads: rows,
    winners,
    needsYou: rows.filter((r) => r.needsYou),
    next: whatToMakeNext(rows),
    missingCategory: snapshot.campaigns.filter((c) => ON(c.status) && !c.specialAdCategories.some((x) => (CREDIT_CATEGORIES as readonly string[]).includes(x))),
    leadsByAd,
  };
}

/** The attribution of one lead, for the drawer's "why this lead is here". */
export function leadAttribution(snapshot: AdsSnapshot, lead: AdLead): Attribution {
  return attributeLead(lead, attributionIndex(snapshot));
}

// ── What to make next ───────────────────────────────────────────────────

const SPANISH = /[áéíóúñ¿¡]|\b(tu|tus|el|la|los|las|que|para|con|crédito|cartas|derechos|reporte|nosotros|hola|cómo)\b/i;
const STOP = new Set(
  "the a an and or of to in on for with your you our we is are it this that from at by be as not can how what why do does credit report reports results vary los las el la de del que para con por tu tus su sus un una es en y o lo se al resultados varían cada every each team equipo nuestro nuestra credalti chat start empieza".split(" "),
);

const wordsOf = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOP.has(w));

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/**
 * What the winners have in common, in counts a person can check: their format,
 * language, call to action, how long the text is, the words that repeat in
 * their headline and first line, and their goal. Nothing is said with fewer
 * than two winners, and a line shows only when most winners share it.
 */
export function whatToMakeNext(rows: readonly AdRow[], need = 2): NextInsight[] {
  const winners = rows.filter((r) => r.verdict.verdict === "winner" || r.verdict.verdict === "good");
  if (winners.length < need) return [{ code: "too_few", winners: winners.length, need }];
  const out: NextInsight[] = [];
  const n = winners.length;
  const most = (k: number) => k * 2 > n;
  const isVideo = (r: AdRow) => Boolean(r.ad.creative.videoId);

  const videos = winners.filter(isVideo).length;
  const judged = rows.filter((r) => r.verdict.verdict !== "needs_data");
  const format = most(videos) ? "video" : most(n - videos) ? "image" : null;
  if (format) {
    out.push({
      code: "format",
      format,
      count: format === "video" ? videos : n - videos,
      of: n,
      overall: judged.filter((r) => (format === "video" ? isVideo(r) : !isVideo(r))).length,
      overallOf: judged.length,
    });
  }

  const spanish = winners.filter((r) => SPANISH.test(`${r.ad.creative.title ?? ""} ${r.ad.creative.body ?? ""} ${r.ad.name}`)).length;
  if (most(spanish)) out.push({ code: "language", language: "es", count: spanish, of: n });
  else if (most(n - spanish)) out.push({ code: "language", language: "en", count: n - spanish, of: n });

  const ctas = new Map<string, number>();
  for (const r of winners) if (r.ad.creative.callToAction) ctas.set(r.ad.creative.callToAction, (ctas.get(r.ad.creative.callToAction) ?? 0) + 1);
  const topCta = [...ctas.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCta && most(topCta[1])) out.push({ code: "cta", cta: topCta[0], count: topCta[1], of: n });

  const length = (r: AdRow) => (r.ad.creative.body ?? "").split(/\s+/).filter(Boolean).length;
  const winWords = median(winners.map(length).filter((x) => x > 0));
  const others = median(rows.filter((r) => !winners.includes(r) && r.verdict.verdict !== "needs_data").map(length).filter((x) => x > 0));
  if (winWords !== null) out.push({ code: "length", words: winWords, others });

  const seen = new Map<string, number>();
  for (const r of winners) {
    const firstLine = (r.ad.creative.body ?? "").split(/[\n.!?]/)[0] ?? "";
    for (const w of new Set(wordsOf(`${r.ad.creative.title ?? ""} ${firstLine}`))) seen.set(w, (seen.get(w) ?? 0) + 1);
  }
  const shared = [...seen.entries()].filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([w]) => w);
  if (shared.length > 0) out.push({ code: "words", words: shared, of: n });

  const goals = new Map<ResultKind, number>();
  for (const r of winners) goals.set(r.resultKind, (goals.get(r.resultKind) ?? 0) + 1);
  const topGoal = [...goals.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topGoal && topGoal[0] !== "results" && most(topGoal[1])) out.push({ code: "goal", kind: topGoal[0], count: topGoal[1], of: n });
  return out;
}

// ── Money ───────────────────────────────────────────────────────────────

/** Meta's spend per calendar month ("2026-11" → cents), from every day cached. */
export function spendByMonth(days: readonly Pick<AdDay, "day" | "spendCents">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of days) out.set(d.day.slice(0, 7), (out.get(d.day.slice(0, 7)) ?? 0) + d.spendCents);
  return out;
}

/** The short summary the Overview, the menu's red circle and the Accounting card read: the last 7 days. */
export interface AdsSummary {
  connected: boolean;
  sample: boolean;
  spend7dCents: number | null;
  leads7d: number | null;
  signed7d: number | null;
  costPerLead7dCents: number | null;
  /** Ads marked "Turn off" that are still spending. */
  turnOff: number | null;
  syncedAt: string | null;
}

export function adsSummary(report: AdsReport | null, input: { connected: boolean; sample: boolean; syncedAt: string | null }): AdsSummary {
  if (!report) return { ...input, spend7dCents: null, leads7d: null, signed7d: null, costPerLead7dCents: null, turnOff: null };
  return {
    ...input,
    spend7dCents: report.totals.spendCents,
    leads7d: report.totals.leads,
    signed7d: report.totals.signed,
    costPerLead7dCents: report.totals.costPerLeadCents,
    turnOff: report.needsYou.length,
  };
}
