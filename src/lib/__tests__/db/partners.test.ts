import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { deliverOutbox, queueStageEvents } from "../../highlevel/server";
import type { StagePayload } from "../../highlevel/stages";
import { creditPartner } from "../../partners/attribution";
import { convertProspect } from "../../staff/server";
import { PARTNER_REFERRAL_COLUMNS } from "../../partners/portal";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, ago, sampleReport, signAgreement, uid } from "./seed";

// Partners and the HighLevel handoff against the real migrations (0017 on top
// of 0001–0014), with row level security applied: what a partner can read,
// what a client cannot write, the HighLevel webhook end to end (dedupe, the
// SSN that is never stored), and the stage outbox sending each event once.

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
const request = (path: string, init: { body?: unknown; raw?: string; headers?: Record<string, string>; method?: string } = {}) =>
  new Request(`https://app.test${path}`, {
    method: init.method ?? (init.body === undefined && init.raw === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(++ip / 250)}.${ip % 250}`, ...init.headers },
    ...(init.raw !== undefined ? { body: init.raw } : init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

const SECRET = "hl-test-secret-0123456789";
const CONSENT = "Acepto que Credalti me contacte por WhatsApp sobre su servicio. Puedo pedir que dejen de escribirme cuando quiera.";

let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let luis: Awaited<ReturnType<typeof addStaff>>;
let P1: string; // Laura, approved
let P2: string; // Jorge, approved
let P3: string; // Sandra, pending
let laura: string; // Laura's sign-in
let jorge: string; // Jorge's sign-in
let A: string; // a client Laura referred (as a prospect, converted): signed, first round mailed
let B: string; // a client who came by Jorge's link: report on file
let felipe: string; // a prospect Laura referred

const insertPartner = async (fields: Record<string, unknown>) => {
  const { data, error } = await h.service
    .from("partners")
    .insert({ terms_version: "2026-11-socios-v1", terms_accepted_at: new Date().toISOString(), ...fields })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
};

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  luis = await addStaff(h, "sales", "luis", "Luis Ortega");
  // "Comisiones a socios" is off until an administrator records the attorney's
  // approval (migration 0023; partnerSharing.test.ts covers the switch). These
  // tests are about commissions, so the program is on, as an administrator would set it.
  await h.service.from("partner_program_changes").insert({ commissions_enabled: true, attorney_name: "Lic. Prueba Abogada", attorney_approved_on: "2026-11-20", confirmed: true, changed_by: admin.userId, changed_by_name: "carmen" });
  P1 =await insertPartner({ name: "Laura Benítez", kind: "realtor", phone_e164: "+17135550161", status: "approved", referral_code: "laura-benitez", salesperson: "ana", commission_basis: "signed_client", commission_cents: 10000 });
  P2 = await insertPartner({ name: "Jorge Treviño", kind: "loan_officer", phone_e164: "+19565550162", status: "approved", referral_code: "jorge-trevino" });
  P3 = await insertPartner({ name: "Sandra Olvera", kind: "tax_preparer", phone_e164: "+12105550163", status: "pending" });
  laura = uid();
  jorge = uid();
  await h.createUser(laura, { phone: "+17135550161" });
  await h.createUser(jorge, { phone: "+19565550162" });

  // Laura referred Rosa as a prospect; Rosa then created her account, signed and had a round mailed.
  const { data: rosaProspect } = await h.service
    .from("prospects")
    .insert({ first_name: "Rosa", last_name: "Martínez", phone_e164: "+17135550171", state: "TX", goal: "auto", salesperson: "ana", source: "partner", partner_id: P1, consent_text: CONSENT, consent_at: ago(20) })
    .select("id")
    .single();
  expect(rosaProspect).toBeTruthy();
  A = await addClient(h, { name: "Rosa Martínez", phone: "+17135550171", referredBy: "ana" });
  expect(await convertProspect(h.service, A, "+17135550171")).toBe(true);
  await signAgreement(h, A);
  await addDocuments(h, A);
  await importReportForUser(h.service, A, sampleReport(3));
  await h.service.from("attack_rounds").insert({ user_id: A, round_number: 1, status: "mailed", mailed_at: ago(2) });

  // Luis came by Jorge's link and signed up himself.
  B = await addClient(h, { name: "Luis Gómez", phone: "+17135550172", referredBy: "luis" });
  expect(await creditPartner(h.service, B, "jorge-trevino")).toBe(true);
  await importReportForUser(h.service, B, sampleReport(3));

  const { data: f } = await h.service
    .from("prospects")
    .insert({ first_name: "Felipe", last_name: "Arroyo", phone_e164: "+17135550173", state: "TX", goal: "mortgage", salesperson: "ana", source: "partner", partner_id: P1, consent_text: CONSENT, consent_at: ago(1) })
    .select("id")
    .single();
  felipe = String((f as { id: string }).id);

  await h.service.from("partner_commissions").insert([
    { partner_id: P1, kind: "owed", amount_cents: 10000, recorded_by: admin.userId, recorded_by_name: "carmen" },
    { partner_id: P2, kind: "owed", amount_cents: 7500, recorded_by: admin.userId, recorded_by_name: "carmen" },
  ]);

  // Each partner signs in once: the membership is claimed from the verified phone.
  const me = await import("@/app/api/partners/me/route");
  as(h.as(laura, { phone: "+17135550161" }));
  expect((await json(await me.GET(request("/api/partners/me")))).body).toMatchObject({ partner: true, name: "Laura Benítez" });
  as(h.as(jorge, { phone: "+19565550162" }));
  expect((await json(await me.GET(request("/api/partners/me")))).body).toMatchObject({ partner: true });
}, 90_000);

afterAll(() => {
  delete process.env.HIGHLEVEL_WEBHOOK_SECRET;
});

const count = async (who: SupabaseClient, table: string): Promise<number> => {
  const { data, error } = await who.from(table).select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as unknown[]).length;
};

describe("a partner sees only their own referrals, and nothing of anyone's case", () => {
  it("partner_referrals(): first name, last initial, date, the coarse step, who looks after them; their own referrals only", async () => {
    const { data, error } = await h.as(laura).rpc("partner_referrals");
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.first_name).sort()).toEqual(["Felipe", "Rosa"]);
    expect(Object.keys(rows[0]!).sort()).toEqual([...PARTNER_REFERRAL_COLUMNS].sort());
    expect(rows.find((r) => r.first_name === "Rosa")).toMatchObject({ last_initial: "M", status: "active", has_account: true, shared_client_id: null });
    // Felipe: a lead sales has not reached yet (no invitation sent, no account). His salesperson looks after him.
    expect(rows.find((r) => r.first_name === "Felipe")).toMatchObject({ status: "referred", contacted_at: null, has_account: false, care_first_name: "Ana", care_role: "sales" });
    const jorgeRows = (await h.as(jorge).rpc("partner_referrals")).data as Array<Record<string, unknown>>;
    expect(jorgeRows.map((r) => r.first_name)).toEqual(["Luis"]);
    // A client, a member of staff or a stranger gets nothing.
    expect((await h.as(A).rpc("partner_referrals")).data).toEqual([]);
    expect((await h.as(admin.userId).rpc("partner_referrals")).data).toEqual([]);
  });

  it("reads no client record, no case data and no other partner", async () => {
    const reader = h.as(laura);
    for (const table of [
      "profiles", "prospects", "report_pulls", "report_items", "item_flags", "attack_rounds", "letters", "letter_items",
      "service_agreements", "identity_documents", "chat_messages", "events", "charges", "payment_methods", "staff_notes",
      "staff_members", "client_assignments", "team_audit", "integration_outbox", "webhook_receipts",
    ]) {
      expect(await count(reader, table), table).toBe(0);
    }
    const partners = (await reader.from("partners").select("id, name")).data as Array<{ id: string }>;
    expect(partners.map((p) => p.id)).toEqual([P1]);
    const commissions = (await reader.from("partner_commissions").select("partner_id, amount_cents")).data as Array<{ partner_id: string }>;
    expect(commissions.map((c) => c.partner_id)).toEqual([P1]);
    expect(await count(reader, "partner_members")).toBe(1);
  });

  it("writes nothing", async () => {
    const reader = h.as(laura);
    const attempts = await Promise.all([
      reader.from("partners").update({ commission_cents: 99999 }).eq("id", P1).select("id"),
      reader.from("partner_commissions").insert({ partner_id: P1, kind: "paid", amount_cents: 1 }),
      reader.from("prospects").insert({ first_name: "X", last_name: "Y", phone_e164: "+17135550199", state: "TX", goal: "auto", salesperson: "ana", source: "partner", partner_id: P1, consent_text: CONSENT }),
    ]);
    for (const attempt of attempts) {
      const rows = (attempt as { data: unknown[] | null }).data;
      expect(Boolean(attempt.error) || (Array.isArray(rows) && rows.length === 0)).toBe(true);
    }
    const { data } = await h.service.from("partners").select("commission_cents").eq("id", P1).single();
    expect((data as { commission_cents: number }).commission_cents).toBe(10000);
  });

  it("a suspended partner loses the portal at once", async () => {
    await h.service.from("partners").update({ status: "suspended" }).eq("id", P2);
    expect((await h.as(jorge).rpc("partner_referrals")).data).toEqual([]);
    expect(await count(h.as(jorge), "partners")).toBe(0);
    await h.service.from("partners").update({ status: "approved" }).eq("id", P2);
  });
});

describe("staff see partners by role; attribution is the server's to write", () => {
  it("administrators and sales read partners; specialists do not; only administrators read commissions and the outbox", async () => {
    expect(await count(h.as(admin.userId), "partners")).toBe(3);
    expect(await count(h.as(ana.userId), "partners")).toBe(3);
    expect(await count(h.as(marta.userId), "partners")).toBe(0);
    expect(await count(h.as(admin.userId), "partner_commissions")).toBe(2);
    expect(await count(h.as(ana.userId), "partner_commissions")).toBe(0);
    expect(await count(h.as(ana.userId), "integration_outbox")).toBe(0);
  });

  it("a client cannot credit themselves to a partner, nor change their HighLevel contact", async () => {
    const own = h.as(B);
    const change = await own.from("profiles").update({ referred_partner_id: P1 }).eq("id", B);
    expect(change.error?.message).toMatch(/written by the server only/);
    const contact = await own.from("profiles").update({ highlevel_contact_id: "fake12345" }).eq("id", B);
    expect(contact.error?.message).toMatch(/written by the server only/);
    // Their other fields still save.
    expect((await own.from("profiles").update({ goal: "card" }).eq("id", B)).error).toBeNull();
  });

  it("first touch: the partner on a profile is never replaced, and a pending partner's code credits nobody", async () => {
    expect(await creditPartner(h.service, B, "laura-benitez")).toBe(false);
    const { data } = await h.service.from("profiles").select("referred_partner_id").eq("id", B).single();
    expect((data as { referred_partner_id: string }).referred_partner_id).toBe(P2);
    const C = await addClient(h, { name: "Nadia Ruiz", phone: "+17135550174" });
    await h.service.from("partners").update({ referral_code: "sandra-olvera" }).eq("id", P3);
    expect(await creditPartner(h.service, C, "sandra-olvera")).toBe(false);
  });

  it("a prospect's partner carries over to the client at sign-up (convertProspect)", async () => {
    const { data } = await h.service.from("profiles").select("referred_partner_id").eq("id", A).single();
    expect((data as { referred_partner_id: string }).referred_partner_id).toBe(P1);
  });
});

describe("POST /api/webhooks/highlevel", () => {
  const lead = (over: Record<string, unknown> = {}) => ({
    contactId: "hlCarol0001",
    firstName: "Carolina",
    lastName: "Esparza",
    phone: "713-555-0140",
    email: "carolina@ejemplo.com",
    state: "TX",
    goal: "casa",
    consentText: CONSENT,
    campaign: "Formulario Casa propia",
    utm: { source: "facebook", campaign: "casa-propia-nov" },
    ...over,
  });
  const post = (body: unknown, secret: string | null = SECRET) =>
    request("/api/webhooks/highlevel", { raw: JSON.stringify(body), headers: secret ? { "x-credalti-secret": secret } : {} });

  it("refuses everything without a configured secret, and a wrong or missing secret", async () => {
    const route = await import("@/app/api/webhooks/highlevel/route");
    as(null);
    delete process.env.HIGHLEVEL_WEBHOOK_SECRET;
    expect((await route.POST(post(lead()))).status).toBe(503);
    process.env.HIGHLEVEL_WEBHOOK_SECRET = SECRET;
    expect((await route.POST(post(lead(), "wrong-secret-0123456789"))).status).toBe(401);
    expect((await route.POST(post(lead(), null))).status).toBe(401);
    expect((await route.POST(request("/api/webhooks/highlevel", { raw: JSON.stringify(lead()), headers: { authorization: `Bearer ${SECRET}` } }))).status).toBe(200);
  });

  it("creates the prospect with its source, a salesperson in turn, and leaves a record", async () => {
    const route = await import("@/app/api/webhooks/highlevel/route");
    as(null);
    const res = await json(await route.POST(post(lead({ contactId: "hlNew000001", phone: "713-555-0181", firstName: "Marisa" }))));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, outcome: "created" });
    const { data } = await h.service.from("prospects").select("*").eq("id", res.body.prospectId as string).single();
    const row = data as Record<string, unknown>;
    expect(row).toMatchObject({ source: "highlevel", highlevel_contact_id: "hlNew000001", goal: "mortgage", state: "TX", created_by: null, consent_text: CONSENT });
    expect(["ana", "luis"]).toContain(row.salesperson);
    expect((row.source_detail as Record<string, Record<string, unknown>>).firstTouch).toMatchObject({ campaign: "Formulario Casa propia", utm: { source: "facebook" } });
    const audit = await h.sql(`select kind from public.team_audit where prospect_id = $1`, [row.id]);
    expect(audit.map((a) => a.kind)).toContain("prospect_added");
  });

  it("rotates the salesperson, and honours the one HighLevel assigned", async () => {
    const route = await import("@/app/api/webhooks/highlevel/route");
    as(null);
    const a = (await json(await route.POST(post(lead({ contactId: "hlTurn00001", phone: "713-555-0182" }))))).body.salesperson;
    const b = (await json(await route.POST(post(lead({ contactId: "hlTurn00002", phone: "713-555-0183" }))))).body.salesperson;
    expect(new Set([a, b])).toEqual(new Set(["ana", "luis"]));
    const named = await json(await route.POST(post(lead({ contactId: "hlTurn00003", phone: "713-555-0184", assignedTo: "Luis Ortega" }))));
    expect(named.body.salesperson).toBe("luis");
    const partner = await json(await route.POST(post(lead({ contactId: "hlTurn00004", phone: "713-555-0185", partnerCode: "laura-benitez" }))));
    expect(partner.body.salesperson).toBe("ana");
    const { data } = await h.service.from("prospects").select("partner_id").eq("id", partner.body.prospectId as string).single();
    expect((data as { partner_id: string }).partner_id).toBe(P1);
  });

  it("dedupe: the same delivery twice does nothing twice; the same contact or phone updates instead of duplicating", async () => {
    const route = await import("@/app/api/webhooks/highlevel/route");
    as(null);
    const body = lead({ contactId: "hlDup000001", phone: "713-555-0190" });
    const first = await json(await route.POST(post(body)));
    const again = await json(await route.POST(post(body)));
    expect(first.body.outcome).toBe("created");
    expect(again.body).toMatchObject({ duplicate: true, outcome: "created", prospectId: first.body.prospectId });
    const sameContact = await json(await route.POST(post({ ...body, campaign: "Otra campaña", email: "nuevo@ejemplo.com" })));
    expect(sameContact.body).toMatchObject({ outcome: "updated", prospectId: first.body.prospectId });
    const samePhone = await json(await route.POST(post({ ...body, contactId: "hlDup000002" })));
    expect(samePhone.body).toMatchObject({ outcome: "updated", prospectId: first.body.prospectId });
    const rows = await h.sql<{ n: number }>(`select count(*)::int as n from public.prospects where phone_e164 = '+17135550190'`);
    expect(rows[0]!.n).toBe(1);
    const receipts = await h.sql<{ n: number }>(`select count(*)::int as n from public.webhook_receipts`);
    expect(receipts[0]!.n).toBeGreaterThanOrEqual(3);
    // First touch: the campaign stays; the later touch is kept beside it.
    const { data } = await h.service.from("prospects").select("source_detail").eq("id", first.body.prospectId as string).single();
    const detail = (data as { source_detail: Record<string, Record<string, unknown>> }).source_detail;
    expect(detail.firstTouch!.campaign).toBe("Formulario Casa propia");
    expect(detail.lastTouch).toBeTruthy();
  });

  it("someone who is already a client gets no prospect: their HighLevel contact is linked", async () => {
    const route = await import("@/app/api/webhooks/highlevel/route");
    as(null);
    const res = await json(await route.POST(post(lead({ contactId: "hlRosa00001", phone: "713-555-0171" }))));
    expect(res.body).toMatchObject({ outcome: "existing_client", prospectId: null });
    const { data } = await h.service.from("profiles").select("highlevel_contact_id, referred_partner_id").eq("id", A).single();
    expect(data).toMatchObject({ highlevel_contact_id: "hlRosa00001", referred_partner_id: P1 });
  });

  it("an SSN or a date of birth is dropped and never stored anywhere; only the field's name is recorded", async () => {
    const route = await import("@/app/api/webhooks/highlevel/route");
    as(null);
    const res = await json(
      await route.POST(post(lead({ contactId: "hlSsn000001", phone: "713-555-0191", ssn: "123-45-6789", date_of_birth: "1980-02-03", customData: { seguro_social: "987654321" } }))),
    );
    expect(res.status).toBe(200);
    expect((res.body.dropped as string[]).sort()).toEqual(["customData.seguro_social", "date_of_birth", "ssn"]);
    // Every row of every table, as text: the values are nowhere.
    const tables = await h.sql<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
    for (const { table_name } of tables) {
      const dump = await h.sql<{ t: string | null }>(`select string_agg(x::text, ' ') as t from public."${table_name}" x`);
      const text = dump[0]?.t ?? "";
      for (const secret of ["123-45-6789", "123456789", "987654321", "1980-02-03"]) expect(text, `${secret} in ${table_name}`).not.toContain(secret);
    }
    const receipt = await h.sql<{ dropped_fields: string[] }>(`select dropped_fields from public.webhook_receipts where prospect_id = $1`, [res.body.prospectId]);
    expect(receipt[0]!.dropped_fields.sort()).toEqual(["customData.seguro_social", "date_of_birth", "ssn"]);
  });

  it("refuses an invalid lead with the reasons, and a body over the limit", async () => {
    const route = await import("@/app/api/webhooks/highlevel/route");
    as(null);
    const bad = await json(await route.POST(post({ firstName: "Ana", phone: "12" })));
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.problems as object).sort()).toEqual(["consent", "phone", "state"]);
    expect((await route.POST(post({ ...lead(), filler: "x".repeat(20_000) }))).status).toBe(413);
    expect((await route.POST(request("/api/webhooks/highlevel", { raw: "{not json", headers: { "x-credalti-secret": SECRET } }))).status).toBe(400);
  });
});

describe("partner routes", () => {
  it("the portal returns the partner's own referrals and commissions, and nothing to anyone else", async () => {
    const route = await import("@/app/api/partners/portal/route");
    as(h.as(laura, { phone: "+17135550161" }));
    const res = await json(await route.GET(request("/api/partners/portal")));
    expect(res.status).toBe(200);
    // Rosa and Felipe, and the HighLevel lead that carried Laura's code.
    expect((res.body.referrals as Array<{ firstName: string }>).map((r) => r.firstName).sort()).toEqual(["Carolina", "Felipe", "Rosa"]);
    expect(res.body.commissions).toMatchObject({ owedCents: 10000, paidCents: 0 });
    const text = JSON.stringify(res.body);
    for (const word of ["Luis", "phone", "+1713", "report", "score", "letter", "monthlyFee"]) expect(text).not.toContain(word);
    as(h.as(A));
    expect((await route.GET(request("/api/partners/portal"))).status).toBe(403);
    as(h.as(ana.userId));
    expect((await route.GET(request("/api/partners/portal"))).status).toBe(403);
  });

  it("a referral from the portal becomes a prospect with the partner, the consent and the partner's salesperson", async () => {
    const route = await import("@/app/api/partners/referrals/route");
    as(h.as(laura, { phone: "+17135550161" }));
    expect((await route.POST(request("/api/partners/referrals", { body: { firstName: "Mario", lastName: "Vega", phone: "713-555-0195" } }))).status).toBe(400);
    const ok = await route.POST(request("/api/partners/referrals", { body: { firstName: "Mario", lastName: "Vega", phone: "713-555-0195", consent: true, ssn: "123-45-6789" } }));
    expect(ok.status).toBe(200);
    const rows = await h.sql<Record<string, unknown>>(`select * from public.prospects where phone_e164 = '+17135550195'`);
    expect(rows[0]).toMatchObject({ source: "partner", partner_id: P1, salesperson: "ana", first_name: "Mario" });
    // In the partner's language (English unless they chose Spanish: migration 0024).
    expect(String(rows[0]!.consent_text)).toMatch(/agreed to be contacted by the Credalti team/);
    // Someone already in touch: the same answer, and no credit to the partner.
    as(h.as(jorge, { phone: "+19565550162" }));
    const already = await route.POST(request("/api/partners/referrals", { body: { firstName: "Mario", lastName: "Vega", phone: "713-555-0195", consent: true } }));
    expect(already.status).toBe(200);
    const again = await h.sql<Record<string, unknown>>(`select partner_id from public.prospects where phone_e164 = '+17135550195'`);
    expect(again.map((r) => r.partner_id)).toEqual([P1]);
  });

  it("only an administrator approves a partner, which gives the code; sales can only look", async () => {
    const route = await import("@/app/api/staff/partners/route");
    as(h.as(ana.userId));
    expect((await route.GET(request("/api/staff/partners"))).status).toBe(200);
    expect(((await json(await route.GET(request("/api/staff/partners")))).body.commissions as unknown[]).length).toBe(0);
    expect((await route.POST(request("/api/staff/partners", { body: { action: "set_status", id: P3, status: "approved" } }))).status).toBe(403);
    as(h.as(admin.userId));
    const res = await json(await route.POST(request("/api/staff/partners", { body: { action: "set_status", id: P3, status: "approved" } })));
    expect(res.status).toBe(200);
    expect((res.body.partner as { referralCode: string }).referralCode).toBe("sandra-olvera");
    const perResult = await route.POST(request("/api/staff/partners", { body: { action: "set_commission", id: P3, basis: "per_deletion", amount: "50" } }));
    expect(perResult.status).toBe(422);
    const recorded = await route.POST(request("/api/staff/partners", { body: { action: "record_commission", id: P3, kind: "paid", amount: "25.00", note: "Transferencia" } }));
    expect(recorded.status).toBe(200);
    const audit = await h.sql(`select kind from public.team_audit where detail->>'partner' = $1`, [P3]);
    expect(audit.map((a) => a.kind).sort()).toEqual(["partner_commission_recorded", "partner_status_changed"]);
    // Commission records are append-only.
    await expect(h.sql(`update public.partner_commissions set amount_cents = 1`)).rejects.toThrow(/cannot be changed/);
  });

  it("the invitation is recorded once, by the salesperson of that prospect or an administrator", async () => {
    const route = await import("@/app/api/staff/prospects/route");
    as(h.as(luis.userId));
    expect((await route.POST(request("/api/staff/prospects", { body: { action: "invited", id: felipe } }))).status).toBe(403);
    as(h.as(ana.userId));
    const first = await json(await route.POST(request("/api/staff/prospects", { body: { action: "invited", id: felipe } })));
    expect(first.body).toMatchObject({ recorded: true });
    const second = await json(await route.POST(request("/api/staff/prospects", { body: { action: "invited", id: felipe } })));
    expect(second.body).toMatchObject({ recorded: false, invitedAt: first.body.invitedAt });
  });
});

describe("the HighLevel outbox", () => {
  it("queues each recent stage once, however often the sync runs", async () => {
    const now = new Date();
    const queued = await queueStageEvents(h.service, now);
    expect(queued).toBeGreaterThan(0);
    expect(await queueStageEvents(h.service, now)).toBe(0);
    const stages = (await h.sql<{ stage: string }>(`select stage from public.integration_outbox`)).map((r) => r.stage).sort();
    expect(stages).toEqual(expect.arrayContaining(["agreement_signed", "documents_complete", "first_round_mailed", "invited"]));
  });

  it("processed twice — one after the other, or both at once — sends each event once", async () => {
    const sent: StagePayload[] = [];
    const sender = async (_url: string, payload: StagePayload) => {
      sent.push(payload);
      return { ok: true };
    };
    const now = new Date();
    const [a, b] = await Promise.all([deliverOutbox(h.service, "https://hl.test/in", now, sender), deliverOutbox(h.service, "https://hl.test/in", now, sender)]);
    const third = await deliverOutbox(h.service, "https://hl.test/in", now, sender);
    const total = (await h.sql<{ n: number }>(`select count(*)::int as n from public.integration_outbox`))[0]!.n;
    expect(a.sent + b.sent).toBe(total);
    expect(third.sent).toBe(0);
    expect(sent).toHaveLength(total);
    expect(new Set(sent.map((p) => p.eventId)).size).toBe(total);
    for (const payload of sent) expect(Object.keys(payload).sort()).toEqual(["contactId", "event", "eventId", "occurredAt", "phone", "source", "stage", "stageLabel", "text"]);
  });

  it("retries a failed delivery later, with the attempt counted", async () => {
    await h.service.from("integration_outbox").insert({ dedupe_key: "+17135550199:invited", stage: "invited", payload: { event: "credalti.stage_changed", phone: "+17135550199", stage: "invited" } });
    const now = new Date();
    const failed = await deliverOutbox(h.service, "https://hl.test/in", now, async () => ({ ok: false, error: "HTTP 500" }));
    expect(failed.failed).toBe(1);
    const row = (await h.sql<{ attempts: number; next_attempt_at: Date; last_error: string; sent_at: Date | null }>(`select * from public.integration_outbox where dedupe_key = '+17135550199:invited'`))[0]!;
    expect(row).toMatchObject({ attempts: 1, last_error: "HTTP 500", sent_at: null });
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(now.getTime());
    // Not due yet: nothing is sent.
    expect((await deliverOutbox(h.service, "https://hl.test/in", now, async () => ({ ok: true }))).sent).toBe(0);
  });

  it("the database refuses credit data in a payload, a changed event, a delivered event changed, and any delete", async () => {
    const bad = await h.service.from("integration_outbox").insert({ dedupe_key: "x:invited", stage: "invited", payload: { phone: "+17135550100", score: 640 } });
    expect(bad.error?.message).toMatch(/score may not be sent/);
    await expect(h.sql(`update public.integration_outbox set payload = '{}' where dedupe_key = '+17135550199:invited'`)).rejects.toThrow(/cannot be changed/);
    await expect(h.sql(`update public.integration_outbox set attempts = 9 where sent_at is not null`)).rejects.toThrow(/delivered or abandoned/);
    await expect(h.sql(`delete from public.integration_outbox`)).rejects.toThrow(/never deleted/);
    await expect(h.sql(`delete from public.webhook_receipts`)).rejects.toThrow(/cannot be changed or deleted/);
  });
});
