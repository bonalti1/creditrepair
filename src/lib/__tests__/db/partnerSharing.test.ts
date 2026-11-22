import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { creditPartner } from "../../partners/attribution";
import { consentHash, PARTNER_PROGRESS_COLUMNS, SHARING_CONSENT_VERSION } from "../../partners/sharing";
import { runPartnerNotices, type NoticeDeliver } from "../../partners/sharingServer";
import { PARTNER_CLIENT_TERMS_VERSION, partnerTermsHash } from "../../partners/terms";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, ago, assign, sampleReport, signAgreement, uid } from "./seed";

// Partner sharing (migration 0023) against the real migrations, with row level
// security applied: a partner sees a client's progress only with the client's
// consent, only at the level chosen, only while approved and with the current
// terms accepted, and never anything from the credit file, however they ask.
// Also: consent records are append-only and checked by the database, every
// view of a client's page is logged, "Comisiones a socios" is off until an
// administrator records the attorney's approval, and milestone notices go once.

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
    headers: { "content-type": "application/json", "x-forwarded-for": `10.23.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let P1: string; // Laura (realtor), approved
let P2: string; // Jorge (loan officer), approved
let laura: string;
let jorge: string;
let A: string; // Rosa: referred by Laura, signed, documents, report, round 1 mailed with two items
let B: string; // Luis: referred by Laura, never shares
let C: string; // Nadia: nobody referred her; she adds Jorge by his code
let itemNames: string[] = [];

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

const share = async (client: string, body: Record<string, unknown>) => {
  const route = await import("@/app/api/sharing/route");
  as(h.as(client));
  return json(await route.POST(request("/api/sharing", { action: "set", locale: "es", version: SHARING_CONSENT_VERSION, ...body })));
};

const clientsOf = async (partner: string) => {
  const { data, error } = await h.as(partner).rpc("partner_clients");
  if (error) throw new Error(error.message);
  return data as Array<Record<string, unknown>>;
};
const viewAs = async (partner: string, client: string) => {
  const { data, error } = await h.as(partner).rpc("partner_client_view", { p_client: client });
  return { rows: (data as Array<Record<string, unknown>> | null) ?? [], error };
};
const viewCount = async (client: string) => (await h.sql<{ n: number }>(`select count(*)::int as n from public.partner_view_log where user_id = $1`, [client]))[0]!.n;

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  P1 = await insertPartner({ name: LAURA.name, company: LAURA.company, kind: "realtor", phone_e164: "+17135550161", email: "laura@ejemplo.com", state: "TX", status: "approved", referral_code: "laura-benitez" });
  P2 = await insertPartner({ name: JORGE.name, company: JORGE.company, kind: "loan_officer", phone_e164: "+19565550162", status: "approved", referral_code: "jorge-trevino" });
  laura = uid();
  jorge = uid();
  await h.createUser(laura, { phone: "+17135550161" });
  await h.createUser(jorge, { phone: "+19565550162" });
  await h.service.from("partner_members").insert([{ user_id: laura, partner_id: P1 }, { user_id: jorge, partner_id: P2 }]);

  A = await addClient(h, { name: "Rosa Martínez", phone: "+17135550171", address: ["742 Calle Secreta", "Houston, TX 77002"] });
  expect(await creditPartner(h.service, A, "laura-benitez")).toBe(true);
  await h.service.from("profiles").update({ goal: "mortgage" }).eq("id", A);
  await signAgreement(h, A);
  await addDocuments(h, A);
  await assign(h, A, marta.userId);
  await importReportForUser(h.service, A, sampleReport(20));
  const { data: items } = await h.service.from("report_items").select("id, name").eq("user_id", A);
  const list = (items as Array<{ id: string; name: string }>).slice(0, 2);
  itemNames = list.map((i) => i.name);
  for (const item of (items as Array<{ id: string }>)) await h.service.from("item_flags").insert({ user_id: A, item_id: item.id, reason: "No es mía", attested: true, attested_at: ago(15) });
  const { data: round } = await h.service.from("attack_rounds").insert({ user_id: A, round_number: 1, status: "mailed", mailed_at: ago(10) }).select("id").single();
  const { data: letter } = await h.service
    .from("letters")
    .insert({ user_id: A, round_id: (round as { id: string }).id, target_type: "bureau", target_key: "equifax", target_name: "Equifax", template_key: "bureau_dispute", escalation_stage: "initial", body: "Carta privada de Rosa", status: "mailed", mailed_at: ago(10) })
    .select("id")
    .single();
  await h.service.from("letter_items").insert(list.map((i) => ({ letter_id: (letter as { id: string }).id, item_id: i.id, escalation_stage: "initial" })));
  // A later report no longer lists the first disputed item.
  await h.service.from("report_items").update({ status: "deleted", deleted_detected_at: ago(1) }).eq("id", list[0]!.id);
  await h.service.from("chat_messages").insert({ user_id: A, role: "user", content: "Mensaje privado de Rosa" });

  B = await addClient(h, { name: "Luis Gómez", phone: "+17135550172" });
  expect(await creditPartner(h.service, B, "laura-benitez")).toBe(true);
  C = await addClient(h, { name: "Nadia Ruiz", phone: "+17135550174" });
}, 90_000);

describe("consent comes first, and the partner terms", () => {
  it("without consent a partner gets nothing, and nothing is logged", async () => {
    await h.service.from("partner_terms_acceptances").insert({ partner_id: P1, user_id: laura, version: PARTNER_CLIENT_TERMS_VERSION, locale: "es", text_hash: "c".repeat(64) });
    expect(await clientsOf(laura)).toEqual([]);
    expect((await viewAs(laura, A)).rows).toEqual([]);
    expect((await viewAs(laura, B)).rows).toEqual([]);
    expect(await viewCount(A)).toBe(0);
  });

  it("a choice is refused unless it carries the hash of the current text; the client's grant is recorded with version and hash", async () => {
    const wrong = await share(A, { partnerId: P1, level: "progress", textHash: "0".repeat(64) });
    expect(wrong.status).toBe(409);
    const stale = await share(A, { partnerId: P1, level: "progress", version: "2025-old", textHash: consentHash("progress", LAURA, "es") });
    expect(stale.status).toBe(409);
    const ok = await share(A, { partnerId: P1, level: "progress", textHash: consentHash("progress", LAURA, "es") });
    expect(ok.status).toBe(200);
    expect(ok.body.record).toMatchObject({ level: "progress", previous_level: "none", action: "grant" });
    const rows = await h.sql(`select * from public.partner_share_consents where user_id = $1`, [A]);
    expect(rows[0]).toMatchObject({ how: "referred", text_version: SHARING_CONSENT_VERSION, text_hash: consentHash("progress", LAURA, "es"), partner_name_shown: "Laura Benítez, Benítez Realty" });
  });

  it("a partner who has not accepted the current terms sees no client, even with consent", async () => {
    expect(await clientsOf(jorge)).toEqual([]);
    // Laura accepted (above): she sees Rosa.
    expect((await clientsOf(laura)).map((r) => r.client_id)).toEqual([A]);
  });

  it("the portal records the terms only with the hash of what was shown", async () => {
    const route = await import("@/app/api/partners/portal/route");
    as(h.as(jorge, { phone: "+19565550162" }));
    const before = await json(await route.GET(request("/api/partners/portal")));
    expect(before.body.terms).toMatchObject({ accepted: false });
    expect(before.body.clients).toEqual([]);
    const bad = await route.POST(request("/api/partners/portal", { action: "accept_terms", locale: "es", version: PARTNER_CLIENT_TERMS_VERSION, textHash: partnerTermsHash("es", true) }));
    expect(bad.status).toBe(409); // Commissions are off: the "no referral fees" form is the one shown.
    const good = await route.POST(request("/api/partners/portal", { action: "accept_terms", locale: "es", version: PARTNER_CLIENT_TERMS_VERSION, textHash: partnerTermsHash("es", false) }));
    expect(good.status).toBe(200);
    const after = await json(await route.GET(request("/api/partners/portal")));
    expect(after.body.terms).toMatchObject({ accepted: true });
    await expect(h.sql(`delete from public.partner_terms_acceptances`)).rejects.toThrow(/cannot be changed or deleted/);
  });
});

describe("what a partner sees, by level", () => {
  it("Solo el avance: name, stage dates and goal; the counts are null; exactly the allowed columns", async () => {
    const [row] = await clientsOf(laura);
    expect(Object.keys(row!).sort()).toEqual([...PARTNER_PROGRESS_COLUMNS].sort());
    expect(row).toMatchObject({ display_name: "Rosa Martínez", level: "progress", how: "referred", goal: "mortgage", disputing_count: null, no_longer_reported_count: null });
    expect(row!.agreement_signed_at).toBeTruthy();
    expect(row!.documents_complete_at).toBeTruthy();
    expect(row!.review_finished_at).toBeTruthy();
    const rounds = row!.rounds as Array<Record<string, unknown>>;
    expect(rounds).toHaveLength(1);
    expect(Object.keys(rounds[0]!).sort()).toEqual(["answer_due_at", "mailed_at", "next_round_at", "number"]);
  });

  it("Avance y resumen adds only the two counts", async () => {
    const res = await share(A, { partnerId: P1, level: "summary", textHash: consentHash("summary", LAURA, "es") });
    expect(res.body.record).toMatchObject({ previous_level: "progress", action: "change" });
    const [row] = await clientsOf(laura);
    expect(row).toMatchObject({ level: "summary", disputing_count: 2, no_longer_reported_count: 1 });
  });

  it("nothing from the credit file, the letters, the address or the chat is in what a partner receives", async () => {
    const { rows } = await viewAs(laura, A);
    const text = JSON.stringify(rows) + JSON.stringify(await clientsOf(laura));
    for (const secret of [...itemNames, "Equifax", "Carta privada", "742 Calle Secreta", "No es mía", "Mensaje privado", "+1713", "89.00", "score"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("crafted requests reach no table of the case, no consent record and no view log", async () => {
    const reader = h.as(laura);
    for (const table of [
      "profiles", "report_pulls", "report_items", "item_flags", "attack_rounds", "letters", "letter_items", "service_agreements",
      "identity_documents", "chat_messages", "events", "charges", "payment_methods", "refunds", "staff_notes", "mail_events",
      "partner_share_consents", "partner_view_log", "partner_notices", "client_pulses", "outbound_messages",
    ]) {
      const { data, error } = await reader.from(table).select("*");
      expect(error ? 0 : (data as unknown[]).length, table).toBe(0);
    }
    // Filters and ids do not open anything either.
    expect(((await reader.from("report_items").select("*").eq("user_id", A)).data as unknown[] | null) ?? []).toEqual([]);
    expect(((await reader.from("letters").select("body").eq("user_id", A)).data as unknown[] | null) ?? []).toEqual([]);
    // The internal function is not theirs to call; another partner's client is not theirs to view.
    const internal = await reader.rpc("partner_progress_rows", { p_partner: P1, p_client: A });
    expect(internal.error).toBeTruthy();
    expect((await viewAs(jorge, A)).rows).toEqual([]);
    // A client or a member of staff gets nothing from the partner functions.
    expect((await h.as(A).rpc("partner_clients")).data).toEqual([]);
    expect((await h.as(admin.userId).rpc("partner_clients")).data).toEqual([]);
  });
});

describe("the view log", () => {
  it("each view of a client's page is written, and the client and administrators can read it; a specialist and sales cannot", async () => {
    const before = await viewCount(A);
    const route = await import("@/app/api/partners/clients/[id]/route");
    as(h.as(laura, { phone: "+17135550161" }));
    const res = await json(await route.GET(request(`/api/partners/clients/${A}`), { params: Promise.resolve({ id: A }) }));
    expect(res.status).toBe(200);
    expect((res.body.client as Record<string, unknown>).name).toBe("Rosa Martínez");
    expect(await viewCount(A)).toBe(before + 1);
    const own = (await h.as(A).from("partner_view_log").select("partner_id, viewer")).data as Array<Record<string, unknown>>;
    expect(own.length).toBe(before + 1);
    expect(own[0]).toMatchObject({ partner_id: P1, viewer: laura });
    expect(((await h.as(admin.userId).from("partner_view_log").select("*")).data as unknown[]).length).toBe(before + 1);
    expect(((await h.as(marta.userId).from("partner_view_log").select("*")).data as unknown[]).length).toBe(0);
    expect(((await h.as(ana.userId).from("partner_view_log").select("*")).data as unknown[]).length).toBe(0);
    expect(((await h.as(B).from("partner_view_log").select("*")).data as unknown[]).length).toBe(0);
    await expect(h.sql(`delete from public.partner_view_log`)).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("the client's own page lists the partner, the level and the views", async () => {
    const route = await import("@/app/api/sharing/route");
    as(h.as(A));
    const res = await json(await route.GET(request("/api/sharing")));
    expect(res.status).toBe(200);
    const partners = res.body.partners as Array<Record<string, unknown>>;
    expect(partners).toHaveLength(1);
    expect(partners[0]).toMatchObject({ name: "Laura Benítez", company: "Benítez Realty", referred: true, level: "summary" });
    expect(JSON.stringify(partners)).not.toContain("+1713555");
    expect((res.body.views as unknown[]).length).toBeGreaterThan(0);
    expect(res.body.counts).toEqual({ disputing: 2, noLongerReported: 1 });
  });
});

describe("revocation, suspension and the database's own checks", () => {
  it("revoked: nothing, at once; a revocation needs no hash", async () => {
    const res = await share(A, { partnerId: P1, level: "none" });
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ level: "none", action: "revoke" });
    expect(await clientsOf(laura)).toEqual([]);
    const before = await viewCount(A);
    expect((await viewAs(laura, A)).rows).toEqual([]);
    expect(await viewCount(A)).toBe(before);
  });

  it("a client adds a partner who did not refer them, by code, with the same consent", async () => {
    const route = await import("@/app/api/sharing/route");
    as(h.as(C));
    const found = await json(await route.POST(request("/api/sharing", { action: "lookup", code: "jorge-trevino" })));
    expect(found.body.partner).toMatchObject({ name: JORGE.name, company: JORGE.company });
    expect((await route.POST(request("/api/sharing", { action: "lookup", code: "nadie-123" }))).status).toBe(404);
    const res = await share(C, { code: "jorge-trevino", level: "progress", textHash: consentHash("progress", JORGE, "es") });
    expect(res.status).toBe(200);
    const rows = await clientsOf(jorge);
    expect(rows.map((r) => [r.client_id, r.how])).toEqual([[C, "added_by_code"]]);
  });

  it("the database refuses a 'referred' record for a partner who did not refer, the same level twice, and any change to a record", async () => {
    const base = { user_id: C, level: "summary", text_version: SHARING_CONSENT_VERSION, locale: "es", text_hash: "d".repeat(64), partner_name_shown: "Laura Benítez" };
    const lie = await h.service.from("partner_share_consents").insert({ ...base, partner_id: P1, how: "referred" });
    expect(lie.error?.message).toMatch(/did not refer/);
    const same = await h.service.from("partner_share_consents").insert({ ...base, partner_id: P2, level: "progress", how: "added_by_code" });
    expect(same.error?.message).toMatch(/already progress/);
    await expect(h.sql(`update public.partner_share_consents set level = 'summary'`)).rejects.toThrow(/cannot be changed/);
    await expect(h.sql(`delete from public.partner_share_consents`)).rejects.toThrow(/cannot be changed/);
    // A client cannot write a record directly.
    const direct = await h.as(C).from("partner_share_consents").insert({ ...base, partner_id: P2, how: "added_by_code" });
    expect(direct.error).toBeTruthy();
  });

  it("a suspended partner: nothing, at once, and no new grant", async () => {
    await h.service.from("partners").update({ status: "suspended" }).eq("id", P2);
    expect(await clientsOf(jorge)).toEqual([]);
    expect((await viewAs(jorge, C)).rows).toEqual([]);
    const route = await import("@/app/api/partners/clients/[id]/route");
    as(h.as(jorge, { phone: "+19565550162" }));
    expect((await route.GET(request(`/api/partners/clients/${C}`), { params: Promise.resolve({ id: C }) })).status).toBe(403);
    const res = await share(C, { code: "jorge-trevino", level: "summary", textHash: consentHash("summary", JORGE, "es") });
    expect(res.status).toBe(404); // A suspended partner's code finds nobody.
    await h.service.from("partners").update({ status: "approved" }).eq("id", P2);
    expect((await clientsOf(jorge)).map((r) => r.client_id)).toEqual([C]);
  });
});

describe("Escribir al equipo", () => {
  it("lands as a note the assigned specialist reads; the client never does; only about a client who shares", async () => {
    await share(A, { partnerId: P1, level: "progress", textHash: consentHash("progress", LAURA, "es") });
    const route = await import("@/app/api/partners/portal/route");
    as(h.as(laura, { phone: "+17135550161" }));
    const ok = await route.POST(request("/api/partners/portal", { action: "message", clientId: A, text: "Rosa quiere saber si necesita algo más para su ronda." }));
    expect(ok.status).toBe(200);
    const notes = (await h.as(marta.userId).from("staff_notes").select("author_name, body").eq("user_id", A)).data as Array<Record<string, string>>;
    expect(notes.some((n) => n.author_name === "Socio · Laura Benítez" && n.body.includes("Rosa quiere saber"))).toBe(true);
    expect(((await h.as(A).from("staff_notes").select("*")).data as unknown[]).length).toBe(0);
    const notMine = await route.POST(request("/api/partners/portal", { action: "message", clientId: B, text: "¿Cómo va Luis?" }));
    expect(notMine.status).toBe(404);
  });
});

describe("Comisiones a socios: off until the attorney approves", () => {
  it("off by default: no amount is recorded and no terms are set, by the route or the database", async () => {
    const rpcRes = await h.service.rpc("partner_commissions_enabled");
    expect(rpcRes.data).toBe(false);
    const insert = await h.service.from("partner_commissions").insert({ partner_id: P1, kind: "owed", amount_cents: 10000, recorded_by_name: "carmen" });
    expect(insert.error?.message).toMatch(/off/);
    const terms = await h.service.from("partners").update({ commission_basis: "signed_client", commission_cents: 10000 }).eq("id", P1);
    expect(terms.error?.message).toMatch(/off/);
    const route = await import("@/app/api/staff/partners/route");
    as(h.as(admin.userId));
    expect((await route.POST(request("/api/staff/partners", { action: "set_commission", id: P1, basis: "signed_client", amount: "100" }))).status).toBe(409);
    expect((await route.POST(request("/api/staff/partners", { action: "record_commission", id: P1, kind: "owed", amount: "100" }))).status).toBe(409);
    // A partner sees no commission figures.
    const portal = await import("@/app/api/partners/portal/route");
    as(h.as(laura, { phone: "+17135550161" }));
    const view = await json(await portal.GET(request("/api/partners/portal")));
    expect(view.body.commissions).toBeNull();
    expect(view.body.program).toEqual({ commissionsEnabled: false });
  });

  it("turning it on needs the attorney's name, the date and the confirmation, and only an administrator; who and when are recorded", async () => {
    const route = await import("@/app/api/staff/partners/route");
    as(h.as(ana.userId));
    expect((await route.POST(request("/api/staff/partners", { action: "set_program", enabled: true, attorneyName: "Lic. Prueba", attorneyApprovedOn: "2026-11-20", confirmed: true }))).status).toBe(403);
    as(h.as(admin.userId));
    expect((await route.POST(request("/api/staff/partners", { action: "set_program", enabled: true, attorneyName: "Lic. Prueba", attorneyApprovedOn: "2026-11-20" }))).status).toBe(422);
    expect((await route.POST(request("/api/staff/partners", { action: "set_program", enabled: true, confirmed: true }))).status).toBe(422);
    const on = await json(await route.POST(request("/api/staff/partners", { action: "set_program", enabled: true, attorneyName: "Lic. Prueba Abogada", attorneyApprovedOn: "2026-11-20", confirmed: true })));
    expect(on.status).toBe(200);
    expect(on.body.program).toMatchObject({ commissionsEnabled: true, attorneyName: "Lic. Prueba Abogada", attorneyApprovedOn: "2026-11-20", changedBy: "carmen" });
    const rows = await h.sql(`select changed_by, confirmed from public.partner_program_changes order by seq desc limit 1`);
    expect(rows[0]).toMatchObject({ changed_by: admin.userId, confirmed: true });
    // The database refuses "on" without the approval, whatever the server sends.
    await expect(h.sql(`insert into public.partner_program_changes (commissions_enabled) values (true)`)).rejects.toThrow(/partner_program_on_needs_approval/);
    expect((await route.POST(request("/api/staff/partners", { action: "record_commission", id: P1, kind: "owed", amount: "100" }))).status).toBe(200);
    const get = await json(await route.GET(request("/api/staff/partners")));
    expect((get.body.shares as Array<Record<string, unknown>>).map((s) => [s.clientName, s.level])).toEqual(
      expect.arrayContaining([["Rosa Martínez", "progress"], ["Nadia Ruiz", "progress"]]),
    );
    expect((get.body.views as unknown[]).length).toBeGreaterThan(0);
    // Off again: no confirmation needed; recording stops.
    expect((await route.POST(request("/api/staff/partners", { action: "set_program", enabled: false }))).status).toBe(200);
    expect((await route.POST(request("/api/staff/partners", { action: "record_commission", id: P1, kind: "owed", amount: "100" }))).status).toBe(409);
    await expect(h.sql(`delete from public.partner_program_changes`)).rejects.toThrow(/cannot be changed or deleted/);
  });
});

describe("milestone notices to partners", () => {
  it("only to partners who opted in, once per milestone, never in quiet hours", async () => {
    await h.service.from("partners").update({ notify_email: true }).eq("id", P1);
    const sent: string[] = [];
    const deliver: NoticeDeliver = async (_p, text) => {
      sent.push(text);
      return { ok: true };
    };
    const channels = { whatsapp: false, email: true, approvedTemplates: [] as string[], simulated: false };
    // 3 a.m. in Texas: quiet.
    const night = new Date("2026-11-22T09:00:00Z");
    const quiet = await runPartnerNotices(h.service, night, { channels, deliver });
    expect(quiet).toMatchObject({ waitingQuietHours: 1, sent: 0 });
    // Mid-day: Rosa's recent milestone (her round's 30 days are not up; documents and signing are older than 3 days)...
    const noon = new Date();
    noon.setUTCHours(18, 0, 0, 0);
    await h.service.from("attack_rounds").insert({ user_id: A, round_number: 2, status: "mailed", mailed_at: new Date(noon.getTime() - 60 * 60 * 1000).toISOString() });
    const first = await runPartnerNotices(h.service, noon, { channels, deliver });
    expect(first.sent).toBeGreaterThan(0);
    expect(sent.join(" ")).toMatch(/ronda 2 de Rosa/);
    for (const text of sent) for (const secret of [...itemNames, "Equifax", "742 Calle"]) expect(text).not.toContain(secret);
    const again = await runPartnerNotices(h.service, noon, { channels, deliver });
    expect(again.sent).toBe(0);
    // Jorge did not opt in: nothing for him.
    const keys = await h.sql<{ partner_id: string }>(`select partner_id from public.partner_notices`);
    expect(new Set(keys.map((k) => k.partner_id))).toEqual(new Set([P1]));
  });
});
