import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attributeLead, attributionIndex, creditLeads } from "../ads/attribution";
import { adSpendChecks, tolerance } from "../ads/books";
import { attributionFromSearch, isFresh, sanitizeAttribution } from "../ads/capture";
import { AD_TEMPLATES, adChecklist, checkAdDraft, checkAdText, draftAdCopy, parseAdCopy, templateAdDraft, type AdCopyRequest } from "../ads/copy";
import { buildDemoAds } from "../ads/demo";
import { graphUrl, metaAdsConfig, MetaAdsError, parseAccount, parseAd, parseAdSet, parseCampaign, parseCreative, parseInsight, readAccount, readInsights, readStructure, readVideo, resultOf, resultsOf, unitsToCents } from "../ads/meta";
import { adsSummary, buildReport, CREDIT_CATEGORIES, spendByMonth, whatToMakeNext } from "../ads/report";
import type { Ad, AdCampaign, AdLead, AdSet, AdsSnapshot } from "../ads/types";
import { AD_RULES, adVerdict } from "../ads/verdict";
import { adWindow, dayInZone } from "../ads/window";
import { ALTI_HELP_TEXT, altiJobs } from "../staff/altiHelp";
import { groupOfPath, NAV_BY_HREF, NAV_GROUPS } from "../staff/nav";
import { can, deniedReason, rolesThatCan } from "../staff/permissions";
import { helpForPath } from "../staff/playbook";
import { SHELL_TEXT } from "../staff/i18n/ui/shell";
import { fakeMeta, fixture, META_ENV } from "./fixtures/meta-ads/http";

// The Ads Manager (docs/ADS.md): the verdict rules, the attribution of leads
// to ads, Meta's answers parsed from fixture JSON (no live call), the window,
// the report, Alti's ad copy and its checklist, the tags a link carries, the
// books' reconciliation, and who may see what.

const NOW = new Date("2026-11-25T18:00:00.000Z");

// ── The verdict ─────────────────────────────────────────────────────────

describe("ads: the verdict, from the rules on the screen", () => {
  const v = (input: Partial<Parameters<typeof adVerdict>[0]>) => adVerdict({ spendCents: 0, results: null, leads: 0, signed: 0, daysWithSpend: 0, ...input });

  it("no spend: Needs data", () => {
    expect(v({}).verdict).toBe("needs_data");
    expect(v({}).reason.code).toBe("no_spend");
  });

  it("$150 with no result and no lead: Turn off, even during the test", () => {
    const out = v({ spendCents: 15_000, results: 0, daysWithSpend: 2 });
    expect(out.verdict).toBe("turn_off");
    expect(out.reason).toEqual({ code: "no_result_spent", spentCents: 15_000, limitCents: AD_RULES.noResultCutCents });
    // Under the limit it is still a test.
    expect(v({ spendCents: 14_999, results: 0, daysWithSpend: 2 }).verdict).toBe("testing");
  });

  it("every ad is tested for 7 days with spend first, however cheap it looks", () => {
    const out = v({ spendCents: 5_000, results: 40, daysWithSpend: 6 });
    expect(out.verdict).toBe("testing");
    expect(out.reason).toEqual({ code: "testing_days", day: 6, of: 7 });
  });

  it("after the test: over $45 a result, after $50 spent, Turn off", () => {
    const out = v({ spendCents: 50_000, results: 10, daysWithSpend: 9 });
    expect(out.verdict).toBe("turn_off");
    expect(out.reason).toEqual({ code: "too_expensive", costCents: 5_000, limitCents: 4_500 });
    // No result at all after the test: Turn off, said as "no result".
    expect(v({ spendCents: 6_000, results: 0, daysWithSpend: 8 }).reason.code).toBe("no_result_spent");
  });

  it("then at least 10 results before Winner or Looking good", () => {
    const out = v({ spendCents: 9_000, results: 9, daysWithSpend: 8 });
    expect(out.verdict).toBe("testing");
    expect(out.reason).toEqual({ code: "testing_results", have: 9, need: 10 });
  });

  it("$25 a result or less: Winner; $45 or less: Looking good", () => {
    expect(v({ spendCents: 25_000, results: 10, daysWithSpend: 7 }).verdict).toBe("winner");
    expect(v({ spendCents: 25_010, results: 10, daysWithSpend: 7 }).verdict).toBe("good");
    expect(v({ spendCents: 45_000, results: 10, daysWithSpend: 7 }).verdict).toBe("good");
  });

  it("2 signed clients at $300 or less each make a winner, whatever the cost per result", () => {
    const out = v({ spendCents: 60_000, results: 5, leads: 5, signed: 2, daysWithSpend: 10 });
    expect(out.verdict).toBe("winner");
    expect(out.reason).toEqual({ code: "signed_winner", signed: 2, costCents: 30_000, limitCents: 30_000 });
    expect(v({ spendCents: 60_002, results: 5, leads: 5, signed: 2, daysWithSpend: 10 }).verdict).toBe("turn_off");
  });

  it("Meta's results when it has them; Credalti's leads when it has none, or counted none while we have leads", () => {
    expect(v({ spendCents: 20_000, results: 12, leads: 3, daysWithSpend: 8 }).basis).toBe("meta");
    const credalti = v({ spendCents: 20_000, results: null, leads: 12, daysWithSpend: 8 });
    expect(credalti.basis).toBe("credalti");
    expect(credalti.costPerResultCents).toBe(1_667);
    expect(v({ spendCents: 20_000, results: 0, leads: 11, daysWithSpend: 8 }).basis).toBe("credalti");
  });
});

// ── Attribution ─────────────────────────────────────────────────────────

const CAMPAIGN: AdCampaign = { id: "900", name: "Website · Start", status: "ACTIVE", objective: "OUTCOME_LEADS", specialAdCategories: ["CREDIT"], dailyBudgetCents: null, lifetimeBudgetCents: null, createdAt: null };
const SET: AdSet = { id: "910", campaignId: "900", name: "Texas leads", status: "ACTIVE", optimizationGoal: "LEAD_GENERATION", resultAction: "lead", resultKind: "leads_form", createdAt: null };
const blankCreative = { title: null, body: null, thumbnailUrl: null, imageUrl: null, videoId: null, callToAction: null, link: null };
const AD_A: Ad = { id: "920", adsetId: "910", campaignId: "900", name: "How it works", status: "ACTIVE", createdAt: null, creative: blankCreative, previewUrl: null };
const AD_B: Ad = { ...AD_A, id: "921", name: "Twin name" };
const AD_C: Ad = { ...AD_A, id: "922", name: "Twin name" };
const index = attributionIndex({ ads: [AD_A, AD_B, AD_C], adsets: [SET], campaigns: [CAMPAIGN] });
const lead = (over: Partial<AdLead>): AdLead => ({ id: "l", name: null, createdAt: NOW.toISOString(), signedAt: null, source: "signup_chat", utm: null, ad: null, ...over });

describe("ads: which ad a lead came from (first touch)", () => {
  it("the ad's own id, from a link's ad_id or a click-to-WhatsApp referral", () => {
    expect(attributeLead(lead({ ad: { adId: "920", via: "link" } }), index)).toMatchObject({ level: "ad", adId: "920", adsetId: "910", campaignId: "900", how: "ad_id" });
    expect(attributeLead(lead({ ad: { adId: "920", via: "ctwa" } }), index).how).toBe("ctwa");
  });

  it("utm_content: an ad's id, or the name of exactly one ad (never a guess between two)", () => {
    expect(attributeLead(lead({ utm: { content: "920" } }), index)).toMatchObject({ level: "ad", adId: "920", how: "utm_content" });
    expect(attributeLead(lead({ utm: { content: "  how IT works " } }), index)).toMatchObject({ level: "ad", adId: "920" });
    // Two ads share the name: one level up only if the ad set is known; here the campaign by its name.
    expect(attributeLead(lead({ utm: { content: "Twin name", campaign: "Website · Start" } }), index)).toMatchObject({ level: "campaign", adId: null, campaignId: "900", how: "utm_campaign" });
  });

  it("the ad set, then the campaign, then only 'from Meta'", () => {
    expect(attributeLead(lead({ utm: { term: "910" } }), index)).toMatchObject({ level: "adset", adsetId: "910", campaignId: "900" });
    expect(attributeLead(lead({ ad: { campaignId: "900" } }), index)).toMatchObject({ level: "campaign", how: "campaign_id" });
    expect(attributeLead(lead({ ad: { fbclid: true } }), index)).toMatchObject({ level: "meta", how: "fbclid" });
    expect(attributeLead(lead({ utm: { source: "Instagram" } }), index)).toMatchObject({ level: "meta", how: "utm_source" });
    // An ad we do not know is still from Meta, never another ad.
    expect(attributeLead(lead({ ad: { adId: "555555", via: "ctwa" } }), index).level).toBe("meta");
    expect(attributeLead(lead({ utm: { source: "google", content: "nothing" } }), index).level).toBe("none");
    expect(attributeLead(lead({}), index).level).toBe("none");
  });

  it("credits leads in the window to ads, their ad sets and campaigns; signed ones counted apart", () => {
    const leads = [
      lead({ id: "1", ad: { adId: "920" }, signedAt: NOW.toISOString() }),
      lead({ id: "2", utm: { content: "920" } }),
      lead({ id: "3", utm: { term: "Texas leads" } }),
      lead({ id: "4", ad: { fbclid: true } }),
      lead({ id: "5", utm: { source: "google" } }),
      lead({ id: "6", ad: { adId: "920" }, createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const out = creditLeads(leads, index, (l) => l.createdAt >= "2026-11-01");
    expect(out.ads.get("920")).toMatchObject({ leads: 2, signed: 1, leadIds: ["1", "2"] });
    expect(out.adsets.get("910")).toEqual({ leads: 3, signed: 1 });
    expect(out.campaigns.get("900")).toEqual({ leads: 3, signed: 1 });
    expect(out.metaUnknown).toEqual({ leads: 1, signed: 0 });
    expect(out.total).toEqual({ leads: 4, signed: 1 });
  });
});

// ── Meta's answers ──────────────────────────────────────────────────────

describe("ads: Meta's Marketing API, read only, parsed strictly (fixture JSON)", () => {
  it("needs the token and the ad account; the app secret adds appsecret_proof; the token never goes in a URL", () => {
    expect(metaAdsConfig({})).toEqual({ ok: false, missing: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] });
    expect(metaAdsConfig({ META_ADS_ACCESS_TOKEN: "t", META_AD_ACCOUNT_ID: "act_12x" })).toEqual({ ok: false, missing: ["META_AD_ACCOUNT_ID"] });
    const setup = metaAdsConfig({ ...META_ENV, META_APP_SECRET: "s3cret" });
    expect(setup.ok && setup.config).toMatchObject({ accountId: "act_123456789", version: "v21.0" });
    if (!setup.ok) return;
    const url = graphUrl(setup.config, "act_123456789", { fields: "id" });
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v21\.0\/act_123456789\?fields=id&appsecret_proof=[0-9a-f]{64}$/);
    expect(url).not.toContain("EAAtesttoken");
  });

  it("the account: its currency and time zone (the days of every number)", () => {
    expect(parseAccount(fixture("account"), "act_1")).toEqual({ id: "act_123456789", name: "Credalti Ads", currency: "USD", timeZone: "America/Chicago", status: "active", statusCode: 1 });
    expect(parseAccount({ account_status: 3, timezone_name: "Not/AZone", currency: "usd" }, "act_9")).toMatchObject({ id: "act_9", status: "unsettled", timeZone: "America/Chicago", currency: "USD" });
  });

  it("what a result is, from the ad set's goal, as Ads Manager counts it", () => {
    expect(resultOf("CONVERSATIONS", null)).toEqual({ action: "onsite_conversion.messaging_conversation_started_7d", kind: "conversations" });
    expect(resultOf("LEAD_GENERATION", null).kind).toBe("leads_form");
    expect(resultOf("OFFSITE_CONVERSIONS", { custom_event_type: "LEAD" })).toEqual({ action: "offsite_conversion.fb_pixel_lead", kind: "website_leads" });
    expect(resultOf("LINK_CLICKS", null).kind).toBe("link_clicks");
    expect(resultOf("REACH", null)).toEqual({ action: null, kind: "results" });
    expect(resultsOf([{ action_type: "lead", value: "3" }], "lead")).toBe(3);
    expect(resultsOf(undefined, "lead")).toBe(0);
    expect(resultsOf([{ action_type: "onsite_conversion.lead_grouped", value: "2" }], null)).toBe(2);
    expect(resultsOf([{ action_type: "video_view", value: "99" }], null)).toBeNull();
  });

  it("campaigns, ad sets and ads: ids checked, text cleaned, links https only, the creative from any of Meta's shapes", () => {
    const [first] = (fixture("campaigns-1") as { data: unknown[] }).data.map(parseCampaign);
    expect(first).toMatchObject({ id: "120200000000000001", specialAdCategories: ["FINANCIAL_PRODUCTS_SERVICES"], dailyBudgetCents: 10_000 });
    const second = (fixture("campaigns-2") as { data: unknown[] }).data.map(parseCampaign);
    expect(second[0]).toMatchObject({ status: "PAUSED", lifetimeBudgetCents: 50_000, specialAdCategories: [] });
    expect(second[1]).toBeNull();
    const sets = (fixture("adsets") as { data: unknown[] }).data.map(parseAdSet);
    expect(sets.map((s) => s?.resultKind)).toEqual(["conversations", "link_clicks", "website_leads"]);
    const ads = (fixture("ads") as { data: unknown[] }).data.map(parseAd);
    expect(ads[0]!.creative).toEqual({
      title: "Tus derechos, en tu idioma",
      body: expect.stringContaining("Los resultados varían."),
      thumbnailUrl: "https://scontent.xx.fbcdn.net/v/t45.1600-4/thumb1.jpg",
      imageUrl: null,
      videoId: "400000000000001",
      callToAction: "WHATSAPP_MESSAGE",
      link: null,
    });
    expect(ads[0]!.previewUrl).toBe("https://fb.me/adspreview/abc123");
    // A javascript: link is dropped; the story's picture and link are used instead.
    expect(ads[1]!.creative).toMatchObject({ imageUrl: "https://scontent.xx.fbcdn.net/v/pic2.jpg", callToAction: "LEARN_MORE", link: expect.stringMatching(/^https:\/\/credalti\.com\/registro/) });
    // A dynamic creative: its first asset.
    expect(ads[2]!.creative).toMatchObject({ title: "Cómo funciona", videoId: "400000000000003", callToAction: "LEARN_MORE", link: "https://credalti.com/registro" });
    expect(parseCreative({ body: "<b>hi</b>\u0000 there" }).body).toBe("b hi /b there");
  });

  it("insights per ad per day: spend in cents, link clicks, Meta's results for the ad set's goal", () => {
    const sets = (fixture("adsets") as { data: unknown[] }).data.map(parseAdSet).filter((s): s is AdSet => s !== null);
    const actions = new Map(sets.map((s) => [s.id, s.resultAction]));
    const rows = (fixture("insights") as { data: unknown[] }).data.map((r) => parseInsight(r, actions));
    expect(rows[0]).toEqual({ adId: "120200000000000101", adsetId: "120200000000000011", campaignId: "120200000000000001", day: "2026-11-23", spendCents: 4025, impressions: 2310, clicks: 41, results: 5 });
    expect(rows[1]!.results).toBe(0);
    expect(rows[2]!.results).toBe(12);
    expect(rows[3]).toMatchObject({ spendCents: 2100, clicks: 30, results: 2 });
    // An ad set we did not see: the first lead action.
    expect(rows[4]!.results).toBe(1);
    expect(rows[5]).toBeNull();
    expect(unitsToCents("0.005")).toBe(1);
    expect(unitsToCents("-3")).toBe(0);
  });

  it("reads with GETs only, the token in the header, Meta's own next pages only", async () => {
    const setup = metaAdsConfig(META_ENV);
    if (!setup.ok) throw new Error("config");
    const meta = fakeMeta();
    const account = await readAccount(setup.config, meta.http);
    expect(account.timeZone).toBe("America/Chicago");
    const structure = await readStructure(setup.config, meta.http);
    expect(structure.campaigns.map((c) => c.id)).toEqual(["120200000000000001", "120200000000000002"]);
    expect(structure.ads).toHaveLength(3);
    const days = await readInsights(setup.config, meta.http, { since: "2026-11-19", until: "2026-11-25" }, structure.adsets);
    expect(days).toHaveLength(5);
    const video = await readVideo(setup.config, meta.http, "400000000000001");
    expect(video.src).toBe("https://video.xx.fbcdn.net/v/clip1.mp4");
    expect(meta.calls.every((c) => c.method === "GET")).toBe(true);
    expect(meta.calls.every((c) => c.authorization === "Bearer EAAtesttoken" && !c.url.includes("EAAtesttoken"))).toBe(true);
    // The second campaigns page pointed off Meta: never followed.
    expect(meta.calls.some((c) => c.url.includes("evil.example.com"))).toBe(false);
    const insights = meta.calls.find((c) => c.url.includes("/insights"))!;
    expect(new URL(insights.url).searchParams.get("time_range")).toBe(JSON.stringify({ since: "2026-11-19", until: "2026-11-25" }));
    expect(new URL(insights.url).searchParams.get("time_increment")).toBe("1");
  });

  it("an expired token is an auth error, with Meta's words", async () => {
    const setup = metaAdsConfig(META_ENV);
    if (!setup.ok) throw new Error("config");
    const err = await readAccount(setup.config, fakeMeta({ failWith: "error-token" }).http).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaAdsError);
    expect((err as MetaAdsError).kind).toBe("auth");
    expect((err as MetaAdsError).message).toMatch(/Session has expired/);
  });
});

// ── The window ──────────────────────────────────────────────────────────

describe("ads: the dates, in the ad account's time zone", () => {
  it("presets end on the account's today; custom ranges are checked", () => {
    // 18:00 UTC is noon in Chicago but already the next day in Tokyo.
    expect(dayInZone(new Date("2026-11-25T23:30:00Z"), "America/Chicago")).toBe("2026-11-25");
    expect(dayInZone(new Date("2026-11-25T23:30:00Z"), "Asia/Tokyo")).toBe("2026-11-26");
    expect(adWindow({ preset: 7 }, NOW, "America/Chicago")).toEqual({ since: "2026-11-19", until: "2026-11-25", days: 7, preset: 7 });
    expect(adWindow({ preset: "90" }, NOW, "America/Chicago")).toMatchObject({ since: "2026-08-28", days: 90 });
    expect(adWindow({ preset: "custom", since: "2026-11-01", until: "2026-11-10" }, NOW, "America/Chicago")).toEqual({ since: "2026-11-01", until: "2026-11-10", days: 10, preset: "custom" });
    // In the future, backwards, not a day, or too long: the last 7 days.
    for (const bad of [{ since: "2026-11-20", until: "2026-11-30" }, { since: "2026-11-10", until: "2026-11-01" }, { since: "2026-02-30", until: "2026-03-01" }, { since: "2024-01-01", until: "2026-11-01" }]) {
      expect(adWindow({ preset: "custom", ...bad }, NOW, "America/Chicago").preset).toBe(7);
    }
  });
});

// ── The report ──────────────────────────────────────────────────────────

describe("ads: the report on the sample account", () => {
  const { snapshot, leads } = buildDemoAds(NOW);
  const report = (preset: 7 | 30 | 90) => buildReport(snapshot, leads, adWindow({ preset }, NOW, "America/Chicago"));

  it("the sample is deterministic and labelled by its account", () => {
    expect(buildDemoAds(NOW).snapshot.days).toEqual(snapshot.days);
    expect(snapshot.account!.name).toMatch(/sample/);
  });

  it("totals are the sum of the ads' days; Credalti's leads include the ones from Meta with no known ad", () => {
    const r = report(30);
    const days = snapshot.days.filter((d) => d.day >= r.window.since && d.day <= r.window.until);
    expect(r.totals.spendCents).toBe(days.reduce((a, d) => a + d.spendCents, 0));
    const fromAds = [...r.leadsByAd.values()].reduce((a, l) => a + l.length, 0);
    expect(r.totals.leads).toBeGreaterThan(fromAds);
    expect(r.totals.metaUnknownLeads).toBeGreaterThan(0);
    expect(r.totals.costPerLeadCents).toBe(Math.round(r.totals.spendCents / r.totals.leads));
  });

  it("the tree: campaigns → ad sets → ads, each campaign's spend the sum of its days", () => {
    const r = report(30);
    for (const c of r.campaigns) {
      const spend = snapshot.days.filter((d) => d.campaignId === c.campaign.id && d.day >= r.window.since && d.day <= r.window.until).reduce((a, d) => a + d.spendCents, 0);
      expect(c.metrics.spendCents).toBe(spend);
      for (const s of c.adsets) for (const a of s.ads) expect(a.ad.adsetId).toBe(s.adset.id);
    }
    // The retargeting campaign is on without the credit category: flagged.
    expect(r.missingCategory.map((c) => c.name)).toEqual(["Retargeting · Site visitors"]);
    expect(r.campaigns.find((c) => c.campaign.name.startsWith("Retargeting"))!.specialCategory).toBe(false);
    expect(CREDIT_CATEGORIES).toContain("FINANCIAL_PRODUCTS_SERVICES");
  });

  it("a click goal's results never judge an ad: Credalti's leads do", () => {
    const r = report(30);
    const clicks = r.ads.find((a) => a.resultKind === "link_clicks")!;
    expect(clicks.metrics.results).toBeGreaterThan(100);
    expect(clicks.verdict.basis).toBe("credalti");
  });

  it("winners first; an ad marked Turn off that is still on and spending needs a person", () => {
    const r = report(7);
    expect(r.ads[0]!.verdict.verdict).toBe("winner");
    expect(r.winners.every((w) => w.verdict.verdict === "winner" || w.verdict.verdict === "good")).toBe(true);
    expect(r.needsYou.map((a) => a.ad.name)).toEqual(["Myth: checking hurts · carousel"]);
    // The paused one that was turned off already is not "still spending".
    const paused = report(30).ads.find((a) => a.ad.status === "PAUSED" && a.verdict.verdict === "turn_off")!;
    expect(paused.stillSpending).toBe(false);
    expect(paused.needsYou).toBe(false);
    // An archived ad with nothing in the window is not listed.
    expect(r.ads.some((a) => a.ad.status === "ARCHIVED")).toBe(false);
    expect(adsSummary(r, { connected: false, sample: true, syncedAt: null })).toMatchObject({ turnOff: 1, spend7dCents: r.totals.spendCents, sample: true });
    expect(adsSummary(null, { connected: false, sample: false, syncedAt: null })).toMatchObject({ spend7dCents: null, turnOff: null });
  });

  it("what to make next: counts from the winners, nothing said with fewer than two", () => {
    const r = report(30);
    const codes = r.next.map((n) => n.code);
    expect(codes).toContain("format");
    expect(codes).toContain("language");
    const format = r.next.find((n) => n.code === "format");
    expect(format).toMatchObject({ format: "video" });
    expect(whatToMakeNext(r.ads.filter((a) => a.verdict.verdict !== "winner" && a.verdict.verdict !== "good"))).toEqual([{ code: "too_few", winners: 0, need: 2 }]);
  });

  it("spend per month for the books", () => {
    const months = spendByMonth(snapshot.days);
    expect([...months.values()].reduce((a, b) => a + b, 0)).toBe(snapshot.days.reduce((a, d) => a + d.spendCents, 0));
  });

  it("an empty account reads as nothing, never as zeros that look like results", () => {
    const empty: AdsSnapshot = { platform: "meta", account: null, campaigns: [], adsets: [], ads: [], days: [], syncedAt: null, lastRun: null };
    const r = buildReport(empty, [], adWindow({ preset: 7 }, NOW, "America/Chicago"));
    expect(r.totals.costPerResultCents).toBeNull();
    expect(r.totals.costPerLeadCents).toBeNull();
    expect(r.totals.results).toBeNull();
    expect(r.ads).toEqual([]);
  });
});

// ── Alti's ad copy ──────────────────────────────────────────────────────

describe("ads: Alti's ad copy, checked against the claim rules and the credit ad checklist", () => {
  const request: AdCopyRequest = { angle: "Your rights under the FCRA", format: "video", goal: "whatsapp", language: "both" };

  it("every template passes every check, in both languages, for every format and goal", () => {
    for (const t of AD_TEMPLATES) {
      for (const format of ["video", "image", "carousel"] as const) {
        for (const goal of ["whatsapp", "website", "form"] as const) {
          const draft = templateAdDraft({ angle: t.id, format, goal, language: "both" });
          const blocking = checkAdDraft(draft, "both").filter((i) => i.severity === "block");
          expect(blocking.map((i) => `${t.id}/${format}: ${i.id} “${i.match}”`)).toEqual([]);
        }
      }
    }
  });

  it("refuses targeting assumptions, personal attributes, promises, “free”, scores, prices and pressure", () => {
    const rules = (text: string, lang: "en" | "es" = "en") => checkAdText(text, "caption", lang).map((i) => i.rule);
    expect(rules("Are you over 50? We help seniors.")).toContain("ad-targeting");
    expect(rules("For single moms in 78701.")).toContain("ad-targeting");
    expect(rules("Para mamás y mayores de 60.", "es")).toContain("ad-targeting");
    expect(rules("Do you have bad credit? Fix your bad credit.")).toContain("ad-personal-attribute");
    expect(rules("¿Tienes deudas? Arreglamos tu mal crédito.", "es")).toContain("ad-personal-attribute");
    expect(rules("Free consultation today")).toContain("no-free");
    expect(rules("We remove negative items. Guaranteed results.")).toEqual(expect.arrayContaining(["diy-positioning"]));
    expect(rules("Raise your score 100 points in 30 days")).toEqual(expect.arrayContaining(["no-points-in-days", "no-outcome-promise"]));
    expect(rules("Only $99 a month. Act now!")).toEqual(expect.arrayContaining(["no-price", "no-pressure"]));
    expect(rules("See your before and after")).toContain("no-score-visuals");
    expect(rules("Errors on a credit report can be disputed. Results vary.")).toEqual([]);
  });

  it("the checklist: what the code checked, and what a person checks in Ads Manager", () => {
    const good = adChecklist(checkAdDraft(templateAdDraft(request), "both"));
    expect(good.filter((i) => i.mode === "auto").every((i) => i.ok === true)).toBe(true);
    expect(good.filter((i) => i.mode === "person").map((i) => i.key)).toEqual(["special_category", "visual"]);
    const bad = templateAdDraft(request);
    bad.primaryText = { en: "Free help for women over 40 with bad credit.", es: "Ayuda para mujeres." };
    const list = adChecklist(checkAdDraft(bad, "both"));
    const ok = (key: string) => list.find((i) => i.key === key)!.ok;
    expect(ok("no_free")).toBe(false);
    expect(ok("no_targeting")).toBe(false);
    expect(ok("results_vary")).toBe(false);
  });

  it("without a key: a pre-checked template, a draft, and why", async () => {
    const out = await draftAdCopy(request, null);
    expect(out).toMatchObject({ source: "templates", draft: true, note: "not_configured", cta: "WHATSAPP_MESSAGE" });
    expect(out.hooks.at(-1)!.en).toMatch(/^Your rights under the FCRA/);
    expect(out.issues.filter((i) => i.severity === "block")).toEqual([]);
    const picture = await draftAdCopy({ ...request, format: "image", goal: "website" }, null);
    expect(picture.script).toEqual({ en: "", es: "" });
    expect(picture.cta).toBe("LEARN_MORE");
  });

  it("with a model: a draft that breaks a rule is written again once, with the reasons; a second failure keeps the issues", async () => {
    const clean = templateAdDraft(request);
    const promising = { ...clean, primaryText: { en: "We remove bad items, guaranteed. Free!", es: "Eliminamos todo. ¡Gratis!" } };
    const prompts: string[] = [];
    const caller = async ({ user }: { system: string; user: string }) => {
      prompts.push(user);
      return { output: prompts.length === 1 ? promising : clean, problem: null };
    };
    const out = await draftAdCopy(request, caller);
    expect(out.source).toBe("model");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/broke these rules/);
    expect(out.issues.filter((i) => i.severity === "block")).toEqual([]);

    const stubborn = await draftAdCopy(request, async () => ({ output: promising, problem: null }));
    expect(stubborn.issues.some((i) => i.rule === "no-free")).toBe(true);
    expect(stubborn.checklist.find((i) => i.key === "no_free")!.ok).toBe(false);
  });

  it("a refusal, an API error or bad JSON: the template, with the reason", async () => {
    expect((await draftAdCopy(request, async () => ({ output: null, problem: "refusal" }))).note).toBe("refusal");
    expect((await draftAdCopy(request, async () => ({ output: { hooks: [] }, problem: null }))).note).toBe("invalid_output");
    expect(parseAdCopy({ ...templateAdDraft(request), cta: "BUY_NOW" })).toBeNull();
  });
});

// ── The tags a link carries ─────────────────────────────────────────────

describe("ads: the tags an ad link carries, kept without anything personal", () => {
  it("reads utm_*, the Meta ids, and that a click id was there (never its value)", () => {
    const out = attributionFromSearch("?utm_source=facebook&utm_medium=paid&utm_campaign=120200000000000001&utm_content=Tus%20derechos&ad_id=120200000000000101&fbclid=IwAR0abc&email=a@b.co", NOW);
    expect(out).toEqual({
      utm: { source: "facebook", medium: "paid", campaign: "120200000000000001", content: "Tus derechos" },
      ad: { adId: "120200000000000101", fbclid: true, via: "link" },
      at: NOW.toISOString(),
    });
    expect(JSON.stringify(out)).not.toContain("IwAR0abc");
    expect(JSON.stringify(out)).not.toContain("a@b.co");
    expect(attributionFromSearch("?ref=x", NOW)).toBeNull();
    expect(attributionFromSearch("?utm_source=<script>&ad_id=12ab", NOW)).toBeNull();
  });

  it("the server cleans what a browser sends again", () => {
    expect(sanitizeAttribution({ utm: { source: "facebook", evil: "x" }, ad: { adId: "999", fbclid: "IwAR", via: "ctwa" }, phone: "+1713" })).toEqual({ utm: { source: "facebook" }, ad: { adId: "999", via: "link" } });
    expect(sanitizeAttribution("nope")).toBeNull();
    expect(sanitizeAttribution({ utm: { source: "a".repeat(200) } })).toBeNull();
  });

  it("first touch for 28 days", () => {
    expect(isFresh({ at: new Date(NOW.getTime() - 27 * 86_400_000).toISOString() }, NOW)).toBe(true);
    expect(isFresh({ at: new Date(NOW.getTime() - 29 * 86_400_000).toISOString() }, NOW)).toBe(false);
    expect(isFresh(null, NOW)).toBe(false);
  });

  it("every way in carries the ad: the signup's first call, the WhatsApp referral, a HighLevel form", () => {
    expect(readFileSync("src/components/signup/SignupChat.tsx", "utf8")).toMatch(/readAttribution\(\)/);
    expect(readFileSync("src/app/api/signup/route.ts", "utf8")).toMatch(/sanitizeAttribution\(input\.attribution\)/);
    expect(readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8")).toMatch(/source_type === "ad"/);
    expect(readFileSync("src/app/layout.tsx", "utf8")).toMatch(/<AttributionCapture \/>/);
  });
});

// ── The books ───────────────────────────────────────────────────────────

describe("ads: spend and the books (a reconciliation suggestion, never an entry)", () => {
  const expense = (spentOn: string, amountCents: number, category = "advertising_meta", voidedAt: string | null = null) => ({ spentOn, amountCents, category: category as "advertising_meta", voidedAt });

  it("Meta's spend beside Advertising: Meta, month by month", () => {
    const monthly = new Map([
      ["2026-09", 100_000],
      ["2026-10", 120_000],
      ["2026-11", 50_000],
    ]);
    const expenses = [expense("2026-09-30", 99_800), expense("2026-10-15", 60_000), expense("2026-10-20", 1_000, "software"), expense("2026-11-02", 70_000), expense("2026-11-03", 9_999, "advertising_meta", "2026-11-04T00:00:00Z")];
    const checks = adSpendChecks(monthly, expenses, ["2026-09", "2026-10", "2026-11", "2026-08"]);
    expect(checks.map((c) => [c.month, c.status, c.differenceCents])).toEqual([
      ["2026-11", "books_high", -20_000],
      ["2026-10", "books_low", 60_000],
      ["2026-09", "match", 200],
      ["2026-08", "no_spend", 0],
    ]);
    expect(tolerance(10_000)).toBe(500);
    expect(tolerance(100_000)).toBe(2_000);
  });

  it("the Ads Manager never writes to the books", () => {
    for (const file of ["src/lib/ads/books.ts", "src/lib/ads/server.ts", "src/app/api/staff/ads/route.ts", "src/app/api/cron/ads/route.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from\("expenses"\)|\.from\('expenses'\)/);
    }
  });
});

// ── Who may see what, and where it lives ────────────────────────────────

describe("ads: permissions, navigation and Ask Alti", () => {
  it("the numbers are administrators' (spend is money); ad copy is the content team's; sales has neither", () => {
    expect(rolesThatCan("ads.view")).toEqual(["admin"]);
    expect(rolesThatCan("ads.draft")).toEqual(["admin", "specialist"]);
    expect(can("sales", "ads.view") || can("sales", "ads.draft")).toBe(false);
    expect(deniedReason("ads.view", "en")).toBe("Only an administrator can see the ads: spend, results and leads per ad.");
    expect(deniedReason("ads.draft", "es")).toMatch(/^Solo un administrador o un especialista puede/);
  });

  it("Ads sits in section 2, now «Marketing», right after Content", () => {
    const group = NAV_GROUPS.find((g) => g.key === "content")!;
    expect(group.number).toBe("2");
    expect(group.hrefs.indexOf("/equipo/anuncios")).toBe(group.hrefs.indexOf("/equipo/contenido") + 1);
    expect(groupOfPath("/equipo/anuncios").key).toBe("content");
    expect(NAV_BY_HREF.get("/equipo/anuncios")).toMatchObject({ label: "ads", needs: "ads.draft" });
    expect(SHELL_TEXT.en.groups.content).toBe("Marketing");
    expect(SHELL_TEXT.es.groups.content).toBe("Mercadeo");
    expect(SHELL_TEXT.en.nav.ads).toBe("Ads");
  });

  it("Ask Alti explains the screen and lists the ad copy drafts for those who may use them", () => {
    expect(helpForPath("/equipo/anuncios", "en").title).toBe("Ads");
    expect(helpForPath("/equipo/anuncios", "es").title).toBe("Anuncios");
    const jobs = (role: "admin" | "specialist" | "sales") => altiJobs("content", (c) => can(role, c)).map((j) => j.id);
    expect(jobs("admin")).toContain("ad_copy");
    expect(jobs("specialist")).toContain("ad_copy");
    expect(jobs("sales")).not.toContain("ad_copy");
    expect(ALTI_HELP_TEXT.en.jobs.ad_copy.desc).toMatch(/nothing reaches Meta/);
  });

  it("nothing in the Ads Manager calls Meta with anything but GET, and the console never shows AltiBot", () => {
    const meta = readFileSync("src/lib/ads/meta.ts", "utf8");
    expect(meta).not.toMatch(/method:\s*"(POST|DELETE|PUT|PATCH)"/);
    for (const file of ["src/app/equipo/anuncios/page.tsx", "src/components/staff/ads/CopyStudio.tsx", "src/components/staff/ads/AdDrawer.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/AltiBot|altibot|character="cameo"/);
    }
    expect(readFileSync("src/components/staff/ads/CopyStudio.tsx", "utf8")).toMatch(/aiByline\(locale\)/);
  });

  it("the migration keeps every table under row level security, and the books untouched", () => {
    const sql = readFileSync("supabase/migrations/0037_ads.sql", "utf8");
    for (const table of ["ads_accounts", "ads_objects", "ads_insights_daily", "ads_sync_runs", "ads_briefs"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
    }
    expect(sql).not.toMatch(/for (insert|update|delete|all)/i);
    expect(sql).not.toMatch(/public\.expenses/);
    expect(readFileSync(".env.example", "utf8")).toMatch(/META_ADS_ACCESS_TOKEN=\n/);
  });
});
