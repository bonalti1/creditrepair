import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { firstWorkingDay } from "../../agreement/businessDays";
import { localHour } from "../../autopilot/clock";
import { runAutopilot, type AutopilotDeps, type Deliver } from "../../autopilot/server";
import { saveAutopilotSettings } from "../../autopilot/store";
import { saveStateOpening } from "../../compliance/stateOpenings";
import { importReportForUser } from "../../domain/importReport";
import { reasonsFor } from "../../letters/reasons";
import { savePlatform, saveReviewSettings } from "../../reviews/server";
import { nextRoundDue, nextRoundDueFromRows } from "../../rounds/timing";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, ago, approveBuiltinLetters, DAY, sampleReport, signAgreement } from "./seed";

// Migrations 0028–0030 on the real migrations, through the real run and routes:
//
//   0028  the next-round date in SQL equals rounds/timing.ts on the same rows;
//         triggers keep attack_rounds.next_round_due_at as deliveries arrive;
//         rounds already mailed are recomputed when the migration runs;
//         round 1 noted inside the cancellation window goes out on the first
//         working day after it.
//   0029  review requests: once per client, at a milestone, whatever the
//         pulse said; append-only; read by staff; nothing a client can write.
//   0030  state openings: only Texas open; Georgia can never be opened; an
//         opened state carries the attorney's review; signup and agreement
//         routes refuse a state not opened; a HighLevel lead from a closed
//         state goes to the waitlist.

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

const HOUR = 60 * 60 * 1000;
let h: Harness;
let admin: Awaited<ReturnType<typeof addStaff>>;
let ip = 0;
const call = (path: string, body?: unknown) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const delivered: Array<{ key: string; body: string }> = [];
const deliver: Deliver = async (_client, message) => {
  delivered.push({ key: message.dedupeKey, body: message.body });
  return { ok: true, providerRef: `t-${delivered.length}` };
};
const deps: AutopilotDeps = { deliver, channels: { whatsapp: true, email: false, approvedTemplates: "all", simulated: false } };

function texasAt(hour: number, after: number): Date {
  let t = new Date(Math.ceil(after / HOUR) * HOUR);
  while (localHour(t, "America/Chicago") !== hour) t = new Date(t.getTime() + HOUR);
  return t;
}

async function answerAll(id: string): Promise<void> {
  const items = await h.sql<{ id: string; category: string }>(`select id, category from public.report_items where user_id = $1`, [id]);
  for (const item of items) {
    const attested = item.category === "personal_info";
    const { error } = await h.service.from("item_flags").insert({
      user_id: id,
      item_id: item.id,
      state: attested ? "attested" : "correct",
      attested,
      reason: attested ? "No es mío." : "",
      reason_code: attested ? reasonsFor("personal_info")[0]!.code : null,
      attestation_text: attested ? "I believe this item is inaccurate." : null,
      attestation_version: attested ? "v1" : null,
      attested_at: attested ? new Date(Date.now() - HOUR).toISOString() : null,
    });
    if (error) throw new Error(error.message);
  }
}

async function mailedRound(user: string, mailedDaysAgo: number, letters: Array<{ cls: string; status: string; deliveredDaysAfter?: number }>, status = "mailed") {
  const mailedAt = ago(mailedDaysAgo);
  const [round] = await h.sql<{ id: string }>(
    `insert into public.attack_rounds (user_id, round_number, status, mailed_at, responded_at, created_at) values ($1, 1, $2, $3, $4, $3) returning id`,
    [user, status, mailedAt, status === "complete" ? ago(2) : null],
  );
  for (const [i, l] of letters.entries()) {
    const deliveredAt = l.deliveredDaysAfter === undefined ? null : new Date(Date.parse(mailedAt) + l.deliveredDaysAfter * DAY).toISOString();
    await h.sql(
      `insert into public.letters (user_id, round_id, target_type, target_key, target_name, template_key, escalation_stage, body, status, mailed_at, mail_class, mail_status, delivered_at, returned_at)
       values ($1, $2, 'bureau', $3, $3, 'personal_info_cleanup', 'dispute', 'x', 'mailed', $4, $5, $6, $7, $8)`,
      [user, round!.id, `b${i}`, mailedAt, l.cls, l.status, deliveredAt, l.status === "returned" ? ago(1) : null],
    );
  }
  return { id: round!.id, mailedAt };
}

const storedDue = async (roundId: string) => (await h.sql<{ next_round_due_at: Date | null }>(`select next_round_due_at from public.attack_rounds where id = $1`, [roundId]))[0]!.next_round_due_at;
const sqlDue = async (roundId: string) => (await h.sql<{ due: Date | null }>(`select public.round_next_due(id, mailed_at) as due from public.attack_rounds where id = $1`, [roundId]))[0]!.due;
const tsDue = async (roundId: string) => {
  const [r] = await h.sql<{ mailed_at: Date }>(`select mailed_at from public.attack_rounds where id = $1`, [roundId]);
  const letters = await h.sql<Record<string, unknown>>(`select id, mail_class, mail_status, mailed_at::text, delivered_at::text from public.letters where round_id = $1`, [roundId]);
  return nextRoundDueFromRows(r!.mailed_at.toISOString(), letters.map((l) => ({ ...l, mailed_at: l.mailed_at ? new Date(String(l.mailed_at)).toISOString() : null, delivered_at: l.delivered_at ? new Date(String(l.delivered_at)).toISOString() : null })))!.dueAt;
};

beforeAll(async () => {
  h = await startHarness();
  session.admin = h.service;
  await approveBuiltinLetters(h);
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
}, 60_000);

describe("0028: when the next round is due", () => {
  it("SQL and TypeScript give the same date, and the trigger stores it", async () => {
    const cases: Array<Array<{ cls: string; status: string; deliveredDaysAfter?: number }>> = [
      [{ cls: "first_class", status: "in_transit" }],
      [{ cls: "certified", status: "delivered", deliveredDaysAfter: 3 }],
      [{ cls: "certified", status: "delivered", deliveredDaysAfter: 2 }, { cls: "certified", status: "in_transit" }],
      [{ cls: "certified", status: "delivered", deliveredDaysAfter: 12 }],
      [{ cls: "certified_return_receipt", status: "delivered", deliveredDaysAfter: 20 }],
      [{ cls: "first_class", status: "delivered", deliveredDaysAfter: 8 }, { cls: "first_class", status: "returned" }],
    ];
    const expected = [40, 38, 40, 45, 50, 43];
    for (const [i, letters] of cases.entries()) {
      const user = await addClient(h, { name: `Caso ${i}` });
      const round = await mailedRound(user, 10, letters);
      const ts = await tsDue(round.id);
      expect(new Date((await sqlDue(round.id))!).toISOString(), `case ${i}`).toBe(ts);
      expect(new Date((await storedDue(round.id))!).toISOString(), `case ${i} stored`).toBe(ts);
      expect(Math.round((Date.parse(ts) - Date.parse(round.mailedAt)) / DAY), `case ${i} days`).toBe(expected[i]);
    }
  });

  it("a certified delivery recorded later moves the stored date (what the Lob webhook writes)", async () => {
    const user = await addClient(h, { name: "Entrega Tarde" });
    const round = await mailedRound(user, 5, [{ cls: "certified", status: "in_transit" }]);
    expect(Math.round((Date.parse(new Date((await storedDue(round.id))!).toISOString()) - Date.parse(round.mailedAt)) / DAY)).toBe(40);
    const deliveredAt = new Date(Date.parse(round.mailedAt) + 2 * DAY).toISOString();
    await h.sql(`update public.letters set mail_status = 'delivered', delivered_at = $2 where round_id = $1`, [round.id, deliveredAt]);
    expect(new Date((await storedDue(round.id))!).toISOString()).toBe(nextRoundDue({ mailedAt: round.mailedAt }, [{ mailClass: "certified", deliveredAt, status: "delivered" }])!.dueAt);
    expect(Math.round((Date.parse(new Date((await storedDue(round.id))!).toISOString()) - Date.parse(round.mailedAt)) / DAY)).toBe(37);
  });

  it("rounds already mailed are recomputed when the migration runs", async () => {
    const old = await startHarness({ before: "0028_round_timing.sql" });
    await old.createUser("00000000-0000-4000-8000-00000000b001", { phone: "+17135550901" });
    await old.sql(`insert into public.profiles (id, full_name, phone_e164, state) values ('00000000-0000-4000-8000-00000000b001', 'Old Round', '+17135550901', 'TX')`);
    const mailedAt = ago(20);
    const [r] = await old.sql<{ id: string }>(
      `insert into public.attack_rounds (user_id, round_number, status, mailed_at, next_round_due_at) values ('00000000-0000-4000-8000-00000000b001', 1, 'mailed', $1, $2) returning id`,
      [mailedAt, new Date(Date.parse(mailedAt) + 40 * DAY).toISOString()],
    );
    await old.sql(
      `insert into public.letters (user_id, round_id, target_type, target_key, target_name, template_key, escalation_stage, body, status, mailed_at, mail_class, mail_status, delivered_at)
       values ('00000000-0000-4000-8000-00000000b001', $1, 'bureau', 'equifax', 'Equifax', 'personal_info_cleanup', 'dispute', 'x', 'mailed', $2, 'certified', 'delivered', $3)`,
      [r!.id, mailedAt, new Date(Date.parse(mailedAt) + 3 * DAY).toISOString()],
    );
    const setup = readFileSync("supabase/setup.sql", "utf8");
    await old.pg.exec(setup.slice(setup.indexOf("-- ===== 0028_round_timing.sql =====")));
    const [after] = await old.sql<{ next_round_due_at: Date }>(`select next_round_due_at from public.attack_rounds where id = $1`, [r!.id]);
    expect(Math.round((after!.next_round_due_at.getTime() - Date.parse(mailedAt)) / DAY)).toBe(38);
  }, 60_000);

  it("round 1 noted inside the cancellation window goes out on the first working day after it, not a day later", async () => {
    await saveAutopilotSettings(h.service, { roundsEnabled: true }, { userId: admin.userId, handle: "carmen" });
    const id = await addClient(h, { name: "Ventana Corta" });
    // Signed yesterday; the 3 business days end tomorrow.
    await signAgreement(h, id, { signedDaysAgo: 1, deadlineInDays: 1 });
    await addDocuments(h, id);
    await importReportForUser(h.service, id, sampleReport(1));
    await answerAll(id);
    const [{ cancellation_deadline: deadline }] = (await h.sql<{ cancellation_deadline: Date }>(`select cancellation_deadline from public.service_agreements where user_id = $1`, [id])) as [{ cancellation_deadline: Date }];
    const firstDay = firstWorkingDay(deadline);

    const inWindow = await runAutopilot(h.service, new Date(), deps);
    expect(inWindow.roundsWaitingForWindow).toBeGreaterThanOrEqual(1);
    expect(inWindow.roundsSent.find((r) => r.userId === id)).toBeUndefined();
    expect((await h.sql(`select 1 from public.autopilot_ready_rounds where user_id = $1`, [id])).length).toBe(1);
    // Nothing reaches the client while the window runs.
    expect((await h.sql(`select 1 from public.outbound_messages where user_id = $1`, [id])).length).toBe(0);

    const justBefore = await runAutopilot(h.service, new Date(firstDay.getTime() - HOUR), deps);
    expect(justBefore.roundsSent.find((r) => r.userId === id)).toBeUndefined();
    const onTheDay = await runAutopilot(h.service, new Date(firstDay.getTime() + 15 * 60 * 1000), deps);
    expect(onTheDay.roundsSent.find((r) => r.userId === id)).toMatchObject({ roundNumber: 1 });
    const [round] = await h.sql<{ mailed_at: Date; next_round_due_at: Date }>(`select mailed_at, next_round_due_at from public.attack_rounds where user_id = $1`, [id]);
    expect(Math.round((round!.next_round_due_at.getTime() - round!.mailed_at.getTime()) / DAY)).toBe(40);
    await saveAutopilotSettings(h.service, { roundsEnabled: false }, { userId: admin.userId, handle: "carmen" });
  }, 60_000);
});

describe("0029: review requests", () => {
  let happy: string;
  let sad: string;

  beforeAll(async () => {
    for (const name of ["Rosa Contenta", "Luis Molesto"]) {
      const id = await addClient(h, { name });
      await signAgreement(h, id, { signedDaysAgo: 60 });
      await addDocuments(h, id);
      await importReportForUser(h.service, id, sampleReport(50));
      // Round 1's answers are in: the first new report after it (whatever it showed).
      await mailedRound(id, 45, [{ cls: "first_class", status: "delivered", deliveredDaysAfter: 4 }], "complete");
      if (name.startsWith("Rosa")) happy = id;
      else sad = id;
    }
    await h.service.from("client_pulses").insert([
      { user_id: happy, moment: "agreement_signed", rating: 3, locale: "es" },
      { user_id: sad, moment: "agreement_signed", rating: 1, comment: "Nadie me contesta.", locale: "es" },
    ]);
  }, 60_000);

  it("starts off: nothing is asked", async () => {
    const run = await runAutopilot(h.service, texasAt(12, Date.now()), deps);
    expect(run.reviews?.asked ?? 0).toBe(0);
    expect((await h.sql(`select 1 from public.review_requests`)).length).toBe(0);
  });

  it("a review link must be on the platform's own host (server and database)", async () => {
    const by = { userId: admin.userId, handle: "carmen" };
    expect(await savePlatform(h.service, { key: "google", url: "https://evil.example/google.com" }, by)).toEqual({ ok: false, code: "wrong_host" });
    expect((await h.service.from("review_platforms").update({ url: "https://evil.example/x" }).eq("key", "trustpilot")).error).not.toBeNull();
    expect((await h.service.from("review_platforms").update({ enabled: true }).eq("key", "bbb")).error).not.toBeNull();
    expect(await savePlatform(h.service, { key: "google", url: "https://g.page/r/credalti-test/review" }, by)).toEqual({ ok: true });
    expect(await savePlatform(h.service, { key: "google", enabled: true, rating: 4.8, reviewCount: 10 }, by)).toEqual({ ok: true });
  });

  it("on: every client at the milestone is asked once, the unhappy one too, through the outbound log", async () => {
    await saveReviewSettings(h.service, { requestsEnabled: true }, { userId: admin.userId, handle: "carmen" });
    const noon = texasAt(12, Date.now() + DAY);
    const run = await runAutopilot(h.service, noon, deps);
    expect(run.reviews?.byMilestone.first_results).toBeGreaterThanOrEqual(2);
    const asked = await h.sql<{ user_id: string; milestone: string; channel: string }>(`select user_id, milestone, channel from public.review_requests where user_id in ($1, $2) order by user_id`, [happy, sad]);
    expect(asked.map((a) => [a.milestone, a.channel])).toEqual([
      ["first_results", "whatsapp_or_email"],
      ["first_results", "whatsapp_or_email"],
    ]);
    const msgs = await h.sql<{ user_id: string; topic: string; status: string; body: string }>(`select user_id, topic, status, body from public.outbound_messages where topic = 'review_request' and user_id in ($1, $2)`, [happy, sad]);
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.status === "sent")).toBe(true);
    expect(msgs[0]!.body).toMatch(/good or bad|buena o mala/);
    // Again: nobody is asked twice.
    const again = await runAutopilot(h.service, new Date(noon.getTime() + 2 * DAY), deps);
    expect(again.reviews?.asked ?? 0).toBe(0);
    expect((await h.sql(`select 1 from public.outbound_messages where topic = 'review_request' and user_id in ($1, $2)`, [happy, sad])).length).toBe(2);
  }, 60_000);

  it("records are append-only, read by staff, written by nobody else", async () => {
    expect((await h.service.from("review_requests").update({ milestone: "program_finished" }).eq("user_id", happy)).error).not.toBeNull();
    expect((await h.service.from("review_requests").delete().eq("user_id", happy)).error).not.toBeNull();
    expect((await h.service.from("review_requests").insert({ user_id: happy, milestone: "referral_signed", channel: "in_app" })).error?.code).toBe("23505");
    expect((await h.as(sad).from("review_requests").insert({ user_id: sad, milestone: "first_results", channel: "in_app" })).error).not.toBeNull();
    expect((await h.as(sad).from("review_requests").select("*")).data).toEqual([]);
    expect(((await h.as(admin.userId).from("review_requests").select("user_id")).data ?? []).length).toBeGreaterThanOrEqual(2);
    expect((await h.as(sad).from("review_settings").update({ requests_enabled: false }).eq("id", true)).error).toBeNull();
    expect((await h.sql<{ requests_enabled: boolean }>(`select requests_enabled from public.review_settings`))[0]!.requests_enabled).toBe(true);
    const audit = await h.sql(`select 1 from public.team_audit where kind = 'reviews_changed'`);
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe("0030: state openings", () => {
  it("only Texas starts opened; Georgia can never be opened; an opened state carries the attorney's review", async () => {
    expect(await h.sql(`select state from public.state_openings where opened`)).toEqual([{ state: "TX" }]);
    expect((await h.service.from("state_openings").upsert({ state: "GA", opened: true, attorney_name: "Lic. Prueba", attorney_reviewed_on: "2026-11-20" })).error).not.toBeNull();
    expect((await h.service.from("state_openings").upsert({ state: "CA", opened: true })).error).not.toBeNull();
    const by = { userId: admin.userId, handle: "carmen" };
    expect(await saveStateOpening(h.service, { state: "CA", opened: true, attorneyName: "Lic. Prueba Abogada", attorneyReviewedOn: "2026-11-20" }, by)).toMatchObject({ ok: false, problems: ["registration_ref", "bond"] });
    expect(await saveStateOpening(h.service, { state: "GA", opened: true, attorneyName: "Lic. Prueba Abogada", attorneyReviewedOn: "2026-11-20" }, by)).toMatchObject({ ok: false, problems: ["restricted"] });
    // A client cannot touch it.
    const someone = await addClient(h, { name: "Curiosa" });
    expect((await h.as(someone).from("state_openings").select("*")).data).toEqual([]);
  });

  it("signup from a state not opened is refused politely; Texas goes through; once opened, it goes through", async () => {
    const onboarding = await import("@/app/api/profile/onboarding/route");
    const id = await addClient(h, { name: "Ana Californiana", state: "CA" });
    session.reader = h.as(id);
    const refused = await onboarding.POST(call("/api/profile/onboarding", { state: "CA", goal: "general" }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "state_not_open" });
    expect((await onboarding.POST(call("/api/profile/onboarding", { state: "GA" }))).status).toBe(409);
    expect((await onboarding.POST(call("/api/profile/onboarding", { state: "TX", goal: "general" }))).status).toBe(200);

    // The agreement routes refuse a client whose state is not opened.
    await h.sql(`update public.profiles set state = 'CA' where id = $1`, [id]);
    const ack = await import("@/app/api/agreement/acknowledge/route");
    const res = await ack.POST(call("/api/agreement/acknowledge", { version: "x", locale: "en", documentHash: "a".repeat(64), consents: { esign: true } }));
    // Either the body is refused for shape first, or the state is: never accepted.
    expect([400, 409]).toContain(res.status);

    const by = { userId: admin.userId, handle: "carmen" };
    expect(await saveStateOpening(h.service, { state: "CA", opened: true, attorneyName: "Lic. Prueba Abogada", attorneyReviewedOn: "2026-11-20", registrationRef: "CSO-2026-1", bondConfirmed: true }, by)).toMatchObject({ ok: true });
    expect((await onboarding.POST(call("/api/profile/onboarding", { state: "CA", goal: "general" }))).status).toBe(200);
    const states = await import("@/app/api/states/route");
    expect(await (await states.GET(call("/api/states"))).json()).toEqual({ opened: expect.arrayContaining(["TX", "CA"]) });
    expect((await h.sql(`select 1 from public.team_audit where kind = 'state_opening_changed'`)).length).toBe(1);
    session.reader = null;
  });

  it("a HighLevel lead from a closed state goes to the waitlist, not to sales", async () => {
    process.env.HIGHLEVEL_WEBHOOK_SECRET = "hl-test-secret";
    const route = await import("@/app/api/webhooks/highlevel/route");
    const req = new Request("https://app.test/api/webhooks/highlevel", {
      method: "POST",
      headers: { "content-type": "application/json", "x-credalti-secret": "hl-test-secret", "x-forwarded-for": "10.8.0.1" },
      body: JSON.stringify({ contact_id: "hl-ny-1", first_name: "Nora", last_name: "Neoyorquina", phone: "+12125550177", email: "nora@example.com", state: "NY", consent_text: "Acepto que me contacten.", consent_at: new Date().toISOString() }),
    });
    const res = await route.POST(req);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ outcome: "waitlisted" });
    expect(await h.sql(`select state, source, phone_e164 from public.waitlist where phone_e164 = '+12125550177'`)).toEqual([{ state: "NY", source: "highlevel", phone_e164: "+12125550177" }]);
    expect(await h.sql(`select 1 from public.prospects where phone_e164 = '+12125550177'`)).toEqual([]);
  });
});
