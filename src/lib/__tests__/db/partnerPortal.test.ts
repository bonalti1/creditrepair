import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { creditPartner } from "../../partners/attribution";
import { PARTNER_REFERRAL_COLUMNS, SHARE_REQUEST_TEMPLATE } from "../../partners/portal";
import { requestShare, runPartnerDigests, runShareRequestMessages, type DigestDeliver, type ShareRequestDeliver } from "../../partners/portalServer";
import { consentHash, SHARING_CONSENT_VERSION } from "../../partners/sharing";
import { PARTNER_CLIENT_TERMS_VERSION } from "../../partners/terms";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, ago, assign, sampleReport, signAgreement, uid } from "./seed";

// The partner portal (migration 0033) against the real migrations, with row
// level security applied: the pipeline and who looks after each person,
// "ask to follow progress" (once per 14 days, only the referring partner,
// never to a client who shares, the message never by SMS and once), the notes
// between a partner and the team (only while the client shares, never read by
// the client), and the weekly summary. And, again: a partner reads no table
// of the case, and none of the new tables, directly.

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
    headers: { "content-type": "application/json", "x-forwarded-for": `10.33.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

const LAURA = { name: "Laura Benítez", company: "Benítez Realty" };
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let P1: string; // Laura (realtor)
let P2: string; // Jorge (car dealer)
let laura: string;
let jorge: string;
let A: string; // Rosa: referred by Laura, signed, round mailed, assigned to Marta
let D: string; // Nadia: referred by Laura, has an account, nothing signed
let E: string; // Pablo: referred by Laura, opted out of messages
let G: string; // Gloria: referred by Laura, finished the program
let felipe: string; // a lead of Laura's nobody has reached yet
let marco: string; // a lead of Laura's sales invited
let itemNames: string[] = [];

const insertPartner = async (fields: Record<string, unknown>) => {
  const { data, error } = await h.service
    .from("partners")
    .insert({ terms_version: "2026-11-socios-v1", terms_accepted_at: new Date().toISOString(), ...fields })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
};

const referralsOf = async (partner: string) => {
  const { data, error } = await h.as(partner).rpc("partner_referrals");
  if (error) throw new Error(error.message);
  return data as Array<Record<string, unknown>>;
};

const share = async (client: string, level: "none" | "progress" | "summary") => {
  const route = await import("@/app/api/sharing/route");
  as(h.as(client));
  return json(await route.POST(request("/api/sharing", { action: "set", partnerId: P1, level, locale: "en", version: SHARING_CONSENT_VERSION, textHash: consentHash(level, LAURA, "en") })));
};

const lauraMember = () => ({ userId: laura, partner: { id: P1, name: LAURA.name, company: LAURA.company } });

beforeAll(async () => {
  h = await startHarness();
  await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  P1 = await insertPartner({ name: LAURA.name, company: LAURA.company, kind: "realtor", phone_e164: "+17135550161", email: "laura@ejemplo.com", state: "TX", status: "approved", referral_code: "laura-benitez", salesperson: "ana" });
  P2 = await insertPartner({ name: "Jorge Treviño", company: "Treviño Motors", kind: "car_dealer", phone_e164: "+19565550162", status: "approved", referral_code: "jorge-trevino" });
  laura = uid();
  jorge = uid();
  await h.createUser(laura, { phone: "+17135550161" });
  await h.createUser(jorge, { phone: "+19565550162" });
  await h.service.from("partner_members").insert([{ user_id: laura, partner_id: P1 }, { user_id: jorge, partner_id: P2 }]);
  await h.service.from("partner_terms_acceptances").insert([
    { partner_id: P1, user_id: laura, version: PARTNER_CLIENT_TERMS_VERSION, locale: "en", text_hash: "c".repeat(64) },
    { partner_id: P2, user_id: jorge, version: PARTNER_CLIENT_TERMS_VERSION, locale: "en", text_hash: "c".repeat(64) },
  ]);

  A = await addClient(h, { name: "Rosa Martínez", phone: "+17135550171", address: ["742 Calle Secreta", "Houston, TX 77002"] });
  expect(await creditPartner(h.service, A, "laura-benitez")).toBe(true);
  await signAgreement(h, A);
  await addDocuments(h, A);
  await assign(h, A, marta.userId);
  await importReportForUser(h.service, A, sampleReport(20));
  const { data: items } = await h.service.from("report_items").select("id, name").eq("user_id", A);
  itemNames = (items as Array<{ name: string }>).slice(0, 3).map((i) => i.name);
  await h.service.from("attack_rounds").insert({ user_id: A, round_number: 1, status: "mailed", mailed_at: ago(10) });

  D = await addClient(h, { name: "Nadia Ruiz", phone: "+17135550174" });
  expect(await creditPartner(h.service, D, "laura-benitez")).toBe(true);
  E = await addClient(h, { name: "Pablo Soto", phone: "+17135550175" });
  expect(await creditPartner(h.service, E, "laura-benitez")).toBe(true);
  await h.service.from("message_opt_outs").insert({ user_id: E, kind: "opt_out", channel: "whatsapp", keyword: "STOP" });
  G = await addClient(h, { name: "Gloria Paz", phone: "+17135550176" });
  expect(await creditPartner(h.service, G, "laura-benitez")).toBe(true);
  await signAgreement(h, G, { signedDaysAgo: 200 });
  const done = await h.service.from("program_completions").insert({ user_id: G, reason: "client_chose" });
  expect(done.error).toBeNull();

  const prospect = async (first: string, phone: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await h.service
      .from("prospects")
      .insert({ first_name: first, last_name: "Vega", phone_e164: phone, state: "TX", goal: "mortgage", salesperson: "ana", source: "partner", partner_id: P1, consent_text: "The partner confirms the person agreed to be contacted.", consent_at: ago(1), ...extra })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return String((data as { id: string }).id);
  };
  felipe = await prospect("Felipe", "+17135550181");
  marco = await prospect("Marco", "+17135550182", { invited_at: ago(0.9) });
}, 90_000);

describe("the pipeline: what partner_referrals() gives a partner", () => {
  it("each person's step, when sales reached out, who looks after them, and nothing of the case", async () => {
    const rows = await referralsOf(laura);
    expect(Object.keys(rows[0]!).sort()).toEqual([...PARTNER_REFERRAL_COLUMNS].sort());
    const by = (first: string) => rows.find((r) => r.first_name === first)!;
    expect(by("Felipe")).toMatchObject({ status: "referred", contacted_at: null, has_account: false, care_first_name: "Ana", care_role: "sales" });
    expect(by("Marco")).toMatchObject({ status: "contacted", has_account: false });
    expect(by("Marco").contacted_at).toBeTruthy();
    expect(by("Rosa")).toMatchObject({ status: "active", has_account: true, care_first_name: "Marta", care_role: "specialist", shared_client_id: null });
    expect(by("Nadia")).toMatchObject({ status: "contacted", has_account: true });
    // Graduation records the end of the service too: still "finished", not "did not continue".
    expect(by("Gloria")).toMatchObject({ status: "finished" });
    const text = JSON.stringify(rows);
    for (const secret of [...itemNames, "742 Calle", "+1713", "89.00", "Martínez"]) expect(text, secret).not.toContain(secret);
    // Another partner, a client or a member of staff gets nothing.
    expect(await referralsOf(jorge)).toEqual([]);
    expect((await h.as(A).rpc("partner_referrals")).data).toEqual([]);
    expect((await h.as(marta.userId).rpc("partner_referrals")).data).toEqual([]);
  });

  it("partners can be car dealers and attorneys; an unknown kind is refused", async () => {
    await insertPartner({ name: "Ada Lex", kind: "attorney", phone_e164: "+12145550190", status: "pending" });
    await expect(insertPartner({ name: "Bo Bank", kind: "banker", phone_e164: "+12145550191", status: "pending" })).rejects.toThrow(/partners_kind_check/);
  });
});

describe("ask to follow progress", () => {
  it("the partner asks; the client gets a card; the partner sees only the date; at most once every 14 days", async () => {
    const route = await import("@/app/api/partners/portal/route");
    as(h.as(laura, { phone: "+17135550161" }));
    // A lead without an account cannot be asked yet.
    const lead = await json(await route.POST(request("/api/partners/portal", { action: "ask_share", referralId: felipe })));
    expect(lead).toMatchObject({ status: 409, body: { code: "no_account" } });
    const ok = await json(await route.POST(request("/api/partners/portal", { action: "ask_share", referralId: D })));
    expect(ok.status).toBe(200);
    // No channel configured here: the message is skipped; the card in the app is what the client sees.
    const [row] = await h.sql<Record<string, unknown>>(`select * from public.partner_share_requests where user_id = $1`, [D]);
    expect(row).toMatchObject({ partner_id: P1, requested_by: laura, partner_name_shown: "Laura Benítez, Benítez Realty", message_status: "skipped" });
    const nadia = (await referralsOf(laura)).find((r) => r.first_name === "Nadia")!;
    expect(nadia.share_requested_at).toBeTruthy();
    expect(nadia.shared_client_id).toBeNull();
    // Again: refused by the route and by the database.
    const again = await json(await route.POST(request("/api/partners/portal", { action: "ask_share", referralId: D })));
    expect(again).toMatchObject({ status: 409, body: { code: "requested" } });
    const direct = await h.service.from("partner_share_requests").insert({ partner_id: P1, user_id: D, partner_name_shown: "Laura Benítez" });
    expect(direct.error?.message).toMatch(/14 days/);
  });

  it("the database: only the referring partner, only an approved one, never to a client who shares, never edited", async () => {
    const notTheirs = await h.service.from("partner_share_requests").insert({ partner_id: P2, user_id: A, partner_name_shown: "Jorge Treviño" });
    expect(notTheirs.error?.message).toMatch(/only the partner who referred/);
    await share(A, "progress");
    const sharing = await h.service.from("partner_share_requests").insert({ partner_id: P1, user_id: A, partner_name_shown: "Laura Benítez" });
    expect(sharing.error?.message).toMatch(/already shares/);
    await expect(h.sql(`update public.partner_share_requests set partner_name_shown = 'Otra' where user_id = $1`, [D])).rejects.toThrow(/cannot be changed/);
    await expect(h.sql(`delete from public.partner_share_requests where user_id = $1`, [D])).rejects.toThrow(/never deleted/);
    await expect(h.sql(`update public.partner_share_requests set message_status = 'queued' where user_id = $1`, [D])).rejects.toThrow(/forward/);
  });

  it("the client reads their own request and says not now; nobody else reads it", async () => {
    const route = await import("@/app/api/sharing/route");
    as(h.as(D));
    const got = await json(await route.GET(request("/api/sharing")));
    const requests = got.body.requests as Array<Record<string, unknown>>;
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ partnerName: "Laura Benítez, Benítez Realty", dismissedAt: null });
    // Another client cannot dismiss it.
    as(h.as(A));
    expect((await route.POST(request("/api/sharing", { action: "dismiss_request", id: requests[0]!.id }))).status).toBe(404);
    as(h.as(D));
    expect((await route.POST(request("/api/sharing", { action: "dismiss_request", id: requests[0]!.id }))).status).toBe(200);
    const [row] = await h.sql<Record<string, unknown>>(`select dismissed_at from public.partner_share_requests where user_id = $1`, [D]);
    expect(row!.dismissed_at).toBeTruthy();
    await expect(h.sql(`update public.partner_share_requests set dismissed_at = now() + interval '1 day' where user_id = $1`, [D])).rejects.toThrow(/dismissal cannot be changed/);
    // The partner and another client read nothing; the specialist of the client does (Marta has Rosa, not Nadia).
    expect(((await h.as(laura).from("partner_share_requests").select("*")).data as unknown[]).length).toBe(0);
    expect(((await h.as(A).from("partner_share_requests").select("*")).data as unknown[]).length).toBe(0);
    await assign(h, D, marta.userId);
    expect(((await h.as(marta.userId).from("partner_share_requests").select("*")).data as unknown[]).length).toBe(1);
  });

  it("the message: WhatsApp's approved template or email, never SMS; held in quiet hours; skipped after an opt-out; once", async () => {
    const sent: Array<{ channel: string; body: string }> = [];
    const deliver: ShareRequestDeliver = async (m) => {
      sent.push({ channel: m.channel, body: m.body });
      return { ok: true };
    };
    const channels = { whatsapp: true, email: false, approvedTemplates: [SHARE_REQUEST_TEMPLATE], simulated: false };
    const noon = new Date();
    noon.setUTCHours(18, 0, 0, 0);
    const night = new Date(noon.getTime() + 9 * 60 * 60 * 1000); // 3 a.m. in Texas
    // Pablo opted out: his request is recorded, his message skipped.
    const asked = await requestShare(h.service, h.as(laura), lauraMember(), E, new Date(), { deliverNow: false });
    expect(asked.ok).toBe(true);
    const held = await runShareRequestMessages(h.service, night, { channels, deliver });
    expect(held).toMatchObject({ skipped: 1, sent: 0 });
    const [pablo] = await h.sql<Record<string, unknown>>(`select message_status, message_note from public.partner_share_requests where user_id = $1`, [E]);
    expect(pablo).toMatchObject({ message_status: "skipped", message_note: "opted_out" });
    // Gloria: queued at night, sent at noon, once.
    const g = await requestShare(h.service, h.as(laura), lauraMember(), G, new Date(), { deliverNow: false });
    expect(g.ok).toBe(true);
    expect(await runShareRequestMessages(h.service, night, { channels, deliver })).toMatchObject({ waitingQuietHours: 1, sent: 0 });
    expect(await runShareRequestMessages(h.service, noon, { channels, deliver })).toMatchObject({ sent: 1 });
    expect(await runShareRequestMessages(h.service, noon, { channels, deliver })).toMatchObject({ requests: 0, sent: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channel).toBe("whatsapp");
    expect(sent[0]!.body).toMatch(/^Hi Gloria, Laura Benítez, Benítez Realty asked to follow your progress/);
    // Never SMS: the database refuses it.
    await expect(h.sql(`update public.partner_share_requests set message_channel = 'sms' where user_id = $1`, [G])).rejects.toThrow();
  });
});

describe("notes between the partner and the team", () => {
  it("both ways while the client shares; the specialist reads and replies; the client never reads them", async () => {
    const portal = await import("@/app/api/partners/portal/route");
    as(h.as(laura, { phone: "+17135550161" }));
    expect((await portal.POST(request("/api/partners/portal", { action: "message", clientId: A, text: "Rosa asked if she needs anything else before her next round." }))).status).toBe(200);
    // The staff console: Marta (assigned) reads the thread and replies through the guardrails.
    const staff = await import("@/app/api/staff/partner-notes/route");
    as(h.as(marta.userId));
    const threads = await json(await staff.GET(request(`/api/staff/partner-notes?client=${A}`)));
    const list = threads.body.threads as Array<{ partnerId: string; notes: Array<Record<string, unknown>>; sharing: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ partnerId: P1, sharing: true });
    expect(list[0]!.notes[0]).toMatchObject({ authorKind: "partner", authorFirstName: "Laura" });
    const bad = await json(await staff.POST(request("/api/staff/partner-notes", { clientId: A, partnerId: P1, text: "Her score is 640 and the collection will be deleted." })));
    expect(bad.status).toBe(422);
    const good = await json(await staff.POST(request("/api/staff/partner-notes", { clientId: A, partnerId: P1, text: "Thanks, Laura. I wrote to her today; she has what she needs for now." })));
    expect(good.status).toBe(200);
    // Laura sees the thread on Rosa's page, with Marta's first name and role.
    const page = await import("@/app/api/partners/clients/[id]/route");
    as(h.as(laura, { phone: "+17135550161" }));
    const view = await json(await page.GET(request(`/api/partners/clients/${A}`), { params: Promise.resolve({ id: A }) }));
    expect(view.status).toBe(200);
    expect(view.body.care).toEqual({ firstName: "Marta", role: "specialist" });
    const thread = view.body.thread as Array<Record<string, unknown>>;
    expect(thread.map((n) => [n.authorKind, n.authorFirstName, n.authorRole])).toEqual([
      ["partner", "Laura", null],
      ["staff", "Marta", "specialist"],
    ]);
    // Never the client; not sales, who did not bring Rosa in; not another partner.
    expect(((await h.as(A).from("partner_team_notes").select("*")).data as unknown[]).length).toBe(0);
    expect(((await h.as(ana.userId).from("partner_team_notes").select("*")).data as unknown[]).length).toBe(0);
    expect(((await h.as(laura).from("partner_team_notes").select("*")).data as unknown[]).length).toBe(0);
    expect((await h.as(jorge).rpc("partner_team_thread", { p_client: A })).data).toEqual([]);
    // Sales cannot reply about a client they may not see.
    as(h.as(ana.userId));
    expect((await staff.POST(request("/api/staff/partner-notes", { clientId: A, partnerId: P1, text: "Hello Laura." }))).status).toBe(404);
  });

  it("revoked: the thread, the care line and the client id disappear at once, and no note goes either way", async () => {
    await share(A, "none");
    expect((await h.as(laura).rpc("partner_team_thread", { p_client: A })).data).toEqual([]);
    expect((await h.as(laura).rpc("partner_client_care", { p_client: A })).data).toEqual([]);
    expect((await referralsOf(laura)).find((r) => r.first_name === "Rosa")!.shared_client_id).toBeNull();
    const portal = await import("@/app/api/partners/portal/route");
    as(h.as(laura, { phone: "+17135550161" }));
    expect((await portal.POST(request("/api/partners/portal", { action: "message", clientId: A, text: "Any news about Rosa?" }))).status).toBe(404);
    const staff = await import("@/app/api/staff/partner-notes/route");
    as(h.as(marta.userId));
    expect((await staff.POST(request("/api/staff/partner-notes", { clientId: A, partnerId: P1, text: "Hello again, Laura." }))).status).toBe(409);
    await expect(
      h.sql(`insert into public.partner_team_notes (partner_id, user_id, author_kind, author, author_first_name, body) values ($1, $2, 'partner', $3, 'Laura', 'Hola')`, [P1, A, laura]),
    ).rejects.toThrow(/does not share/);
    await expect(h.sql(`update public.partner_team_notes set body = 'x'`)).rejects.toThrow(/cannot be changed/);
    await expect(h.sql(`delete from public.partner_team_notes`)).rejects.toThrow(/cannot be deleted/);
    // Sharing again: the earlier notes are back for the partner, the client id too.
    await share(A, "summary");
    expect(((await h.as(laura).rpc("partner_team_thread", { p_client: A })).data as unknown[]).length).toBe(2);
    expect((await referralsOf(laura)).find((r) => r.first_name === "Rosa")!.shared_client_id).toBe(A);
  });

  it("the database checks who writes: the partner's own sign-in, or an active teammate in that role", async () => {
    await expect(
      h.sql(`insert into public.partner_team_notes (partner_id, user_id, author_kind, author, author_first_name, body) values ($1, $2, 'partner', $3, 'Jorge', 'Hola')`, [P1, A, jorge]),
    ).rejects.toThrow(/not this partner/);
    await expect(
      h.sql(`insert into public.partner_team_notes (partner_id, user_id, author_kind, author, author_first_name, author_role, body) values ($1, $2, 'staff', $3, 'Ana', 'specialist', 'Hola')`, [P1, A, ana.userId]),
    ).rejects.toThrow(/active member of staff/);
  });
});

describe("who is taking care of a client who shares", () => {
  it("the assigned teammate, else the salesperson: first name and role only", async () => {
    const H = await addClient(h, { name: "Hugo Lara", phone: "+17135550177", referredBy: "ana" });
    expect(await creditPartner(h.service, H, "laura-benitez")).toBe(true);
    const route = await import("@/app/api/sharing/route");
    as(h.as(H));
    expect((await route.POST(request("/api/sharing", { action: "set", partnerId: P1, level: "progress", locale: "en", version: SHARING_CONSENT_VERSION, textHash: consentHash("progress", LAURA, "en") }))).status).toBe(200);
    expect((await h.as(laura).rpc("partner_client_care", { p_client: H })).data).toEqual([{ care_first_name: "Ana", care_role: "sales" }]);
    await assign(h, H, marta.userId);
    expect((await h.as(laura).rpc("partner_client_care", { p_client: H })).data).toEqual([{ care_first_name: "Marta", care_role: "specialist" }]);
    // Another partner: nothing.
    expect((await h.as(jorge).rpc("partner_client_care", { p_client: H })).data).toEqual([]);
  });
});

describe("a partner still cannot read the case, or the new tables, directly", () => {
  it("every case table, the requests, the notes, the summaries and the assignments: nothing; the internal function is not theirs", async () => {
    const reader = h.as(laura);
    for (const table of [
      "profiles", "prospects", "report_pulls", "report_items", "item_flags", "attack_rounds", "letters", "letter_items", "service_agreements",
      "identity_documents", "chat_messages", "events", "charges", "payment_methods", "staff_notes", "staff_members", "client_assignments",
      "partner_share_consents", "partner_view_log", "partner_notices", "partner_share_requests", "partner_team_notes", "partner_digests",
      "program_completions", "message_opt_outs", "outbound_messages",
    ]) {
      const { data, error } = await reader.from(table).select("*");
      expect(error ? 0 : (data as unknown[]).length, table).toBe(0);
    }
    expect(((await reader.from("report_items").select("*").eq("user_id", A)).data as unknown[] | null) ?? []).toEqual([]);
    expect((await reader.rpc("partner_share_level", { p_user: A, p_partner: P1 })).error).toBeTruthy();
    // The care function gives nothing for a client who does not share (Nadia), even with her id.
    expect((await reader.rpc("partner_client_care", { p_client: D })).data).toEqual([]);
    expect((await reader.rpc("partner_team_thread", { p_client: D })).data).toEqual([]);
    // A suspended partner: nothing at all.
    await h.service.from("partners").update({ status: "suspended" }).eq("id", P1);
    expect(await referralsOf(laura)).toEqual([]);
    expect((await reader.rpc("partner_team_thread", { p_client: A })).data).toEqual([]);
    expect((await reader.rpc("partner_client_care", { p_client: A })).data).toEqual([]);
    await h.service.from("partners").update({ status: "approved" }).eq("id", P1);
  });
});

describe("the weekly summary", () => {
  it("only to partners who chose it, Mondays from 9:00 their time, once a week, only with news, never SMS", async () => {
    await expect(h.sql(`update public.partners set digest_channel = 'sms' where id = $1`, [P1])).rejects.toThrow();
    const route = await import("@/app/api/partners/portal/route");
    as(h.as(laura, { phone: "+17135550161" }));
    expect((await route.POST(request("/api/partners/portal", { action: "settings", notifyEmail: false, notifyWhatsapp: false, digestChannel: "email" }))).status).toBe(200);
    const portal = await json(await route.GET(request("/api/partners/portal")));
    expect((portal.body.partner as Record<string, unknown>).digestChannel).toBe("email");

    // The next Monday at 10:00 in Texas, at least a day away; Rosa's round 2 is mailed the day before (after she began sharing).
    const monday = new Date();
    monday.setUTCHours(16, 0, 0, 0);
    do monday.setUTCDate(monday.getUTCDate() + 1);
    while (monday.getUTCDay() !== 1 || monday.getTime() - Date.now() < 36 * 60 * 60 * 1000);
    await h.service.from("attack_rounds").insert({ user_id: A, round_number: 2, status: "mailed", mailed_at: new Date(monday.getTime() - 24 * 60 * 60 * 1000).toISOString() });

    const sent: string[] = [];
    const deliver: DigestDeliver = async (_p, body) => {
      sent.push(body);
      return { ok: true };
    };
    const channels = { whatsapp: false, email: true, approvedTemplates: [] as string[], simulated: false };
    const tuesday = new Date(monday.getTime() + 24 * 60 * 60 * 1000);
    expect(await runPartnerDigests(h.service, tuesday, { channels, deliver })).toMatchObject({ partners: 1, notTime: 1, sent: 0 });
    expect(await runPartnerDigests(h.service, monday, { channels, deliver })).toMatchObject({ sent: 1 });
    expect(await runPartnerDigests(h.service, new Date(monday.getTime() + 2 * 60 * 60 * 1000), { channels, deliver })).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^Hi, Laura\. Your weekly Credalti summary: .*Rosa's round 2 letters were mailed/);
    for (const secret of [...itemNames, "742 Calle", "Equifax", "$"]) expect(sent[0]).not.toContain(secret);
    // Jorge never chose it.
    const rows = await h.sql<{ partner_id: string }>(`select partner_id from public.partner_digests`);
    expect(rows.map((r) => r.partner_id)).toEqual([P1]);
    await expect(h.sql(`delete from public.partner_digests`)).rejects.toThrow(/never deleted/);
  });
});
