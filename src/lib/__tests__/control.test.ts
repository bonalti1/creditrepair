import { readFileSync } from "node:fs";
import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { alertRecipients, DEFAULT_ALERT_PREFS, prefsFromRows, shortName, TOPIC_TEXT, topicsFor, type AlertMember } from "../control/alerts";
import { moneySummary, OVERVIEW_TEXT, overviewCards, type OverviewInput } from "../control/overview";
import { TODAY_PROCEDURES, todayList } from "../control/today";
import { autopilotSamples, composeAutoReply, decideAutoReply, handoffReason, labelled, signupUrl } from "../leads/autopilot";
import { conversationProvider, conversationProviderName, highlevelConversations } from "../leads/conversations";
import { buildDemoLeadRecords, buildDemoLeads } from "../leads/demo";
import { demoLeadDraftCaller, draftLeadReply, LEAD_DRAFT_SYSTEM_PROMPT } from "../leads/drafts";
import { effectiveStage, filterLeads, HANDOFF_LABELS, isPersonStage, SOURCE_LABELS, STAGE_HELP, STAGE_LABELS, waitingSince, whatsappWindow } from "../leads/inbox";
import { leadQuality, QUALITY_TEXT } from "../leads/metrics";
import { LEAD_TEMPLATES, renderLeadTemplate } from "../leads/templates";
import { DEFAULT_LEAD_AUTOPILOT, PERSON_STAGES, type Lead, type LeadMessage } from "../leads/types";
import { allowedEndpoint, generateVapidKeys, pushConfig, sendTickle, vapidJwt } from "../push/webPush";
import { attachDemoAutopilot } from "../autopilot/demo";
import { workQueue } from "../autopilot/queue";
import { buildDemoClients } from "../staff/demoClients";
import { can, CAPABILITIES, ROLE_PERMISSIONS } from "../staff/permissions";
import { MORE_NAV, PRIMARY_NAV } from "../staff/nav";
import type { StaffRole } from "../staff/types";

// Credalti Control, phase 1 (docs/CONTROL.md): the pure rules. The database
// side (triggers, row level security, the autopilot run, the alerts sweep,
// the routes) is in db/controlLeads.test.ts.

const NOW = new Date("2026-12-07T17:00:00.000Z"); // 11 a.m. in Texas
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "11111111-1111-4111-8111-111111111111",
  phone: "+17135550141",
  name: "Rosa Gutiérrez",
  locale: "en",
  source: "whatsapp",
  firstTouch: {},
  prospectId: null,
  salesperson: "ana",
  assignedAt: null,
  stage: "new",
  stageAt: null,
  invitedAt: null,
  signedAt: null,
  clientUserId: null,
  lastInboundAt: ago(10 * MIN),
  lastReplyAt: null,
  lastHumanAt: null,
  firstHumanReplyAt: null,
  lastMessage: { at: ago(10 * MIN), role: "user", source: "journey", excerpt: "Hi" },
  createdAt: ago(20 * MIN),
  optedOutAt: null,
  state: "TX",
  ...over,
});
const msg = (text: string, atMs: number, over: Partial<LeadMessage> = {}): LeadMessage => ({ id: `m${atMs}`, at: ago(atMs), role: "user", source: "journey", text, ...over });
const ON = { ...DEFAULT_LEAD_AUTOPILOT, enabled: true, enabledAt: ago(24 * HOUR) };
const decide = (over: Partial<Parameters<typeof decideAutoReply>[0]> = {}) =>
  decideAutoReply({ lead: lead(), messages: [msg("How do I sign up?", 10 * MIN)], settings: ON, sentToday: { lead: 0, all: 0 }, done: new Set(), now: NOW, appUrl: "https://credalti.com", ...over });

describe("the pipeline: only people move leads", () => {
  it("a person's stage is the stage; Invited and Signed are facts on top of it", () => {
    expect(effectiveStage(lead({ stage: "contacted" }))).toBe("contacted");
    expect(effectiveStage(lead({ stage: "qualified", invitedAt: ago(HOUR) }))).toBe("invited");
    expect(effectiveStage(lead({ stage: "closed_lost", invitedAt: ago(HOUR) }))).toBe("closed_lost");
    expect(effectiveStage(lead({ stage: "closed_lost", signedAt: ago(HOUR) }))).toBe("signed");
    // An archived lead who writes again shows in New.
    expect(effectiveStage(lead({ stage: "archived", stageAt: ago(2 * HOUR), lastInboundAt: ago(HOUR) }))).toBe("new");
    expect(effectiveStage(lead({ stage: "archived", stageAt: ago(HOUR), lastInboundAt: ago(2 * HOUR) }))).toBe("archived");
  });

  it("a person may never choose Invited or Signed", () => {
    expect(PERSON_STAGES).not.toContain("invited");
    expect(PERSON_STAGES).not.toContain("signed");
    expect(isPersonStage("signed")).toBe(false);
    expect(isPersonStage("qualified")).toBe(true);
  });

  it("the migration says the same: a move needs a person, and only to a person's stage", () => {
    const sql = readFileSync("supabase/migrations/0034_control_leads.sql", "utf8");
    expect(sql).toMatch(/actor uuid not null references auth\.users/);
    expect(sql).toMatch(/to_stage text not null check \(to_stage in \('new', 'contacted', 'qualified', 'not_interested', 'closed_lost', 'archived'\)\)/);
    expect(sql).toMatch(/only a person moves a lead, through lead_stage_events/);
  });

  it("the autopilot never moves a stage: its code never writes one", () => {
    for (const file of ["src/lib/leads/autopilot.ts", "src/lib/leads/autopilotServer.ts", "src/lib/control/alertsServer.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/lead_stage_events|stage:/);
    }
  });
});

describe("waiting and WhatsApp's 24 hours", () => {
  it("waits until someone (a person or the AI) answers; Alti's fixed greeting is not an answer", () => {
    expect(waitingSince(lead())).toBe(ago(10 * MIN));
    expect(waitingSince(lead({ lastReplyAt: ago(5 * MIN) }))).toBeNull();
    expect(waitingSince(lead({ optedOutAt: ago(HOUR) }))).toBeNull();
    expect(waitingSince(lead({ stage: "not_interested" }))).toBeNull();
  });

  it("the window is open for 24 hours after their last message, closing in the last 4", () => {
    expect(whatsappWindow(ago(HOUR), NOW)).toEqual({ state: "open", hoursLeft: 23, closing: false });
    expect(whatsappWindow(ago(21 * HOUR), NOW)).toMatchObject({ state: "open", closing: true });
    expect(whatsappWindow(ago(25 * HOUR), NOW)).toEqual({ state: "closed" });
    expect(whatsappWindow(null, NOW)).toEqual({ state: "closed" });
  });

  it("filters: waiting, mine, unassigned, a stage; All leaves out archived", () => {
    const list = [lead({ id: "a" }), lead({ id: "b", salesperson: null }), lead({ id: "c", stage: "archived", stageAt: ago(HOUR), lastInboundAt: ago(2 * HOUR) }), lead({ id: "d", salesperson: "luis", lastReplyAt: ago(MIN) })];
    expect(filterLeads(list, "all", "ana").map((l) => l.id)).toEqual(["a", "b", "d"]);
    expect(filterLeads(list, "mine", "ana").map((l) => l.id)).toEqual(["a", "c"]);
    expect(filterLeads(list, "unassigned", "ana").map((l) => l.id)).toEqual(["b"]);
    expect(filterLeads(list, "waiting", "ana").map((l) => l.id)).toEqual(["a", "b"]);
    expect(filterLeads(list, "archived", "ana").map((l) => l.id)).toEqual(["c"]);
  });
});

describe("lead quality numbers: real numbers only", () => {
  it("no leads: counts are a real 0, every rate is 'No data yet'", () => {
    const q = leadQuality([], NOW);
    expect(q.today.total).toBe(0);
    expect(q.medianFirstReplyMinutes).toBeNull();
    expect(q.contacted.value).toBeNull();
    expect(q.signed.value).toBeNull();
  });

  it("counts from the facts, by source", () => {
    const list = [
      lead({ id: "1", createdAt: ago(HOUR), firstHumanReplyAt: ago(HOUR - 10 * MIN) }),
      lead({ id: "2", source: "highlevel", createdAt: ago(3 * HOUR), firstHumanReplyAt: ago(3 * HOUR - 30 * MIN), invitedAt: ago(HOUR) }),
      lead({ id: "3", source: "partner", createdAt: ago(3 * 24 * HOUR), signedAt: ago(HOUR), invitedAt: ago(2 * HOUR) }),
      lead({ id: "4", createdAt: ago(40 * 24 * HOUR) }),
    ];
    const q = leadQuality(list, NOW);
    expect(q.today.total).toBe(2);
    expect(q.today.bySource).toEqual({ whatsapp: 1, highlevel: 1 });
    expect(q.week.total).toBe(3);
    expect(q.medianFirstReplyMinutes).toBe(20);
    expect(q.contacted).toMatchObject({ count: 3, of: 3 });
    expect(q.invited).toMatchObject({ count: 2, of: 3 });
    expect(q.signed).toMatchObject({ count: 1, of: 3 });
  });
});

describe("the lead autopilot: off, careful, labelled", () => {
  it("is off by default and then does nothing", () => {
    expect(DEFAULT_LEAD_AUTOPILOT.enabled).toBe(false);
    expect(decide({ settings: DEFAULT_LEAD_AUTOPILOT })).toEqual({ action: "skip", reason: "off" });
    expect(readFileSync("supabase/migrations/0034_control_leads.sql", "utf8")).toMatch(/enabled boolean not null default false/);
  });

  it("never answers the backlog, too soon, twice, after a person, a client, a closed lead or STOP", () => {
    expect(decide({ settings: { ...ON, enabledAt: ago(5 * MIN) } })).toEqual({ action: "skip", reason: "before_on" });
    expect(decide({ messages: [msg("How do I sign up?", 30_000)] })).toEqual({ action: "skip", reason: "too_soon" });
    const first = decide();
    expect(first.action).toBe("send");
    if (first.action !== "send") return;
    expect(decide({ done: new Set([first.dedupeKey]) })).toEqual({ action: "skip", reason: "done" });
    expect(decide({ messages: [msg("hi", 3 * HOUR, { role: "assistant", source: "human" }), msg("How do I sign up?", 10 * MIN)] })).toEqual({ action: "skip", reason: "person" });
    expect(decide({ lead: lead({ signedAt: ago(HOUR) }) })).toEqual({ action: "skip", reason: "client" });
    expect(decide({ lead: lead({ stage: "not_interested" }) })).toEqual({ action: "skip", reason: "closed" });
    expect(decide({ lead: lead({ optedOutAt: ago(HOUR) }) })).toEqual({ action: "skip", reason: "opted_out" });
    expect(decide({ messages: [msg("How do I sign up?", 20 * MIN), msg("Thanks!", 10 * MIN, { role: "assistant", source: "coach" })] })).toEqual({ action: "skip", reason: "answered" });
  });

  it("caps per lead and for everyone, and quiet hours on the lead's clock", () => {
    expect(decide({ sentToday: { lead: 3, all: 3 } })).toEqual({ action: "skip", reason: "lead_cap" });
    expect(decide({ sentToday: { lead: 0, all: 40 } })).toEqual({ action: "skip", reason: "daily_cap" });
    const night = new Date("2026-12-08T04:00:00.000Z"); // 10 p.m. in Texas
    expect(decide({ now: night, lead: lead({ lastInboundAt: new Date(night.getTime() - 10 * MIN).toISOString() }), messages: [{ ...msg("How do I sign up?", 0), at: new Date(night.getTime() - 10 * MIN).toISOString() }] })).toEqual({ action: "skip", reason: "quiet_hours" });
  });

  it("hands a person complaints, money, legal, results, a request for a person, personal data", () => {
    expect(handoffReason("This is a scam, nobody answers me")).toBe("complaint");
    expect(handoffReason("¿Cuánto cuesta al mes?")).toBe("billing");
    expect(handoffReason("I want a refund")).toBe("billing");
    expect(handoffReason("Do I need a lawyer?")).toBe("legal");
    expect(handoffReason("Can you guarantee 100 points?")).toBe("results");
    expect(handoffReason("Can I talk to a person please")).toBe("wants_person");
    expect(handoffReason("my ssn is 123-45-6789")).toBe("personal_data");
    expect(handoffReason("How do I sign up?")).toBeNull();
    // A hand-off is never held for quiet hours or caps: a person must know.
    expect(decide({ messages: [msg("This is a scam", 10 * MIN)], sentToday: { lead: 9, all: 999 } })).toMatchObject({ action: "handoff", reason: "complaint" });
    // Nothing it can answer from approved words: a person.
    expect(decide({ messages: [msg("hi", 20 * MIN, { role: "assistant", source: "journey" }), msg("My cousin told me about you", 10 * MIN)] })).toMatchObject({ action: "handoff", reason: "no_fact" });
  });

  it("only says three things: a greeting, an FAQ answer, the signup link; each labelled as AI and inside the rules", () => {
    const signup = composeAutoReply("How do I sign up?", { firstAnswer: false, locale: "en", sendSignupLink: true, appUrl: "https://credalti.com", salesperson: "ana" });
    expect(signup).toMatchObject({ kind: "signup_link" });
    expect("body" in signup && signup.body).toMatch(/^🤖 Alti · AI assistant\n/);
    expect("body" in signup && signup.body).toContain("https://credalti.com/registro?r=ana&lang=en");
    const faq = composeAutoReply("How long do the bureaus take to answer?", { firstAnswer: false, locale: "en", sendSignupLink: true, appUrl: "https://credalti.com", salesperson: null });
    expect(faq).toMatchObject({ kind: "faq" });
    const greeting = composeAutoReply("hola", { firstAnswer: true, locale: "es", sendSignupLink: true, appUrl: "https://credalti.com", salesperson: null });
    expect(greeting).toMatchObject({ kind: "greeting" });
    expect("body" in greeting && greeting.body).toMatch(/^🤖 Alti · Asistente con IA\n/);
    expect("body" in greeting && greeting.body).toMatch(/no una persona/);
    // No link when the owner turned it off.
    expect(composeAutoReply("How do I sign up?", { firstAnswer: false, locale: "en", sendSignupLink: false, appUrl: "", salesperson: null })).toEqual({ handoff: "no_fact" });
    for (const lang of ["en", "es"] as const) {
      const s = autopilotSamples("https://credalti.com")[lang];
      for (const text of [s.greeting, s.signup]) {
        expect(checkClaimGuardrails(text), text).toEqual([]);
        expect(checkMarketingCopy(text), text).toEqual([]);
        expect(text).not.toMatch(/\$|\bfree\b|\bgratis\b/i);
      }
    }
    expect(signupUrl("https://x.test/", null, "es")).toBe("https://x.test/registro?lang=es");
    expect(labelled("Hi", "en")).toBe("🤖 Alti · AI assistant\nHi");
  });

  it("is WhatsApp only: the record refuses any other channel, and nothing here sends SMS", () => {
    expect(readFileSync("supabase/migrations/0034_control_leads.sql", "utf8")).toMatch(/channel text not null default 'whatsapp' check \(channel = 'whatsapp'\)/);
    for (const file of ["src/lib/leads/autopilotServer.ts", "src/lib/leads/inboxServer.ts", "src/lib/control/alertsServer.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/sendSms|twilio|\/sms/i);
    }
  });
});

describe("✨ Suggest reply for a lead: the drafted-reply engine, facts only", () => {
  const thread = buildDemoLeadRecords(NOW).find((e) => e.lead.id === "lead-marcus")!;

  it("drafts in the lead's language from the service facts and the FAQ, and passes the rules", async () => {
    const calls: string[] = [];
    const outcome = await draftLeadReply({ lead: thread.lead, messages: thread.messages, locale: "en" }, async (call) => {
      calls.push(call.user);
      return demoLeadDraftCaller(call);
    });
    expect(outcome.ok).toBe(true);
    expect(calls[0]).toContain("PREGUNTAS FRECUENTES APROBADAS");
    expect(calls[0]).toContain("Escribe el borrador en INGLÉS");
    expect(LEAD_DRAFT_SYSTEM_PROMPT).toMatch(/Nunca des un precio/);
  });

  it("a draft that breaks a rule is asked again once, then none", async () => {
    const caller = vi.fn(async () => ({ reply: "We will remove the collection and your score will go up, guaranteed. It's $99.", problem: null }));
    const outcome = await draftLeadReply({ lead: thread.lead, messages: thread.messages, locale: "en" }, caller);
    expect(outcome).toMatchObject({ ok: false, code: "failed_rules" });
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("without the model key: no draft, no call, and why", async () => {
    expect(await draftLeadReply({ lead: thread.lead, messages: thread.messages, locale: "en" }, null)).toMatchObject({ ok: false, code: "not_configured" });
  });
});

describe("outside the 24 hours: the approved template", () => {
  it("passes the claim rules in both languages, and says how to stop", () => {
    for (const t of LEAD_TEMPLATES) {
      for (const lang of ["en", "es"] as const) {
        const text = renderLeadTemplate(t, lang, ["Rosa", "Ana"]);
        expect(checkClaimGuardrails(text)).toEqual([]);
        expect(checkMarketingCopy(text)).toEqual([]);
        expect(text).toMatch(lang === "en" ? /STOP/ : /BAJA/);
      }
    }
  });
});

describe("phone alerts: off until each person turns them on", () => {
  const member = (role: StaffRole, handle: string, on: boolean, minutes = 15): AlertMember => ({
    userId: handle,
    handle,
    role,
    prefs: Object.fromEntries(Object.entries(DEFAULT_ALERT_PREFS).map(([k, v]) => [k, { ...v, enabled: on, waitingMinutes: minutes }])) as AlertMember["prefs"],
  });

  it("everything starts off; nobody is alerted", () => {
    expect(Object.values(DEFAULT_ALERT_PREFS).every((p) => !p.enabled)).toBe(true);
    expect(prefsFromRows([])).toEqual(DEFAULT_ALERT_PREFS);
    expect(alertRecipients({ topic: "new_lead", salesperson: "ana" }, [member("admin", "carmen", false), member("sales", "ana", false)])).toEqual([]);
  });

  it("the people whose work it is, who turned the topic on", () => {
    const team = [member("admin", "carmen", true), member("sales", "ana", true, 30), member("sales", "luis", true), member("specialist", "marta", true)];
    expect(alertRecipients({ topic: "new_lead", salesperson: "ana" }, team).map((m) => m.handle)).toEqual(["carmen", "ana"]);
    expect(alertRecipients({ topic: "new_lead", salesperson: null }, team).map((m) => m.handle)).toEqual(["carmen", "ana", "luis"]);
    expect(alertRecipients({ topic: "lead_waiting", salesperson: "ana", waitedMinutes: 20 }, team).map((m) => m.handle)).toEqual(["carmen"]);
    expect(alertRecipients({ topic: "partner_note", specialist: "marta" }, team).map((m) => m.handle)).toEqual(["carmen", "marta"]);
    expect(alertRecipients({ topic: "escalation" }, team).map((m) => m.handle)).toEqual(["carmen"]);
    expect(topicsFor("sales")).not.toContain("partner_note");
  });

  it("carries a first name and an initial, never more", () => {
    expect(shortName("Rosa Elena Gutiérrez", "en")).toBe("Rosa G.");
    expect(shortName(null, "es")).toBe("un número nuevo");
  });

  it("web push: VAPID ES256 verifies with the public key; no keys, no push; only browser push services", async () => {
    const keys = generateVapidKeys();
    expect(pushConfig({})).toBeNull();
    expect(pushConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "nope" })).toBeNull();
    const config = pushConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:owner@credalti.test" })!;
    const jwt = vapidJwt("https://fcm.googleapis.com", config, NOW);
    const [h, p, s] = jwt.split(".");
    const raw = Buffer.from(keys.publicKey.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:owner@credalti.test" });
    expect(allowedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(allowedEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(allowedEndpoint("https://evil.test/fcm.googleapis.com")).toBe(false);
    expect(allowedEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    const fetcher = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendTickle("https://fcm.googleapis.com/fcm/send/abc", config, fetcher as unknown as typeof fetch, NOW)).toEqual({ ok: true, status: 201, gone: false });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^vapid t=.+, k=/);
    expect(init.body).toBeUndefined(); // No payload: nothing about a lead goes through the push service.
    expect(await sendTickle("https://evil.test/x", config, fetcher as unknown as typeof fetch)).toMatchObject({ ok: false, gone: true });
  });
});

describe("the Overview: real numbers, by role", () => {
  const clients = attachDemoAutopilot(buildDemoClients(NOW), NOW);
  const base = (role: StaffRole, over: Partial<OverviewInput> = {}): OverviewInput => ({
    clients,
    queue: workQueue(clients, NOW, { autopilot: { settings: DEFAULT_LEAD_AUTOPILOT as never, channels: { whatsapp: false, email: false, approvedTemplates: [], simulated: true } } } as never, role),
    leads: buildDemoLeads(NOW),
    extras: null,
    money: moneySummary(clients, NOW),
    can: (c) => can(role, c),
    now: NOW,
    locale: "en",
    ...over,
  });

  it("a salesperson never sees Money; a specialist sees no leads", () => {
    expect(overviewCards(base("sales")).map((c) => c.key)).toEqual(["leads", "clients", "support", "partners"]);
    // Content (docs/CONTROL.md «Content») is the content team's: administrators and specialists.
    expect(overviewCards(base("specialist")).map((c) => c.key)).toEqual(["clients", "money", "content", "support"]);
    expect(overviewCards(base("admin")).map((c) => c.key)).toEqual(["leads", "clients", "money", "content", "support", "partners", "health"]);
  });

  it("what could not be read says 'No data yet' and why, never 0", () => {
    const cards = overviewCards(base("admin", { leads: null, leadsError: "The leads could not be read right now.", extras: null, money: { ...moneySummary([], NOW) } }));
    const leads = cards.find((c) => c.key === "leads")!;
    expect(leads.metrics[0]).toMatchObject({ value: null, why: "The leads could not be read right now." });
    expect(leads.needsYou.count).toBeNull();
    expect(cards.find((c) => c.key === "money")!.metrics[0]).toMatchObject({ value: null });
    expect(cards.find((c) => c.key === "health")!.metrics[0]!.value).toBeNull();
    // No leads at all: not a fake 0.
    expect(overviewCards(base("admin", { leads: [] })).find((c) => c.key === "leads")!.metrics[0]!.value).toBeNull();
  });

  it("the Today list ranks complaints and escalations first, and every item has steps", () => {
    const items = todayList({ queue: base("admin").queue, leads: buildDemoLeads(NOW), escalations: [{ id: "e1", key: "x", title: "Refund question", note: null, by: "Ana", at: ago(HOUR) }], now: NOW, locale: "en" });
    expect(items[0]!.kind).toBe("escalation");
    expect(items[1]).toMatchObject({ kind: "lead_handoff" });
    expect(items[1]!.title).toMatch(/complaint/);
    for (const item of items) expect(item.steps.length, item.key).toBeGreaterThanOrEqual(3);
    const withoutLeads = todayList({ queue: base("specialist").queue, leads: null, now: NOW, locale: "es" });
    expect(withoutLeads.every((i) => i.kind === "queue")).toBe(true);
  });
});

describe("HighLevel's Conversations API: behind a switch, off by default", () => {
  it("no switch, no token: no provider, no call", () => {
    expect(conversationProviderName({})).toBe("none");
    expect(conversationProviderName({ LEAD_CONVERSATIONS_PROVIDER: "highlevel" })).toBe("none");
    expect(conversationProvider({})).toBeNull();
  });

  it("reads (never sends) with a mocked HighLevel", async () => {
    const fetcher = vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/search")
            ? { conversations: [{ id: "conv1" }] }
            : { messages: { messages: [{ id: "m1", body: "Hola", direction: "inbound", dateAdded: ago(HOUR) }, { id: "m2", body: "Hi!", direction: "outbound", dateAdded: ago(30 * MIN) }] } },
        ),
        { status: 200 },
      ),
    );
    const provider = highlevelConversations({ HIGHLEVEL_API_TOKEN: "t", HIGHLEVEL_LOCATION_ID: "loc" }, fetcher as unknown as typeof fetch);
    const read = await provider.messages("hlDemo0152");
    expect(read).toMatchObject({ ok: true });
    expect(read.ok && read.messages.map((m) => [m.role, m.source])).toEqual([["user", "highlevel"], ["assistant", "highlevel"]]);
    for (const call of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) expect(call[1].method ?? "GET").toBe("GET");
    expect(await provider.messages("bad id!")).toEqual({ ok: false, reason: "bad_contact" });
  });
});

describe("roles, navigation, words", () => {
  it("leads.work is sales' and the owner's; the autopilot switch only the owner's", () => {
    expect(CAPABILITIES).toContain("leads.work");
    expect((Object.keys(ROLE_PERMISSIONS) as StaffRole[]).filter((r) => can(r, "leads.work"))).toEqual(["admin", "sales"]);
    expect(can("sales", "autopilot.manage")).toBe(false);
    expect(PRIMARY_NAV.map((n) => n.href)).toEqual(["/equipo", "/equipo/control", "/equipo/leads", "/equipo/clientes", "/equipo/respuestas"]);
    expect(MORE_NAV.some((n) => n.href === "/equipo/alertas")).toBe(true);
  });

  it("every table has both languages, and no Spanish in the English", () => {
    const SPANISH = /[áéíóúñ¿¡]|\b(el|la|los|las|del|que|para|con|sin|una|es|está|cliente|equipo|aquí|hoy|todavía|nada|cuando|pero|hay|solo|socio|piloto)\b/i;
    const tables: Array<Record<"en" | "es", unknown>> = [STAGE_LABELS, STAGE_HELP, SOURCE_LABELS, HANDOFF_LABELS, TOPIC_TEXT, TODAY_PROCEDURES, QUALITY_TEXT, OVERVIEW_TEXT];
    const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : typeof v === "function" ? [String((v as (n: number) => string)(2))] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
    for (const table of tables) {
      const en = strings(table.en);
      const es = strings(table.es);
      expect(en.length).toBe(es.length);
      for (const text of en) expect(text.replace(/Credalti|Alti|HighLevel|WhatsApp|CR-…/g, ""), text).not.toMatch(SPANISH);
    }
  });
});
