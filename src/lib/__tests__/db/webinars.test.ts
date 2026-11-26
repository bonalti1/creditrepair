import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChannelAvailability } from "../../autopilot/types";
import { WEBINAR_TEMPLATE_NAMES } from "../../webinars/reminders";
import { REMINDERS_CONSENT } from "../../webinars/publicCopy";
import { remindersConsentHash, runWebinarReminders, type ReminderDeliver } from "../../webinars/server";
import { webinarUnsubscribeToken } from "../../webinars/unsubscribe";
import { startHarness, type Harness } from "./pg";
import { addStaff } from "./seed";

// Migration 0044 against the real migrations, with row level security:
// webinars, registrations, the reminders' log, campaigns, costs, purchases,
// and a person in the signup chat. The routes run as in production with the
// two Supabase clients swapped for the test database's: the public
// registration (/api/webinars), the unsubscribe link, the staff routes
// (/api/staff/webinars, /api/staff/signup-chats), the person's chat
// (/api/signup/chat), and the reminders' run with a mocked sender.

const session = vi.hoisted(() => ({ reader: null as unknown, admin: null as unknown }));
vi.mock("@/lib/supabase/server", () => {
  const user = async () => {
    const reader = session.reader as SupabaseClient | null;
    return reader ? (await reader.auth.getUser()).data.user : null;
  };
  return {
    getServerSupabase: async () => session.reader,
    getSessionUser: user,
    resolveActingUser: async () => {
      const u = await user();
      return u ? { userId: u.id, via: "session" as const } : null;
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => session.admin }));

let h: Harness;
let ip = 0;
const as = (who: SupabaseClient | null) => {
  session.reader = who;
  session.admin = h.service;
};
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.44.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let webinarId: string;
let startsAt: Date;

const CHANNELS: ChannelAvailability = { whatsapp: true, email: true, approvedTemplates: WEBINAR_TEMPLATE_NAMES, simulated: false };
const registration = (over: Record<string, unknown> = {}) => ({
  slug: "reporte-explicado",
  firstName: "Rosa",
  lastName: "Martínez",
  phone: "(713) 555-0142",
  email: "rosa@example.com",
  state: "TX",
  locale: "es",
  goal: "home",
  timeline: "months_6",
  question: "¿Cuánto tarda un buró?",
  remindersConsent: true,
  consentVersion: REMINDERS_CONSENT.version,
  attribution: { utm: { source: "facebook", campaign: "111" }, ad: { campaignId: "111111", via: "link" } },
  ...over,
});
const count = async (reader: SupabaseClient, table: string) => {
  const { data, error } = await reader.from(table).select("*");
  return error ? `error: ${error.message}` : ((data as unknown[] | null) ?? []).length;
};

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
  process.env.N8N_WEBHOOK_SECRET = "test-n8n-secret";
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  // Two days ahead, on the hour, at 7 p.m. Texas: whatever the clock now, it is ahead.
  const day = new Date(Date.now() + 2 * DAY).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const route = await import("@/app/api/staff/webinars/route");
  as(h.as(admin.userId));
  const saved = await json(
    await route.POST(
      request("/api/staff/webinars", {
        action: "save_webinar",
        slug: "reporte-explicado",
        titleEn: "Your credit report, explained",
        titleEs: "Tu reporte de crédito, explicado",
        host: "Daniela Ruiz",
        day,
        time: "19:00",
        durationMinutes: 45,
        language: "es",
        topic: "Your rights, in plain words",
        campaignTag: "webinar-test-1",
        keyword: "credit",
        links: { zoom: "https://zoom.us/j/1", facebook: null, youtube: null, instagram: null, tiktok: null },
        replayUrl: null,
      }),
    ),
  );
  expect(saved.status).toBe(200);
  webinarId = String((saved.body.webinar as { id: string }).id);
  startsAt = new Date(String((saved.body.webinar as { startsAt: string }).startsAt));
}, 60_000);

afterAll(() => {
  delete process.env.UNSUBSCRIBE_SECRET;
  delete process.env.N8N_WEBHOOK_SECRET;
});

describe("webinars: creating and publishing (webinars.manage)", () => {
  it("saves a draft with the keyword in capitals; refuses words that break a rule; only an administrator", async () => {
    const [row] = await h.sql<{ status: string; keyword: string }>(`select status, keyword from public.webinars where id = $1`, [webinarId]);
    expect(row).toEqual({ status: "draft", keyword: "CREDIT" });
    const route = await import("@/app/api/staff/webinars/route");
    as(h.as(admin.userId));
    const free = await json(await route.POST(request("/api/staff/webinars", { action: "save_webinar", slug: "free-class", titleEn: "Free credit class", titleEs: "Clase gratis", host: "Daniela", day: "2026-12-30", time: "19:00", durationMinutes: 45, language: "es", topic: "", keyword: "CREDIT", links: {}, replayUrl: null })));
    expect(free).toMatchObject({ status: 422, body: { code: "copy_rules" } });
    as(h.as(marta.userId));
    expect((await route.POST(request("/api/staff/webinars", { action: "publish", id: webinarId }))).status).toBe(403);
    as(h.as(ana.userId));
    expect((await route.POST(request("/api/staff/webinars", { action: "publish", id: webinarId }))).status).toBe(403);
  });

  it("a draft has no public page and takes no registration", async () => {
    const reg = await import("@/app/api/webinars/route");
    as(null);
    expect((await reg.POST(request("/api/webinars", registration()))).status).toBe(404);
  });

  it("publishes; a published one never goes back to draft or changes its link; never deleted", async () => {
    const route = await import("@/app/api/staff/webinars/route");
    as(h.as(admin.userId));
    expect((await json(await route.POST(request("/api/staff/webinars", { action: "publish", id: webinarId })))).status).toBe(200);
    await expect(h.sql(`update public.webinars set status = 'draft' where id = $1`, [webinarId])).rejects.toThrow(/does not go back to draft/);
    await expect(h.sql(`update public.webinars set slug = 'otro' where id = $1`, [webinarId])).rejects.toThrow(/link of a published webinar/);
    await expect(h.sql(`delete from public.webinars where id = $1`, [webinarId])).rejects.toThrow(/never deleted/);
  });
});

describe("webinars: the public registration", () => {
  it("registers a Texan once, with the consent's version and hash and the ad's tags", async () => {
    const reg = await import("@/app/api/webinars/route");
    as(null);
    const first = await json(await reg.POST(request("/api/webinars", registration())));
    expect(first).toMatchObject({ status: 200, body: { ok: true, already: false, served: "texas" } });
    const again = await json(await reg.POST(request("/api/webinars", registration({ firstName: "Rosa Elena" }))));
    expect(again.body).toMatchObject({ ok: true, already: true });
    const rows = await h.sql<{ phone_e164: string; consent_version: string; consent_text_hash: string; attribution: { ad?: { campaignId?: string } }; served: string }>(`select * from public.webinar_registrations where webinar_id = $1`, [webinarId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phone_e164: "+17135550142", consent_version: REMINDERS_CONSENT.version, consent_text_hash: remindersConsentHash("es"), served: "texas" });
    expect(rows[0]!.attribution.ad?.campaignId).toBe("111111");
  });

  it("other states may learn (out of state); Georgia is refused, here and by the database", async () => {
    const reg = await import("@/app/api/webinars/route");
    as(null);
    expect((await json(await reg.POST(request("/api/webinars", registration({ phone: "7135550150", email: "luis@example.com", state: "CA", remindersConsent: false }))))).body).toMatchObject({ served: "out_of_state" });
    expect(await json(await reg.POST(request("/api/webinars", registration({ phone: "7135550151", state: "GA" }))))).toMatchObject({ status: 422, body: { code: "georgia" } });
    await expect(
      h.sql(`insert into public.webinar_registrations (webinar_id, first_name, phone_e164, state, served, locale, goal, timeline, reminders_consent) values ($1, 'X', '+17135550199', 'GA', 'out_of_state', 'en', 'learning', 'learning', false)`, [webinarId]),
    ).rejects.toThrow();
    expect((await reg.POST(request("/api/webinars", registration({ phone: "7135550152", consentVersion: "old" })))).status).toBe(409);
  });

  it("what the person gave never changes, and a registration is never deleted", async () => {
    await expect(h.sql(`update public.webinar_registrations set phone_e164 = '+17135550100' where webinar_id = $1`, [webinarId])).rejects.toThrow(/never changes/);
    await expect(h.sql(`delete from public.webinar_registrations where webinar_id = $1`, [webinarId])).rejects.toThrow(/never deleted/);
  });
});

describe("webinars: who reads what (row level security)", () => {
  it("staff read webinars; administrators and sales read registrations; only administrators read campaigns and reminders; anon nothing", async () => {
    expect(await count(h.as(marta.userId), "webinars")).toBe(1);
    expect(await count(h.as(marta.userId), "webinar_registrations")).toBe(0);
    expect(await count(h.as(ana.userId), "webinar_registrations")).toBe(2);
    expect(await count(h.as(admin.userId), "webinar_registrations")).toBe(2);
    expect(await count(h.as(ana.userId), "campaigns")).toBe(0);
    expect(await count(h.as(ana.userId), "webinar_messages")).toBe(0);
    for (const table of ["webinars", "webinar_registrations", "campaigns", "signup_chat_threads", "signup_chat_messages"]) {
      const n = await count(h.anon, table);
      expect(n === 0 || (typeof n === "string" && /permission denied/.test(n)), table).toBe(true);
    }
  });

  it("the route gives a specialist the counts and first names, never a phone or an email", async () => {
    const route = await import("@/app/api/staff/webinars/route");
    as(h.as(marta.userId));
    const detail = await json(await route.GET(request(`/api/staff/webinars?id=${webinarId}`)));
    expect(detail.status).toBe(200);
    const regs = detail.body.registrants as Array<{ name: string; phone: string | null; email: string | null; question: string | null }>;
    expect(regs).toHaveLength(2);
    expect(regs.every((r) => r.phone === null && r.email === null && r.question === null)).toBe(true);
    expect(regs.map((r) => r.name)).toContain("Rosa M.");
    expect(JSON.stringify(detail.body)).not.toContain("+1713555");
    expect(detail.body.reminders).toBeNull();
    as(h.as(ana.userId));
    const forSales = await json(await route.GET(request(`/api/staff/webinars?id=${webinarId}`)));
    expect((forSales.body.registrants as Array<{ phone: string }>).map((r) => r.phone)).toContain("+17135550142");
    expect((await route.GET(request("/api/staff/webinars?campaigns=1"))).status).toBe(403);
  });
});

describe("webinars: the reminders", () => {
  const sent: Array<{ kind: string; channel: string; to: string }> = [];
  const deliver: ReminderDeliver = async (r, m) => {
    sent.push({ kind: m.kind, channel: m.channel, to: r.phone });
    return { ok: true, providerRef: "wamid.test" };
  };

  it("1 hour before: the consenting Texan gets it once; a second run sends nothing", async () => {
    const at = new Date(startsAt.getTime() - 50 * 60_000);
    const first = await runWebinarReminders(h.service, at, { deliver, channels: CHANNELS, env: { NEXT_PUBLIC_APP_URL: "https://app.test", NEXT_PUBLIC_SITE_URL: "https://credalti.test" } });
    expect(first).toMatchObject({ webinars: 1, registrations: 1, sent: 1, failed: 0 });
    expect(sent).toEqual([{ kind: "hour", channel: "whatsapp", to: "+17135550142" }]);
    const second = await runWebinarReminders(h.service, at, { deliver, channels: CHANNELS });
    expect(second.sent).toBe(0);
    const [log] = await h.sql<{ dedupe_key: string; status: string; template: string; body: string }>(`select * from public.webinar_messages where webinar_id = $1`, [webinarId]);
    expect(log).toMatchObject({ status: "sent", template: "credalti_webinar_una_hora" });
    expect(log!.dedupe_key).toMatch(/^webinar:[0-9a-f-]{36}:hour$/);
    expect(log!.body).toContain("https://credalti.test/webinar/reporte-explicado?lang=es");
    // A settled message never changes, and there is no SMS channel.
    await expect(h.sql(`update public.webinar_messages set status = 'failed' where webinar_id = $1`, [webinarId])).rejects.toThrow(/settled/);
    await expect(h.sql(`insert into public.webinar_messages (registration_id, webinar_id, kind, channel, locale, body, dedupe_key) select id, webinar_id, 'live', 'sms', 'es', 'x', 'webinar:x:sms' from public.webinar_registrations limit 1`)).rejects.toThrow();
  });

  it("the email's unsubscribe link stops every automatic message to that number", async () => {
    const [row] = await h.sql<{ id: string }>(`select id from public.webinar_registrations where phone_e164 = '+17135550142'`);
    const route = await import("@/app/api/webinars/unsubscribe/route");
    as(null);
    expect((await route.POST(request(`/api/webinars/unsubscribe?r=${row!.id}&t=wrong`, {}))).status).toBe(400);
    const ok = await json(await route.POST(request(`/api/webinars/unsubscribe?r=${row!.id}&t=${webinarUnsubscribeToken(row!.id, "test-unsubscribe-secret")}`, {})));
    expect(ok).toMatchObject({ status: 200, body: { ok: true } });
    const [opt] = await h.sql<{ kind: string; phone_e164: string }>(`select kind, phone_e164 from public.message_opt_outs where phone_e164 = '+17135550142'`);
    expect(opt).toEqual({ kind: "opt_out", phone_e164: "+17135550142" });
    sent.length = 0;
    const live = await runWebinarReminders(h.service, new Date(startsAt.getTime() + 5 * 60_000), { deliver, channels: CHANNELS });
    expect(live.sent).toBe(0);
    expect(sent).toEqual([]);
  });

  it("the cron route needs the shared secret and records its heartbeat", async () => {
    const route = await import("@/app/api/cron/webinars/route");
    as(null);
    expect((await route.POST(request("/api/cron/webinars", {}))).status).toBe(401);
    const res = await route.POST(request("/api/cron/webinars", {}, { "x-webhook-secret": "test-n8n-secret" }));
    expect([200, 500]).toContain(res.status);
    const [beat] = await h.sql<{ job: string }>(`select job from public.cron_heartbeats where job = 'webinars'`);
    expect(beat).toEqual({ job: "webinars" });
  });
});

describe("webinars: attendance and the campaign scorecard", () => {
  it("imports Zoom's CSV: a preview first, then the matches are saved", async () => {
    const route = await import("@/app/api/staff/webinars/route");
    as(h.as(admin.userId));
    const csv = "Attended,User Name (Original Name),Email,Phone,Time in Session (minutes)\nYes,Rosa,ROSA@example.com,,32\nYes,Stranger,x@example.com,,5\n";
    const preview = await json(await route.POST(request("/api/staff/webinars", { action: "attendance", id: webinarId, csv, apply: false })));
    expect(preview.body).toMatchObject({ attendees: 2, matched: 1, unmatched: 1 });
    expect((await h.sql<{ n: number }>(`select count(*)::int n from public.webinar_registrations where attended`))[0]!.n).toBe(0);
    expect((await json(await route.POST(request("/api/staff/webinars", { action: "attendance", id: webinarId, csv, apply: true })))).body).toMatchObject({ matched: 1 });
    const [rosa] = await h.sql<{ attended: boolean; attended_minutes: number; attendance_source: string }>(`select attended, attended_minutes, attendance_source from public.webinar_registrations where phone_e164 = '+17135550142'`);
    expect(rosa).toEqual({ attended: true, attended_minutes: 32, attendance_source: "zoom_csv" });
  });

  it("an administrator makes a campaign with its webinar and costs; a cost is voided, never deleted", async () => {
    const route = await import("@/app/api/staff/webinars/route");
    as(h.as(admin.userId));
    const made = await json(await route.POST(request("/api/staff/webinars", { action: "save_campaign", name: "Webinar test #1", startDay: "2026-01-01", endDay: "2026-12-31", budgetCents: 100_000, metaCampaignIds: ["111111"], webinarIds: [webinarId], keywords: ["credit"], organicSources: ["instagram"], note: null })));
    expect(made.status).toBe(200);
    const campaignId = String(made.body.id);
    expect((await json(await route.POST(request("/api/staff/webinars", { action: "add_cost", campaignId, label: "Zoom Webinars", kind: "tools", amountCents: 7_900, day: "2026-11-20" })))).status).toBe(200);
    const view = await json(await route.GET(request("/api/staff/webinars?campaigns=1")));
    const card = (view.body.scorecards as Array<{ campaign: { id: string; webinarIds: string[]; keywords: string[] }; spend: { otherCents: number }; funnel: { registered: number; attended: number }; cac: { blended: { state: string } } }>)[0]!;
    expect(card.campaign).toMatchObject({ id: campaignId, webinarIds: [webinarId], keywords: ["CREDIT"] });
    expect(card.spend.otherCents).toBe(7_900);
    expect(card.funnel).toMatchObject({ registered: 2, attended: 1 });
    expect(card.cac.blended.state).toBe("not_enough");
    const [cost] = await h.sql<{ id: string }>(`select id from public.campaign_costs limit 1`);
    await expect(h.sql(`delete from public.campaign_costs where id = $1`, [cost!.id])).rejects.toThrow(/never deleted/);
    expect((await json(await route.POST(request("/api/staff/webinars", { action: "void_cost", id: cost!.id })))).status).toBe(200);
    await expect(h.sql(`update public.campaign_costs set amount_cents = 1 where id = $1`, [cost!.id])).rejects.toThrow(/does not change/);
  });
});

describe("a person joins Alti's signup chat", () => {
  let caseRef: string;
  let token: string;

  it("the person asks for a human; Alti answers from the library while nobody is in", async () => {
    const signup = await import("@/app/api/signup/route");
    const chat = await import("@/app/api/signup/chat/route");
    as(null);
    const started = (await json(await signup.POST(request("/api/signup", { action: "start", locale: "es" })))).body as { caseRef: string; token: string };
    caseRef = started.caseRef;
    token = started.token;
    expect((await chat.POST(request("/api/signup/chat", { action: "request", caseRef, token: "f".repeat(64), locale: "es" }))).status).toBe(404);
    const asked = await json(await chat.POST(request("/api/signup/chat", { action: "request", caseRef, token, locale: "es" })));
    expect(asked.body).toMatchObject({ ok: true, thread: { status: "requested" } });
    const [c] = await h.sql<{ wants_person: boolean }>(`select wants_person from public.signup_cases where case_ref = $1`, [caseRef]);
    expect(c!.wants_person).toBe(true);
    const sent = await json(await chat.POST(request("/api/signup/chat", { action: "send", caseRef, token, locale: "es", text: "Mi seguro es 123-45-6789, ¿lo necesitan?" })));
    const lines = (sent.body.thread as { messages: Array<{ author: string; text: string }> }).messages;
    expect(lines.find((m) => m.author === "person")!.text).not.toMatch(/123-45-6789/);
    expect(lines.filter((m) => m.author === "alti").length).toBe(2);
  });

  it("sales sees it waiting (a red circle), joins, and Alti pauses; the database refuses Alti while a person is in", async () => {
    const staff = await import("@/app/api/staff/signup-chats/route");
    as(h.as(marta.userId));
    expect((await staff.GET(request("/api/staff/signup-chats"))).status).toBe(403);
    as(h.as(ana.userId));
    expect((await json(await staff.GET(request("/api/staff/signup-chats?count=1")))).body).toEqual({ waiting: 1 });
    expect(((await json(await staff.GET(request("/api/staff/signup-chats")))).body.threads as unknown[]).length).toBe(1);
    // Writing before joining is refused.
    expect((await json(await staff.POST(request("/api/staff/signup-chats", { action: "reply", caseRef, text: "Hola" })))).body).toMatchObject({ code: "join_first" });
    const joined = await json(await staff.POST(request("/api/staff/signup-chats", { action: "join", caseRef })));
    expect(joined.body).toMatchObject({ ok: true, thread: { status: "joined", joinedBy: "Ana" } });
    expect((await json(await staff.GET(request("/api/staff/signup-chats?count=1")))).body).toEqual({ waiting: 0 });
    await expect(h.sql(`insert into public.signup_chat_messages (case_ref, author, body) values ($1, 'alti', 'x')`, [caseRef])).rejects.toThrow(/Alti is paused/);
    const chat = await import("@/app/api/signup/chat/route");
    as(null);
    const quiet = await json(await chat.POST(request("/api/signup/chat", { action: "send", caseRef, token, locale: "es", text: "¿Sigues ahí?" })));
    const lines = (quiet.body.thread as { messages: Array<{ author: string }> }).messages;
    expect(lines[lines.length - 1]!.author).toBe("person");
  });

  it("a teammate's reply passes the staff reply checks; the line carries their name; hand back brings Alti back", async () => {
    const staff = await import("@/app/api/staff/signup-chats/route");
    as(h.as(ana.userId));
    const promise = await json(await staff.POST(request("/api/staff/signup-chats", { action: "reply", caseRef, text: "Tranquila, esa cobranza se va a eliminar." })));
    expect(promise).toMatchObject({ status: 422, body: { code: "reply_rules" } });
    const ok = await json(await staff.POST(request("/api/staff/signup-chats", { action: "reply", caseRef, text: "¡Hola! No necesitas mandar tu número por aquí. Sigue con el registro y te acompaño." })));
    const last = (ok.body.thread as { messages: Array<{ author: string; staffName: string }> }).messages.at(-1)!;
    expect(last).toMatchObject({ author: "staff", staffName: "Ana" });
    const back = await json(await staff.POST(request("/api/staff/signup-chats", { action: "hand_back", caseRef })));
    expect(back.body).toMatchObject({ thread: { status: "handed_back" } });
    const chat = await import("@/app/api/signup/chat/route");
    as(null);
    const again = await json(await chat.POST(request("/api/signup/chat", { action: "send", caseRef, token, locale: "es", text: "Gracias" })));
    expect((again.body.thread as { messages: Array<{ author: string }> }).messages.at(-1)!.author).toBe("alti");
    await expect(h.sql(`delete from public.signup_chat_messages where case_ref = $1`, [caseRef])).rejects.toThrow(/append-only/);
  });
});
