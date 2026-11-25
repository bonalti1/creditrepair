import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, assign, signAgreement, uid } from "./seed";

// Fulfillment (migration 0041) against the real migrations, with row level
// security applied: notification settings and the opt-out from the app, the
// monitoring checks and the commissions, document reviews and the other
// documents, no Social Security card, the CRC import log, and the routes end
// to end (/api/notifications, /api/staff/documents, /api/staff/monitoring,
// /api/staff/import).

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
    headers: { "content-type": "application/json", "x-forwarded-for": `10.41.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let rosa: string; // Marta's client, brought in by Ana
let beto: string; // nobody's but the admin's
const texasToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  rosa = await addClient(h, { name: "Rosa Uno", referredBy: "ana", phone: "+17135550201" });
  beto = await addClient(h, { name: "Beto Dos", phone: "+17135550202" });
  await assign(h, rosa, marta.userId);
  await signAgreement(h, rosa);
  await addDocuments(h, rosa);
}, 120_000);

afterAll(async () => {
  await h?.pg.close();
});

describe("notification settings and the opt-out from the app", () => {
  it("the client reads their own; staff who see the client read them; nobody else", async () => {
    await h.service.from("notification_settings").insert({ user_id: rosa, whatsapp: true, email: false, reminders: false, updates: true });
    expect((await h.as(rosa).from("notification_settings").select("*")).data).toHaveLength(1);
    expect((await h.as(beto).from("notification_settings").select("*")).data).toHaveLength(0);
    expect((await h.as(marta.userId).from("notification_settings").select("*")).data).toHaveLength(1);
    expect((await h.as(ana.userId).from("notification_settings").select("*")).data).toHaveLength(1);
    expect((await h.anon.from("notification_settings").select("*")).data ?? []).toHaveLength(0);
    // Nobody writes through their own connection.
    const own = await h.as(rosa).from("notification_settings").update({ email: true }).eq("user_id", rosa).select("*");
    expect(own.data ?? []).toHaveLength(0);
  });

  it("at least one channel; the history is append-only; «Stop all» is an opt-out record", async () => {
    const none = await h.service.from("notification_settings").insert({ user_id: beto, whatsapp: false, email: false });
    expect(none.error?.message).toMatch(/one_channel/);
    await h.service.from("notification_setting_changes").insert({ user_id: rosa, whatsapp: true, email: true, reminders: true, updates: true, by_kind: "client" });
    const change = await h.service.from("notification_setting_changes").update({ email: false }).eq("user_id", rosa);
    expect(change.error?.message).toMatch(/cannot be changed/);
    const app = await h.service.from("message_opt_outs").insert({ user_id: beto, kind: "opt_out", channel: "app", keyword: "APP STOP" });
    expect(app.error).toBeNull();
    const sms = await h.service.from("message_opt_outs").insert({ user_id: beto, kind: "opt_out", channel: "sms" });
    expect(sms.error).not.toBeNull();
  });

  it("the route saves the client's choice, refuses no channel, and records stop / start", async () => {
    const route = await import("@/app/api/notifications/route");
    as(h.as(beto));
    expect((await json(await route.POST(request("/api/notifications", { action: "save", whatsapp: false, email: false, reminders: true, updates: true })))).status).toBe(400);
    expect((await json(await route.POST(request("/api/notifications", { action: "save", whatsapp: true, email: false, reminders: false, updates: true })))).status).toBe(200);
    const read = await json(await route.GET(request("/api/notifications")));
    expect(read.body.settings).toMatchObject({ whatsapp: true, email: false, reminders: false, updates: true, updatedBy: "client" });
    // beto opted out above ("app"): the screen says so; START brings them back.
    expect(read.body.optedOutAt).not.toBeNull();
    expect((await json(await route.POST(request("/api/notifications", { action: "start_again" })))).status).toBe(200);
    expect((await json(await route.GET(request("/api/notifications")))).body.optedOutAt).toBeNull();
    const history = await h.service.from("notification_setting_changes").select("*").eq("user_id", beto);
    expect(history.data).toHaveLength(1);
    as(null);
    expect((await route.GET(request("/api/notifications"))).status).toBe(503);
  });
});

describe("monitoring checks and commissions", () => {
  it("checks: the client's team reads them, the client does not; append-only; no SSN in the note", async () => {
    const ok = await h.service.from("monitoring_checks").insert({ user_id: rosa, provider: "identityiq", enrolled_via_link: "yes", status: "active", checked_on: texasToday(), method: "client_said" });
    expect(ok.error).toBeNull();
    expect((await h.as(marta.userId).from("monitoring_checks").select("*")).data).toHaveLength(1);
    expect((await h.as(admin.userId).from("monitoring_checks").select("*")).data).toHaveLength(1);
    expect((await h.as(rosa).from("monitoring_checks").select("*")).data).toHaveLength(0);
    const edit = await h.service.from("monitoring_checks").update({ status: "cancelled" }).eq("user_id", rosa);
    expect(edit.error?.message).toMatch(/cannot be changed/);
    const ssn = await h.service.from("monitoring_checks").insert({ user_id: rosa, provider: "identityiq", enrolled_via_link: "yes", status: "active", checked_on: texasToday(), method: "other", note: "ssn 123-45-6789" });
    expect(ssn.error).not.toBeNull();
    const other = await h.service.from("monitoring_checks").insert({ user_id: rosa, provider: "other", enrolled_via_link: "no", status: "unknown", checked_on: texasToday(), method: "other" });
    expect(other.error?.message).toMatch(/other_named/);
  });

  it("the route: a specialist records a check for their own client, not for someone else's", async () => {
    const route = await import("@/app/api/staff/monitoring/route");
    as(h.as(marta.userId));
    const body = { action: "check", clientId: rosa, provider: "identityiq", enrolledViaLink: "yes", status: "cancelled", checkedOn: texasToday(), method: "provider_portal", note: "Seen in the portal" };
    expect((await json(await route.POST(request("/api/staff/monitoring", body)))).status).toBe(200);
    expect((await json(await route.POST(request("/api/staff/monitoring", { ...body, clientId: beto })))).status).toBe(403);
    // Commissions are an administrator's.
    expect((await route.GET(request("/api/staff/monitoring"))).status).toBe(403);
    expect((await json(await route.POST(request("/api/staff/monitoring", { action: "record", clientId: rosa, month: "2026-10", amountCents: 4000, memberRef: "Rosa", paidOn: null })))).status).toBe(403);
  });

  it("commissions: only administrators read them; amounts never change; posting adds ONE other_income row", async () => {
    const route = await import("@/app/api/staff/monitoring/route");
    as(h.as(admin.userId));
    const month = texasToday().slice(0, 7);
    for (const amount of [4000, 4000]) {
      expect((await json(await route.POST(request("/api/staff/monitoring", { action: "record", clientId: rosa, month, amountCents: amount, memberRef: `Rosa ${amount}`, paidOn: texasToday() })))).status).toBe(200);
    }
    expect((await h.as(marta.userId).from("monitoring_commissions").select("*")).data).toHaveLength(0);
    expect((await h.as(rosa).from("monitoring_commissions").select("*")).data).toHaveLength(0);
    expect((await h.as(admin.userId).from("monitoring_commissions").select("*")).data).toHaveLength(2);
    const view = await json(await route.GET(request("/api/staff/monitoring")));
    expect((view.body.lines as unknown[]).length).toBe(2);

    const line = (await h.service.from("monitoring_commissions").select("id").limit(1)).data![0]!.id as string;
    expect((await h.service.from("monitoring_commissions").update({ amount_cents: 9000 }).eq("id", line)).error?.message).toMatch(/kept as recorded/);
    expect((await h.service.from("monitoring_commissions").delete().eq("id", line)).error?.message).toMatch(/never deleted/);

    const posted = await json(await route.POST(request("/api/staff/monitoring", { action: "post", month, receivedOn: texasToday(), confirmNotDuplicate: false })));
    expect(posted.status).toBe(200);
    const income = await h.service.from("other_income").select("*").eq("kind", "monitoring_commission");
    expect(income.data).toHaveLength(1);
    expect(income.data![0]!.amount_cents).toBe(8000);
    // Nothing left to post; a posted line can't be voided or re-matched.
    expect((await json(await route.POST(request("/api/staff/monitoring", { action: "post", month, receivedOn: texasToday(), confirmNotDuplicate: false })))).body.code).toBe("nothing_to_post");
    expect((await h.service.from("monitoring_commissions").update({ voided_at: new Date().toISOString(), void_reason: "typed twice" }).eq("id", line)).error?.message).toMatch(/in the books/);
    // A new line the same month: Accounting already has monitoring income, so posting asks for confirmation.
    await route.POST(request("/api/staff/monitoring", { action: "record", clientId: null, month, amountCents: 4000, memberRef: "Someone", paidOn: null }));
    expect((await json(await route.POST(request("/api/staff/monitoring", { action: "post", month, receivedOn: texasToday(), confirmNotDuplicate: false })))).body.code).toBe("existing_income");
  });
});

describe("documents", () => {
  it("a Social Security card is never stored", async () => {
    const card = await h.service.from("identity_documents").insert({ user_id: beto, kind: "ssn_card", storage_path: `${beto}/ssn.jpg` });
    expect(card.error?.message).toMatch(/Social Security card/);
  });

  it("other documents: the client and their case team read them; sales does not; only a withdrawal changes one", async () => {
    const id = uid();
    const ok = await h.service.from("client_files").insert({ id, user_id: rosa, kind: "supporting_document", storage_path: `${rosa}/${id}.pdf`, content_type: "application/pdf", bytes: 1000 });
    expect(ok.error).toBeNull();
    expect((await h.as(rosa).from("client_files").select("*")).data).toHaveLength(1);
    expect((await h.as(marta.userId).from("client_files").select("*")).data).toHaveLength(1);
    expect((await h.as(ana.userId).from("client_files").select("*")).data).toHaveLength(0);
    expect((await h.as(beto).from("client_files").select("*")).data).toHaveLength(0);
    expect((await h.service.from("client_files").update({ kind: "court_record" }).eq("id", id)).error).not.toBeNull();
    expect((await h.service.from("client_files").update({ withdrawn_at: new Date().toISOString() }).eq("id", id)).error).toBeNull();
    const poa = await h.service.from("client_files").insert({ user_id: rosa, kind: "power_of_attorney", storage_path: `${rosa}/poa-file.pdf`, content_type: "application/pdf", bytes: 10 });
    expect(poa.error?.message).toMatch(/poa_version/);
  });

  it("review route: a specialist accepts or rejects their client's document with a reason; sales cannot; promises are refused", async () => {
    const route = await import("@/app/api/staff/documents/route");
    as(h.as(marta.userId));
    const reject = await json(await route.POST(request("/api/staff/documents", { clientId: rosa, kind: "proof_of_address", decision: "rejected", reasonCode: "too_old", note: "The bill is from June.", askAgain: true })));
    expect(reject.status).toBe(200);
    expect((await json(await route.POST(request("/api/staff/documents", { clientId: rosa, kind: "proof_of_address", decision: "rejected" })))).status).toBe(400);
    const promise = await json(await route.POST(request("/api/staff/documents", { clientId: rosa, kind: "proof_of_address", decision: "rejected", reasonCode: "other", note: "Upload a new one and we guarantee it will be deleted." })));
    expect(promise.status).toBe(422);
    expect((await json(await route.POST(request("/api/staff/documents", { clientId: beto, kind: "government_id", decision: "accepted" })))).status).toBe(403);
    const link = await json(await route.GET(request(`/api/staff/documents?clientId=${rosa}&kind=government_id`)));
    expect(link.status).toBe(200);
    as(h.as(ana.userId));
    expect((await route.POST(request("/api/staff/documents", { clientId: rosa, kind: "government_id", decision: "accepted" }))).status).toBe(403);
    // The client reads the reason; reviews never change.
    expect((await h.as(rosa).from("document_reviews").select("*")).data).toHaveLength(1);
    expect((await h.as(beto).from("document_reviews").select("*")).data).toHaveLength(0);
    expect((await h.service.from("document_reviews").update({ decision: "accepted" }).eq("user_id", rosa)).error?.message).toMatch(/cannot be changed/);
  });
});

describe("importing from Credit Repair Cloud", () => {
  const header = ["First Name", "Last Name", "Email", "Phone (Mobile)", "State", "SSN", "Date of Birth", "Status", "Notes"];
  const rows = [
    header,
    ["Gloria", "Paredes", "gloria@example.com", "(713) 555-0161", "TX", "123-45-6789", "04/12/1979", "Client", "ssn 987-65-4321"],
    ["Teresa", "Lugo", "teresa@example.com", "404-555-0163", "GA", "123-45-0000", "02/02/1982", "Client", ""],
    ["Rosa", "Uno", "rosa2@example.com", "713-555-0201", "TX", "", "", "Lead", ""],
  ];
  const mapping = { firstName: 0, lastName: 1, email: 2, phone: 3, state: 4, status: 7, city: 5, referredBy: 8 };

  it("only an administrator imports; SSN and birth date never reach the database; duplicates and Georgia are not created", async () => {
    const route = await import("@/app/api/staff/import/route");
    const body = { action: "import", kind: "clients", fileName: "my_clients.csv", fileSha256: "c".repeat(64), rows, mapping, includeInactive: false, locale: "es" };
    as(h.as(marta.userId));
    expect((await route.POST(request("/api/staff/import", body))).status).toBe(403);
    as(h.as(admin.userId));
    const done = await json(await route.POST(request("/api/staff/import", body)));
    expect(done.status).toBe(200);
    expect(done.body.created).toBe(1);
    expect(done.body.dropped).toEqual(["SSN", "Date of Birth"]);
    // The same file again is refused.
    expect((await route.POST(request("/api/staff/import", body))).status).toBe(409);

    const everything = JSON.stringify([
      (await h.service.from("prospects").select("*")).data,
      (await h.service.from("crc_import_batches").select("*")).data,
      (await h.service.from("crc_import_rows").select("*")).data,
      (await h.service.from("leads").select("*")).data,
    ]);
    expect(everything).not.toMatch(/123-45|987-65|1979|1982/);
    const prospect = (await h.service.from("prospects").select("*").eq("source", "crc_import")).data!;
    expect(prospect).toHaveLength(1);
    expect(prospect[0]).toMatchObject({ first_name: "Gloria", state: "TX", locale: "es", salesperson: "carmen", converted_user_id: null });
    // The lead inbox picked it up with its source.
    expect((await h.service.from("leads").select("source").eq("prospect_id", prospect[0]!.id as string)).data).toEqual([{ source: "crc_import" }]);
    const log = (await h.service.from("crc_import_rows").select("line, outcome, reasons").order("line")).data!;
    expect(log.map((r) => r.outcome)).toEqual(["created", "problem", "duplicate"]);
    // Nobody but an administrator reads the log.
    expect((await h.as(marta.userId).from("crc_import_rows").select("*")).data).toHaveLength(0);
    // Nothing is charged: no charge exists for anyone imported.
    expect((await h.service.from("charges").select("*")).data).toHaveLength(0);
  });

  it("undo removes the people not invited yet and keeps the log", async () => {
    const route = await import("@/app/api/staff/import/route");
    as(h.as(admin.userId));
    const batch = (await h.service.from("crc_import_batches").select("id").limit(1)).data![0]!.id as string;
    const undo = await json(await route.POST(request("/api/staff/import", { action: "undo", batchId: batch })));
    expect(undo.status).toBe(200);
    expect(undo.body.kept).toBe(0);
    expect((await h.service.from("prospects").select("*").eq("source", "crc_import")).data).toHaveLength(0);
    expect((await h.service.from("crc_import_rows").select("outcome").eq("batch_id", batch)).data!.map((r) => r.outcome).sort()).toEqual(["duplicate", "problem", "undone"]);
    expect((await json(await route.POST(request("/api/staff/import", { action: "undo", batchId: batch })))).status).toBe(409);
    // An undone file may be imported again.
    const again = await json(
      await route.POST(request("/api/staff/import", { action: "import", kind: "clients", fileName: "my_clients.csv", fileSha256: "c".repeat(64), rows, mapping, includeInactive: false, locale: "en" })),
    );
    expect(again.status).toBe(200);
  });
});
