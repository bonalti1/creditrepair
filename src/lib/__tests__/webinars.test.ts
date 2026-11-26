import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChannelAvailability } from "../autopilot/types";
import type { BillingCharge } from "../billing/types";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { checkText } from "../content/check";
import { collectSignals, WEBINARS_SIGNAL_ID, type WebinarsSignalInput } from "../ideas/signals";
import { WHATSAPP_TEMPLATE_NAMES, CRON_JOBS, MIGRATION_SENTINELS } from "../launch/checklist";
import { altiPaused, bylineOf, LIVE_CHAT_COPY, redactPersonText, systemLine } from "../signup/liveChat";
import { altiLiveReply } from "../signup/liveChatAlti";
import { sampleLiveChats } from "../signup/liveChatDemo";
import { checkStaffReply } from "../staff/conversation";
import { groupOfPath, NAV_BY_HREF, NAV_GROUPS } from "../staff/nav";
import { can, rolesThatCan } from "../staff/permissions";
import { helpForPath } from "../staff/playbook";
import type { StaffClient } from "../staff/types";
import { matchAttendance, readAttendees } from "../webinars/attendance";
import { webinarCopyProblems } from "../webinars/check";
import { demoAdDays, demoCampaigns, demoCosts, demoFunnelLeads, demoRegistrations, demoReportClients, demoValues, demoWebinars } from "../webinars/demo";
import { leadFromWebinar, leadTags, liveCounters, type FunnelLead } from "../webinars/live";
import { normalizeOption, packageOf, upgradesOf } from "../webinars/packages";
import { REMINDERS_CONSENT, WEBINAR_PUBLIC_COPY } from "../webinars/publicCopy";
import { cleanRegistration, servedFor, type RegisterBody } from "../webinars/register";
import { fillTemplate, kindDueAt, planReminder, reminderWindow, sampleReminderTexts, WEBINAR_TEMPLATE_NAMES, WEBINAR_TEMPLATES, type ReminderContext } from "../webinars/reminders";
import { buildScorecard, cacFigure, MIN_SIGNED_FOR_CAC, type ClientValueFacts, type ScorecardInput } from "../webinars/scorecard";
import { allScriptLines, moderatorMessages, packagePrices, PRICE_PLACEHOLDER, runOfShow, type ScriptVars } from "../webinars/scripts";
import { isoToTexas, phaseOf, texasToIso, TEXAS_TZ } from "../webinars/time";
import { REMINDER_KINDS, type Campaign, type Registration, type Webinar } from "../webinars/types";
import { verifyWebinarUnsubscribe, webinarUnsubscribeToken, webinarUnsubscribeUrl } from "../webinars/unsubscribe";
import { clientValueFacts } from "../webinars/value";
import { scorecardsFor, summarize, webinarsSignal, nextWebinar } from "../webinars/views";
import { dayInZone } from "../ads/window";

// Webinars, the campaign scorecard and a person in Alti's signup chat
// (docs/WEBINARS.md, docs/SIGNUP-CHAT.md), without a database: who may do
// what, the reminders' schedule and rules (consent, quiet hours, opt-out,
// dedupe, never SMS), every word a prospect reads, the scripts, attendance,
// the CAC formulas and the threshold, client value from the money rule,
// packages and upgrades, the chat's pause, and the Ideas center's numbers.
// The database side is db/webinars.test.ts.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A Thursday 7 p.m. in Texas (CST, UTC−6): 2026-12-11T01:00Z.
const START = texasToIso("2026-12-10", "19:00")!;
const S = Date.parse(START);

function webinar(over: Partial<Webinar> = {}): Webinar {
  return {
    id: "w1",
    slug: "reporte-explicado",
    title: { en: "Your credit report, explained", es: "Tu reporte de crédito, explicado" },
    host: "Daniela Ruiz",
    startsAt: START,
    durationMinutes: 45,
    language: "es",
    topic: "",
    campaignTag: "webinar-test-1",
    keyword: "CREDIT",
    links: { zoom: "https://zoom.us/j/1" },
    replayUrl: null,
    status: "published",
    campaignId: "c1",
    createdAt: new Date(S - 20 * DAY).toISOString(),
    createdBy: "Carmen",
    ...over,
  };
}

function reg(over: Partial<Registration> = {}): Registration {
  return {
    id: "r1",
    webinarId: "w1",
    firstName: "Rosa",
    lastName: "Martínez",
    phone: "+17135550142",
    email: "rosa@example.com",
    state: "TX",
    served: "texas",
    locale: "es",
    goal: "home",
    timeline: "months_6",
    question: null,
    remindersConsent: true,
    optedOutAt: null,
    attended: false,
    attendedMinutes: null,
    attendanceSource: null,
    createdAt: new Date(S - 10 * DAY).toISOString(),
    attribution: null,
    ...over,
  };
}

const CHANNELS: ChannelAvailability = { whatsapp: true, email: true, approvedTemplates: WEBINAR_TEMPLATE_NAMES, simulated: false };
const LINKS = { page: "https://credalti.com/webinar/reporte-explicado?lang=es", signup: "https://credalti.com/registro?utm_source=webinar" };
const ctx = (now: number, over: Partial<ReminderContext> = {}): ReminderContext => ({ now: new Date(now), optedOut: false, written: new Set(), signedUp: false, channels: CHANNELS, emailReady: true, ...over });

describe("webinars: who may do what, and where it lives", () => {
  it("every role sees the webinars; only an administrator creates them and sees the campaigns' money", () => {
    expect(rolesThatCan("webinars.view")).toEqual(["admin", "specialist", "sales"]);
    expect(rolesThatCan("webinars.manage")).toEqual(["admin"]);
    expect(rolesThatCan("campaigns.view")).toEqual(["admin"]);
    // The live chats are lead work: administrators and sales.
    expect(can("specialist", "leads.work")).toBe(false);
    expect(can("sales", "leads.work")).toBe(true);
  });

  it("sits in Marketing after Ads and before SEO; the live chats in Lead Manager", () => {
    const content = NAV_GROUPS.find((g) => g.key === "content")!.hrefs;
    expect(content.indexOf("/equipo/webinars")).toBe(content.indexOf("/equipo/anuncios") + 1);
    expect(content.indexOf("/equipo/seo")).toBe(content.indexOf("/equipo/webinars") + 1);
    expect(NAV_BY_HREF.get("/equipo/webinars")).toMatchObject({ label: "webinars", needs: "webinars.view" });
    expect(groupOfPath("/equipo/webinars/abc/en-vivo").key).toBe("content");
    expect(NAV_GROUPS.find((g) => g.key === "leads")!.hrefs).toEqual(["/equipo/leads", "/equipo/revisiones", "/equipo/chats", "/equipo/invitar"]);
    expect(NAV_BY_HREF.get("/equipo/chats")).toMatchObject({ needs: "leads.work" });
    expect(helpForPath("/equipo/webinars/abc/guion", "en").title).toBe("Webinars");
    expect(helpForPath("/equipo/chats", "es").title).toBe("Chats en vivo");
  });

  it("the cron is a launch job with its workflow, and the migration has its sentinel", () => {
    expect(CRON_JOBS.find((j) => j.job === "webinars")).toMatchObject({ path: "/api/cron/webinars", workflow: 14 });
    expect(MIGRATION_SENTINELS["0044_webinars"]).toEqual({ table: "signup_chat_messages" });
    for (const name of WEBINAR_TEMPLATE_NAMES) expect(WHATSAPP_TEMPLATE_NAMES).toContain(name);
  });
});

describe("webinars: Texas time", () => {
  it("enters and shows the start on Texas's clock", () => {
    expect(START).toBe("2026-12-11T01:00:00.000Z");
    expect(isoToTexas(START)).toEqual({ day: "2026-12-10", time: "19:00" });
    expect(texasToIso("2026-07-10", "19:00")).toBe("2026-07-11T00:00:00.000Z");
    expect(texasToIso("not a day", "19:00")).toBeNull();
  });

  it("a webinar is a draft, upcoming, live from its start to its end, ended, or cancelled", () => {
    const w = webinar();
    expect(phaseOf({ ...w, status: "draft" }, new Date(S))).toBe("draft");
    expect(phaseOf(w, new Date(S - 1))).toBe("upcoming");
    expect(phaseOf(w, new Date(S + 44 * 60_000))).toBe("live");
    expect(phaseOf(w, new Date(S + 45 * 60_000))).toBe("ended");
    expect(phaseOf({ ...w, status: "cancelled" }, new Date(S - DAY))).toBe("cancelled");
  });
});

describe("webinars: the reminders", () => {
  const w = webinar({ replayUrl: "https://youtube.com/watch?v=x" });

  it("the windows never overlap, in order, and stop after day 5", () => {
    const windows = REMINDER_KINDS.map((k) => reminderWindow(k, w));
    for (let i = 1; i < windows.length; i++) expect(windows[i]!.from).toBeGreaterThanOrEqual(windows[i - 1]!.until);
    expect(kindDueAt(w, new Date(S + 7 * DAY))).toBeNull();
    expect(kindDueAt(w, new Date(S - 8 * DAY))).toBeNull();
  });

  it("sends each reminder at its time (outside quiet hours), by WhatsApp template", () => {
    // 1 week before is 7 p.m.: quiet hours start at 9.
    const cases: Array<[number, string]> = [
      [S - 7 * DAY + 30 * 60_000, "week"],
      [S - DAY + 30 * 60_000, "day"],
      [S - 50 * 60_000, "hour"],
      [S + 5 * 60_000, "live"],
      [S + 50 * 60_000, "replay"],
      [S + 2 * DAY + 16 * HOUR, "followup_2"],
      [S + 5 * DAY + 16 * HOUR, "followup_5"],
    ];
    for (const [at, kind] of cases) {
      const out = planReminder(w, reg(), LINKS, ctx(at));
      expect(out.ok, `${kind}: ${out.ok ? "" : out.why}`).toBe(true);
      if (!out.ok) continue;
      expect(out.reminder.kind).toBe(kind);
      expect(out.reminder.channel).toBe("whatsapp");
      expect(out.reminder.mode).toBe("template");
      expect(out.reminder.dedupeKey).toBe(`webinar:r1:${kind}`);
      expect(out.reminder.body).toMatch(/responde BAJA/);
    }
  });

  it("never in quiet hours (9 p.m. to 8 a.m. Texas)", () => {
    // The day-before reminder's window runs from 7 p.m. the day before; at 11 p.m. it waits.
    expect(planReminder(w, reg(), LINKS, ctx(S - DAY + 4 * HOUR))).toEqual({ ok: false, why: "quiet_hours" });
    // 8:30 a.m. the next day, still in its window: it goes.
    expect(planReminder(w, reg(), LINKS, ctx(S - 10.5 * HOUR)).ok).toBe(true);
  });

  it("only with consent, never after an opt-out, each once", () => {
    const at = S - 50 * 60_000;
    expect(planReminder(w, reg({ remindersConsent: false }), LINKS, ctx(at))).toEqual({ ok: false, why: "no_consent" });
    expect(planReminder(w, reg(), LINKS, ctx(at, { optedOut: true }))).toEqual({ ok: false, why: "opted_out" });
    expect(planReminder(w, reg({ optedOutAt: new Date(S - DAY).toISOString() }), LINKS, ctx(at))).toEqual({ ok: false, why: "opted_out" });
    expect(planReminder(w, reg(), LINKS, ctx(at, { written: new Set(["hour"]) }))).toEqual({ ok: false, why: "already_sent" });
    expect(planReminder({ ...w, status: "cancelled" }, reg(), LINKS, ctx(at))).toEqual({ ok: false, why: "not_published" });
  });

  it("a late registrant gets the next reminder, not the ones before it", () => {
    const late = reg({ createdAt: new Date(S - 3 * HOUR).toISOString() });
    expect(planReminder(w, late, LINKS, ctx(S - 2 * HOUR))).toEqual({ ok: false, why: "registered_after" });
    expect(planReminder(w, late, LINKS, ctx(S - 30 * 60_000)).ok).toBe(true);
  });

  it("the replay waits for its link; follow-ups are for Texas registrants who have not signed up", () => {
    expect(planReminder(webinar(), reg(), LINKS, ctx(S + 50 * 60_000))).toEqual({ ok: false, why: "no_replay_yet" });
    const day2 = S + 2 * DAY + 16 * HOUR;
    expect(planReminder(w, reg({ state: "CA", served: "out_of_state" }), LINKS, ctx(day2))).toEqual({ ok: false, why: "out_of_state" });
    expect(planReminder(w, reg(), LINKS, ctx(day2, { signedUp: true }))).toEqual({ ok: false, why: "signed_up" });
  });

  it("WhatsApp first; email when no approved template; nothing when neither can carry it; never SMS", () => {
    const at = S - 50 * 60_000;
    const notApproved = { ...CHANNELS, approvedTemplates: [] as string[] };
    const email = planReminder(w, reg(), LINKS, ctx(at, { channels: notApproved }));
    expect(email.ok && email.reminder.channel).toBe("email");
    expect(email.ok && email.reminder.subject).toBe("Tu clase en vivo empieza en una hora");
    expect(planReminder(w, reg({ email: null }), LINKS, ctx(at, { channels: notApproved }))).toEqual({ ok: false, why: "no_channel" });
    const window = planReminder(w, reg(), LINKS, ctx(at, { lastInboundAt: new Date(at - HOUR).toISOString(), channels: notApproved }));
    expect(window.ok && window.reminder.mode).toBe("text");
    expect(readFileSync("src/lib/webinars/reminders.ts", "utf8")).not.toMatch(/channel: "sms"|sendSms/i);
    expect(readFileSync("supabase/migrations/0044_webinars.sql", "utf8")).toMatch(/channel text not null check \(channel in \('whatsapp', 'email'\)\)/);
  });

  it("every template, in both languages, passes the claim rules and the content check; nothing free, no pressure", () => {
    const texts = sampleReminderTexts();
    expect(texts).toHaveLength(14);
    for (const { kind, locale, text } of texts) {
      expect(checkClaimGuardrails(text, "full_service"), `${kind} ${locale}`).toEqual([]);
      expect(checkMarketingCopy(text, "full_service"), `${kind} ${locale}`).toEqual([]);
      expect(checkText(text, "caption", locale).filter((i) => i.severity === "block"), `${kind} ${locale}: ${text}`).toEqual([]);
      expect(text).not.toMatch(/\bfree\b|gratis/i);
    }
    for (const k of REMINDER_KINDS) {
      const t = WEBINAR_TEMPLATES[k];
      expect(t.name).toMatch(/^credalti_webinar_[a-z0-9_]+$/);
      // Each template's placeholders are numbered 1..n, matching its parameter list, in both languages.
      for (const lang of ["en", "es"] as const) {
        const used = [...t.body[lang].matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
        expect(Math.max(...used), `${k} ${lang}`).toBe(t.params.length);
      }
    }
    expect(fillTemplate(WEBINAR_TEMPLATES.live, "en", ["Rosa", "Class", "https://x"])).toBe("Hi Rosa, we're live now: “Class”. Join here: https://x");
  });

  it("the email's unsubscribe link is signed, and only ours works", () => {
    const id = "3f2b6c1e-8a44-4d0e-9a51-0c9d2f6f1a77";
    const token = webinarUnsubscribeToken(id, "secret");
    expect(verifyWebinarUnsubscribe(id, token, "secret")).toBe(true);
    expect(verifyWebinarUnsubscribe(id, token, "other")).toBe(false);
    expect(verifyWebinarUnsubscribe("not-an-id", token, "secret")).toBe(false);
    expect(webinarUnsubscribeUrl(id, { NEXT_PUBLIC_APP_URL: "https://app.test/", UNSUBSCRIBE_SECRET: "secret" }, "es")).toBe(`https://app.test/webinar/baja?r=${id}&t=${token}&lang=es`);
    expect(webinarUnsubscribeUrl(id, {})).toBeNull();
  });
});

describe("webinars: the public page's words", () => {
  const lines = (locale: "en" | "es") => {
    const c = WEBINAR_PUBLIC_COPY[locale];
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") out.push(v);
      else if (typeof v === "function") out.push(String((v as (a: unknown) => string)(locale === "es" ? "Florida" : "Florida")));
      else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
    };
    walk(c);
    return out;
  };

  it("never free: “Live class · 45 minutes · Register”", () => {
    expect(WEBINAR_PUBLIC_COPY.en.badge(45)).toBe("Live class · 45 minutes · Register");
    expect(WEBINAR_PUBLIC_COPY.es.badge(45)).toBe("Clase en vivo · 45 minutos · Regístrate");
  });

  for (const locale of ["en", "es"] as const) {
    it(`${locale}: every line passes the claim rules, nothing free, no pressure, no score, Alti labelled as AI`, () => {
      const all = lines(locale);
      expect(all.length).toBeGreaterThan(50);
      for (const line of all) {
        expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        expect(webinarCopyProblems(line), line).toEqual([]);
        expect(line, line).not.toMatch(/\b(deleted|removed|fixed|guaranteed|approved)\b|\b(eliminad[oa]s?|borrad[oa]s?|arreglad[oa]s?|aprobad[oa]s?|garantizad[oa]s?)\b/i);
      }
      expect(WEBINAR_PUBLIC_COPY[locale].alti).toMatch(/Alti · (AI assistant|Asistente con IA)/);
      expect(WEBINAR_PUBLIC_COPY[locale].noPromise).toMatch(/results vary|resultados varían/i);
    });
  }

  it("the consent says WhatsApp or email, how many, how to stop, and never text messages", () => {
    expect(REMINDERS_CONSENT.en).toMatch(/WhatsApp or email/);
    expect(REMINDERS_CONSENT.en).toMatch(/Up to 7 messages/);
    expect(REMINDERS_CONSENT.en).toMatch(/Reply STOP/);
    expect(REMINDERS_CONSENT.en).toMatch(/Never by text message/);
    expect(REMINDERS_CONSENT.es).toMatch(/Nunca por mensaje de texto/);
  });

  it("a title with a promise, “free” or pressure is refused", () => {
    expect(webinarCopyProblems("Free credit class")).toContain("free");
    expect(webinarCopyProblems("Raise your score in 30 days")).toContain("promise");
    expect(webinarCopyProblems("Clase gratis, solo hoy")).toEqual(expect.arrayContaining(["free", "pressure"]));
    expect(webinarCopyProblems("Your credit report, explained")).toEqual([]);
  });
});

describe("webinars: registering", () => {
  const body = (over: Partial<RegisterBody> = {}): RegisterBody => ({ slug: "reporte-explicado", firstName: "Rosa", lastName: "Martínez", phone: "(713) 555-0142", email: "Rosa@Example.com", state: "TX", locale: "es", goal: "home", timeline: "months_6", question: null, remindersConsent: true, consentVersion: REMINDERS_CONSENT.version, ...over });

  it("Texas is served; other states learn (out of state); Georgia never", () => {
    expect(servedFor("TX")).toBe("texas");
    expect(servedFor("CA")).toBe("out_of_state");
    expect(servedFor("GA")).toBe("refused");
    const ok = cleanRegistration(body());
    expect(ok.ok && ok.value).toMatchObject({ phone: "+17135550142", email: "rosa@example.com", served: "texas" });
    const ca = cleanRegistration(body({ state: "CA" }));
    expect(ca.ok && ca.value.served).toBe("out_of_state");
    expect(cleanRegistration(body({ state: "GA" }))).toEqual({ ok: false, problems: ["georgia"] });
    expect(readFileSync("supabase/migrations/0044_webinars.sql", "utf8")).toMatch(/state <> 'GA'/);
  });

  it("names, phone and email are checked; no SSN or account number in the question", () => {
    const bad = cleanRegistration(body({ firstName: "", phone: "123", email: "nope", question: "My SSN is 123-45-6789" }));
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.problems).toEqual(expect.arrayContaining(["firstName", "phone", "email", "question"]));
    expect(cleanRegistration(body({ question: "Account 4111111111111111 is wrong" })).ok).toBe(false);
    expect(cleanRegistration(body({ question: "How long does a bureau have?" })).ok).toBe(true);
  });
});

describe("webinars: attendance from Zoom's CSV", () => {
  const csv = [
    "Attendee Report,",
    "Report Generated:,12/10/2026 9:00 PM",
    "Topic,Webinar ID,Actual Start Time,Unique Viewers",
    "Your credit report,123 456,12/10/2026 7:00 PM,3",
    "",
    "Attendee Details,",
    "Attended,User Name (Original Name),First Name,Last Name,Email,Phone,Registration Time,Join Time,Leave Time,Time in Session (minutes)",
    "Yes,Rosa M,Rosa,M,ROSA@example.com,,x,x,x,20",
    "Yes,Rosa M,Rosa,M,rosa@example.com,,x,x,x,15",
    "Yes,Luis,Luis,G,,713-555-0143,x,x,x,30",
    "No,Ana,Ana,P,ana@example.com,,x,,,",
    "Yes,Stranger,S,T,someone@example.com,,x,x,x,5",
  ].join("\n");

  it("finds the table under Zoom's summary, adds up a person's joins, and leaves out the ones who did not attend", () => {
    const read = readAttendees(csv);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.attendees).toEqual([
      { email: "rosa@example.com", phone: null, name: "Rosa M", minutes: 35 },
      { email: null, phone: "+17135550143", name: "Luis", minutes: 30 },
      { email: "someone@example.com", phone: null, name: "Stranger", minutes: 5 },
    ]);
    expect(readAttendees("just,some,words")).toEqual({ ok: false, reason: "no_header" });
  });

  it("matches by email first, then phone; strangers stay unmatched", () => {
    const read = readAttendees(csv);
    if (!read.ok) throw new Error("no");
    const plan = matchAttendance(read.attendees, [reg(), reg({ id: "r2", email: null, phone: "+17135550143" }), reg({ id: "r3", email: "ana@example.com", phone: "+17135550144" })]);
    expect(plan.matches).toEqual([
      { registrationId: "r1", minutes: 35, by: "email" },
      { registrationId: "r2", minutes: 30, by: "phone" },
    ]);
    expect(plan.unmatched.map((a) => a.email)).toEqual(["someone@example.com"]);
  });
});

describe("webinars: the scripts", () => {
  const vars: ScriptVars = { keyword: "CREDIT", signupLink: "https://credalti.com/registro", pageLink: "https://credalti.com/webinar/x", whatsapp: "+1 713 555 0100", prices: { complete: PRICE_PLACEHOLDER, diy: PRICE_PLACEHOLDER } };

  for (const locale of ["en", "es"] as const) {
    it(`${locale}: every line passes the claim rules; nothing free; no pressure; the person decides`, () => {
      const lines = allScriptLines(locale, vars);
      expect(lines.length).toBeGreaterThan(30);
      for (const line of lines) {
        expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
        expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        expect(line, line).not.toMatch(/\bfree\b|gratis|gratuit/i);
        expect(line, line).not.toMatch(/today only|last chance|hurry|act now|limited time|solo hoy|[uú]ltima oportunidad|ap[uú]rate|por tiempo limitado/i);
        expect(line, line).not.toMatch(/nothing is charged until|no se cobra nada hasta/i);
      }
    });
  }

  it("the two-package pitch: Complete first, then DIY, the switch, no honest promise, monitoring apart, the charge rule true for both", () => {
    const cta2 = runOfShow(vars).find((s) => s.cta === 2)!;
    const en = cta2.host.en;
    expect(en.indexOf("Credalti Complete")).toBeLessThan(en.indexOf("Credalti DIY"));
    expect(en).toContain("Not sure? Start with DIY. If it gets to be too much, switch to Complete anytime and keep everything you've done.");
    expect(en).toContain("you decide what's wrong on your report, and nobody can honestly promise results");
    expect(en).toContain("With Complete, you're charged each month right after your letters are mailed; DIY is a simple monthly subscription.");
    expect(en).toMatch(/IdentityIQ is a separate monthly subscription/);
    expect(cta2.host.es).toContain("¿No sabes cuál? Empieza con DIY.");
    const homeBuyer = moderatorMessages(vars).find((m) => m.key === "homeBuyer")!;
    expect(homeBuyer.text.en).toMatch(/Complete is the faster path/);
    expect(runOfShow(vars).filter((s) => s.cta).map((s) => s.cta)).toEqual([1, 2, 3]);
  });

  it("prices come from the offered plans; [price] until one is offered", () => {
    expect(packagePrices([])).toEqual({ complete: "[price]", diy: "[price]" });
    expect(packagePrices([{ name: "Credalti Complete", terms: ["$99 each month, after your letters are mailed"] }, { name: "Credalti DIY", terms: ["$39 a month"] }])).toEqual({ complete: "$99", diy: "$39" });
  });
});

describe("webinars: the live funnel's tags, read generically", () => {
  it("reads the keyword, the campaign and the webinar from whatever shape the first touch has", () => {
    expect(leadTags("webinar", { keyword: "credit", campaign: "webinar-test-1" })).toMatchObject({ keyword: "CREDIT", campaign: "webinar-test-1", fromWebinar: true });
    expect(leadTags("whatsapp", { live: { keyword: "CREDIT", webinarId: "w1" } })).toMatchObject({ keyword: "CREDIT", webinarId: "w1" });
    expect(leadTags("whatsapp", { utm: { campaign: "spring" } })).toMatchObject({ keyword: null, campaign: "spring", fromWebinar: false });
  });

  it("a lead belongs to the webinar by its id, a registrant's phone, or its keyword or tag during it", () => {
    const base: FunnelLead = { id: "l1", name: "Rosa M.", phone: null, createdAt: new Date(S + 10 * 60_000).toISOString(), source: "webinar", keyword: "CREDIT", campaign: null, webinarId: null, utmSource: null, utmCampaign: null, adCampaignId: null, fromMeta: false, clientUserId: null, signupStarted: false, signedAt: null, lastMessage: null };
    const w = webinar();
    expect(leadFromWebinar(base, w, new Set())).toBe(true);
    expect(leadFromWebinar({ ...base, createdAt: new Date(S - 3 * DAY).toISOString() }, w, new Set())).toBe(false);
    expect(leadFromWebinar({ ...base, keyword: null, source: "whatsapp", phone: "+17135550142", createdAt: new Date(S - 3 * DAY).toISOString() }, w, new Set(["+17135550142"]))).toBe(true);
    expect(leadFromWebinar({ ...base, keyword: null, source: "whatsapp", campaign: "WEBINAR-TEST-1" }, w, new Set())).toBe(true);
    const counters = liveCounters({ registrations: [reg({ attended: true }), reg()], leads: [{ ...base, clientUserId: "c1", signupStarted: true }], keyword: "credit", reportClients: new Set(["c1"]), videos: null });
    expect(counters).toEqual({ registered: 2, attended: 1, keywordMessages: 1, reportsUploaded: 1, videosSent: null, videosWatched: null, signupsStarted: 1, signed: 0 });
  });
});

describe("webinars: packages", () => {
  it("DIY when the client's option says so; Complete otherwise; DIY → Complete upgrades read from the events", () => {
    expect(normalizeOption("diy")).toBe("diy");
    expect(normalizeOption("do_it_yourself")).toBe("diy");
    expect(normalizeOption("complete")).toBe("complete");
    expect(normalizeOption(undefined)).toBe("complete");
    expect(packageOf({ option: "DIY" })).toBe("diy");
    expect(packageOf({})).toBe("complete");
    expect(upgradesOf({ id: "c1", packageEvents: [{ at: "2026-11-01T00:00:00Z", from: "diy", to: "complete" }, { at: "2026-11-02T00:00:00Z", from: "complete", to: "diy" }, { at: "bad", from: "diy", to: "complete" }] })).toEqual([
      { clientId: "c1", at: "2026-11-01T00:00:00Z", from: "diy", to: "complete" },
    ]);
  });
});

describe("webinars: the scorecard and its formulas", () => {
  const campaign: Campaign = { id: "c1", name: "Webinar test #1", startDay: "2026-12-01", endDay: "2026-12-20", budgetCents: 100_000, metaCampaignIds: ["111"], webinarIds: ["w1"], keywords: ["CREDIT"], organicSources: ["instagram"], note: null, createdAt: "2026-11-30T00:00:00Z" };
  const lead = (id: string, over: Partial<FunnelLead>): FunnelLead => ({ id, name: `${id} X.`, phone: null, createdAt: "2026-12-05T18:00:00Z", source: "whatsapp", keyword: null, campaign: null, webinarId: null, utmSource: null, utmCampaign: null, adCampaignId: null, fromMeta: false, clientUserId: null, signupStarted: false, signedAt: null, lastMessage: null, ...over });
  const value = (id: string, over: Partial<ClientValueFacts> = {}): ClientValueFacts => ({ clientId: id, name: `${id} X.`, option: "complete", collectedCents: 10_000, collectedAfterUpgradeCents: 0, commissionsCents: 0, purchasesCents: 0, purchaseCounts: {}, upgrades: 0, households: 0, loanOfficer: 0, ...over });
  const signed = (id: string, over: Partial<FunnelLead>) => lead(id, { clientUserId: `c-${id}`, signupStarted: true, signedAt: "2026-12-08T18:00:00Z", ...over });
  const input = (over: Partial<ScorecardInput> = {}): ScorecardInput => ({
    campaign,
    costs: [{ id: "k1", campaignId: "c1", label: "Zoom", kind: "tools", amountCents: 20_000, day: "2026-12-01", by: "Carmen", voidedAt: null }],
    adDays: [
      { campaignId: "111", day: "2026-12-02", spendCents: 30_000 },
      { campaignId: "111", day: "2026-12-03", spendCents: 30_000 },
      // Outside the dates, and another campaign: not counted.
      { campaignId: "111", day: "2026-11-20", spendCents: 99_999 },
      { campaignId: "222", day: "2026-12-02", spendCents: 99_999 },
    ],
    webinars: [webinar({ id: "w1" })],
    registrations: [reg({ id: "r1", phone: "+17135550142", attended: true }), reg({ id: "r2", phone: "+17135550143", attribution: { ad: { campaignId: "111" } } }), reg({ id: "r3", webinarId: "other" })],
    leads: [
      signed("a1", { adCampaignId: "111" }),
      signed("a2", { adCampaignId: "111" }),
      signed("a3", { phone: "+17135550143" }), // registered from the ad: credited to ads
      signed("w1", { phone: "+17135550142" }), // a webinar registrant
      signed("k1", { keyword: "CREDIT", source: "webinar" }),
      lead("o1", { utmSource: "instagram" }),
      lead("x1", { adCampaignId: "222" }), // another campaign: not this one
      lead("late", { adCampaignId: "111", createdAt: "2026-12-25T18:00:00Z" }), // after the dates
    ],
    reportClients: new Set(["c-a1", "c-w1"]),
    videos: { sent: new Set(["k1"]), watched: new Set<string>() },
    values: new Map([
      ["c-a1", value("c-a1", { collectedCents: 26_700, commissionsCents: 4_000 })],
      ["c-a2", value("c-a2", { option: "diy", collectedCents: 3_900 })],
      ["c-a3", value("c-a3", { collectedCents: 17_800, upgrades: 1, collectedAfterUpgradeCents: 8_900 })],
      ["c-w1", value("c-w1", { collectedCents: 8_900, purchasesCents: 4_900, purchaseCounts: { household_addon: 1 } })],
      ["c-k1", value("c-k1", { option: "diy", collectedCents: 0 })],
    ]),
    dayOf: (iso) => dayInZone(iso, TEXAS_TZ),
    ...over,
  });

  it("counts the funnel of the leads that arrived in the dates, once each, by the first channel that matches", () => {
    const card = buildScorecard(input());
    expect(card.spend).toEqual({ metaCents: 60_000, otherCents: 20_000, totalCents: 80_000, budgetCents: 100_000, leftCents: 20_000 });
    expect(card.funnel).toEqual({ registered: 2, attended: 1, leads: 6, reportsUploaded: 2, videosSent: 1, videosWatched: 0, signupsStarted: 5, signed: 5 });
    expect(card.byChannel).toEqual({ ads: { leads: 3, signed: 3 }, webinar: { leads: 1, signed: 1 }, keyword: { leads: 1, signed: 1 }, organic: { leads: 1, signed: 0 } });
  });

  it("CAC two ways: ads-only = Meta spend ÷ ad-credited signed; blended = all costs ÷ all signed", () => {
    const card = buildScorecard(input());
    expect(card.cac.adsOnly).toEqual({ cents: 20_000, state: "ok", costCents: 60_000, signed: 3 });
    expect(card.cac.blended).toEqual({ cents: 16_000, state: "ok", costCents: 80_000, signed: 5 });
  });

  it(`below ${MIN_SIGNED_FOR_CAC} signed clients: "Not enough data yet"; with no spend: none recorded`, () => {
    expect(cacFigure(50_000, 2)).toEqual({ cents: null, state: "not_enough", costCents: 50_000, signed: 2 });
    expect(cacFigure(0, 9).state).toBe("no_cost");
    const few = buildScorecard(input({ leads: input().leads.slice(0, 2) }));
    expect(few.cac.adsOnly.state).toBe("not_enough");
    expect(few.value.valueOverCac).toBeNull();
  });

  it("client value: collected + commissions + purchases; average; value ÷ CAC; upgrades; split by package", () => {
    const card = buildScorecard(input());
    expect(card.value.totalCents).toBe(26_700 + 4_000 + 3_900 + 17_800 + 8_900 + 4_900);
    expect(card.value.averageCents).toBe(Math.round(66_200 / 5));
    expect(card.value.valueOverCac).toBeCloseTo(13_240 / 16_000, 5);
    expect(card.value.upgrades).toBe(1);
    expect(card.value.collectedAfterUpgradeCents).toBe(8_900);
    expect(card.byPackage.complete).toMatchObject({ signed: 3, collectedCents: 26_700 + 17_800 + 8_900, upgrades: 1, cac: { cents: Math.round(80_000 / 3), state: "ok" } });
    expect(card.byPackage.diy).toMatchObject({ signed: 2, collectedCents: 3_900, cac: { state: "not_enough" }, adsCac: { state: "not_enough" } });
    // Names only as a first name and an initial; nothing of a report.
    expect(JSON.stringify(card)).not.toMatch(/tradeline|account|ssn|score/i);
  });

  it("a voided cost is not counted", () => {
    const cards = scorecardsFor({ ...input(), campaigns: [campaign], costs: [{ id: "k1", campaignId: "c1", label: "Zoom", kind: "tools", amountCents: 20_000, day: "2026-12-01", by: "Carmen", voidedAt: "2026-12-02T00:00:00Z" }] });
    expect(cards[0]!.spend.otherCents).toBe(0);
  });

  it("client value comes from the money rule: payments in, refunds out, test charges never; voided commissions not", () => {
    const charge = (id: string, over: Partial<BillingCharge> = {}): BillingCharge => ({ id, roundNumber: 1, amountCents: 8900, status: "succeeded", workDate: "2026-12-01T00:00:00Z", createdAt: "2026-12-01T00:00:00Z", attempts: 1, lastAttemptAt: null, nextAttemptAt: null, chargedAt: "2026-12-02T00:00:00Z", failureCode: null, refund: null, ...over });
    const client = { id: "c1", firstName: "Rosa", lastName: "Martínez", option: "diy", packageEvents: [{ at: "2026-12-05T00:00:00Z", from: "diy", to: "complete" }], billing: { paymentMethod: null, charges: [charge("p1"), charge("p2", { chargedAt: "2026-12-10T00:00:00Z" }), charge("p3", { refund: { id: "rf", amountCents: 8900, reason: "x", by: "carmen", at: "2026-12-11T00:00:00Z", completedAt: "2026-12-11T00:00:00Z" } as BillingCharge["refund"] }), charge("t1")], pause: null } } as unknown as StaffClient;
    const values = clientValueFacts({
      clients: [client],
      chargeMeta: { t1: { gateway: "demo", reference: null } },
      commissions: [
        { id: "m1", clientId: "c1", provider: "IdentityIQ", month: "2026-12", amountCents: 4000, kind: "commission", memberRef: "", paidOn: null, source: "manual", note: "", postedIncomeId: null, voidedAt: null, voidReason: null, by: "x", at: "" },
        { id: "m2", clientId: "c1", provider: "IdentityIQ", month: "2026-12", amountCents: 4000, kind: "commission", memberRef: "", paidOn: null, source: "manual", note: "", postedIncomeId: null, voidedAt: "2026-12-12T00:00:00Z", voidReason: "dup", by: "x", at: "" },
      ],
      purchases: [{ id: "u1", clientId: "c1", kind: "partner_offer", amountCents: 2500, day: "2026-12-12", note: null, by: "x", voidedAt: null }],
    }).get("c1")!;
    expect(values).toMatchObject({ name: "Rosa M.", option: "diy", collectedCents: 8900 + 8900 + 8900 - 8900, commissionsCents: 4000, purchasesCents: 2500, upgrades: 1, purchaseCounts: { partner_offer: 1 } });
    // After the upgrade (Dec 5): the Dec 10 payment and the Dec 11 refund.
    expect(values.collectedAfterUpgradeCents).toBe(8900 - 8900);
  });
});

describe("webinars: the demo", () => {
  const now = new Date("2026-11-26T18:00:00Z");

  it("has an ended, a live and an upcoming sample webinar, and a campaign with real-looking numbers", () => {
    const webinars = demoWebinars(now);
    const phases = summarize(webinars, demoRegistrations(now), now).map((s) => s.phase).sort();
    expect(phases).toEqual(["ended", "live", "upcoming"]);
    expect(nextWebinar(summarize(webinars, demoRegistrations(now), now))!.phase).toBe("live");
    const [card] = scorecardsFor({ campaigns: demoCampaigns(now).map((c) => ({ ...c, webinarIds: webinars.map((w) => w.id) })), costs: demoCosts(now), adDays: demoAdDays(now), webinars, registrations: demoRegistrations(now), leads: demoFunnelLeads(now), reportClients: demoReportClients(now), videos: null, values: demoValues(now), dayOf: (iso) => dayInZone(iso, TEXAS_TZ) });
    expect(card!.funnel.registered).toBeGreaterThan(50);
    expect(card!.funnel.signed).toBeGreaterThanOrEqual(MIN_SIGNED_FOR_CAC);
    expect(card!.cac.blended.state).toBe("ok");
    expect(card!.byPackage.diy.signed).toBeGreaterThan(0);
    expect(card!.value.upgrades).toBeGreaterThan(0);
    expect(card!.funnel.videosSent).toBeNull();
  });

  it("feeds the Ideas center: the webinars' numbers, filled by the code, null below the threshold", () => {
    const webinars = demoWebinars(now);
    const scorecards = scorecardsFor({ campaigns: demoCampaigns(now), costs: demoCosts(now), adDays: demoAdDays(now), webinars, registrations: demoRegistrations(now), leads: demoFunnelLeads(now), reportClients: demoReportClients(now), videos: null, values: demoValues(now), dayOf: (iso) => dayInZone(iso, TEXAS_TZ) });
    const signal = webinarsSignal({ webinars, registrations: demoRegistrations(now), leads: demoFunnelLeads(now), scorecards, now });
    const signals = collectSignals({ clients: null, leads: null, content: null, now, extra: { [WEBINARS_SIGNAL_ID]: signal } });
    const get = (k: string) => signals.find((s) => s.key === k)!;
    expect(get("webinar_registered_30d").value).toBeGreaterThan(0);
    expect(get("webinar_attendance_rate").value).toBeGreaterThan(0);
    expect(get("webinar_attendance_rate").value).toBeLessThanOrEqual(1);
    expect(get("campaign_value_over_cac").display).toMatch(/×$/);
    const none: WebinarsSignalInput = { registered30d: 0, endedRegistered30d: 0, endedAttended30d: 0, keywordLeads30d: 0, signed30d: 0, campaign: { cacBlendedCents: null, cacAdsCents: null, valuePerClientCents: null, valueOverCac: null, upgrades: 0 } };
    const empty = collectSignals({ clients: null, leads: null, content: null, now, extra: { [WEBINARS_SIGNAL_ID]: none } });
    expect(empty.find((s) => s.key === "campaign_cac_blended")!.value).toBeNull();
    expect(empty.find((s) => s.key === "webinar_attendance_rate")!.value).toBeNull();
    expect(collectSignals({ clients: null, leads: null, content: null, now }).find((s) => s.key === "webinar_signed_30d")!.value).toBeNull();
  });
});

describe("a person joins Alti's signup chat", () => {
  it("numbers that look like an SSN or an account are taken out before the message is stored", () => {
    expect(redactPersonText("my ssn is 123-45-6789 ok")).toBe("my ssn is ••• ok");
    expect(redactPersonText("card 4111 1111 1111 1111")).toBe("card •••");
    expect(redactPersonText("call me at 3pm")).toBe("call me at 3pm");
  });

  it("Alti answers from the website's library while nobody is in, and is paused while a teammate is", () => {
    expect(altiPaused("joined")).toBe(true);
    expect(altiPaused("requested")).toBe(false);
    expect(altiLiveReply("¿Cuánto tarda un buró en responder?", "es", "joined")).toBeNull();
    const reply = altiLiveReply("zzz qqq", "en", "requested")!;
    expect(reply.length).toBeGreaterThan(5);
    expect(checkMarketingCopy(reply, "full_service")).toEqual([]);
  });

  it("every line says who wrote it: “Alti · AI assistant” or “Rolando · Credalti team”", () => {
    expect(bylineOf({ author: "alti", staffName: null }, "en")).toBe("Alti · AI assistant");
    expect(bylineOf({ author: "staff", staffName: "Rolando" }, "en")).toBe("Rolando · Credalti team");
    expect(bylineOf({ author: "staff", staffName: "Rolando" }, "es")).toBe("Rolando · equipo Credalti");
    expect(systemLine({ text: "joined", staffName: "Rolando" }, "en")).toMatch(/^Rolando from the Credalti team joined the chat\. Alti is paused/);
  });

  it("a teammate's reply passes the same promise and claim checks as any staff reply", () => {
    expect(checkStaffReply("The collection will be deleted.", "en").length).toBeGreaterThan(0);
    expect(checkStaffReply("Hi! The upload is under “Verify identity”.", "en")).toEqual([]);
  });

  it("the chat's own words pass the claim rules, in both languages", () => {
    for (const locale of ["en", "es"] as const) {
      for (const line of Object.values(LIVE_CHAT_COPY[locale]).map((v) => (typeof v === "function" ? v("Rolando") : v))) {
        expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        expect(line).not.toMatch(/\bfree\b|gratis/i);
      }
    }
    expect(sampleLiveChats(new Date()).every((t) => t.sample)).toBe(true);
  });

  it("the database refuses Alti while a person is in, and a teammate writing before joining", () => {
    const sql = readFileSync("supabase/migrations/0044_webinars.sql", "utf8");
    expect(sql).toMatch(/Alti is paused while a person is in the chat/);
    expect(sql).toMatch(/a teammate joins the chat before writing in it/);
  });
});
