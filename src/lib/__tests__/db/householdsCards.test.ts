import { beforeAll, describe, expect, it } from "vitest";
import { loadAcceptedCards, saveAcceptedCards } from "../../billing/cardSettings";
import { DEFAULT_ACCEPTED_CARDS } from "../../billing/cardBrands";
import { loadClientReportById, loadClientReportHistory } from "../../clientCase/server";
import { importReportForUser } from "../../domain/importReport";
import { addHouseholdMember, loadHouseholdPrimary } from "../../household/server";
import { readStaffReport } from "../../staff/actions";
import { loadStaffClients } from "../../staff/load";
import { convertProspect } from "../../staff/server";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, assign, sampleReport, signAgreement, uid } from "./seed";

// Migration 0027 on the real migrations: the accepted card brands, household
// signup (a member of their own, linked for the discount, never sharing a
// case), and the Reports tab's reads (role scope, the client's own list).

let h: Harness;
let A: string;
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let jorge: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let pullA: string;

const LUIS_PHONE = "+17135550199";

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  jorge = await addStaff(h, "specialist", "jorge", "Jorge Paz");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  A = await addClient(h, { name: "Rosa Delgado", referredBy: "ana", phone: "+17135550124" });
  await signAgreement(h, A, { signedDaysAgo: 30 });
  await addDocuments(h, A);
  pullA = (await importReportForUser(h.service, A, sampleReport(20))).pullId;
  await assign(h, A, marta.userId, admin.userId);
}, 60_000);

describe("accepted card brands (billing_card_settings)", () => {
  it("starts with Visa and Mastercard on, American Express and Discover off", async () => {
    expect(await loadAcceptedCards(h.service)).toEqual(DEFAULT_ACCEPTED_CARDS);
  });

  it("is read by staff only; a client reads nothing and nobody but the server writes", async () => {
    expect(((await h.as(admin.userId).from("billing_card_settings").select("amex")).data as unknown[]).length).toBe(1);
    expect(((await h.as(A).from("billing_card_settings").select("amex")).data as unknown[]).length).toBe(0);
    await h.as(admin.userId).from("billing_card_settings").update({ amex: true }).eq("id", true);
    expect((await loadAcceptedCards(h.service)).amex).toBe(false);
  });

  it("an administrator's change is kept, with who made it, and at least one brand stays on", async () => {
    const saved = await saveAcceptedCards(h.service, { ...DEFAULT_ACCEPTED_CARDS, amex: true }, { userId: admin.userId, name: "Carmen Ruiz" });
    expect(saved).toEqual({ ok: true, cards: { ...DEFAULT_ACCEPTED_CARDS, amex: true } });
    expect((await loadAcceptedCards(h.service)).amex).toBe(true);
    const [row] = await h.sql<{ updated_by_name: string }>(`select updated_by_name from public.billing_card_settings`);
    expect(row!.updated_by_name).toBe("Carmen Ruiz");
    expect((await h.sql(`select 1 from public.team_audit where kind = 'card_brands_changed'`)).length).toBe(1);
    expect((await saveAcceptedCards(h.service, { visa: false, mastercard: false, amex: false, discover: false }, { userId: null, name: "x" })).ok).toBe(false);
    // The database refuses it too, and refuses a delete.
    await expect(h.sql(`update public.billing_card_settings set visa = false, mastercard = false, amex = false, discover = false`)).rejects.toThrow();
    await expect(h.sql(`delete from public.billing_card_settings`)).rejects.toThrow(/setting is kept/);
    await saveAcceptedCards(h.service, DEFAULT_ACCEPTED_CARDS, { userId: admin.userId, name: "Carmen Ruiz" });
  });
});

describe("household signup (household_members)", () => {
  let luisProspect: string;
  let B: string;

  it("adds a household member as a lead of their own, with the first person's salesperson and teammate", async () => {
    const primary = await loadHouseholdPrimary(h.service, A);
    expect(primary).toMatchObject({ kind: "user", firstName: "Rosa", salesperson: "ana", assignedTo: marta.userId });
    const result = await addHouseholdMember(
      h.service,
      primary!,
      { firstName: "Luis", lastName: "Delgado", phone: "(713) 555-0199", email: "luis@example.com", relationship: "spouse", locale: "es" },
      { kind: "staff", userId: ana.userId, name: "Ana Prieto" },
    );
    expect(result.ok).toBe(true);
    luisProspect = result.ok ? result.prospectId : "";
    const [prospect] = await h.sql<Record<string, unknown>>(`select * from public.prospects where id = $1`, [luisProspect]);
    expect(prospect).toMatchObject({ source: "household", salesperson: "ana", assigned_to: marta.userId, locale: "es", phone_e164: LUIS_PHONE, converted_user_id: null });
    const [row] = await h.sql<Record<string, unknown>>(`select * from public.household_members where member_prospect_id = $1`, [luisProspect]);
    expect(row).toMatchObject({ primary_user_id: A, member_name: "Luis Delgado", primary_name: "Rosa", relationship: "spouse", added_by: "staff", link_id: null });
    expect((await h.sql(`select 1 from public.team_audit where kind = 'household_member_added' and prospect_id = $1`, [luisProspect])).length).toBe(1);
  });

  it("a household is two people, each with their own phone", async () => {
    const primary = (await loadHouseholdPrimary(h.service, A))!;
    const again = await addHouseholdMember(h.service, primary, { firstName: "Ana", lastName: "Delgado", phone: "7135550177", relationship: "family", locale: "en" }, { kind: "staff", userId: ana.userId, name: "Ana" });
    expect(again).toMatchObject({ ok: false, status: 409 });
    const other = await addClient(h, { name: "Tomás Ruiz", phone: "+12145550300" });
    const theirs = (await loadHouseholdPrimary(h.service, other))!;
    const samePhone = await addHouseholdMember(h.service, theirs, { firstName: "Tomás", lastName: "Ruiz", phone: "2145550300", relationship: "family", locale: "en" }, { kind: "client", userId: other, name: "Tomás" });
    expect(samePhone).toMatchObject({ ok: false, status: 422 });
    const takenPhone = await addHouseholdMember(h.service, theirs, { firstName: "Luisa", lastName: "Ruiz", phone: LUIS_PHONE, relationship: "family", locale: "en" }, { kind: "client", userId: other, name: "Tomás" });
    expect(takenPhone).toMatchObject({ ok: false, status: 422 });
    // A client with no salesperson can still add one (the lead has none either).
    const own = await addHouseholdMember(h.service, theirs, { firstName: "Elena", lastName: "Ruiz", phone: "2145550301", relationship: "partner", locale: "en" }, { kind: "client", userId: other, name: "Tomás" });
    expect(own.ok).toBe(true);
    const [lead] = await h.sql<{ salesperson: string | null; created_by: string | null }>(`select salesperson, created_by from public.prospects where phone_e164 = '+12145550301'`);
    expect(lead).toEqual({ salesperson: null, created_by: null });
  });

  it("puts the household discount in the agreement from the start, for the server only", async () => {
    expect((await h.service.rpc("household_discount_applies", { uid: A })).data).toBe(true);
    expect((await h.service.rpc("household_discount_applies", { uid: uid() })).data).toBe(false);
    // Asked by a client, it says nothing about anyone.
    expect((await h.as(A).rpc("household_discount_applies", { uid: A })).data).toBe(false);
  });

  it("links the two for the discount by itself once the member creates their own account", async () => {
    B = uid();
    await h.createUser(B, { phone: LUIS_PHONE });
    await h.service.from("profiles").insert({ id: B, full_name: "Luis Delgado", phone_e164: LUIS_PHONE, state: "TX" });
    expect(await convertProspect(h.service, B, LUIS_PHONE)).toBe(true);
    const [row] = await h.sql<{ link_id: string | null }>(`select link_id from public.household_members where member_prospect_id = $1`, [luisProspect]);
    expect(row!.link_id).not.toBeNull();
    expect((await h.service.rpc("household_partner", { uid: A })).data).toBe(B);
    expect((await h.service.rpc("household_partner", { uid: B })).data).toBe(A);
    expect((await h.service.rpc("household_discount_applies", { uid: B })).data).toBe(true);
  });

  it("never lets one member read the other's case, or the household rows", async () => {
    await signAgreement(h, B, { signedDaysAgo: 5 });
    await importReportForUser(h.service, B, sampleReport(3));
    for (const table of ["report_pulls", "report_items", "item_flags", "service_agreements", "identity_documents", "attack_rounds", "letters", "charges", "payment_methods", "chat_messages", "profiles"]) {
      const { data } = await h.as(B).from(table).select("*").eq(table === "profiles" ? "id" : "user_id", A);
      expect((data as unknown[] | null) ?? [], `${table}: B reads A's`).toEqual([]);
      const back = await h.as(A).from(table).select("*").eq(table === "profiles" ? "id" : "user_id", B);
      expect((back.data as unknown[] | null) ?? [], `${table}: A reads B's`).toEqual([]);
    }
    for (const table of ["household_members", "household_links", "prospects"]) {
      expect(((await h.as(B).from(table).select("*")).data as unknown[] | null) ?? [], table).toEqual([]);
      expect(((await h.as(A).from(table).select("*")).data as unknown[] | null) ?? [], table).toEqual([]);
    }
    // The client's own report list and its one-report read stay theirs.
    expect((await loadClientReportHistory(h.as(B), A)).length).toBe(0);
    expect(await loadClientReportById(h.as(B), B, pullA)).toBeNull();
  });

  it("staff read the household by role, like the people in it", async () => {
    const read = async (uidOf: string) => ((await h.as(uidOf).from("household_members").select("id").eq("member_prospect_id", luisProspect)).data as unknown[]).length;
    expect(await read(admin.userId)).toBe(1);
    expect(await read(marta.userId)).toBe(1);
    expect(await read(ana.userId)).toBe(1);
    expect(await read(jorge.userId)).toBe(0);
    // Nobody on staff writes it.
    await h.as(admin.userId).from("household_members").update({ relationship: "family" }).eq("member_prospect_id", luisProspect);
    const [row] = await h.sql<{ relationship: string }>(`select relationship from public.household_members where member_prospect_id = $1`, [luisProspect]);
    expect(row!.relationship).toBe("spouse");
  });

  it("is a record: only its end and its link can be written, even by the server", async () => {
    await expect(h.sql(`update public.household_members set relationship = 'family' where member_prospect_id = $1`, [luisProspect])).rejects.toThrow(/only the end and the link/);
    await expect(h.sql(`delete from public.household_members where member_prospect_id = $1`, [luisProspect])).rejects.toThrow(/end it instead/);
  });

  it("the console shows each one the other, by role, with only the link", async () => {
    const all = await loadStaffClients(h.as(admin.userId));
    const rosa = all.find((c) => c.id === A)!;
    const luis = all.find((c) => c.id === B)!;
    expect(rosa.household).toEqual({ partnerId: B, partnerName: "Luis Delgado", relationship: "spouse", status: "linked" });
    expect(luis.household).toEqual({ partnerId: A, partnerName: "Rosa", relationship: "spouse", status: "linked" });
    // Each keeps their own report.
    expect(rosa.report?.pulledAt).not.toBe(luis.report?.pulledAt);
    const forJorge = await loadStaffClients(h.as(jorge.userId));
    expect(forJorge.some((c) => c.id === A || c.id === B)).toBe(false);
  });
});

describe("reports in one place, on the database", () => {
  it("staff open a stored report only within their case scope", async () => {
    expect((await readStaffReport(h.as(admin.userId), A, pullA)).ok).toBe(true);
    expect((await readStaffReport(h.as(marta.userId), A, pullA)).ok).toBe(true);
    expect(await readStaffReport(h.as(jorge.userId), A, pullA)).toMatchObject({ ok: false, status: 404 });
    expect(await readStaffReport(h.as(ana.userId), A, pullA)).toMatchObject({ ok: false, status: 404 });
    // The id must be the client's own pull.
    const other = await addClient(h, { name: "Otro Cliente", phone: "+12145550444" });
    expect(await readStaffReport(h.as(admin.userId), other, pullA)).toMatchObject({ ok: false });
  });

  it("every pull is an entry of the client's history, with its counts, and repeats are not stored twice", async () => {
    // A second report with the same personal information in other spellings.
    const second = sampleReport(1, (raw) => {
      raw.bureaus.equifax!.personalInfo.push({ field: "address", value: "123 OLD ST #2 HOUSTON TX 77001" }, { field: "name", value: "r. martinez jr." });
    });
    const result = await importReportForUser(h.service, A, second);
    const [stored] = await h.sql<{ raw: { bureaus: { equifax: { personalInfo: unknown[] } } }; import_summary: Record<string, number> }>(
      `select raw, import_summary from public.report_pulls where id = $1`,
      [result.pullId],
    );
    expect(stored!.raw.bureaus.equifax.personalInfo).toEqual(sampleReport(1).bureaus.equifax!.personalInfo);
    expect(stored!.import_summary.skippedPersonalInfo).toBeGreaterThanOrEqual(2);
    const piItems = await h.sql(`select 1 from public.report_items where user_id = $1 and category = 'personal_info'`, [A]);
    expect(piItems.length).toBe(sampleReport(1).bureaus.equifax!.personalInfo.length + sampleReport(1).bureaus.experian!.personalInfo.length + sampleReport(1).bureaus.transunion!.personalInfo.length);

    const mine = await loadClientReportHistory(h.as(A), A);
    expect(mine.map((e) => e.first)).toEqual([false, true]);
    expect(mine[0]).toMatchObject({ id: result.pullId, byTeam: false, skippedPersonalInfo: stored!.import_summary.skippedPersonalInfo });
    expect(JSON.stringify(mine)).not.toMatch(/imported_by|"by"/);
    expect(await loadClientReportById(h.as(A), A, pullA)).not.toBeNull();

    const staffView = (await loadStaffClients(h.as(marta.userId), { clientId: A }))[0]!;
    expect(staffView.reportHistory?.map((e) => e.id)).toEqual([pullA, result.pullId]);
  });
});
