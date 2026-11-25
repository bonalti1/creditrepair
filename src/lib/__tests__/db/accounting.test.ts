import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addMonths, monthOf } from "../../accounting/periods";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff, DAY, signAgreement, uid } from "./seed";

// The accounting department against the real migrations (0036 on top of
// 0001–0027), with row level security applied: who can read the books
// (accounting staff only: not clients, partners, anonymous visitors, sales
// or specialists), the closed-month rule and its adjustments, the
// append-only records, the collections guard (no reminder after an opt-out,
// nothing for money already taken), and the two routes end to end.

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
const uploads: Array<{ bucket: string; path: string; bytes: number }> = [];

/** The service client with a storage upload that records what was kept (the harness has none). */
function withUploads(service: SupabaseClient): SupabaseClient {
  const storage = service.storage as unknown as { from: (b: string) => Record<string, unknown> };
  return new Proxy(service, {
    get(target, prop, receiver) {
      if (prop !== "storage") return Reflect.get(target, prop, receiver);
      return {
        ...storage,
        from: (bucket: string) => ({
          ...storage.from(bucket),
          async upload(path: string, bytes: Uint8Array) {
            uploads.push({ bucket, path, bytes: bytes.length });
            return { data: { path }, error: null };
          },
        }),
      };
    },
  }) as SupabaseClient;
}

const as = (who: SupabaseClient | null) => {
  session.reader = who;
  session.admin = withUploads(h.service);
};
const request = (path: string, body?: unknown) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.36.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let A: string; // a client with a declined charge
let B: string; // a client with a paid charge, who opted out of messages
let partnerUser: string;
let partnerId: string;
let failedCharge: string;
let paidCharge: string;
const now = new Date();
const thisMonth = monthOf(now);
const lastMonth = addMonths(thisMonth, -1);
const lastMonthDay = `${lastMonth}-10`;
const today = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

const TABLES = [
  "expense_categories",
  "accounting_settings",
  "month_closes",
  "accounting_imports",
  "accounting_recurring",
  "expenses",
  "other_income",
  "settlement_rows",
  "reconciliation_matches",
  "collection_actions",
  "partner_tax_info",
  "accounting_audit",
];

async function mailedRound(user: string, daysAgo: number): Promise<string> {
  const mailed = new Date(Date.now() - daysAgo * DAY).toISOString();
  const [round] = await h.sql<{ id: string }>(
    `insert into public.attack_rounds (user_id, round_number, status, approved_at, mailed_at) values ($1, 1, 'mailed', $2, $2) returning id`,
    [user, mailed],
  );
  await h.sql(
    `insert into public.letters (user_id, round_id, target_type, target_key, target_name, template_key, escalation_stage, body, status, mailed_at)
     values ($1, $2, 'bureau', 'equifax', 'Equifax', 'initial_dispute', 'initial', 'x', 'mailed', $3)`,
    [user, round!.id, mailed],
  );
  return round!.id;
}

async function charge(user: string): Promise<string> {
  const round = await mailedRound(user, 3);
  const { data, error } = await h.service.from("charges").insert({ user_id: user, round_id: round, amount_cents: 8900, unit: "round" }).select("id").single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

const count = async (who: SupabaseClient, table: string): Promise<number> => {
  const { data, error } = await who.from(table).select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as unknown[]).length;
};

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  A = await addClient(h, { name: "Rosa Martínez", referredBy: "ana" });
  B = await addClient(h, { name: "Luis Gómez", referredBy: "ana" });
  for (const c of [A, B]) await signAgreement(h, c, { signedDaysAgo: 20 });
  failedCharge = await charge(A);
  await h.sql(`update public.charges set status = 'failed', attempts = 1, last_attempt_at = now(), failure_code = 'insufficient_funds', gateway = 'nmi' where id = $1`, [failedCharge]);
  paidCharge = await charge(B);
  await h.sql(`update public.charges set status = 'succeeded', attempts = 1, charged_at = now(), last_attempt_at = now(), gateway = 'nmi', gateway_reference = 'nmi_txn_1001' where id = $1`, [paidCharge]);
  await h.service.from("message_opt_outs").insert({ user_id: B, kind: "opt_out", channel: "whatsapp", keyword: "STOP" });

  partnerUser = uid();
  await h.createUser(partnerUser, { phone: "+17135550199" });
  const { data: p } = await h.service
    .from("partners")
    .insert({ name: "Laura Benítez", kind: "realtor", phone_e164: "+17135550161", status: "approved", referral_code: "laura-b", terms_version: "2026-11-socios-v1", terms_accepted_at: now.toISOString() })
    .select("id")
    .single();
  partnerId = String((p as { id: string }).id);
  await h.service.from("partner_members").insert({ user_id: partnerUser, partner_id: partnerId });

  // One of everything, written as the server writes it.
  const { data: imp } = await h.service
    .from("accounting_imports")
    .insert({ kind: "processor_settlement", gateway: "nmi", file_name: "nmi.csv", file_sha256: "c".repeat(64), row_count: 1, added_count: 1, duplicate_count: 0 })
    .select("id")
    .single();
  const importId = String((imp as { id: string }).id);
  const { data: row } = await h.service
    .from("settlement_rows")
    .insert({ import_id: importId, gateway: "nmi", transaction_id: "nmi_txn_1001", kind: "sale", status: "settled", amount_cents: 8900, fee_cents: 377, settled_on: today })
    .select("id")
    .single();
  await h.service.from("reconciliation_matches").insert({ settlement_row_id: (row as { id: string }).id, charge_id: paidCharge, decision: "explained", note: "Checked against the batch report." });
  const { data: rule } = await h.service
    .from("accounting_recurring")
    .insert({ vendor: "Supabase", category_key: "software", amount_cents: 2500, day_of_month: 3, payment_method: "business_card", starts_on: "2026-01-01" })
    .select("id")
    .single();
  const expenses = await h.service.from("expenses").insert([
    { spent_on: lastMonthDay, amount_cents: 12000, category_key: "advertising_meta", vendor: "Meta", payment_method: "business_card" },
    { spent_on: lastMonthDay, amount_cents: 2500, category_key: "software", vendor: "Supabase", payment_method: "business_card", source: "recurring", recurring_id: (rule as { id: string }).id },
  ]);
  if (expenses.error) throw new Error(expenses.error.message);
  await h.service.from("other_income").insert({ kind: "monitoring_commission", source: "IdentityIQ", received_on: lastMonthDay, amount_cents: 4000 });
  await h.service.from("collection_actions").insert({ charge_id: failedCharge, user_id: A, kind: "reminder_whatsapp", by_name: "carmen" });
  await h.service.from("partner_tax_info").insert({ partner_id: partnerId, legal_name: "Laura Benítez Realty LLC", w9_received_on: today });
  await h.service.from("accounting_audit").insert({ actor: admin.userId, actor_name: "Carmen Ruiz", action: "expense_added", entity: "expense" });
  await h.service.from("month_closes").insert({ month: addMonths(thisMonth, -3), totals: { netProfitCents: 0 }, closed_by_name: "Carmen Ruiz" });
}, 90_000);

afterAll(() => {
  session.reader = null;
  session.admin = null;
});

describe("accounting: who can read the books", () => {
  it("an administrator (the accounting capability) reads every table", async () => {
    const reader = h.as(admin.userId);
    for (const table of TABLES) expect(await count(reader, table), table).toBeGreaterThan(0);
  });

  it("clients, partners, anonymous visitors, sales and specialists read nothing", async () => {
    const readers: Array<[string, SupabaseClient]> = [
      ["anon", h.anon],
      ["client with a declined charge", h.as(A)],
      ["client with a paid charge", h.as(B)],
      ["partner", h.as(partnerUser)],
      ["sales", h.as(ana.userId)],
      ["specialist", h.as(marta.userId)],
    ];
    for (const [who, reader] of readers) for (const table of TABLES) expect(await count(reader, table), `${who}: ${table}`).toBe(0);
  });

  it("nobody writes through the API: no insert, update or delete policy, even for an administrator", async () => {
    for (const who of [h.as(admin.userId), h.as(A), h.anon]) {
      const insert = await who.from("expenses").insert({ spent_on: today, amount_cents: 100, category_key: "other", vendor: "Someone", payment_method: "cash" });
      expect(insert.error).not.toBeNull();
    }
    const before = await count(h.service, "expenses");
    await h.as(admin.userId).from("expenses").update({ amount_cents: 1 }).eq("vendor", "Meta");
    await h.as(admin.userId).from("expenses").delete().eq("vendor", "Meta");
    expect(await count(h.service, "expenses")).toBe(before);
    const [meta] = await h.sql<{ amount_cents: number }>(`select amount_cents from public.expenses where vendor = 'Meta'`);
    expect(meta!.amount_cents).toBe(12000);
  });

  it("a deactivated administrator reads nothing", async () => {
    const old = await addStaff(h, "admin", "rafa", "Rafa Ex");
    expect(await count(h.as(old.userId), "expenses")).toBeGreaterThan(0);
    await h.sql(`update public.staff_members set active = false, deactivated_at = now() where user_id = $1`, [old.userId]);
    expect(await count(h.as(old.userId), "expenses")).toBe(0);
  });
});

describe("accounting: a closed month stays as it was", () => {
  beforeAll(async () => {
    const { error } = await h.service.from("month_closes").insert({ month: lastMonth, totals: { netProfitCents: -10500 }, closed_by_name: "Carmen Ruiz" });
    expect(error).toBeNull();
  });

  it("refuses a new expense, a change, a void or a delete dated in it", async () => {
    const add = await h.service.from("expenses").insert({ spent_on: lastMonthDay, amount_cents: 999, category_key: "other", vendor: "Late entry", payment_method: "cash" });
    expect(add.error?.message).toMatch(/closed month/);
    const change = await h.service.from("expenses").update({ amount_cents: 1 }).eq("vendor", "Meta");
    expect(change.error?.message).toMatch(/closed month/);
    const voided = await h.service.from("expenses").update({ voided_at: now.toISOString(), void_reason: "Entered twice." }).eq("vendor", "Meta");
    expect(voided.error?.message).toMatch(/closed month/);
    const moved = await h.service.from("expenses").update({ spent_on: today }).eq("vendor", "Meta");
    expect(moved.error?.message).toMatch(/closed month/);
    const removed = await h.service.from("expenses").delete().eq("vendor", "Meta");
    expect(removed.error?.message).toMatch(/voided, never deleted/);
    const income = await h.service.from("other_income").update({ amount_cents: 1 }).eq("source", "IdentityIQ");
    expect(income.error?.message).toMatch(/closed month/);
    const lateIncome = await h.service.from("other_income").insert({ kind: "monitoring_commission", source: "IdentityIQ", received_on: lastMonthDay, amount_cents: 4000 });
    expect(lateIncome.error?.message).toMatch(/closed month/);
  });

  it("takes an adjustment (even negative), which can never change; and a receipt any time", async () => {
    const adj = await h.service
      .from("expenses")
      .insert({ spent_on: lastMonthDay, amount_cents: -2000, category_key: "advertising_meta", vendor: "Meta", description: "Meta refunded a duplicate charge.", payment_method: "business_card", source: "adjustment", adjusts_month: lastMonth })
      .select("id")
      .single();
    expect(adj.error).toBeNull();
    const id = String((adj.data as { id: string }).id);
    expect((await h.service.from("expenses").update({ amount_cents: -1500 }).eq("id", id)).error?.message).toMatch(/adjustment is never changed/);
    // An adjustment for an open month is refused: edit the expense itself.
    const open = await h.service.from("expenses").insert({ spent_on: today, amount_cents: 500, category_key: "other", vendor: "Someone", payment_method: "cash", source: "adjustment", adjusts_month: thisMonth });
    expect(open.error?.message).toMatch(/only for a closed month/);
    // The receipt of a closed month's expense.
    const [meta] = await h.sql<{ id: string }>(`select id from public.expenses where vendor = 'Meta' and source = 'manual'`);
    const path = `${meta!.id}/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}.pdf`;
    const receipt = await h.service.from("expenses").update({ receipt_path: path, receipt_kind: "pdf", receipt_bytes: 2048, receipt_name: "meta.pdf", receipt_uploaded_at: now.toISOString() }).eq("id", meta!.id);
    expect(receipt.error).toBeNull();
  });

  it("a month is closed once, never reopened, and only after it is over", async () => {
    expect((await h.service.from("month_closes").delete().eq("month", lastMonth)).error?.message).toMatch(/cannot be changed or deleted/);
    expect((await h.service.from("month_closes").update({ note: "reopen" }).eq("month", lastMonth)).error?.message).toMatch(/cannot be changed or deleted/);
    expect((await h.service.from("month_closes").insert({ month: lastMonth, totals: {} })).error?.message).toMatch(/duplicate key|month_closes_pkey/);
    expect((await h.service.from("month_closes").insert({ month: thisMonth, totals: {} })).error?.message).toMatch(/not over yet/);
  });

  it("keeps the audit trail, imports, processor lines and decisions append-only", async () => {
    for (const table of ["accounting_audit", "accounting_imports", "settlement_rows", "reconciliation_matches", "collection_actions"]) {
      const del = await h.service.from(table).delete().neq("id", "00000000-0000-4000-8000-000000000000");
      expect(del.error?.message, table).toMatch(/cannot be changed or deleted/);
    }
  });
});

describe("accounting: collections", () => {
  it("never records a step for money already taken, nor a reminder after an opt-out", async () => {
    const paid = await h.service.from("collection_actions").insert({ charge_id: paidCharge, user_id: B, kind: "called" });
    expect(paid.error?.message).toMatch(/only an unpaid charge/);
    const other = await h.service.from("collection_actions").insert({ charge_id: failedCharge, user_id: B, kind: "called" });
    expect(other.error?.message).toMatch(/another client/);
    // B opted out; put B's charge back to unpaid to see the reminder refused.
    await h.pg.exec(`set session_replication_role = replica`);
    await h.sql(`update public.charges set status = 'failed', charged_at = null where id = $1`, [paidCharge]);
    await h.pg.exec(`set session_replication_role = origin`);
    const reminder = await h.service.from("collection_actions").insert({ charge_id: paidCharge, user_id: B, kind: "reminder_email" });
    expect(reminder.error?.message).toMatch(/asked for no messages/);
    expect((await h.service.from("collection_actions").insert({ charge_id: paidCharge, user_id: B, kind: "called", note: "Left a voicemail." })).error).toBeNull();
    const sms = await h.service.from("collection_actions").insert({ charge_id: failedCharge, user_id: A, kind: "reminder_sms" });
    expect(sms.error?.message).toMatch(/collection_actions_kind_check|check constraint/);
    await h.pg.exec(`set session_replication_role = replica`);
    await h.sql(`update public.charges set status = 'succeeded', charged_at = now() where id = $1`, [paidCharge]);
    await h.pg.exec(`set session_replication_role = origin`);
  });

  it("stores no tax id for a partner", async () => {
    const { error } = await h.service.from("partner_tax_info").update({ legal_name: "Laura 123-45-6789" }).eq("partner_id", partnerId);
    expect(error?.message).toMatch(/check constraint|partner_tax_info_legal_name_check/);
  });
});

describe("accounting: the routes", () => {
  it("refuse sales, specialists, clients and partners; answer an administrator", async () => {
    const route = await import("@/app/api/staff/accounting/route");
    for (const who of [ana.userId, marta.userId, A, partnerUser]) {
      as(h.as(who));
      expect((await route.GET(request("/api/staff/accounting"))).status).toBe(403);
      expect((await route.POST(request("/api/staff/accounting", { action: "set_tax_rate", bps: 3000 }))).status).toBe(403);
    }
    as(h.anon);
    expect((await route.GET(request("/api/staff/accounting"))).status).toBe(403);
    as(h.as(admin.userId));
    const read = await json(await route.GET(request("/api/staff/accounting")));
    expect(read.status).toBe(200);
    const book = read.body.book as { expenses: unknown[]; chargeMeta: Record<string, { reference: string | null }>; closes: Array<{ month: string }> };
    expect(book.expenses.length).toBeGreaterThan(1);
    expect(book.chargeMeta[paidCharge]?.reference).toBe("nmi_txn_1001");
    expect(book.closes.map((c) => c.month)).toContain(lastMonth);
  });

  it("records an expense, refuses one in a closed month with the reason, and writes the audit", async () => {
    const route = await import("@/app/api/staff/accounting/route");
    as(h.as(admin.userId));
    const ok = await json(await route.POST(request("/api/staff/accounting", { action: "add_expense", spentOn: today, amountCents: 4999, category: "postage", vendor: "Lob", description: "Round 2 letters", paymentMethod: "business_card" })));
    expect(ok.status).toBe(200);
    const [row] = await h.sql<{ created_by_name: string; amount_cents: number }>(`select created_by_name, amount_cents from public.expenses where vendor = 'Lob'`);
    expect(row).toMatchObject({ created_by_name: "Carmen Ruiz", amount_cents: 4999 });
    const closed = await json(await route.POST(request("/api/staff/accounting", { action: "add_expense", spentOn: lastMonthDay, amountCents: 100, category: "other", vendor: "Late", description: "", paymentMethod: "cash" })));
    expect(closed.status).toBe(422);
    expect(String((closed.body.message as { en: string }).en)).toMatch(/month is closed/);
    // A float or a string amount is refused before anything else.
    expect((await route.POST(request("/api/staff/accounting", { action: "add_expense", spentOn: today, amountCents: 49.99, category: "postage", vendor: "Lob", description: "", paymentMethod: "business_card" }))).status).toBe(400);
    const audit = await h.sql<{ action: string; actor_name: string }>(`select action, actor_name from public.accounting_audit where action = 'expense_added' and actor_name = 'Carmen Ruiz'`);
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("records a collections step through the member's own reading of the clients", async () => {
    const route = await import("@/app/api/staff/accounting/route");
    as(h.as(admin.userId));
    const note = await json(await route.POST(request("/api/staff/accounting", { action: "collection", chargeId: failedCharge, kind: "called", note: "Client will update the card Friday." })));
    expect(note.status).toBe(200);
    const sms = await route.POST(request("/api/staff/accounting", { action: "collection", chargeId: failedCharge, kind: "reminder_sms", note: "" }));
    expect(sms.status).toBe(400);
  });

  it("keeps a receipt (PNG) in the private bucket and refuses a file that is not a receipt", async () => {
    const route = await import("@/app/api/staff/accounting/receipt/route");
    const [lob] = await h.sql<{ id: string }>(`select id from public.expenses where vendor = 'Lob'`);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const form = (bytes: Uint8Array<ArrayBuffer>, name: string) => {
      const f = new FormData();
      f.set("expenseId", lob!.id);
      f.set("file", new File([bytes], name));
      return new Request("https://app.test/api/staff/accounting/receipt", { method: "POST", body: f, headers: { "x-forwarded-for": `10.37.0.${++ip % 250}` } });
    };
    as(h.as(ana.userId));
    expect((await route.POST(form(png, "lob.png"))).status).toBe(403);
    as(h.as(admin.userId));
    const ok = await route.POST(form(png, "lob.png"));
    expect(ok.status).toBe(200);
    expect(uploads.at(-1)).toMatchObject({ bucket: "accounting-receipts", bytes: png.length });
    const [row] = await h.sql<{ receipt_kind: string; receipt_path: string }>(`select receipt_kind, receipt_path from public.expenses where id = $1`, [lob!.id]);
    expect(row!.receipt_kind).toBe("png");
    expect(row!.receipt_path.startsWith(`${lob!.id}/`)).toBe(true);
    const html = await route.POST(form(new TextEncoder().encode("<html><body>not a receipt</body></html>") as Uint8Array<ArrayBuffer>, "x.html"));
    expect(html.status).toBe(415);
    const link = await json(await route.GET(new Request(`https://app.test/api/staff/accounting/receipt?expenseId=${lob!.id}`, { headers: { "x-forwarded-for": "10.38.0.1" } })));
    expect(String(link.body.url)).toContain("accounting-receipts/");
  });

  it("closes last month only once, with its figures, and refuses this month", async () => {
    const route = await import("@/app/api/staff/accounting/route");
    as(h.as(admin.userId));
    const again = await json(await route.POST(request("/api/staff/accounting", { action: "close_month", month: lastMonth, note: "" })));
    expect(again.status).toBe(422);
    const current = await json(await route.POST(request("/api/staff/accounting", { action: "close_month", month: thisMonth, note: "" })));
    expect(current.status).toBe(422);
    const two = addMonths(thisMonth, -2);
    const closed = await json(await route.POST(request("/api/staff/accounting", { action: "close_month", month: two, note: "Reviewed with the CPA." })));
    expect(closed.status).toBe(200);
    const [row] = await h.sql<{ totals: Record<string, number>; closed_by_name: string }>(`select totals, closed_by_name from public.month_closes where month = $1`, [two]);
    expect(row!.closed_by_name).toBe("Carmen Ruiz");
    expect(Object.keys(row!.totals)).toEqual(expect.arrayContaining(["revenueCents", "expensesCents", "netProfitCents"]));
  });
});
