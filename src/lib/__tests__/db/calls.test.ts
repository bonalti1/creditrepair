import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { nextAllowedTime } from "../../autopilot/clock";
import { callConsentHash, CALL_CONSENT, QUESTIONS_ONLY } from "../../calls/config";
import { callDedupeKey } from "../../calls/messages";
import { runCallMessages } from "../../calls/server";
import { tokenHash } from "../../signup/server";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff, assign } from "./seed";

// Migration 0032 against the real migrations, with row level security: the
// chat signup's case reference (signup_cases) and calls with a person
// (call_windows, call_bookings, call_messages). Who reads what: a client their
// own rows; staff by the 0012 scopes once a row belongs to a client; a lead's
// rows by an administrator or sales; anon nothing. Who writes: the server
// only, through /api/signup, /api/calls and /api/staff/calls, which run here
// as in production with the two Supabase clients swapped for the test
// database's. And what the database itself refuses.

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
    headers: { "content-type": "application/json", "x-forwarded-for": `10.32.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

const HOUR = 3_600_000;
/** A window two days ahead, on the hour, two hours long, 20-minute slots. */
const ahead = (days: number, hours = 0) => new Date(Math.ceil(Date.now() / HOUR) * HOUR + days * 24 * HOUR + hours * HOUR);

let admin: Awaited<ReturnType<typeof addStaff>>;
let sales: Awaited<ReturnType<typeof addStaff>>;
let specialist: Awaited<ReturnType<typeof addStaff>>;
let rosa: string; // a client, assigned to the specialist, brought in by sales
let luis: string; // another client
let windowId: string;
let windowStart: Date;

async function insertWindow(start: Date, hours = 2): Promise<string> {
  const { data, error } = await h.service
    .from("call_windows")
    .insert({ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + hours * HOUR).toISOString(), slot_minutes: 20, created_by_name: "Carmen" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

const bookingRow = (over: Record<string, unknown> = {}) => ({
  window_id: windowId,
  slot_start: windowStart.toISOString(),
  slot_end: new Date(windowStart.getTime() + 20 * 60_000).toISOString(),
  first_name: "Rosa",
  phone_e164: "+17135550142",
  confirm_channel: "whatsapp",
  locale: "es",
  call_consent: true,
  consent_version: CALL_CONSENT.version,
  consent_text_hash: callConsentHash("es"),
  notice_version: QUESTIONS_ONLY.version,
  ...over,
});

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  sales = await addStaff(h, "sales", "ana", "Ana Prieto");
  specialist = await addStaff(h, "specialist", "marta", "Marta Leal");
  rosa = await addClient(h, { name: "Rosa Martínez", referredBy: "ana", phone: "+17135550142" });
  luis = await addClient(h, { name: "Luis Gómez", referredBy: "luis", phone: "+17135550143" });
  await assign(h, rosa, specialist.userId, admin.userId);
  windowStart = ahead(2);
  windowId = await insertWindow(windowStart);
  process.env.NEXT_PUBLIC_CALLS_ENABLED = "1";
}, 60_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_CALLS_ENABLED;
});

describe("signup_cases: the case reference", () => {
  it("POST /api/signup start creates one for an anonymous visitor; only the token's hash is kept", async () => {
    const route = await import("@/app/api/signup/route");
    as(null);
    const res = await json(await route.POST(request("/api/signup", { action: "start", locale: "es" })));
    expect(res.status).toBe(200);
    const { caseRef, token } = res.body as { caseRef: string; token: string };
    expect(caseRef).toMatch(/^CR-[2-9A-HJKMNP-TW-Z]{5}$/);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await h.sql<{ token_hash: string; locale: string; step: string; user_id: string | null }>(`select * from public.signup_cases where case_ref = $1`, [caseRef]);
    expect(row).toMatchObject({ token_hash: tokenHash(token), locale: "es", step: "start", user_id: null });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("moves forward with the token, links the account once signed in, and never goes back", async () => {
    const route = await import("@/app/api/signup/route");
    as(null);
    const { caseRef, token } = (await json(await route.POST(request("/api/signup", { action: "start" })))).body as { caseRef: string; token: string };
    // Without the token, or with another one: not found.
    expect((await json(await route.POST(request("/api/signup", { action: "progress", caseRef, step: "info" })))).status).toBe(404);
    expect((await json(await route.POST(request("/api/signup", { action: "progress", caseRef, token: "a".repeat(64), step: "info" })))).status).toBe(404);
    expect((await json(await route.POST(request("/api/signup", { action: "progress", caseRef, token, step: "info", state: "TX" })))).body).toMatchObject({ ok: true, signup: { step: "info", state: "TX", userId: null } });
    // Signed in: the account is linked.
    as(h.as(rosa));
    const linked = await json(await route.POST(request("/api/signup", { action: "progress", caseRef, token, step: "identity" })));
    expect(linked.body).toMatchObject({ ok: true, signup: { step: "identity", userId: rosa } });
    // From another device, signed in as the same person, no token needed; an older step does not undo progress.
    expect((await json(await route.POST(request("/api/signup", { action: "progress", caseRef, step: "start" })))).body).toMatchObject({ signup: { step: "identity" } });
    // Another account cannot take it.
    as(h.as(luis));
    expect((await json(await route.POST(request("/api/signup", { action: "progress", caseRef, token, step: "report" })))).status).toBe(409);
    // GET: the person's own signup.
    as(h.as(rosa));
    expect((await json(await route.GET())).body).toMatchObject({ authenticated: true, signup: { caseRef, step: "identity" }, softPull: "none" });
    // The soft pull has no provider: 409.
    expect((await json(await route.POST(request("/api/signup", { action: "soft_pull", consentVersion: "x" })))).body).toMatchObject({ code: "provider_none" });
  });

  it("is read by its owner and by staff by scope; anon and others read nothing and nobody writes but the server", async () => {
    const ref = "CR-RSA2M";
    await h.service.from("signup_cases").insert({ case_ref: ref, token_hash: "b".repeat(64), user_id: rosa, linked_at: new Date().toISOString() });
    await h.service.from("signup_cases").insert({ case_ref: "CR-NEWA2", token_hash: "c".repeat(64) });
    const refs = async (c: SupabaseClient) => ((await c.from("signup_cases").select("case_ref")).data ?? []).map((r) => (r as { case_ref: string }).case_ref);
    expect(await refs(h.anon)).toEqual([]);
    expect(await refs(h.as(rosa))).toContain(ref);
    expect(await refs(h.as(luis))).not.toContain(ref);
    expect(await refs(h.as(admin.userId))).toEqual(expect.arrayContaining([ref, "CR-NEWA2"]));
    // Sales: the leads and the clients they brought in. A specialist: the assigned client, not the leads.
    expect(await refs(h.as(sales.userId))).toEqual(expect.arrayContaining([ref, "CR-NEWA2"]));
    expect(await refs(h.as(specialist.userId))).toContain(ref);
    expect(await refs(h.as(specialist.userId))).not.toContain("CR-NEWA2");
    for (const c of [h.anon, h.as(rosa), h.as(admin.userId)]) {
      expect((await c.from("signup_cases").insert({ case_ref: "CR-HACK2", token_hash: "d".repeat(64) })).error).not.toBeNull();
    }
  });

  it("the database keeps the reference, the token and the account; done stays done; nothing is deleted", async () => {
    await h.service.from("signup_cases").insert({ case_ref: "CR-FXD22", token_hash: "e".repeat(64) });
    expect((await h.service.from("signup_cases").update({ token_hash: "f".repeat(64) }).eq("case_ref", "CR-FXD22")).error).not.toBeNull();
    expect((await h.service.from("signup_cases").insert({ case_ref: "CR-0OIL1", token_hash: "e".repeat(64) })).error).not.toBeNull();
    await h.service.from("signup_cases").update({ user_id: rosa }).eq("case_ref", "CR-FXD22");
    expect((await h.service.from("signup_cases").update({ user_id: luis }).eq("case_ref", "CR-FXD22")).error?.message).toMatch(/another account/);
    await h.service.from("signup_cases").update({ step: "done" }).eq("case_ref", "CR-FXD22");
    await h.service.from("signup_cases").update({ step: "info" }).eq("case_ref", "CR-FXD22");
    const [row] = await h.sql<{ step: string; completed_at: string | null; linked_at: string | null }>(`select step, completed_at, linked_at from public.signup_cases where case_ref = 'CR-FXD22'`);
    expect(row!.step).toBe("done");
    expect(row!.completed_at).not.toBeNull();
    expect(row!.linked_at).not.toBeNull();
    expect((await h.service.from("signup_cases").delete().eq("case_ref", "CR-FXD22")).error).not.toBeNull();
  });
});

describe("call_bookings: what the database refuses", () => {
  it("only a real, open, future slot, consented, and one person per slot", async () => {
    const slot2 = new Date(windowStart.getTime() + 20 * 60_000);
    const slot = (d: Date, over: Record<string, unknown> = {}) => bookingRow({ slot_start: d.toISOString(), slot_end: new Date(d.getTime() + 20 * 60_000).toISOString(), ...over });
    // Not on the 20-minute grid; past the window; not consented.
    expect((await h.service.from("call_bookings").insert(slot(new Date(windowStart.getTime() + 5 * 60_000)))).error?.message).toMatch(/slots/);
    expect((await h.service.from("call_bookings").insert(slot(new Date(windowStart.getTime() + 2 * HOUR)))).error?.message).toMatch(/slots/);
    expect((await h.service.from("call_bookings").insert(slot(slot2, { call_consent: false }))).error).not.toBeNull();
    // Never SMS.
    expect((await h.service.from("call_bookings").insert(slot(slot2, { confirm_channel: "sms" }))).error).not.toBeNull();
    // Booked; and the same slot again is refused.
    expect((await h.service.from("call_bookings").insert(slot(slot2))).error).toBeNull();
    expect((await h.service.from("call_bookings").insert(slot(slot2, { first_name: "Otro" }))).error?.code).toBe("23505");
    // In the past.
    const past = await insertWindow(new Date(Math.floor(Date.now() / HOUR) * HOUR - 4 * HOUR));
    const pastStart = new Date(Math.floor(Date.now() / HOUR) * HOUR - 4 * HOUR);
    expect((await h.service.from("call_bookings").insert(bookingRow({ window_id: past, slot_start: pastStart.toISOString(), slot_end: new Date(pastStart.getTime() + 20 * 60_000).toISOString() }))).error?.message).toMatch(/already started/);
    // A removed window takes no booking; a window is never edited or deleted.
    const gone = await insertWindow(ahead(3));
    await h.service.from("call_windows").update({ removed_at: new Date().toISOString(), removed_by_name: "Carmen" }).eq("id", gone);
    const goneStart = ahead(3);
    expect((await h.service.from("call_bookings").insert(bookingRow({ window_id: gone, slot_start: goneStart.toISOString(), slot_end: new Date(goneStart.getTime() + 20 * 60_000).toISOString() }))).error?.message).toMatch(/not open/);
    expect((await h.service.from("call_windows").update({ slot_minutes: 30 }).eq("id", windowId)).error).not.toBeNull();
    expect((await h.service.from("call_windows").delete().eq("id", windowId)).error).not.toBeNull();
  });

  it("a booking is never rewritten or deleted; it is closed once", async () => {
    const d = new Date(windowStart.getTime() + 40 * 60_000);
    const { data } = await h.service.from("call_bookings").insert(bookingRow({ slot_start: d.toISOString(), slot_end: new Date(d.getTime() + 20 * 60_000).toISOString() })).select("id").single();
    const id = (data as { id: string }).id;
    expect((await h.service.from("call_bookings").update({ phone_e164: "+17135559999" }).eq("id", id)).error?.message).toMatch(/rewritten/);
    expect((await h.service.from("call_bookings").update({ consent_text_hash: "0".repeat(64) }).eq("id", id)).error).not.toBeNull();
    expect((await h.service.from("call_bookings").update({ status: "completed", closed_at: new Date().toISOString(), closed_by_name: "Ana" }).eq("id", id)).error).toBeNull();
    expect((await h.service.from("call_bookings").update({ status: "no_answer" }).eq("id", id)).error?.message).toMatch(/already closed/);
    expect((await h.service.from("call_bookings").delete().eq("id", id)).error).not.toBeNull();
  });

  it("anon reads and writes nothing; a client reads only their own; staff by scope; leads by admin and sales", async () => {
    const d = new Date(windowStart.getTime() + 60 * 60_000);
    await h.service.from("call_bookings").insert(bookingRow({ slot_start: d.toISOString(), slot_end: new Date(d.getTime() + 20 * 60_000).toISOString(), user_id: rosa, first_name: "RosaClient" }));
    const names = async (c: SupabaseClient) => ((await c.from("call_bookings").select("first_name")).data ?? []).map((r) => (r as { first_name: string }).first_name);
    expect(await names(h.anon)).toEqual([]);
    expect((await h.anon.from("call_windows").select("id")).data ?? []).toEqual([]);
    expect((await h.anon.from("call_bookings").insert(bookingRow({ slot_start: ahead(2, 1.5).toISOString() }))).error).not.toBeNull();
    expect(await names(h.as(rosa))).toEqual(["RosaClient"]);
    expect(await names(h.as(luis))).toEqual([]);
    expect((await h.as(rosa).from("call_bookings").insert(bookingRow({ user_id: rosa }))).error).not.toBeNull();
    const adminSees = await names(h.as(admin.userId));
    expect(adminSees).toEqual(expect.arrayContaining(["RosaClient", "Rosa"]));
    expect(await names(h.as(sales.userId))).toEqual(expect.arrayContaining(["RosaClient", "Rosa"]));
    // The specialist sees the assigned client's booking, not the leads'.
    expect(await names(h.as(specialist.userId))).toEqual(["RosaClient"]);
    // Windows: staff only.
    expect(((await h.as(specialist.userId).from("call_windows").select("id")).data ?? []).length).toBeGreaterThan(0);
    expect((await h.as(rosa).from("call_windows").select("id")).data ?? []).toEqual([]);
  });
});

describe("POST /api/calls: a person books a call", () => {
  it("is off without the flag", async () => {
    const route = await import("@/app/api/calls/route");
    delete process.env.NEXT_PUBLIC_CALLS_ENABLED;
    as(null);
    expect((await route.GET(request("/api/calls"))).status).toBe(404);
    expect((await route.POST(request("/api/calls", {}))).status).toBe(404);
    process.env.NEXT_PUBLIC_CALLS_ENABLED = "1";
  });

  it("lists free times only, and books one with the consent on record", async () => {
    const route = await import("@/app/api/calls/route");
    const ref = "CR-CAKK2";
    await h.service.from("signup_cases").insert({ case_ref: ref, token_hash: "9".repeat(64) });
    as(null);
    const list = await json(await route.GET(request("/api/calls")));
    expect(list.status).toBe(200);
    const slots = list.body.slots as Array<{ windowId: string; start: string }>;
    expect(slots.length).toBeGreaterThan(0);
    expect(JSON.stringify(list.body)).not.toMatch(/first_name|firstName|phone|Rosa/);
    const pick = slots[slots.length - 1]!;
    const body = { windowId: pick.windowId, start: pick.start, firstName: "Marisol", phone: "(713) 555-0177", confirmChannel: "whatsapp", locale: "en", caseRef: ref, consent: true, consentTextHash: callConsentHash("en") };
    // Without consent: refused before anything.
    expect((await route.POST(request("/api/calls", { ...body, consent: false }))).status).toBe(400);
    // A consent hash from other words: refused.
    expect((await route.POST(request("/api/calls", { ...body, consentTextHash: callConsentHash("es") }))).status).toBe(409);
    // Email confirmation needs an account.
    expect((await json(await route.POST(request("/api/calls", { ...body, confirmChannel: "email", email: "m@example.com" })))).body).toMatchObject({ code: "email_needs_account" });
    const booked = await json(await route.POST(request("/api/calls", body)));
    expect(booked.status).toBe(200);
    expect(booked.body.booking).toMatchObject({ slotStart: new Date(pick.start).toISOString(), caseRef: ref });
    const [row] = await h.sql<Record<string, unknown>>(`select * from public.call_bookings where first_name = 'Marisol'`);
    expect(row).toMatchObject({ phone_e164: "+17135550177", case_ref: ref, call_consent: true, consent_version: CALL_CONSENT.version, consent_text_hash: callConsentHash("en"), notice_version: QUESTIONS_ONLY.version, consent_user_agent: "vitest", status: "booked" });
    expect(row!.consent_ip).toMatch(/^10\.32\./);
    const [signup] = await h.sql<{ wants_person: boolean }>(`select wants_person from public.signup_cases where case_ref = $1`, [ref]);
    expect(signup!.wants_person).toBe(true);
    // The same time again: taken.
    expect((await json(await route.POST(request("/api/calls", { ...body, firstName: "Otra" })))).body).toMatchObject({ code: "taken" });
  });
});

describe("confirmations and reminders", () => {
  it("each message once, by WhatsApp, and none to a number that opted out", async () => {
    const start = ahead(4);
    const w = await insertWindow(start);
    const d = new Date(start.getTime() + 20 * 60_000);
    const { data } = await h.service.from("call_bookings").insert(bookingRow({ window_id: w, slot_start: d.toISOString(), slot_end: new Date(d.getTime() + 20 * 60_000).toISOString(), phone_e164: "+17135550188", first_name: "Nadia" })).select("id").single();
    const id = (data as { id: string }).id;
    const sent: string[] = [];
    const deps = {
      bookingIds: [id],
      channels: { whatsapp: true, email: false, approvedTemplates: "all" as const, simulated: false },
      deliver: async (_b: unknown, m: { dedupeKey: string; channel: string }) => {
        sent.push(`${m.dedupeKey}:${m.channel}`);
        return { ok: true, providerRef: "wamid.1" };
      },
    };
    // The first moment outside quiet hours on the Texas clock (now, unless it is night there).
    const at = new Date(nextAllowedTime(new Date(), "America/Chicago", { quietStartHour: 21, quietEndHour: 8 }).getTime() + 60_000);
    await runCallMessages(h.service, at, deps);
    await runCallMessages(h.service, at, deps);
    expect(sent.filter((s) => s.startsWith(callDedupeKey(id, "confirmation")))).toEqual([`${callDedupeKey(id, "confirmation")}:whatsapp`]);
    const rows = await h.sql<{ kind: string; channel: string; status: string; body: string }>(`select kind, channel, status, body from public.call_messages where booking_id = $1`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "confirmation", channel: "whatsapp", status: "sent" });
    expect(rows[0]!.body).toContain(QUESTIONS_ONLY.es.short);
    // The database refuses an SMS row and a rewrite.
    expect((await h.service.from("call_messages").insert({ booking_id: id, dedupe_key: `call:${id}:x`, kind: "reminder", channel: "sms", body: "x", status: "sending" })).error).not.toBeNull();
    expect((await h.service.from("call_messages").update({ body: "other" }).eq("booking_id", id)).error).not.toBeNull();
    // A number that replied STOP gets nothing more.
    const d2 = new Date(start.getTime() + 40 * 60_000);
    const { data: other } = await h.service.from("call_bookings").insert(bookingRow({ window_id: w, slot_start: d2.toISOString(), slot_end: new Date(d2.getTime() + 20 * 60_000).toISOString(), phone_e164: "+17135550199", first_name: "Sofía" })).select("id").single();
    await h.service.from("message_opt_outs").insert({ phone_e164: "+17135550199", kind: "opt_out", channel: "whatsapp", keyword: "STOP" });
    await runCallMessages(h.service, at, { ...deps, bookingIds: [(other as { id: string }).id] });
    expect(sent.some((s) => s.includes((other as { id: string }).id))).toBe(false);
    // The client reads their messages through their booking; others do not.
    expect((await h.as(luis).from("call_messages").select("id")).data ?? []).toEqual([]);
    expect(((await h.as(admin.userId).from("call_messages").select("id")).data ?? []).length).toBeGreaterThan(0);
  });
});

describe("/api/staff/calls: the team's hours and bookings", () => {
  it("needs calls.manage: administrators and sales, not specialists; off without the flag", async () => {
    const route = await import("@/app/api/staff/calls/route");
    as(h.as(specialist.userId));
    expect((await route.GET()).status).toBe(403);
    as(h.as(rosa));
    expect((await route.GET()).status).toBe(403);
    delete process.env.NEXT_PUBLIC_CALLS_ENABLED;
    as(h.as(admin.userId));
    expect((await route.GET()).status).toBe(404);
    process.env.NEXT_PUBLIC_CALLS_ENABLED = "1";
    as(h.as(sales.userId));
    const got = await json(await route.GET());
    expect(got.status).toBe(200);
    expect((got.body.bookings as Array<{ firstName: string }>).map((b) => b.firstName)).toContain("Marisol");
  });

  it("adds hours on the Texas clock, refuses bad ones, removes them, and closes a booking once", async () => {
    const route = await import("@/app/api/staff/calls/route");
    as(h.as(sales.userId));
    const day = ahead(5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const added = await json(await route.POST(request("/api/staff/calls", { action: "add_window", day, from: "09:00", to: "11:00", slotMinutes: 30, timeZone: "America/Chicago" })));
    expect(added.status).toBe(200);
    const w = added.body.window as { id: string; slotMinutes: number; createdByName: string };
    expect(w).toMatchObject({ slotMinutes: 30, createdByName: "Ana Prieto" });
    expect((await json(await route.POST(request("/api/staff/calls", { action: "add_window", day, from: "11:00", to: "09:00", slotMinutes: 30, timeZone: "America/Chicago" })))).body).toMatchObject({ problems: ["end_before_start"] });
    expect((await route.POST(request("/api/staff/calls", { action: "remove_window", windowId: w.id }))).status).toBe(200);
    expect((await route.POST(request("/api/staff/calls", { action: "remove_window", windowId: w.id }))).status).toBe(404);
    const [booking] = await h.sql<{ id: string }>(`select id from public.call_bookings where first_name = 'Marisol'`);
    expect((await route.POST(request("/api/staff/calls", { action: "close_booking", bookingId: booking!.id, outcome: "completed", note: "Answered questions; sent to /registro." }))).status).toBe(200);
    expect((await route.POST(request("/api/staff/calls", { action: "close_booking", bookingId: booking!.id, outcome: "no_answer" }))).status).toBe(409);
    const [closed] = await h.sql<{ status: string; closed_by_name: string; staff_note: string }>(`select status, closed_by_name, staff_note from public.call_bookings where id = $1`, [booking!.id]);
    expect(closed).toMatchObject({ status: "completed", closed_by_name: "Ana Prieto" });
    // A specialist cannot close anything.
    as(h.as(specialist.userId));
    expect((await route.POST(request("/api/staff/calls", { action: "remove_window", windowId: windowId }))).status).toBe(403);
  });
});
