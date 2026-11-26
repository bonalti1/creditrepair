import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLeads } from "../../leads/inboxServer";
import { countFunnelForCampaign, hashToken, readReview, replyToKeyword, runRetention, sendVideo, trackVideo, videoForToken, type SendDeps } from "../../live/server";
import { parseKeywords, matchKeyword } from "../../live/keywords";
import { twilioSignature } from "../../live/sms";
import { signMetaPayload } from "../../security/signatures";
import { resetRateLimits } from "../../security/rateLimit";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff, signAgreement } from "./seed";

// Migration 0043 (the live funnel, docs/LIVE-FUNNEL.md) against the real
// migrations: row level security on the funnel's records and files, the
// WhatsApp keyword reply through the real webhook (WhatsApp mocked), the /live
// form and upload, the AI reading (simulated: no key), the review queue, the
// personal video and its private link, the comment hand-off, the SMS channel
// (off by default; Twilio mocked when on), retention and the import into the
// case.

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
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.43.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (path: string) => new Request(`https://app.test${path}`, { headers: { "x-forwarded-for": `10.43.${Math.floor(++ip / 250)}.${ip % 250}` } });

const sent: Array<{ url: string; body: string }> = [];
const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const href = String(url instanceof Request ? url.url : url);
  sent.push({ url: href, body: typeof init?.body === "string" ? init.body : "" });
  if (href.includes("api.twilio.com")) return new Response(JSON.stringify({ sid: "SM-test" }), { status: 201 });
  return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 });
});

const APP_SECRET = "meta-app-secret";
const waPayload = (from: string, text: string, id: string, timestamp = Math.floor(Date.now() / 1000)) =>
  JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from, timestamp: String(timestamp), type: "text", text: { body: text } }] } }] }] });
const whatsapp = async (from: string, text: string, id: string, timestamp?: number) => {
  const webhook = await import("@/app/api/webhooks/whatsapp/route");
  const body = waPayload(from, text, id, timestamp);
  return webhook.POST(new Request("https://app.test/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signMetaPayload(body, APP_SECRET) }, body }));
};
const waSends = () => sent.filter((s) => s.url.includes("graph.facebook.com"));
const leadByPhone = async (phone: string) => (await h.sql<Record<string, unknown>>(`select * from public.leads where phone_e164 = $1`, [phone]))[0] ?? null;
const liveOf = async (leadId: string) => (await h.sql<Record<string, unknown>>(`select * from public.live_leads where lead_id = $1`, [leadId]))[0] ?? null;

let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.WHATSAPP_ACCESS_TOKEN = "wa-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = "https://credalti.test";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LIVE_KEYWORDS;
  vi.stubGlobal("fetch", fetchMock);
  h = await startHarness();
  session.admin = h.service;
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
}, 90_000);

beforeEach(() => resetRateLimits());

afterAll(async () => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "NEXT_PUBLIC_APP_URL", "SMS_FUNNEL_ENABLED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "LIVE_FUNNEL_WEBHOOK_SECRET"]) delete process.env[k];
  vi.unstubAllGlobals();
  await h?.pg.close();
});

describe("the keyword on WhatsApp, through the real webhook", () => {
  const PHONE = "+17135550311";

  it("CREDIT from a new number: one reply from Alti with the /live link; the lead starts with the funnel as its first touch", async () => {
    sent.length = 0;
    const res = await whatsapp("17135550311", "Credit!", "wamid.kw1");
    expect(res.status).toBe(200);
    expect(waSends()).toHaveLength(1);
    const out = JSON.parse(waSends()[0]!.body) as { to: string; text: { body: string } };
    expect(out.to).toBe("17135550311");
    expect(out.text.body.split("\n")[0]).toBe("🤖 Alti · AI assistant");
    expect(out.text.body).toContain("https://credalti.test/live?src=whatsapp&kw=credit&lang=en");
    const lead = await leadByPhone(PHONE);
    expect(lead).toMatchObject({ source: "whatsapp", first_touch: { channel: "whatsapp", funnel: { tag: "webinar", keyword: "CREDIT", platform: "whatsapp" } } });
    expect(await liveOf(String(lead!.id))).toMatchObject({ tag: "webinar", keyword: "CREDIT", platform: "whatsapp" });
    // The reply is in the conversation as Alti's (and stops the greeting and the autopilot from answering again).
    const chat = await h.sql<{ role: string; source: string; body: string }>(`select role, source, body from public.chat_messages where phone_e164 = $1 order by created_at`, [PHONE]);
    expect(chat.map((m) => [m.role, m.source])).toEqual([["user", "journey"], ["assistant", "journey"]]);
    expect(await h.sql(`select status, channel, keyword from public.live_replies where phone_e164 = $1`, [PHONE])).toEqual([{ status: "sent", channel: "whatsapp", keyword: "CREDIT" }]);
  });

  it("never twice for the same person and keyword in the window; a redelivery of the same message is ignored", async () => {
    sent.length = 0;
    await whatsapp("17135550311", "CREDIT", "wamid.kw2");
    await whatsapp("17135550311", "Credit!", "wamid.kw1");
    expect(waSends()).toHaveLength(0);
    // Another keyword is another reply.
    await whatsapp("17135550311", "webinar", "wamid.kw3");
    expect(waSends()).toHaveLength(1);
  });

  it("a Spanish keyword gets the Spanish reply with a campaign tag; STOP stops it; a client gets their assistant", async () => {
    sent.length = 0;
    await whatsapp("17135550312", "Crédito #webinar-nov", "wamid.es1");
    const body = (JSON.parse(waSends()[0]!.body) as { text: { body: string } }).text.body;
    expect(body.split("\n")[0]).toBe("🤖 Alti · Asistente con IA");
    expect(body).toContain("c=webinar-nov");
    expect((await leadByPhone("+17135550312"))!.first_touch).toMatchObject({ campaign: "webinar-nov" });

    sent.length = 0;
    await whatsapp("17135550313", "BAJA", "wamid.stop1");
    sent.length = 0;
    await whatsapp("17135550313", "CREDIT", "wamid.stop2");
    expect(waSends()).toHaveLength(0);

    await addClient(h, { name: "Cliente Ya", phone: "+17135550314" });
    sent.length = 0;
    await whatsapp("17135550314", "CREDIT", "wamid.client1");
    expect(await h.sql(`select 1 from public.live_replies where phone_e164 = '+17135550314'`)).toEqual([]);
    // The client's assistant answered (the usual fallback reply), not the funnel.
    expect(waSends()).toHaveLength(1);
    expect((JSON.parse(waSends()[0]!.body) as { text: { body: string } }).text.body).not.toContain("/live");
  });

  it("in quiet hours: a reply to a message just sent goes; a late delivery waits for a person", async () => {
    const match = matchKeyword("CREDIT", parseKeywords(""))!;
    const night = new Date("2026-12-03T08:00:00.000Z"); // 2 a.m. in Texas
    const send = vi.fn(async () => ({ sent: true }));
    const late = await replyToKeyword(h.service, { channel: "whatsapp", phone: "+17135550315", match, inboundRef: "late-1", inboundAt: new Date(night.getTime() - 40 * 60_000).toISOString(), isClient: false, savedLocale: null, appUrl: "https://credalti.test", now: night }, { send });
    expect(late).toMatchObject({ sent: false, skipped: "quiet_hours" });
    const fresh = await replyToKeyword(h.service, { channel: "whatsapp", phone: "+17135550315", match, inboundRef: "fresh-1", inboundAt: new Date(night.getTime() - 60_000).toISOString(), isClient: false, savedLocale: null, appUrl: "https://credalti.test", now: night }, { send });
    expect(fresh).toMatchObject({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("/live: the form, the report, the reading", () => {
  const PHONE = "+17135550321";
  let token = "";

  it("only an opened state proceeds; Georgia is refused; the consents are required", async () => {
    const route = await import("@/app/api/live/route");
    const base = { firstName: "Rosa", phone: "(713) 555-0321", email: "rosa@example.com", state: "TX", goal: "mortgage", locale: "es", consentMessages: true, consentReport: true, origin: { src: "webinar", kw: "credit", c: "webinar-nov" }, attribution: { utm: { source: "facebook", campaign: "Webinar Nov" } } };
    expect((await route.POST(post("/api/live", { ...base, state: "GA" }))).status).toBe(403);
    expect((await route.POST(post("/api/live", { ...base, state: "CA" }))).status).toBe(409);
    expect((await route.POST(post("/api/live", { ...base, consentReport: false }))).status).toBe(400);
    expect((await route.POST(post("/api/live", { ...base, phone: "12345" }))).status).toBe(400);
    const ok = await json(await route.POST(post("/api/live", base)));
    expect(ok.status).toBe(200);
    token = String(ok.body.uploadToken);
    const lead = await leadByPhone(PHONE);
    expect(lead).toMatchObject({ source: "live", display_name: "Rosa", locale: "es", first_touch: { campaign: "webinar-nov", utm: { source: "facebook" }, funnel: { tag: "webinar", keyword: "CREDIT" } } });
    const live = await liveOf(String(lead!.id));
    expect(live).toMatchObject({ first_name: "Rosa", state: "TX", goal: "mortgage", email: "rosa@example.com", consent_sms_at: null });
    expect(String(live!.consent_report_text)).toMatch(/se borra después de 30 días/);
    expect(live!.upload_token_hash).toBe(hashToken(token));
  });

  it("the report goes to the private bucket and is read (simulated without a key) into an overview", async () => {
    const route = await import("@/app/api/live/report/route");
    const form = new FormData();
    form.set("token", token);
    form.append("file", new File([new TextEncoder().encode("<html><body>Equifax credit report</body></html>")], "equifax.html", { type: "text/html" }));
    const res = await route.POST(new Request("https://app.test/api/live/report", { method: "POST", body: form, headers: { "x-forwarded-for": "10.43.200.1" } }));
    expect(res.status).toBe(200);
    const [review] = await h.sql<{ id: string; status: string; simulated: boolean; overview: Record<string, unknown> | null; delete_after: Date }>(`select * from public.live_reviews`);
    expect(review).toMatchObject({ status: "ready", simulated: true });
    expect(review!.overview).toMatchObject({ version: 1, fit: { suggested: "complete" } });
    expect(Math.round((review!.delete_after.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect([...h.files.keys()].filter((k) => k.startsWith("live-reports/"))).toHaveLength(1);
    // A bad token, or a file that is not a report, is refused.
    const bad = new FormData();
    bad.set("token", "x".repeat(32));
    bad.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], "photo.jpg"));
    expect((await route.POST(new Request("https://app.test/api/live/report", { method: "POST", body: bad, headers: { "x-forwarded-for": "10.43.200.2" } }))).status).toBe(401);
  });
});

describe("who reads what", () => {
  it("reviews, files and videos: administrators and specialists; sales and anon nothing; sales reads the funnel line of its lead", async () => {
    const lead = await leadByPhone("+17135550321");
    expect((await h.as(admin.userId).from("live_reviews").select("id")).data).toHaveLength(1);
    expect((await h.as(marta.userId).from("live_reviews").select("id, overview")).data).toHaveLength(1);
    expect((await h.as(ana.userId).from("live_reviews").select("id")).data).toEqual([]);
    expect((await h.as(ana.userId).from("live_report_files").select("id")).data).toEqual([]);
    expect((await h.anon.from("live_reviews").select("id")).data ?? []).toEqual([]);
    expect((await h.anon.from("live_leads").select("lead_id")).data ?? []).toEqual([]);
    // Sales sees the funnel facts of a lead nobody has yet (their policy for leads), never the report.
    expect((await h.as(ana.userId).from("live_leads").select("lead_id").eq("lead_id", String(lead!.id))).data).toHaveLength(1);
    // The specialist reads the funnel row of a lead in review, but not the lead itself.
    expect((await h.as(marta.userId).from("live_leads").select("first_name").eq("lead_id", String(lead!.id))).data).toEqual([{ first_name: "Rosa" }]);
    expect((await h.as(marta.userId).from("leads").select("id")).data).toEqual([]);
    // Both buckets are private.
    expect(await h.sql(`select id, public from storage.buckets where id like 'live-%' order by id`)).toEqual([{ id: "live-reports", public: false }, { id: "live-videos", public: false }]);
  });

  it("nobody rewrites the record: a reply's words, a first touch, a video's file", async () => {
    await expect(h.sql(`update public.live_replies set body = 'x'`)).rejects.toThrow(/never changes/);
    await expect(h.sql(`delete from public.live_replies`)).rejects.toThrow(/kept/);
    const lead = await leadByPhone("+17135550321");
    await h.sql(`update public.live_leads set tag = 'ad', campaign = 'other' where lead_id = $1`, [lead!.id]);
    expect(await liveOf(String(lead!.id))).toMatchObject({ tag: "webinar", campaign: "webinar-nov" });
  });
});

describe("the review queue and the personal video", () => {
  let reviewId = "";
  let videoId = "";

  it("the queue: a specialist reads it with the overview; sales is refused", async () => {
    const route = await import("@/app/api/staff/live/route");
    as(h.as(marta.userId));
    const answer = await json(await route.GET(get("/api/staff/live")));
    expect(answer.status).toBe(200);
    const items = answer.body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ firstName: "Rosa", status: "ready", signed: false, funnel: { stage: "reviewing", keyword: "CREDIT" } });
    reviewId = String(items[0]!.id);
    expect((await json(await route.GET(get("/api/staff/live?needs=1")))).body).toEqual({ count: 1 });
    expect(answer.body.keywords).toEqual([{ word: "CREDIT", campaign: null }, { word: "CREDITO", campaign: null }, { word: "WEBINAR", campaign: null }]);
    expect(JSON.stringify(answer.body)).not.toMatch(/secret|token/i);
    as(h.as(ana.userId));
    expect((await route.GET(get("/api/staff/live"))).status).toBe(403);
  });

  it("a recording goes to the private bucket through a signed link, and is checked by its first bytes", async () => {
    const route = await import("@/app/api/staff/live/route");
    as(h.as(marta.userId));
    const ticket = await json(await route.POST(post("/api/staff/live", { action: "upload_url", reviewId, mediaType: "video/webm", bytes: 4096 })));
    expect(ticket.status).toBe(200);
    videoId = String(ticket.body.videoId);
    const path = String(ticket.body.path);
    // Not a video: refused and removed.
    h.files.set(`live-videos/${path}`, new TextEncoder().encode("<html>not a video</html>"));
    expect((await route.POST(post("/api/staff/live", { action: "confirm_video", reviewId, videoId, path, duration: 150 }))).status).toBe(415);
    expect(h.files.has(`live-videos/${path}`)).toBe(false);
    h.files.set(`live-videos/${path}`, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5]));
    expect((await route.POST(post("/api/staff/live", { action: "confirm_video", reviewId, videoId, path, duration: 150 }))).status).toBe(200);
    expect(await h.sql(`select recorded_by_name, duration_seconds, sent_at from public.live_videos where id = $1`, [videoId])).toEqual([{ recorded_by_name: "Marta Leal", duration_seconds: 150, sent_at: null }]);
    expect((await json(await route.GET(get("/api/staff/live?needs=1")))).body).toEqual({ count: 0 });
  });

  it("sends the private link (a new one each time), sets Invited, and the page tracks opened, watched and «Get started»", async () => {
    const lead = await leadByPhone("+17135550321");
    const now = new Date();
    // Outside WhatsApp's 24 hours with the template not approved: WhatsApp is refused; email hands over the words.
    const deps: SendDeps = { sendText: vi.fn(async () => ({ sent: true })), sendTemplate: vi.fn(async () => ({ sent: true })), sendSms: vi.fn(async () => ({ sent: true, sid: "x" })), env: { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" } };
    expect(await sendVideo(h.service, marta, { videoId, channel: "whatsapp", appUrl: "https://credalti.test", now }, deps)).toEqual({ ok: false, status: 409, code: "window_closed" });
    expect(await sendVideo(h.service, marta, { videoId, channel: "sms", appUrl: "https://credalti.test", now }, deps)).toMatchObject({ ok: false, code: "sms_off" });
    const email = await sendVideo(h.service, marta, { videoId, channel: "email", appUrl: "https://credalti.test", now }, deps);
    expect(email).toMatchObject({ ok: true, email: "rosa@example.com", channel: "email" });
    const first = email.ok ? email.link : "";
    expect(first).toMatch(/^https:\/\/credalti\.test\/v\/[A-Za-z0-9_-]{20,64}$/);
    expect(email.ok && email.message).toMatch(/^Hola Rosa, soy Marta de Credalti/);
    // She writes on WhatsApp: the window opens and the text goes, with a new link; the old one stops working.
    await h.sql(`insert into public.chat_messages (phone_e164, channel, role, source, body) values ($1, 'whatsapp', 'user', 'journey', 'Gracias')`, ["+17135550321"]);
    const wa = await sendVideo(h.service, marta, { videoId, channel: "whatsapp", appUrl: "https://credalti.test", now: new Date(Date.now() + 1000) }, deps);
    expect(wa).toMatchObject({ ok: true, channel: "whatsapp" });
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect((await videoForToken(h.service, first.split("/v/")[1]!, now)).state).toBe("gone");
    const token = wa.ok ? wa.link.split("/v/")[1]! : "";
    const page = await videoForToken(h.service, token, now);
    expect(page).toMatchObject({ state: "ok", firstName: "Rosa", locale: "es" });
    expect(page.state === "ok" && page.startHref.complete).toBe("/onboarding?n=Rosa&g=mortgage&s=TX&lang=es&option=complete");
    expect(page.state === "ok" && page.src).toMatch(/^https:\/\/storage\.test\/live-videos\//);
    expect(JSON.stringify(page)).not.toMatch(/overview|collections|"raw"/);
    expect((await leadByPhone("+17135550321"))!.invited_at).toBeTruthy();
    expect(await h.sql(`select sent_via from public.live_videos where id = $1`, [videoId])).toEqual([{ sent_via: ["email", "whatsapp"] }]);

    const events = await import("@/app/api/live/v/route");
    for (const event of ["opened", "watched", "started"]) expect((await events.POST(post("/api/live/v", { token, event }))).status).toBe(200);
    expect((await events.POST(post("/api/live/v", { token: "y".repeat(30), event: "opened" }))).status).toBe(404);
    as(h.as(admin.userId));
    const [seen] = await loadLeads(h.as(admin.userId), { id: String(lead!.id) });
    expect(seen!.funnel).toMatchObject({ stage: "started", tag: "webinar", keyword: "CREDIT", campaign: "webinar-nov" });
    expect(await countFunnelForCampaign(h.service, "webinar-nov")).toMatchObject({ total: 2, reviewing: 1, video_sent: 1, watched: 1, started: 1, signed: 0 });
    // Fourteen days later the link has expired.
    expect((await videoForToken(h.service, token, new Date(now.getTime() + 15 * 86_400_000))).state).toBe("expired");
    expect(await trackVideo(h.service, token, "opened", new Date(now.getTime() + 15 * 86_400_000))).toBe(false);
  });

  it("signed: a simulated reading is never imported; a real one becomes the case's first report and the funnel's copy goes", async () => {
    const client = await addClient(h, { name: "Rosa Elena", phone: "+17135550321" });
    await signAgreement(h, client, { signedDaysAgo: 0 });
    const route = await import("@/app/api/staff/live/route");
    as(h.as(admin.userId));
    expect((await json(await route.POST(post("/api/staff/live", { action: "import", reviewId })))).body).toMatchObject({ code: "simulated" });
    await h.sql(`update public.live_reviews set simulated = false where id = $1`, [reviewId]);
    const done = await json(await route.POST(post("/api/staff/live", { action: "import", reviewId })));
    expect(done.status).toBe(200);
    expect((await h.sql(`select count(*)::int as n from public.report_pulls where user_id = $1`, [client]))[0]).toEqual({ n: 1 });
    expect(await h.sql(`select status, raw, overview, imported_at is not null as imported from public.live_reviews where id = $1`, [reviewId])).toEqual([{ status: "imported", raw: null, overview: null, imported: true }]);
    expect([...h.files.keys()].filter((k) => k.startsWith("live-"))).toEqual([]);
  });
});

describe("retention", () => {
  it("30 days after the upload, a review of someone who did not sign up is deleted, files and data; a signed one waits for the import", async () => {
    const formRoute = await import("@/app/api/live/route");
    const reportRoute = await import("@/app/api/live/report/route");
    const upload = async (phone: string) => {
      const ok = await json(await formRoute.POST(post("/api/live", { firstName: "Ana", phone, state: "TX", goal: "general", locale: "en", consentMessages: true, consentReport: true })));
      const form = new FormData();
      form.set("token", String(ok.body.uploadToken));
      form.append("file", new File([new TextEncoder().encode("TransUnion credit report text")], "tu.txt", { type: "text/plain" }));
      expect((await reportRoute.POST(new Request("https://app.test/api/live/report", { method: "POST", body: form, headers: { "x-forwarded-for": `10.43.201.${++ip % 250}` } }))).status).toBe(200);
      return String((await leadByPhone(phone))!.id);
    };
    const unsigned = await upload("+17135550331");
    const signedLead = await upload("+17135550332");
    const client = await addClient(h, { name: "Signed Person", phone: "+17135550332" });
    await signAgreement(h, client, { signedDaysAgo: 0 });
    const later = new Date(Date.now() + 31 * 86_400_000);
    const result = await runRetention(h.service, later);
    expect(result).toMatchObject({ deleted: 1, waitingImport: 1 });
    const [gone] = await h.sql<Record<string, unknown>>(`select status, raw, overview, deleted_at from public.live_reviews where lead_id = $1`, [unsigned]);
    expect(gone).toMatchObject({ status: "deleted", raw: null, overview: null });
    expect(await h.sql(`select f.status, f.envelope from public.live_report_files f join public.live_reviews r on r.id = f.review_id where r.lead_id = $1`, [unsigned])).toEqual([{ status: "deleted", envelope: null }]);
    expect((await liveOf(unsigned))!.report_deleted_at).toBeTruthy();
    const kept = await h.sql<{ status: string }>(`select status from public.live_reviews where lead_id = $1`, [signedLead]);
    expect(kept).toEqual([{ status: "ready" }]);
    // Twice is the same; after the grace period the signed one goes too.
    expect(await runRetention(h.service, later)).toMatchObject({ deleted: 0, waitingImport: 1 });
    expect(await runRetention(h.service, new Date(Date.now() + 95 * 86_400_000))).toMatchObject({ deleted: 1 });
    expect([...h.files.keys()].filter((k) => k.startsWith("live-reports/"))).toEqual([]);
  });

  it("the cron route checks the secret and records its heartbeat", async () => {
    const route = await import("@/app/api/cron/live/route");
    process.env.N8N_WEBHOOK_SECRET = "n8n";
    expect((await route.POST(post("/api/cron/live", {}))).status).toBe(401);
    expect((await route.POST(post("/api/cron/live", {}, { "x-webhook-secret": "n8n" }))).status).toBe(200);
    expect(await h.sql(`select job, last_error from public.cron_heartbeats where job = 'live'`)).toEqual([{ job: "live", last_error: null }]);
    delete process.env.N8N_WEBHOOK_SECRET;
  });

  it("a deleted review is never read again", async () => {
    const [review] = await h.sql<{ id: string }>(`select id from public.live_reviews where status = 'deleted' limit 1`);
    expect(await readReview(h.service, review!.id, new Date())).toEqual({ status: "missing" });
  });

  it("a reading that did not finish (the server restarted) is tried again by the job", async () => {
    const lead = await leadByPhone("+17135550331");
    const reviewId = "00000000-0000-4000-8000-0000000c0de1";
    const fileId = "00000000-0000-4000-8000-0000000c0de2";
    const path = `${reviewId}/${fileId}.txt`;
    await h.sql(`insert into public.live_reviews (id, lead_id, status, created_at, delete_after) values ($1, $2, 'reading', now() - interval '20 minutes', now() + interval '30 days')`, [reviewId, lead!.id]);
    await h.sql(`insert into public.live_report_files (id, review_id, storage_path, file_kind, file_bytes) values ($1, $2, $3, 'text', 30)`, [fileId, reviewId, path]);
    h.files.set(`live-reports/${path}`, new TextEncoder().encode("Experian credit report as text"));
    expect(await runRetention(h.service, new Date())).toMatchObject({ reread: 1 });
    expect(await h.sql(`select status from public.live_reviews where id = $1`, [reviewId])).toEqual([{ status: "ready" }]);
  });
});

describe("comments handed over by HighLevel or ManyChat", () => {
  it("refuses without the secret; with it, the lead shows in the Lead Manager with its source; SSN-like fields are dropped", async () => {
    const route = await import("@/app/api/webhooks/live/route");
    const lead = { phone: "713-555-0341", firstName: "Lucía", platform: "instagram", source: "comment", keyword: "info", campaign: "IG Nov", locale: "es", ssn: "123-45-6789", consentText: "Acepto que Credalti me escriba por WhatsApp." };
    expect((await route.POST(post("/api/webhooks/live", lead))).status).toBe(503);
    process.env.LIVE_FUNNEL_WEBHOOK_SECRET = "comments-secret";
    expect((await route.POST(post("/api/webhooks/live", lead, { "x-credalti-secret": "wrong" }))).status).toBe(401);
    const ok = await json(await route.POST(post("/api/webhooks/live", lead, { authorization: "Bearer comments-secret" })));
    expect(ok.body).toMatchObject({ ok: true, outcome: "created", dropped: ["ssn"] });
    const row = await leadByPhone("+17135550341");
    expect(row).toMatchObject({ source: "live", display_name: "Lucía", locale: "es" });
    expect(await liveOf(String(row!.id))).toMatchObject({ tag: "comment", platform: "instagram", keyword: "INFO", campaign: "ig-nov" });
    expect(JSON.stringify(await h.sql(`select * from public.live_leads where lead_id = $1`, [row!.id]))).not.toContain("123-45-6789");
    // A state not opened goes to the waitlist; Georgia is refused.
    expect((await json(await route.POST(post("/api/webhooks/live", { ...lead, phone: "7135550342", state: "CA" }, { "x-credalti-secret": "comments-secret" })))).body.outcome).toBe("waitlisted");
    expect((await json(await route.POST(post("/api/webhooks/live", { ...lead, phone: "7135550343", state: "GA" }, { "x-credalti-secret": "comments-secret" })))).body.outcome).toBe("state_blocked");
    expect(await leadByPhone("+17135550343")).toBeNull();
  });
});

describe("SMS: off by default; when on, only the keyword reply to someone who texted us", () => {
  const sms = (params: Record<string, string>, signature?: string) =>
    new Request("https://app.test/api/webhooks/sms", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature ?? twilioSignature("https://credalti.test/api/webhooks/sms", params, "twilio-token"), "x-forwarded-for": `10.43.202.${++ip % 250}` },
      body: new URLSearchParams(params).toString(),
    });

  it("off: nothing is read, stored or sent", async () => {
    const route = await import("@/app/api/webhooks/sms/route");
    sent.length = 0;
    const res = await route.POST(sms({ From: "+17135550351", Body: "CREDIT", MessageSid: "SM1" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<Response></Response>");
    expect(sent).toEqual([]);
    expect(await leadByPhone("+17135550351")).toBeNull();
  });

  it("on: Twilio's signature is checked; the keyword gets one text with the link; STOP is recorded and stops it", async () => {
    Object.assign(process.env, { SMS_FUNNEL_ENABLED: "on", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "twilio-token", TWILIO_FROM_NUMBER: "+18325550100" });
    const route = await import("@/app/api/webhooks/sms/route");
    expect((await route.POST(sms({ From: "+17135550351", Body: "CREDIT", MessageSid: "SM2" }, "bad"))).status).toBe(401);
    sent.length = 0;
    expect((await route.POST(sms({ From: "+17135550351", Body: "credit", MessageSid: "SM3" }))).status).toBe(200);
    const texts = sent.filter((s) => s.url.includes("api.twilio.com"));
    expect(texts).toHaveLength(1);
    const body = new URLSearchParams(texts[0]!.body);
    expect(body.get("To")).toBe("+17135550351");
    expect(body.get("Body")).toMatch(/live\?src=sms&kw=credit/);
    expect(body.get("Body")).toMatch(/Reply STOP to opt out\.$/);
    const lead = await leadByPhone("+17135550351");
    expect((await liveOf(String(lead!.id)))!.sms_keyword_at).toBeTruthy();
    // Again: nothing (the window).
    sent.length = 0;
    await route.POST(sms({ From: "+17135550351", Body: "CREDIT", MessageSid: "SM4" }));
    expect(sent).toEqual([]);
    // STOP is recorded; a new keyword after it gets nothing.
    await route.POST(sms({ From: "+17135550352", Body: "STOP", MessageSid: "SM5" }));
    expect(await h.sql(`select kind, keyword from public.live_sms_opt_outs where phone_e164 = '+17135550352'`)).toEqual([{ kind: "opt_out", keyword: "STOP" }]);
    sent.length = 0;
    await route.POST(sms({ From: "+17135550352", Body: "CREDIT", MessageSid: "SM6" }));
    expect(sent).toEqual([]);
    // A client is never texted by the funnel.
    await addClient(h, { name: "Client Sms", phone: "+17135550353" });
    await route.POST(sms({ From: "+17135550353", Body: "CREDIT", MessageSid: "SM7" }));
    expect(sent).toEqual([]);
    for (const k of ["SMS_FUNNEL_ENABLED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) delete process.env[k];
  });

  it("the record of SMS opt-outs cannot be rewritten, and client follow-ups still refuse SMS", async () => {
    await expect(h.sql(`delete from public.live_sms_opt_outs`)).rejects.toThrow(/append-only/);
    await expect(h.sql(`insert into public.message_opt_outs (phone_e164, kind, channel) values ('+17135550354', 'opt_out', 'sms')`)).rejects.toThrow();
  });
});
