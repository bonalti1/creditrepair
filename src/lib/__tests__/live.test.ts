import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { demoClientRawReport, DEMO_RAW_REPORT } from "../demo";
import { CONSENT_TEXT, LIVE_COPY, VIDEO_COPY } from "../live/copy";
import { demoReviews } from "../live/demo";
import { demoLeadFunnels } from "../live/demoFunnels";
import { cleanCampaign, DEFAULT_KEYWORDS, liveLink, matchKeyword, originFromParams, parseKeywords, plainWord, prefillText } from "../live/keywords";
import { buildOverview, mergeRaw, packageFit } from "../live/overview";
import { isPackageKey, OPTION_PARAM, PACKAGE_TEXT } from "../live/packages";
import { decideKeywordReply, funnelWordsProblem, keywordReplyText, REPLY_WINDOW_HOURS } from "../live/replies";
import { clock, reviewNeedsYou, type ReviewItem } from "../live/review";
import { hashToken, newToken, sniffVideo, startHref, TOKEN_PATTERN } from "../live/server";
import { sendFunnelSms, smsAllowed, smsFunnelEnabled, smsFunnelReady, SmsRefused, twilioSignature, verifyTwilioSignature } from "../live/sms";
import { countFunnelByCampaign, countFunnelStages, FUNNEL_STAGES, funnelStage, type FunnelRow } from "../live/stages";
import { renderVideoTemplate, VIDEO_TEMPLATE, videoMessage } from "../live/templates";
import { LIVE_TEXT } from "../live/text";
import { CRON_JOBS, NOT_FOR_LAUNCH, WHATSAPP_TEMPLATE_NAMES } from "../launch/checklist";
import { can, CAPABILITY_LABELS } from "../staff/permissions";
import { NAV_GROUPS } from "../staff/nav";
import { SCREEN_HELPS } from "../staff/playbook";
import { PRIVATE_PATHS } from "../site/routes";

// The live funnel (docs/LIVE-FUNNEL.md): the rules, the words and the
// invariants, without a database. The routes and row level security are in
// db/live.test.ts.

const NOW = new Date("2026-12-02T18:00:00.000Z"); // noon in Texas
const NIGHT = new Date("2026-12-03T08:00:00.000Z"); // 2 a.m. in Texas
const ago = (date: Date, minutes: number) => new Date(date.getTime() - minutes * 60_000).toISOString();

/** Every string in a value, functions called with sample arguments. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    try {
      const out = (value as (...a: unknown[]) => unknown)("Ana", "Ana");
      return typeof out === "string" ? [out] : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const FREE = /\bfree\b|gratis|gratuit/i;
const PROMISE = /\bwe('ll| will)? (remove|delete|fix|repair)\b|\b(eliminamos|borramos|quitamos|vamos a (quitar|borrar|eliminar))\b|guarantee|garantiz|\bpoints?\b|\bpuntos\b/i;

describe("keywords", () => {
  it("default to CREDIT, CREDITO and WEBINAR; a config names words and their campaigns; opt words never count", () => {
    expect(parseKeywords("").map((k) => k.word)).toEqual(["CREDIT", "CREDITO", "WEBINAR"]);
    expect(DEFAULT_KEYWORDS).toBe("CREDIT,CREDITO,WEBINAR");
    expect(parseKeywords("info=IG Nov, Crédito, LINK")).toEqual([
      { word: "INFO", campaign: "ig-nov", locale: null },
      { word: "CREDITO", campaign: null, locale: "es" },
      { word: "LINK", campaign: null, locale: null },
    ]);
    // STOP, BAJA, START, ALTA… are the opt-out and opt-in words: never a keyword.
    expect(parseKeywords("STOP,BAJA,START,ALTA,CANCELAR,CREDIT").map((k) => k.word)).toEqual(["CREDIT"]);
  });

  it("match a message that is the word alone, whatever the case, accents, punctuation or emoji", () => {
    const keywords = parseKeywords("");
    for (const text of ["CREDIT", "credit", " Credit! ", "credit 🙌", "Crédito", "CRÉDITO.", "webinar"]) expect(matchKeyword(text, keywords), text).not.toBeNull();
    for (const text of ["I need credit help", "credit please", "my credit", "creditos", "", "hola", "STOP"]) expect(matchKeyword(text, keywords), text).toBeNull();
    expect(matchKeyword("Crédito", keywords)!.keyword.locale).toBe("es");
  });

  it("take a #campaign tag after the word (what /live prefills), and nothing else", () => {
    const keywords = parseKeywords("CREDIT=default-camp");
    expect(matchKeyword("CREDIT", keywords)!.campaign).toBe("default-camp");
    expect(matchKeyword(prefillText("CREDIT", "webinar-nov"), keywords)!.campaign).toBe("webinar-nov");
    expect(matchKeyword("CREDIT nov", keywords)).toBeNull();
    expect(prefillText("CREDIT", null)).toBe("CREDIT");
    expect(plainWord("  Crédito!! ")).toBe("CREDITO");
    expect(cleanCampaign("Webinar Nov 26")).toBe("webinar-nov-26");
    expect(cleanCampaign("<script>")).toBe("script");
    expect(cleanCampaign("")).toBeNull();
  });

  it("read where a /live visitor came from, and build the reply's link", () => {
    const params = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    expect(originFromParams(params({ src: "webinar", kw: "credit", c: "webinar-nov" }))).toEqual({ tag: "webinar", platform: null, keyword: "CREDIT", campaign: "webinar-nov", src: "webinar" });
    expect(originFromParams(params({ src: "ig-comment", c: "nov" }))).toMatchObject({ tag: "comment", platform: "instagram" });
    expect(originFromParams(params({ src: "fb-ad" }))).toMatchObject({ tag: "ad", platform: "facebook" });
    expect(originFromParams(params({ src: "tiktok-bio" }))).toMatchObject({ tag: "bio", platform: "tiktok" });
    expect(originFromParams(params({}))).toMatchObject({ tag: "link", src: null, keyword: null });
    expect(liveLink("https://credalti.test/", { src: "whatsapp", keyword: "CREDIT", campaign: "webinar-nov", locale: "es" })).toBe("https://credalti.test/live?src=whatsapp&kw=credit&c=webinar-nov&lang=es");
  });
});

describe("the automatic keyword reply", () => {
  const base = { channel: "whatsapp" as const, isClient: false, optedOut: false, lastReplyAt: null, inboundAt: ago(NOW, 0), state: null, locale: "en" as const, link: "https://credalti.test/live?src=whatsapp&kw=credit", now: NOW };

  it("says it is AI, carries the link, says a person will answer and how to stop; in the person's language", () => {
    const en = decideKeywordReply(base);
    expect(en.action).toBe("send");
    const body = en.action === "send" ? en.body : "";
    expect(body.split("\n")[0]).toBe("🤖 Alti · AI assistant");
    expect(body).toContain(base.link);
    expect(body).toMatch(/A person on our team will also answer you right here/);
    expect(body).toMatch(/Reply STOP/);
    expect(body).toMatch(/at no cost/);
    const es = keywordReplyText("whatsapp", "es", base.link);
    expect(es.split("\n")[0]).toBe("🤖 Alti · Asistente con IA");
    expect(es).toMatch(/responde BAJA/);
    expect(keywordReplyText("sms", "en", base.link)).toMatch(/Reply STOP to opt out\.$/);
    for (const text of [body, es, keywordReplyText("sms", "en", base.link), keywordReplyText("sms", "es", base.link)]) {
      expect(funnelWordsProblem(text), text).toBeNull();
      expect(text).not.toMatch(FREE);
    }
  });

  it("never twice for the same person and keyword within the window; again after it", () => {
    expect(decideKeywordReply({ ...base, lastReplyAt: ago(NOW, 60) })).toEqual({ action: "skip", reason: "already_replied" });
    expect(decideKeywordReply({ ...base, lastReplyAt: ago(NOW, REPLY_WINDOW_HOURS * 60 - 1) })).toEqual({ action: "skip", reason: "already_replied" });
    expect(decideKeywordReply({ ...base, lastReplyAt: ago(NOW, REPLY_WINDOW_HOURS * 60 + 1) }).action).toBe("send");
    expect(REPLY_WINDOW_HOURS).toBe(168);
  });

  it("respects STOP, and leaves clients to their assistant", () => {
    expect(decideKeywordReply({ ...base, optedOut: true })).toEqual({ action: "skip", reason: "opted_out" });
    expect(decideKeywordReply({ ...base, isClient: true })).toEqual({ action: "skip", reason: "client" });
  });

  it("in quiet hours answers only a message the person just sent, as the lead greeting does", () => {
    expect(decideKeywordReply({ ...base, now: NIGHT, inboundAt: ago(NIGHT, 1) }).action).toBe("send");
    expect(decideKeywordReply({ ...base, now: NIGHT, inboundAt: ago(NIGHT, 30) })).toEqual({ action: "skip", reason: "quiet_hours" });
    // Outside quiet hours an older message still gets its reply.
    expect(decideKeywordReply({ ...base, inboundAt: ago(NOW, 30) }).action).toBe("send");
    // The greeting the keyword reply stands beside answers whatever the hour, too (no quiet-hours check there).
    expect(readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8")).not.toMatch(/isQuietHour/);
  });

  it("the webhook answers the keyword instead of the greeting, from the funnel's server code", () => {
    const route = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
    expect(route).toMatch(/keywordOf\(question\)/);
    expect(route).toMatch(/replyToKeyword\(/);
    expect(route.indexOf("replyToKeyword(")).toBeLessThan(route.indexOf("LEAD_GREETINGS[language]"));
    expect(route).not.toMatch(/twilio|sendFunnelSms/i);
  });
});

describe("the funnel's stages", () => {
  const row = (campaign: string | null, facts: Partial<FunnelRow>): FunnelRow => ({ campaign, keyword: "CREDIT", tag: "webinar", ...facts });

  it("are facts, the furthest reached: New → Reviewing report → Video sent → Watched → Started signup → Signed", () => {
    expect(FUNNEL_STAGES).toEqual(["new", "reviewing", "video_sent", "watched", "started", "signed"]);
    expect(funnelStage({})).toBe("new");
    expect(funnelStage({ formAt: "x" })).toBe("new");
    expect(funnelStage({ reportAt: "x" })).toBe("reviewing");
    expect(funnelStage({ reportAt: "x", videoSentAt: "x" })).toBe("video_sent");
    expect(funnelStage({ videoWatchedAt: "x" })).toBe("watched");
    expect(funnelStage({ startedAt: "x" })).toBe("started");
    expect(funnelStage({ startedAt: "x", signedAt: "x" })).toBe("signed");
  });

  it("count by campaign for the Webinars section: each lead counts at every stage it reached", () => {
    const rows = [row("webinar-nov", {}), row("webinar-nov", { reportAt: "x" }), row("webinar-nov", { reportAt: "x", videoSentAt: "x", videoWatchedAt: "x", startedAt: "x", signedAt: "x" }), row("ads-dec", { reportAt: "x" }), row(null, {})];
    expect(countFunnelStages(rows, { campaign: "webinar-nov" })).toEqual({ total: 3, new: 3, reviewing: 2, video_sent: 1, watched: 1, started: 1, signed: 1 });
    expect(countFunnelStages(rows)).toMatchObject({ total: 5, reviewing: 3 });
    expect(countFunnelStages(rows, { keyword: "OTHER" }).total).toBe(0);
    const by = countFunnelByCampaign(rows);
    expect(by.get("webinar-nov")!.total).toBe(3);
    expect(by.get("ads-dec")).toMatchObject({ total: 1, reviewing: 1, video_sent: 0 });
    expect(by.get("")!.total).toBe(1);
  });
});

describe("the review overview", () => {
  const raw = demoClientRawReport();
  const overview = buildOverview({ raw, goal: "mortgage", doubtful: 1, warnings: [], now: NOW });

  it("counts in plain words, an account on several bureaus once; and shows no score anywhere", () => {
    expect(overview.bureaus).toEqual(["equifax", "experian", "transunion"]);
    const tradelines = Object.values(raw.bureaus).reduce((n, s) => n + (s?.tradelines.length ?? 0), 0);
    expect(overview.counts.accounts).toBeGreaterThan(0);
    expect(overview.counts.accounts).toBeLessThan(tradelines);
    expect(overview.counts.collections).toBeGreaterThan(0);
    expect(overview.counts.inquiries).toBeGreaterThan(0);
    expect(overview.byBureau.equifax!.accounts).toBeGreaterThan(0);
    expect(JSON.stringify(overview)).not.toMatch(/"score"/i);
    expect(overview.doubtful).toBe(1);
  });

  it("lists the § 605 periods soonest first and what the data checks noticed, never a verdict", () => {
    expect(overview.timeLimits.length).toBeGreaterThan(0);
    const untils = overview.timeLimits.map((l) => l.until);
    expect(untils).toEqual([...untils].sort());
    expect(overview.checks.length).toBeGreaterThan(0);
    for (const check of overview.checks) {
      expect(check.explanation.en).not.toMatch(/\b(is|are) (wrong|inaccurate|incorrect)\b/i);
      expect(checkClaimGuardrails(check.explanation.en)).toEqual([]);
    }
  });

  it("suggests which package may fit, never decides: Complete for a home buyer or many items, DIY for a few", () => {
    expect(overview.fit.suggested).toBe("complete");
    expect(overview.fit.reasons).toContain("goal_home");
    const counts = { accounts: 3, openAccounts: 3, collections: 0, latePayments: 1, chargeOffs: 0, inquiries: 2, publicRecords: 0, personalInfo: 2 };
    expect(packageFit(counts, "card")).toEqual({ suggested: "diy", reasons: ["few_items"] });
    expect(packageFit({ ...counts, latePayments: 0 }, "general")).toEqual({ suggested: "either", reasons: ["no_negatives"] });
    expect(packageFit({ ...counts, publicRecords: 1 }, "card").suggested).toBe("complete");
  });

  it("merges one file per bureau, each bureau from the newest file, and drops the scores", () => {
    const eq = structuredClone(DEMO_RAW_REPORT);
    eq.bureaus = { equifax: eq.bureaus.equifax };
    const ex = structuredClone(DEMO_RAW_REPORT);
    ex.bureaus = { experian: ex.bureaus.experian };
    ex.pulledAt = "2026-07-05T00:00:00.000Z";
    const merged = mergeRaw([ex, eq])!;
    expect(Object.keys(merged.bureaus).sort()).toEqual(["equifax", "experian"]);
    expect(merged.pulledAt).toBe("2026-07-05T00:00:00.000Z");
    expect(Object.values(merged.bureaus).some((s) => s && "score" in s)).toBe(false);
    // The inputs are left as they were.
    expect(DEMO_RAW_REPORT.bureaus.equifax!.score).toBeDefined();
    expect(mergeRaw([])).toBeNull();
  });
});

describe("the words", () => {
  const all = [
    ...strings(LIVE_COPY),
    ...strings(VIDEO_COPY),
    ...strings(CONSENT_TEXT),
    ...strings(PACKAGE_TEXT),
    ...strings({ ...LIVE_TEXT.en, script: { steps: LIVE_TEXT.en.script.steps } }),
    ...strings({ ...LIVE_TEXT.es, script: { steps: LIVE_TEXT.es.script.steps } }),
    ...strings(VIDEO_TEMPLATE.body),
    renderVideoTemplate("en", ["Rosa", "Ana", "https://credalti.test/v/x"]),
    renderVideoTemplate("es", ["Rosa", "Ana", "https://credalti.test/v/x"]),
    videoMessage("en", { firstName: "Rosa", teammate: "Ana", link: "https://credalti.test/v/x" }),
    videoMessage("es", { firstName: null, teammate: "Ana", link: "https://credalti.test/v/x" }),
  ];

  it("every line passes the claim and advertising rules; never “free”; no promise; no outcome words", () => {
    expect(all.length).toBeGreaterThan(150);
    for (const line of all) {
      expect(checkMarketingCopy(line), line).toEqual([]);
      expect(line, line).not.toMatch(FREE);
      expect(line, line).not.toMatch(PROMISE);
    }
    // The «never» line of the script names what is never said, quoted: it is for the team, not the person.
    expect(LIVE_TEXT.en.script.never).toMatch(/Never: “we'll remove”/);
  });

  it("says the review is at no cost and annualcreditreport.com is the official site where the law lets them get reports", () => {
    expect(LIVE_COPY.en.sub).toMatch(/^At no cost\./);
    expect(LIVE_COPY.es.sub).toMatch(/^Sin costo\./);
    expect(LIVE_COPY.en.guide.intro).toMatch(/official site where the law lets you get your reports/);
    expect(LIVE_COPY.es.guide.intro).toMatch(/sitio oficial donde la ley te permite sacar tus reportes/);
    // The Social Security number is entered only on the official site, never sent to us; the form never asks.
    expect(LIVE_COPY.en.guide.steps.join(" ")).toMatch(/Enter it there only, never send it to us/);
    expect(LIVE_COPY.en.form.neverAsk).toMatch(/never ask for your Social Security number, your date of birth or a card number/);
  });

  it("names Alti as the AI assistant wherever he speaks", () => {
    expect(LIVE_COPY.en.altiTag).toBe("Alti · AI assistant");
    expect(LIVE_COPY.es.altiTag).toBe("Alti · Asistente con IA");
    expect(CONSENT_TEXT.en.report).toMatch(/Alti, an AI assistant, reads it first and a person reviews it/);
  });

  it("names both packages, Complete first, with who each is for and how each is charged (never “nothing is charged until the work is done”)", () => {
    expect(PACKAGE_TEXT.en.complete.name).toBe("Credalti Complete");
    expect(PACKAGE_TEXT.en.diy.name).toBe("Credalti DIY");
    expect(PACKAGE_TEXT.en.complete.who).toMatch(/busy, buying a home soon, or want it handled/);
    expect(PACKAGE_TEXT.en.diy.who).toMatch(/hands-on, on a tighter budget, or not in a rush/);
    expect(PACKAGE_TEXT.en.upgrade).toBe("Start with DIY, upgrade anytime and keep everything you've done.");
    expect(PACKAGE_TEXT.en.charges).toBe("With Complete, you're charged each month right after your letters are mailed; DIY is a simple monthly subscription.");
    const doc = readFileSync("docs/LIVE-FUNNEL.md", "utf8");
    expect(doc).toContain("send the word **CREDIT** to our");
    expect(doc).toContain("With Complete, you're\n> charged each month right after your letters are mailed; DIY is a simple\n> monthly subscription.");
    for (const file of ["docs/LIVE-FUNNEL.md", "src/lib/live/copy.ts", "src/lib/live/text.ts", "src/components/live/VideoView.tsx", "src/components/live/LiveContent.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/Nothing is charged until the work is done/i);
    }
    const view = readFileSync("src/components/live/VideoView.tsx", "utf8");
    expect(view.indexOf('"complete"')).toBeLessThan(view.indexOf('"diy"'));
  });

  it("the signup link carries the invitation and the chosen package (option=complete|diy)", () => {
    expect(OPTION_PARAM).toBe("option");
    expect(isPackageKey("complete") && isPackageKey("diy") && !isPackageKey("other")).toBe(true);
    const href = startHref({ firstName: "Rosa", goal: "mortgage", state: "TX", locale: "es", salesperson: "ana" }, "diy");
    expect(href).toBe("/onboarding?n=Rosa&g=mortgage&s=TX&r=ana&lang=es&option=diy");
    expect(startHref({ firstName: null, goal: null, state: null, locale: "en", salesperson: null }, "complete")).toBe("/onboarding?lang=en&option=complete");
  });
});

describe("SMS: off by default, and only for the funnel", () => {
  const on = { SMS_FUNNEL_ENABLED: "on", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+18325550100" };

  it("is off unless SMS_FUNNEL_ENABLED is on, and refuses to send while off", async () => {
    expect(smsFunnelEnabled({})).toBe(false);
    expect(smsFunnelEnabled({ SMS_FUNNEL_ENABLED: "" })).toBe(false);
    expect(smsFunnelReady({ ...on, TWILIO_AUTH_TOKEN: undefined })).toBe(false);
    expect(smsFunnelReady(on)).toBe(true);
    await expect(sendFunnelSms("+17135550142", "Credalti: link. Reply STOP to opt out.", { purpose: "keyword_reply", consent: { texted: true, formConsent: false } }, {})).rejects.toBeInstanceOf(SmsRefused);
  });

  it("sends only to a person who texted the keyword, or the video link to one who consented on /live; every text says STOP", async () => {
    expect(smsAllowed("keyword_reply", { texted: false, formConsent: true })).toBe(false);
    expect(smsAllowed("keyword_reply", { texted: true, formConsent: false })).toBe(true);
    expect(smsAllowed("video_link", { texted: false, formConsent: true })).toBe(true);
    expect(smsAllowed("video_link", { texted: false, formConsent: false })).toBe(false);
    const env = { SMS_FUNNEL_ENABLED: "on" };
    await expect(sendFunnelSms("+17135550142", "Hi there", { purpose: "keyword_reply", consent: { texted: true, formConsent: false } }, env)).rejects.toThrow(/STOP/);
    await expect(sendFunnelSms("+17135550142", "We'll remove it. Reply STOP to opt out.", { purpose: "keyword_reply", consent: { texted: true, formConsent: false } }, env)).rejects.toThrow(/guardrail/);
    await expect(sendFunnelSms("+447700900123", "x Reply STOP to opt out.", { purpose: "video_link", consent: { texted: true, formConsent: false } }, env)).rejects.toThrow(/US/);
    // On, allowed, but no Twilio keys: nothing goes out.
    expect(await sendFunnelSms("+17135550142", "Credalti: link. Reply STOP to opt out.", { purpose: "video_link", consent: { texted: false, formConsent: true } }, env)).toEqual({ sent: false, sid: null });
  });

  it("checks Twilio's signature in constant time", () => {
    const params = { From: "+17135550142", Body: "CREDIT", MessageSid: "SM1" };
    const sig = twilioSignature("https://app.test/api/webhooks/sms", params, "tok");
    expect(verifyTwilioSignature("https://app.test/api/webhooks/sms", params, sig, "tok")).toBe(true);
    expect(verifyTwilioSignature("https://app.test/api/webhooks/sms", { ...params, Body: "x" }, sig, "tok")).toBe(false);
    expect(verifyTwilioSignature("https://app.test/api/webhooks/sms", params, null, "tok")).toBe(false);
  });

  it("keeps every “never SMS” rule elsewhere: one adapter, in the funnel, imported only by the funnel", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? (n === "__tests__" ? [] : files(join(dir, n))) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
    const all = files("src");
    const twilio = all.filter((f) => /api\.twilio\.com/.test(readFileSync(f, "utf8")));
    expect(twilio).toEqual(["src/lib/live/sms.ts"]);
    const importers = all.filter((f) => /from "(\.\/|@\/lib\/live\/|\.\.\/live\/)sms"/.test(readFileSync(f, "utf8")));
    for (const f of importers) expect(f, f).toMatch(/^src\/(lib\/live|app\/api\/webhooks\/sms|app\/api\/staff\/live|app\/live)\//);
    expect(readdirSync("src/lib/integrations").some((f) => /sms|twilio/i.test(f))).toBe(false);
    for (const dir of ["src/lib/autopilot", "src/lib/leads", "src/lib/billing", "src/lib/fulfillment"]) for (const f of files(dir)) expect(readFileSync(f, "utf8"), f).not.toMatch(/live\/sms|sendFunnelSms/);
    // The database: the record of replies takes WhatsApp or SMS; lead_auto_messages stays WhatsApp only.
    const sql = readFileSync("supabase/migrations/0043_live_funnel.sql", "utf8");
    expect(sql).toMatch(/channel text not null check \(channel in \('whatsapp', 'sms'\)\)/);
    expect(sql).not.toMatch(/lead_auto_messages|outbound_messages|message_opt_outs.*sms/);
  });
});

describe("the video link and the review queue", () => {
  it("links are random tokens; only their hash is kept", () => {
    const token = newToken();
    expect(token).toMatch(TOKEN_PATTERN);
    expect(newToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it("knows a recording by its first bytes", () => {
    expect(sniffVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe("video/webm");
    expect(sniffVideo(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe("video/mp4");
    expect(sniffVideo(new TextEncoder().encode("<html>"))).toBeNull();
    expect(clock(166)).toBe("2:46");
  });

  it("a review needs a person when it is ready with no video, or signed and not imported", () => {
    const items = demoReviews(NOW);
    expect(items.every((i) => i.sample)).toBe(true);
    const needs = items.filter(reviewNeedsYou).map((i) => i.id);
    expect(needs).toEqual(["demo-review-rosa"]);
    const signed: ReviewItem = { ...items[1]!, signed: true, simulated: false, importedAt: null };
    expect(reviewNeedsYou(signed)).toBe(true);
    expect(reviewNeedsYou({ ...signed, importedAt: NOW.toISOString() })).toBe(false);
    // The demo's funnel lines match its sample reviews.
    const funnels = demoLeadFunnels(NOW);
    for (const item of items) expect(funnels[item.leadId]?.stage === "new" ? "new" : "ok").toBe("ok");
  });

  it("the video page shows only the video: it imports no overview, no report and no other lead", () => {
    for (const file of ["src/components/live/VideoView.tsx", "src/app/v/[token]/page.tsx"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/overview|ReviewOverview|report_items|live_reviews|raw\b/);
      expect(text, file).not.toMatch(/strokeDasharray|conic-gradient|ScoreRing/);
    }
    expect(readFileSync("src/app/v/[token]/page.tsx", "utf8")).toMatch(/index: false/);
    expect(PRIVATE_PATHS).toEqual(expect.arrayContaining(["/v/", "/live"]));
  });
});

describe("the console and launch", () => {
  it("reviews.video is for administrators and specialists; sales sees the stage, never the report", () => {
    expect(can("admin", "reviews.video")).toBe(true);
    expect(can("specialist", "reviews.video")).toBe(true);
    expect(can("sales", "reviews.video")).toBe(false);
    expect(CAPABILITY_LABELS.en["reviews.video"]).toMatch(/record their personal video/);
    expect(NAV_GROUPS.find((g) => g.key === "leads")!.hrefs).toContain("/equipo/revisiones");
    for (const locale of ["en", "es"] as const) expect(SCREEN_HELPS[locale]["/equipo/revisiones"]!.steps.length).toBeGreaterThan(3);
  });

  it("the retention job is a required scheduled job; the template and the new settings are listed", () => {
    expect(CRON_JOBS.find((j) => j.job === "live")).toMatchObject({ path: "/api/cron/live", workflow: 13, needed: "required" });
    expect(WHATSAPP_TEMPLATE_NAMES).toContain(VIDEO_TEMPLATE.name);
    for (const key of ["LIVE_KEYWORDS", "SMS_FUNNEL_ENABLED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) expect(NOT_FOR_LAUNCH[key], key).toBeTruthy();
    expect(readFileSync(".env.example", "utf8")).toMatch(/^SMS_FUNNEL_ENABLED=$/m);
  });

  it("the /live page uses the website's look with Alti, labelled, and never asks for SSN, birth date or a card", () => {
    const page = readFileSync("src/components/live/LiveContent.tsx", "utf8");
    expect(page).toMatch(/AltiWaveLoop/);
    expect(page).toMatch(/c\.altiTag/);
    expect(page).not.toMatch(/name="ssn"|id="live-ssn"|date-of-birth|cc-number|autoComplete="bday"/);
    expect(page).not.toMatch(/altibot|"cameo"/i);
    expect(page.replace(/^\s*\/\/.*$/gm, "")).not.toMatch(FREE);
  });
});
