import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { introHash, INTRO_CONSENT_VERSION } from "../../aftercare/connect";
import { importReportForUser } from "../../domain/importReport";
import { creditPartner } from "../../partners/attribution";
import { consentHash, SHARING_CONSENT_VERSION } from "../../partners/sharing";
import { PARTNER_CLIENT_TERMS_VERSION } from "../../partners/terms";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, ago, assign, sampleReport, signAgreement, uid } from "./seed";

// After-care (migration 0030) against the real migrations, with row level
// security: the kind of taxpayer number only; marks and graduation written by
// the server; graduating ends the service so no charge can follow; offers off
// until an administrator turns them on, ranked by cost; home-ready milestones
// reach a partner only with the client's consent, through the 0023 consent;
// and the loan officer introduction checks who may receive it.

const session = vi.hoisted(() => ({ reader: null as unknown, admin: null as unknown, staff: null as unknown }));
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
vi.mock("@/lib/agreement/server", async (original) => ({ ...(await original<typeof import("@/lib/agreement/server")>()), notifyTeam: async () => undefined }));

let h: Harness;
let ip = 0;
const as = (who: SupabaseClient | null) => {
  session.reader = who;
  session.admin = h.service;
};
const request = (path: string, body?: unknown) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.30.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

const aftercare = async (client: string, body?: unknown) => {
  const route = await import("@/app/api/aftercare/route");
  as(h.as(client));
  return json(body === undefined ? await route.GET(request("/api/aftercare")) : await route.POST(request("/api/aftercare", body)));
};

let P1: string; // Laura, realtor, approved
let P2: string; // Jorge, loan officer, approved
let P3: string; // Sandra, tax preparer, approved
let laura: string;
let jorge: string;
let A: string; // Rosa: referred by Laura, signed long ago, round 1 mailed
let B: string; // Luis: signed yesterday, inside the window
let C: string; // Nadia: nobody referred her
const LAURA = { name: "Laura Benítez", company: "Benítez Realty" };
const JORGE = { name: "Jorge Treviño", company: "Hipotecas del Valle" };

const insertPartner = async (fields: Record<string, unknown>) => {
  const { data, error } = await h.service
    .from("partners")
    .insert({ terms_version: "2026-11-socios-v1", terms_accepted_at: new Date().toISOString(), ...fields })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
};

async function mailRound(user: string, n: number, daysAgo: number): Promise<string> {
  const { data: round } = await h.service.from("attack_rounds").insert({ user_id: user, round_number: n, status: "mailed", mailed_at: ago(daysAgo) }).select("id").single();
  const id = (round as { id: string }).id;
  await h.service.from("letters").insert({ user_id: user, round_id: id, target_type: "bureau", target_key: "equifax", target_name: "Equifax", template_key: "dispute_611_accounts", escalation_stage: "initial", body: "Carta", status: "mailed", mailed_at: ago(daysAgo) });
  return id;
}

beforeAll(async () => {
  h = await startHarness();
  await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  P1 = await insertPartner({ name: LAURA.name, company: LAURA.company, kind: "realtor", phone_e164: "+17135550161", status: "approved", referral_code: "laura-benitez" });
  P2 = await insertPartner({ name: JORGE.name, company: JORGE.company, kind: "loan_officer", phone_e164: "+19565550162", status: "approved", referral_code: "jorge-trevino" });
  P3 = await insertPartner({ name: "Sandra Olvera", company: null, kind: "tax_preparer", phone_e164: "+19565550163", status: "approved", referral_code: "sandra-olvera" });
  laura = uid();
  jorge = uid();
  await h.createUser(laura, { phone: "+17135550161" });
  await h.createUser(jorge, { phone: "+19565550162" });
  await h.service.from("partner_members").insert([{ user_id: laura, partner_id: P1 }, { user_id: jorge, partner_id: P2 }]);
  for (const [partner, user] of [[P1, laura], [P2, jorge]] as const) {
    await h.service.from("partner_terms_acceptances").insert({ partner_id: partner, user_id: user, version: PARTNER_CLIENT_TERMS_VERSION, locale: "es", text_hash: "c".repeat(64) });
  }

  A = await addClient(h, { name: "Rosa Martínez", phone: "+17135550181" });
  expect(await creditPartner(h.service, A, "laura-benitez")).toBe(true);
  await h.service.from("profiles").update({ goal: "mortgage" }).eq("id", A);
  await signAgreement(h, A, { signedDaysAgo: 100 });
  await addDocuments(h, A);
  await importReportForUser(h.service, A, sampleReport(60));
  const { data: items } = await h.service.from("report_items").select("id").eq("user_id", A);
  for (const item of items as Array<{ id: string }>) await h.service.from("item_flags").insert({ user_id: A, item_id: item.id, reason: "No es mía", attested: true, attested_at: ago(55) });
  await mailRound(A, 1, 50);

  B = await addClient(h, { name: "Luis Gómez", phone: "+17135550182" });
  await signAgreement(h, B, { signedDaysAgo: 1, deadlineInDays: 2 });
  C = await addClient(h, { name: "Nadia Ruiz", phone: "+17135550183" });
  await signAgreement(h, C, { signedDaysAgo: 40 });
}, 90_000);

describe("the kind of taxpayer number, never the number", () => {
  it("the client saves SSN or ITIN on their own profile; anything else is refused", async () => {
    expect((await aftercare(A, { action: "id_type", idType: "itin" })).status).toBe(200);
    expect((await h.sql(`select id_type from public.profiles where id = $1`, [A]))[0]).toEqual({ id_type: "itin" });
    expect((await aftercare(A, { action: "id_type", idType: "912-70-1234" })).status).toBe(400);
    const { error } = await h.as(A).from("profiles").update({ id_type: "912701234" }).eq("id", A);
    expect(error?.message).toMatch(/check constraint/);
  });

  it("no table has a column for an SSN or an ITIN", async () => {
    const cols = await h.sql<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type <> 'boolean' and column_name ~* '(^|_)(ssn|itin|social_security|tax_id|taxpayer)(_|$)' and column_name <> 'id_type'`,
    );
    expect(cols).toEqual([]);
  });

  it("staff see it on the client page; partners never", async () => {
    const route = await import("@/app/api/partners/clients/[id]/route");
    as(h.as(laura, { phone: "+17135550161" }));
    const res = await route.GET(request(`/api/partners/clients/${A}`), { params: Promise.resolve({ id: A }) });
    expect(JSON.stringify(await res.json())).not.toMatch(/itin/i);
  });
});

describe("Mark as done", () => {
  it("goes through the server, one append-only row each; the client cannot write it directly", async () => {
    expect((await aftercare(A, { action: "mark", key: "on_time", done: true })).status).toBe(200);
    expect((await aftercare(A, { action: "mark", key: "home_savings", done: true })).status).toBe(200);
    expect((await aftercare(A, { action: "mark", key: "not_a_step", done: true })).status).toBe(400);
    const direct = await h.as(A).from("aftercare_marks").insert({ user_id: A, item_key: "on_time", done: false });
    expect(direct.error).not.toBeNull();
    await expect(h.sql(`update public.aftercare_marks set done = false`)).rejects.toThrow(/cannot be changed or deleted/);
    const state = await aftercare(A);
    expect(state.body.marks).toMatchObject({ on_time: { done: true }, home_savings: { done: true } });
    // Another client reads none of them.
    expect((await h.as(C).from("aftercare_marks").select("*")).data).toEqual([]);
  });
});

describe("partner offers", () => {
  it("are off by default: a client sees none, even with active offers", async () => {
    const offer = (o: Record<string, unknown>) => ({ itin_friendly: false, affiliate: false, affiliate_disclosure: null, active: true, ...o });
    const inserted = await h.service.from("partner_offers").insert([
      offer({ name: "Zeta Card", kind: "secured_card", provider: "Bank Z", yearly_cost_cents: 4900, cost_note: "$49 a year", url: "https://z.example/c", affiliate: true, affiliate_disclosure: "Credalti may be paid if you sign up for this card." }),
      offer({ name: "alpha Loan", kind: "credit_builder_loan", provider: "CU A", yearly_cost_cents: 4900, cost_note: "Interest", url: "https://a.example/l", itin_friendly: true }),
      offer({ name: "Free Rent", kind: "rent_reporting", provider: "Rent Co", yearly_cost_cents: 0, cost_note: "Free", url: "https://r.example/r", affiliate: true, affiliate_disclosure: "Credalti may be paid if you sign up for this service." }),
      offer({ name: "Old", kind: "other", provider: "Old Co", yearly_cost_cents: 0, cost_note: "x y", url: "https://o.example/o", active: false }),
    ]);
    expect(inserted.error?.message ?? null).toBeNull();
    expect((await h.as(A).rpc("client_offers")).data).toEqual([]);
    expect((await aftercare(A)).body).toMatchObject({ offersEnabled: false, offers: [] });
  });

  it("an affiliate offer without its disclosure is refused by the database", async () => {
    const { error } = await h.service.from("partner_offers").insert({ name: "Sneaky", kind: "other", provider: "Sneaky Co", yearly_cost_cents: 0, cost_note: "Free", url: "https://s.example/s", affiliate: true });
    expect(error?.message).toMatch(/partner_offers_affiliate_disclosed/);
  });

  it("once an administrator turns them on: active offers, cheapest first, then by name; clients cannot read the table itself", async () => {
    const route = await import("@/app/api/staff/offers/route");
    const admin = (await h.sql<{ user_id: string }>(`select user_id from public.staff_members where role = 'admin' limit 1`))[0]!.user_id;
    as(h.as(admin));
    const on = await json(await route.POST(request("/api/staff/offers", { action: "switch", enabled: true })));
    expect(on, JSON.stringify(on)).toMatchObject({ status: 200 });
    expect((await h.as(A).rpc("offers_enabled")).data).toBe(true);
    const direct = await h.as(A).rpc("client_offers");
    expect(direct.error).toBeNull();
    const { body } = await aftercare(A);
    expect(body.offersEnabled, JSON.stringify(body)).toBe(true);
    expect((body.offers as Array<{ name: string }>).map((o) => o.name)).toEqual(["Free Rent", "alpha Loan", "Zeta Card"]);
    expect((await h.as(A).from("partner_offers").select("*")).data).toEqual([]);
    expect((await h.anon.rpc("client_offers")).error).not.toBeNull();
    // A specialist or a client cannot turn it off.
    as(h.as(A));
    expect((await route.POST(request("/api/staff/offers", { action: "switch", enabled: false }))).status).toBe(403);
  });
});

describe("home-ready milestones reach a partner only with consent", () => {
  const homeOf = async (partner: string, client: string) => ((await h.as(partner).rpc("partner_home_ready", { p_client: client })).data as Array<Record<string, unknown>> | null) ?? [];
  const share = async (client: string, body: Record<string, unknown>) => {
    const route = await import("@/app/api/sharing/route");
    as(h.as(client));
    return json(await route.POST(request("/api/sharing", { action: "set", locale: "es", version: SHARING_CONSENT_VERSION, ...body })));
  };

  it("nothing without consent, and nothing with progress sharing alone", async () => {
    expect(await homeOf(laura, A)).toEqual([]);
    expect((await share(A, { partnerId: P1, level: "progress", textHash: consentHash("progress", LAURA, "es") })).status).toBe(200);
    expect(await homeOf(laura, A)).toEqual([]);
  });

  it("with the home-ready line consented to: milestone names and dates only", async () => {
    const wrong = await share(A, { partnerId: P1, level: "progress", homeReady: true, textHash: consentHash("progress", LAURA, "es") });
    expect(wrong.status).toBe(409);
    const ok = await share(A, { partnerId: P1, level: "progress", homeReady: true, textHash: consentHash("progress", LAURA, "es", SHARING_CONSENT_VERSION, { homeReady: true }) });
    expect(ok.status).toBe(200);
    expect(ok.body.record).toMatchObject({ level: "progress", previous_level: "progress", action: "change", home_ready: true });
    const rows = await homeOf(laura, A);
    expect(rows.map((r) => r.milestone)).toEqual(["documents", "report_reviewed", "disputes_in_progress", "positive_accounts", "savings", "loan_officer", "graduated"]);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["done_at", "milestone"]);
    const done = Object.fromEntries(rows.map((r) => [r.milestone, r.done_at !== null]));
    expect(done).toMatchObject({ documents: true, report_reviewed: true, disputes_in_progress: true, savings: true, positive_accounts: false, graduated: false });
    // The partner page returns them, after logging the view.
    const route = await import("@/app/api/partners/clients/[id]/route");
    as(h.as(laura, { phone: "+17135550161" }));
    const page = (await (await route.GET(request(`/api/partners/clients/${A}`), { params: Promise.resolve({ id: A }) })).json()) as { homeReady: unknown[] };
    expect(page.homeReady).toHaveLength(7);
    // Another partner, or a crafted read of the tables, gets nothing.
    expect(await homeOf(jorge, A)).toEqual([]);
    expect((await h.as(laura).from("aftercare_marks").select("*")).data).toEqual([]);
    expect((await h.as(laura).from("program_completions").select("*")).data).toEqual([]);
    expect((await h.as(laura).from("loan_officer_requests").select("*")).data).toEqual([]);
  });

  it("a change made on a screen without the home-ready line keeps it off; a revocation stops everything at once", async () => {
    const changed = await share(A, { partnerId: P1, level: "summary", textHash: consentHash("summary", LAURA, "es") });
    expect(changed.body.record).toMatchObject({ level: "summary", home_ready: false });
    expect(await homeOf(laura, A)).toEqual([]);
    await share(A, { partnerId: P1, level: "summary", homeReady: true, textHash: consentHash("summary", LAURA, "es", SHARING_CONSENT_VERSION, { homeReady: true }) });
    expect((await homeOf(laura, A)).length).toBe(7);
    expect((await share(A, { partnerId: P1, level: "none" })).status).toBe(200);
    expect(await homeOf(laura, A)).toEqual([]);
  });

  it("home-ready milestones never go to a tax preparer, and the database refuses a crafted record", async () => {
    const { error } = await h.service.from("partner_share_consents").insert({ user_id: C, partner_id: P3, level: "progress", home_ready: true, how: "added_by_code", text_version: SHARING_CONSENT_VERSION, locale: "es", text_hash: "d".repeat(64), partner_name_shown: "Sandra Olvera" });
    expect(error?.message).toMatch(/real estate agent or a loan officer/);
    const none = await h.service.from("partner_share_consents").insert({ user_id: C, partner_id: P2, level: "none", home_ready: true, how: "added_by_code", text_version: SHARING_CONSENT_VERSION, locale: "es", text_hash: "d".repeat(64), partner_name_shown: "Jorge" });
    expect(none.error?.message).toMatch(/home_ready_needs_level/);
  });
});

describe("Connect me with a loan officer", () => {
  it("goes to the referring partner when they help with home loans, with the hash of the text shown", async () => {
    const state = await aftercare(A);
    expect(state.body.intro).toMatchObject({ how: "referred", partners: [{ id: P1, kind: "realtor" }] });
    expect((await aftercare(A, { action: "intro", partnerId: P1, locale: "es", version: INTRO_CONSENT_VERSION, textHash: "0".repeat(64) })).status).toBe(409);
    const ok = await aftercare(A, { action: "intro", partnerId: P1, locale: "es", version: INTRO_CONSENT_VERSION, textHash: introHash(LAURA, "es") });
    expect(ok.status).toBe(200);
    // One open request at a time.
    expect((await aftercare(A, { action: "intro", partnerId: P1, locale: "es", version: INTRO_CONSENT_VERSION, textHash: introHash(LAURA, "es") })).status).toBe(409);
    // The partner sees the name, phone and goal the client agreed to send; nothing else.
    const { data } = await h.as(laura).rpc("partner_intro_requests");
    expect(data).toEqual([{ request_id: expect.any(String), display_name: "Rosa Martínez", phone_e164: "+17135550181", goal: "mortgage", requested_at: expect.anything() }]);
    expect((await h.as(jorge).rpc("partner_intro_requests")).data).toEqual([]);
    expect((await aftercare(A, { action: "withdraw_intro" })).status).toBe(200);
    expect((await h.as(laura).rpc("partner_intro_requests")).data).toEqual([]);
  });

  it("otherwise only to a loan officer an administrator marked as accepting new clients", async () => {
    expect((await aftercare(C)).body.intro).toEqual({ how: "accepting", partners: [] });
    const blocked = await h.service.from("loan_officer_requests").insert({ user_id: C, partner_id: P2, how: "accepting", text_version: INTRO_CONSENT_VERSION, locale: "es", text_hash: introHash(JORGE, "es"), partner_name_shown: "Jorge" });
    expect(blocked.error?.message).toMatch(/not accepting new clients/);
    // Only a loan officer can be marked as accepting.
    expect((await h.service.from("partners").update({ accepting_clients: true }).eq("id", P1)).error?.message).toMatch(/partners_accepting_is_loan_officer/);
    await h.service.from("partners").update({ accepting_clients: true }).eq("id", P2);
    expect((await aftercare(C)).body.intro).toMatchObject({ how: "accepting", partners: [{ id: P2, name: JORGE.name }] });
    const ok = await aftercare(C, { action: "intro", partnerId: P2, locale: "es", version: INTRO_CONSENT_VERSION, textHash: introHash(JORGE, "es") });
    expect(ok.status).toBe(200);
    // A partner who did not refer C cannot be reached as "referred".
    await aftercare(C, { action: "withdraw_intro" });
    const crafted = await h.service.from("loan_officer_requests").insert({ user_id: C, partner_id: P1, how: "referred", text_version: INTRO_CONSENT_VERSION, locale: "es", text_hash: introHash(LAURA, "es"), partner_name_shown: "Laura" });
    expect(crafted.error?.message).toMatch(/did not refer/);
  });
});

describe("graduation", () => {
  it("is refused inside the cancellation window (the client cancels instead)", async () => {
    expect((await aftercare(B, { action: "graduate", keepTips: true, locale: "es" })).status).toBe(409);
    const { error } = await h.service.from("program_completions").insert({ user_id: B, reason: "client_chose" });
    expect(error?.message).toMatch(/cancellation window/);
  });

  it("ends the service on the agreement in the same transaction, and no charge can be created afterwards", async () => {
    // The control: the same situation without graduating is charged (another client, same dates).
    const D = await addClient(h, { name: "Elena Soto", phone: "+17135550184" });
    await signAgreement(h, D, { signedDaysAgo: 40 });
    const dRound = await mailRound(D, 1, 20);
    const control = await h.service.from("charges").insert({ user_id: D, round_id: dRound, amount_cents: 8900, unit: "round" });
    expect(control.error?.message ?? null).toBeNull();
    await mailRound(C, 1, 20);
    const res = await aftercare(C, { action: "graduate", keepTips: false, locale: "en", markedStillReported: 0 });
    expect(res.status).toBe(200);
    expect(res.body.graduation).toMatchObject({ reason: "client_chose", keepTips: false });
    const [agreement] = await h.sql<{ service_end_requested_at: string | null; service_end_reason: string | null }>(`select service_end_requested_at, service_end_reason from public.service_agreements where user_id = $1`, [C]);
    expect(agreement!.service_end_requested_at).not.toBeNull();
    expect(agreement!.service_end_reason).toBe("Program completed (graduation)");
    const round = (await h.sql<{ id: string }>(`select id from public.attack_rounds where user_id = $1`, [C]))[0]!.id;
    const charge = await h.service.from("charges").insert({ user_id: C, round_id: round, amount_cents: 8900, unit: "round" });
    expect(charge.error?.message).toMatch(/asked to end the service/);
    // Asking again changes nothing; the record cannot be edited except the tips choice.
    expect((await aftercare(C, { action: "graduate", keepTips: true, locale: "en" })).body).toMatchObject({ unchanged: true });
    expect((await aftercare(C, { action: "tips", keepTips: true })).status).toBe(200);
    await expect(h.sql(`update public.program_completions set reason = 'disputes_done' where user_id = $1`, [C])).rejects.toThrow(/only the tips choice/);
    await expect(h.sql(`delete from public.program_completions where user_id = $1`, [C])).rejects.toThrow(/cannot be deleted/);
  });

  it("a client whose marked items are all gone graduates as 'disputes done', and a shared partner sees it", async () => {
    await h.service.from("report_items").update({ status: "deleted", deleted_detected_at: ago(5) }).eq("user_id", A);
    // A has nothing active now; the review counts are 0 of 0, so finishing is the client's choice.
    const res = await aftercare(A, { action: "graduate", keepTips: true, locale: "es", markedStillReported: 0 });
    expect(res.status).toBe(200);
    const share = await import("@/app/api/sharing/route");
    as(h.as(A));
    await share.POST(request("/api/sharing", { action: "set", partnerId: P1, level: "progress", homeReady: true, locale: "es", version: SHARING_CONSENT_VERSION, textHash: consentHash("progress", LAURA, "es", SHARING_CONSENT_VERSION, { homeReady: true }) }));
    const rows = ((await h.as(laura).rpc("partner_home_ready", { p_client: A })).data as Array<{ milestone: string; done_at: string | null }>) ?? [];
    expect(rows.find((r) => r.milestone === "graduated")?.done_at).toBeTruthy();
    // The staff console reads it, by role.
    const { loadStaffClients } = await import("@/lib/staff/load");
    const admin = (await h.sql<{ user_id: string }>(`select user_id from public.staff_members where role = 'admin' limit 1`))[0]!.user_id;
    const [client] = await loadStaffClients(h.as(admin), { clientId: A });
    expect(client).toMatchObject({ idType: "itin", graduation: { reason: expect.any(String) }, aftercareMarks: { on_time: { done: true } } });
  });
});

describe("staff", () => {
  it("a specialist sees marks for an assigned client only, and sales sees none", async () => {
    const marta = await addStaff(h, "specialist", "marta", "Marta Leal");
    const ana = await addStaff(h, "sales", "ana", "Ana Prieto");
    expect((await h.as(marta.userId).from("aftercare_marks").select("user_id")).data).toEqual([]);
    await assign(h, A, marta.userId);
    expect(((await h.as(marta.userId).from("aftercare_marks").select("user_id")).data as unknown[]).length).toBeGreaterThan(0);
    expect((await h.as(ana.userId).from("aftercare_marks").select("user_id")).data).toEqual([]);
  });
});
