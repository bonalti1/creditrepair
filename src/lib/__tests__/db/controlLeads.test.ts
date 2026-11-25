import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sweepAlerts } from "../../control/alertsServer";
import { runLeadAutopilot } from "../../leads/autopilotServer";
import { assignWaitingLeads, loadLeads, loadLeadThread } from "../../leads/inboxServer";
import { storeMessage } from "../../chat/history";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff, signAgreement, uid } from "./seed";

// Migration 0034 (Credalti Control) against the real migrations, with row
// level security: the leads the database keeps by itself (from WhatsApp, a
// prospect, a chat signup, a signed agreement), who may read them (an
// administrator; sales theirs and nobody's; never a specialist, a client, a
// partner or anon), that only a person moves a stage, the records nobody can
// rewrite, the lead autopilot's run with a mocked WhatsApp (off by default),
// the alerts sweep (off for everyone by default), and the routes.

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
const request = (path: string, body?: unknown) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.34.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

const MIN = 60_000;
let admin: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let luis: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let client: string;
let partnerUser: string;

const WA = "+12105550178"; // a number with no account that writes on WhatsApp
const inbound = (phone: string, text: string, minutesAgo: number) =>
  h.service.from("chat_messages").insert({ phone_e164: phone, channel: "whatsapp", role: "user", source: "journey", body: text, created_at: new Date(Date.now() - minutesAgo * MIN).toISOString() });
const leadByPhone = async (phone: string) => {
  const { data } = await h.service.from("leads").select("*").eq("phone_e164", phone).maybeSingle();
  return data as Record<string, unknown> | null;
};

beforeAll(async () => {
  // The routes run as on a configured server (not the demo).
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  luis = await addStaff(h, "sales", "luis", "Luis Ortega");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  client = await addClient(h, { name: "Rosa Martínez", phone: "+17135550142" });
  const { data: partner } = await h.service
    .from("partners")
    .insert({ name: "Laura Benítez", kind: "realtor", phone_e164: "+17135550161", status: "approved", referral_code: "laura-benitez", terms_version: "2026-11-socios-v1", terms_accepted_at: new Date().toISOString() })
    .select("id")
    .single();
  partnerUser = uid();
  await h.createUser(partnerUser, { phone: "+17135550161" });
  await h.service.from("partner_members").insert({ user_id: partnerUser, partner_id: (partner as { id: string }).id });
});

afterAll(async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  await h?.pg.close();
});

describe("the database keeps the leads by itself", () => {
  it("a number with no account that writes on WhatsApp becomes a lead; every message keeps it up to date", async () => {
    await inbound(WA, "Hi is this the credit repair?", 30);
    const lead = await leadByPhone(WA);
    expect(lead).toMatchObject({ source: "whatsapp", stage: "new", salesperson: null });
    expect(lead!.last_inbound_at).toBeTruthy();
    await storeMessage(h.service, { phoneE164: WA, channel: "whatsapp", role: "assistant", source: "journey", text: "Hi! I'm Alti, the AI assistant." });
    expect((await leadByPhone(WA))!.last_reply_at).toBeNull(); // Alti's greeting is not an answer.
    expect((await leadByPhone(WA))!.last_message_role).toBe("assistant");
  });

  it("a prospect (by hand, HighLevel, a partner) is a lead; the invitation sets Invited; the signature sets Signed", async () => {
    const { data: prospect, error } = await h.service
      .from("prospects")
      .insert({ first_name: "Marcus", last_name: "Bell", phone_e164: "+17135550152", state: "TX", goal: "mortgage", salesperson: "ana", source: "highlevel", source_detail: { firstTouch: { campaign: "Home buyers Nov" } }, consent_text: "Acepto que Credalti me contacte por WhatsApp." })
      .select("id")
      .single();
    expect(error).toBeNull();
    const id = (prospect as { id: string }).id;
    expect(await leadByPhone("+17135550152")).toMatchObject({ source: "highlevel", salesperson: "ana", display_name: "Marcus Bell", prospect_id: id, first_touch: { campaign: "Home buyers Nov" } });
    await h.service.from("prospects").update({ invited_at: new Date().toISOString() }).eq("id", id);
    expect((await leadByPhone("+17135550152"))!.invited_at).toBeTruthy();
    // He signs up with that phone and signs: Signed, by itself.
    const marcus = await addClient(h, { name: "Marcus Bell", phone: "+17135550152" });
    await signAgreement(h, marcus, { signedDaysAgo: 0 });
    expect(await leadByPhone("+17135550152")).toMatchObject({ client_user_id: marcus });
    expect((await leadByPhone("+17135550152"))!.signed_at).toBeTruthy();
    // A person's stage never changed: only the facts did.
    expect((await leadByPhone("+17135550152"))!.stage).toBe("new");
  });

  it("a chat signup that reached a phone is a lead, with its case reference", async () => {
    const james = await addClient(h, { name: "James Carter", phone: "+18325550184" });
    await h.service.from("signup_cases").insert({ case_ref: "CR-7KQ4M", token_hash: "a".repeat(64), locale: "en" });
    await h.service.from("signup_cases").update({ user_id: james, wants_person: true }).eq("case_ref", "CR-7KQ4M");
    expect(await leadByPhone("+18325550184")).toMatchObject({ source: "signup_chat", signup_case_ref: "CR-7KQ4M", first_touch: { caseRef: "CR-7KQ4M" } });
  });

  it("leads nobody has go to the next salesperson in turn", async () => {
    expect(await assignWaitingLeads(h.service, new Date())).toBeGreaterThanOrEqual(1);
    expect((await leadByPhone(WA))!.salesperson).toMatch(/^(ana|luis)$/);
  });
});

describe("who may read a lead", () => {
  let lucia: string;
  beforeAll(async () => {
    await inbound("+17135550195", "Hola, quiero información", 20);
    const row = await leadByPhone("+17135550195");
    lucia = String(row!.id);
    await h.service.from("leads").update({ salesperson: "luis" }).eq("id", lucia);
    await inbound("+17135550196", "Hello?", 15); // nobody's yet
    await h.service.from("lead_notes").insert({ lead_id: lucia, author: luis.userId, author_handle: "luis", author_name: "Luis", body: "Wants to buy in spring." });
  });

  it("an administrator: every lead; sales: theirs and nobody's; never another salesperson's", async () => {
    const all = await loadLeads(h.as(admin.userId));
    expect(all.length).toBeGreaterThanOrEqual(5);
    const anas = await loadLeads(h.as(ana.userId));
    expect(anas.some((l) => l.phone === "+17135550195")).toBe(false);
    expect(anas.some((l) => l.phone === "+17135550196")).toBe(true);
    expect(anas.every((l) => l.salesperson === "ana" || l.salesperson === null)).toBe(true);
    const luiss = await loadLeads(h.as(luis.userId));
    expect(luiss.some((l) => l.phone === "+17135550195")).toBe(true);
    // Luis reads his lead's WhatsApp conversation and notes (chat with no account was the owner's only, 0012).
    const thread = await loadLeadThread(h.as(luis.userId), lucia);
    expect(thread?.messages.map((m) => m.text)).toEqual(["Hola, quiero información"]);
    expect(thread?.notes.map((n) => n.text)).toEqual(["Wants to buy in spring."]);
    // Ana does not.
    expect(await loadLeadThread(h.as(ana.userId), lucia)).toBeNull();
    const { data: chat } = await h.as(ana.userId).from("chat_messages").select("body").eq("phone_e164", "+17135550195");
    expect(chat).toEqual([]);
  });

  it("a specialist, a client, a partner and anon read nothing of it", async () => {
    for (const who of [h.as(marta.userId), h.as(client), h.as(partnerUser), h.anon]) {
      for (const table of ["leads", "lead_notes", "lead_stage_events", "lead_auto_messages", "lead_autopilot_changes", "control_escalations"]) {
        const { data } = await who.from(table).select("*");
        expect(data ?? [], table).toEqual([]);
      }
      const { data: chat } = await who.from("chat_messages").select("body").eq("phone_e164", "+17135550195");
      expect(chat ?? []).toEqual([]);
    }
  });
});

describe("only people move leads; the records are never rewritten", () => {
  it("a stage moves only through a stage event written by an active member of the team", async () => {
    const lead = await leadByPhone(WA);
    const id = String(lead!.id);
    // Straight to the row: refused, even with the service role.
    expect((await h.service.from("leads").update({ stage: "qualified" }).eq("id", id)).error?.message).toMatch(/only a person moves a lead/);
    // Not a person's stage: refused.
    expect((await h.service.from("lead_stage_events").insert({ lead_id: id, to_stage: "signed", actor: ana.userId })).error).toBeTruthy();
    // No person (the system, a bot): refused.
    expect((await h.service.from("lead_stage_events").insert({ lead_id: id, to_stage: "contacted", actor: null })).error).toBeTruthy();
    // A client is not a member of the team: refused.
    expect((await h.service.from("lead_stage_events").insert({ lead_id: id, to_stage: "contacted", actor: client })).error?.message).toMatch(/only an active member/);
    // A person: moves it, and the history keeps from → to.
    expect((await h.service.from("lead_stage_events").insert({ lead_id: id, to_stage: "contacted", actor: ana.userId, actor_handle: "ana" })).error).toBeNull();
    expect(await leadByPhone(WA)).toMatchObject({ stage: "contacted", stage_by: ana.userId });
    const { data: events } = await h.service.from("lead_stage_events").select("from_stage, to_stage").eq("lead_id", id);
    expect(events).toEqual([{ from_stage: "new", to_stage: "contacted" }]);
    expect((await h.service.from("lead_stage_events").delete().eq("lead_id", id)).error).toBeTruthy();
  });

  it("notes, autopilot changes and the automatic messages' words cannot be edited or deleted; a lead is never deleted", async () => {
    expect((await h.service.from("lead_notes").update({ body: "changed" }).neq("body", "")).error).toBeTruthy();
    expect((await h.service.from("leads").delete().eq("phone_e164", WA)).error).toBeTruthy();
    const lead = await leadByPhone(WA);
    const { data } = await h.service.from("lead_auto_messages").insert({ lead_id: lead!.id, kind: "greeting", status: "claimed", body: "🤖 Alti · AI assistant\nHi", inbound_at: new Date().toISOString(), dedupe_key: "lead-auto:test:1" }).select("id").single();
    const id = (data as { id: string }).id;
    expect((await h.service.from("lead_auto_messages").update({ body: "something else" }).eq("id", id)).error).toBeTruthy();
    expect((await h.service.from("lead_auto_messages").update({ status: "sent" }).eq("id", id)).error).toBeNull();
    expect((await h.service.from("lead_auto_messages").update({ status: "claimed" }).eq("id", id)).error).toBeTruthy();
    expect((await h.service.from("lead_auto_messages").insert({ lead_id: lead!.id, kind: "greeting", status: "sent", channel: "sms", body: "x", inbound_at: new Date().toISOString(), dedupe_key: "lead-auto:test:sms" })).error).toBeTruthy();
  });
});

describe("the lead autopilot's run (WhatsApp mocked)", () => {
  const phone = "+17135550199";
  const sent: string[] = [];
  const deps = { sendText: async (_to: string, text: string) => (sent.push(text), { sent: true }), sendTemplate: async () => ({ sent: true }) };

  it("is off by default: nothing is read beyond the switch, nothing is sent", async () => {
    await inbound(phone, "How do I sign up?", 10);
    expect(await runLeadAutopilot(h.service, new Date(), { appUrl: "https://credalti.test", deps })).toMatchObject({ enabled: false, sent: 0 });
    expect(sent).toEqual([]);
  });

  it("turned on, it answers a new message once, labelled as AI, and records it; a complaint goes to a person", async () => {
    // Quiet hours off for this test (start = end), so it does not depend on the clock it runs at; they have their own unit test.
    await h.service.from("lead_autopilot_settings").update({ enabled: true, enabled_at: new Date(Date.now() - 60 * MIN).toISOString(), quiet_start_hour: 0, quiet_end_hour: 0 }).eq("id", true);
    const run = await runLeadAutopilot(h.service, new Date(), { appUrl: "https://credalti.test", deps });
    expect(run.sent).toBeGreaterThanOrEqual(1);
    const mine = sent.find((t) => t.includes("credalti.test/registro"));
    expect(mine).toMatch(/^🤖 Alti · AI assistant\n/);
    const lead = await leadByPhone(phone);
    const { data: records } = await h.service.from("lead_auto_messages").select("kind, status, body").eq("lead_id", lead!.id);
    expect(records).toEqual([{ kind: "signup_link", status: "sent", body: mine }]);
    // The conversation shows it as Alti's (AI) message, and the lead is no longer waiting.
    expect((await leadByPhone(phone))!.last_reply_at).toBeTruthy();
    const { data: chat } = await h.service.from("chat_messages").select("source, role").eq("phone_e164", phone).eq("role", "assistant");
    expect(chat).toEqual([{ source: "coach", role: "assistant" }]);
    // A second run sends nothing twice.
    const before = sent.length;
    await runLeadAutopilot(h.service, new Date(), { appUrl: "https://credalti.test", deps });
    expect(sent.length).toBe(before);
    // A complaint: no answer, a hand-off on record.
    // A minute after Alti's answer (the run looks ten minutes on, past the delay).
    await inbound(phone, "This is a scam, I want to complain", -1);
    const again = await runLeadAutopilot(h.service, new Date(Date.now() + 10 * MIN), { appUrl: "https://credalti.test", deps });
    expect(again.handedOff).toEqual([{ leadId: lead!.id, reason: "complaint" }]);
    expect(sent.length).toBe(before);
    const [withHandoff] = await loadLeads(h.service, { id: String(lead!.id) });
    expect(withHandoff!.handoff?.reason).toBe("complaint");
  });

  it("never writes to a number that said STOP", async () => {
    const stop = "+17135550188";
    await inbound(stop, "How do I sign up?", 10);
    await h.service.from("message_opt_outs").insert({ phone_e164: stop, kind: "opt_out", channel: "whatsapp", keyword: "STOP" });
    const before = sent.length;
    await runLeadAutopilot(h.service, new Date(), { appUrl: "https://credalti.test", deps });
    expect(sent.length).toBe(before);
    await h.service.from("lead_autopilot_settings").update({ enabled: false }).eq("id", true);
  });
});

describe("phone alerts: off until each person turns them on", () => {
  it("nobody turned anything on: nothing is recorded", async () => {
    expect(await sweepAlerts(h.service, new Date(), { config: null })).toEqual({ candidates: 0, created: 0, pushed: 0 });
  });

  it("the owner turns on new leads and complaints: each once; a member reads only their own", async () => {
    await h.service.from("staff_alert_topics").insert([
      { user_id: admin.userId, topic: "new_lead", enabled: true },
      { user_id: admin.userId, topic: "complaint", enabled: true },
    ]);
    const first = await sweepAlerts(h.service, new Date(), { config: null });
    expect(first.created).toBeGreaterThanOrEqual(2);
    expect((await sweepAlerts(h.service, new Date(), { config: null })).created).toBe(0);
    const { data: mine } = await h.as(admin.userId).from("staff_alerts").select("topic, title, url");
    expect((mine as Array<{ topic: string }>).some((a) => a.topic === "complaint")).toBe(true);
    for (const a of mine as Array<{ title: string; url: string }>) expect(a.url).toMatch(/^\/equipo/);
    expect((await h.as(ana.userId).from("staff_alerts").select("*")).data).toEqual([]);
  });
});

describe("the routes", () => {
  it("leads: sales reads theirs; a specialist is refused; a stage move is a person's; Signed is refused", async () => {
    const route = await import("@/app/api/staff/leads/route");
    as(h.as(marta.userId));
    expect((await route.GET(request("/api/staff/leads"))).status).toBe(403);
    as(h.as(ana.userId));
    const list = await json(await route.GET(request("/api/staff/leads")));
    expect(list.status).toBe(200);
    const leads = list.body.leads as Array<{ id: string; phone: string; salesperson: string | null }>;
    expect(leads.every((l) => l.salesperson === "ana" || l.salesperson === null)).toBe(true);
    const target = leads.find((l) => l.phone === "+17135550196")!;
    expect((await json(await route.POST(request("/api/staff/leads", { action: "stage", id: target.id, to: "signed" })))).status).toBe(400);
    expect((await json(await route.POST(request("/api/staff/leads", { action: "stage", id: target.id, to: "contacted" })))).status).toBe(200);
    expect((await leadByPhone("+17135550196"))!.stage).toBe("contacted");
    // Another salesperson's lead: refused.
    const lucia = await leadByPhone("+17135550195");
    expect((await json(await route.POST(request("/api/staff/leads", { action: "note", id: lucia!.id, text: "hello there" })))).status).toBe(403);
    // A reply that promises a result is not sent.
    const bad = await json(await route.POST(request("/api/staff/leads", { action: "reply", id: target.id, text: "We will remove it, guaranteed.", locale: "en" })));
    expect(bad.status).toBe(422);
    // Without WhatsApp configured nothing is sent, and nothing is stored as sent.
    const noWa = await json(await route.POST(request("/api/staff/leads", { action: "reply", id: target.id, text: "Hi! I'm Ana from Credalti. How can I help?", locale: "en" })));
    expect(noWa).toMatchObject({ status: 503, body: { error: "no_whatsapp" } });
    // Sales takes a lead nobody has, but cannot give one to someone else.
    await inbound("+17135550197", "hi", 2);
    const free = await leadByPhone("+17135550197");
    expect((await json(await route.POST(request("/api/staff/leads", { action: "assign", id: free!.id, to: "luis" })))).status).toBe(403);
    expect((await json(await route.POST(request("/api/staff/leads", { action: "assign", id: free!.id, to: "ana" })))).status).toBe(200);
  });

  it("the autopilot switch: only an administrator, and each change is recorded", async () => {
    const route = await import("@/app/api/staff/leads/autopilot/route");
    as(h.as(ana.userId));
    expect((await route.POST(request("/api/staff/leads/autopilot", { enabled: true }))).status).toBe(403);
    as(h.as(admin.userId));
    expect((await json(await route.POST(request("/api/staff/leads/autopilot", { enabled: true, replyDelaySeconds: 300 })))).status).toBe(200);
    const { data } = await h.service.from("lead_autopilot_settings").select("enabled, enabled_at, reply_delay_seconds").single();
    expect(data).toMatchObject({ enabled: true, reply_delay_seconds: 300 });
    const { data: log } = await h.service.from("lead_autopilot_changes").select("actor, enabled");
    expect(log).toEqual([{ actor: admin.userId, enabled: true }]);
    await route.POST(request("/api/staff/leads/autopilot", { enabled: false }));
  });

  it("escalate to the owner: recorded; the owner reads it, the teammate their own, and only the owner resolves it", async () => {
    const route = await import("@/app/api/staff/control/route");
    as(h.as(ana.userId));
    const esc = await json(await route.POST(request("/api/staff/control", { action: "escalate", key: "lead-waiting:x", title: "Marcus asks for a discount", note: "What do I say?" })));
    expect(esc.status).toBe(200);
    expect((await route.POST(request("/api/staff/control", { action: "resolve", id: esc.body.id }))).status).toBe(403);
    as(h.as(admin.userId));
    const extras = await json(await route.GET());
    expect((extras.body.extras as { escalations: Array<{ title: string }> }).escalations.map((e) => e.title)).toContain("Marcus asks for a discount");
    expect((await route.POST(request("/api/staff/control", { action: "resolve", id: esc.body.id }))).status).toBe(200);
    expect((await h.as(marta.userId).from("control_escalations").select("*")).data).toEqual([]);
  });

  it("alerts: a member sets only their role's topics; a subscription only to a browser's push service", async () => {
    const route = await import("@/app/api/staff/alerts/route");
    as(h.as(marta.userId));
    expect((await route.POST(request("/api/staff/alerts", { action: "topic", topic: "new_lead", enabled: true }))).status).toBe(403);
    expect((await route.POST(request("/api/staff/alerts", { action: "topic", topic: "partner_note", enabled: true }))).status).toBe(200);
    expect((await route.POST(request("/api/staff/alerts", { action: "subscribe", endpoint: "https://evil.test/push", keys: { p256dh: "x", auth: "y" } }))).status).toBe(400);
    expect((await route.POST(request("/api/staff/alerts", { action: "subscribe", endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x", auth: "y" } }))).status).toBe(200);
    const view = await json(await route.GET(request("/api/staff/alerts")));
    expect(view.body).toMatchObject({ topics: ["complaint", "partner_note"], push: { configured: false, publicKey: null, devices: 1 } });
  });
});
