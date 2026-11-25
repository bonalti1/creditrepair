import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommissionRecord } from "../partners/rules";
import type { StaffClient } from "../staff/types";
import { applyAction, type ActionResult } from "./actions";
import type { AccountingAction } from "./api";
import { isCategoryKey, isPaymentMethod, type CategoryKey, type PaymentMethod } from "./categories";
import { collectionItems } from "./collections";
import { checkReceipt, RECEIPT_BUCKET } from "./expenses";
import { chargeFacts } from "./facts";
import { totalsFor } from "./summary";
import {
  DEFAULT_SETTINGS,
  type AccountingBook,
  type AuditEntry,
  type Bilingual,
  type ChargeMeta,
  type CollectionAction,
  type Expense,
  type ImportRecord,
  type MatchDecision,
  type MonthClose,
  type OtherIncome,
  type PartnerTaxInfo,
  type RecurringRule,
  type SettlementRow,
} from "./types";

// The books in the database (migration 0036), for /api/staff/accounting.
// The service role reads and writes, and only after the route checked
// requireCapability('accounting'). Every change is worked out by the same pure
// function the demo uses (actions.ts applyAction) on the books as they are
// now; this file only writes what it produced. The database checks again
// (closed months, append-only records, no reminder to a client who opted out).

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : "");
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : "");
const orNull = <T>(v: T | null | undefined | "") => (v === undefined || v === "" ? null : v);

export interface Actor {
  userId: string;
  name: string;
}

async function all(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

export function expenseFromRow(r: Row): Expense {
  return {
    id: text(r.id),
    spentOn: day(r.spent_on),
    amountCents: Number(r.amount_cents),
    category: (isCategoryKey(r.category_key) ? r.category_key : "other") as CategoryKey,
    vendor: text(r.vendor),
    description: text(r.description),
    paymentMethod: (isPaymentMethod(r.payment_method) ? r.payment_method : "other") as PaymentMethod,
    source: (["manual", "recurring", "bank_import", "adjustment"].includes(text(r.source)) ? r.source : "manual") as Expense["source"],
    recurringId: orNull(text(r.recurring_id)),
    importId: orNull(text(r.import_id)),
    bankFingerprint: orNull(text(r.bank_fingerprint)),
    adjustsMonth: orNull(text(r.adjusts_month)),
    receipt: r.receipt_path
      ? { name: text(r.receipt_name) || "receipt", kind: r.receipt_kind as "pdf" | "jpeg" | "png", bytes: Number(r.receipt_bytes), ref: text(r.receipt_path), uploadedAt: iso(r.receipt_uploaded_at ?? r.created_at) }
      : null,
    voidedAt: r.voided_at ? iso(r.voided_at) : null,
    voidReason: orNull(text(r.void_reason)),
    createdBy: text(r.created_by_name),
    createdAt: iso(r.created_at),
  };
}

function rowOfExpense(e: Expense, actor: Actor): Row {
  return {
    id: e.id,
    spent_on: e.spentOn,
    amount_cents: e.amountCents,
    category_key: e.category,
    vendor: e.vendor,
    description: e.description,
    payment_method: e.paymentMethod,
    source: e.source,
    recurring_id: e.recurringId,
    import_id: e.importId,
    bank_fingerprint: e.bankFingerprint,
    adjusts_month: e.adjustsMonth,
    created_by: actor.userId,
    created_by_name: actor.name.slice(0, 80),
  };
}

/** Everything the accounting screens read besides the clients (which come through the member's own connection). */
export async function loadBook(db: SupabaseClient): Promise<AccountingBook> {
  const [expenses, recurring, income, imports, settlement, decisions, actions, closes, audit, settings, tax, charges] = await Promise.all([
    all(db.from("expenses").select("*").order("spent_on", { ascending: false }).limit(10000), "expenses"),
    all(db.from("accounting_recurring").select("*").order("created_at", { ascending: false }), "accounting_recurring"),
    all(db.from("other_income").select("*").order("received_on", { ascending: false }).limit(5000), "other_income"),
    all(db.from("accounting_imports").select("*").order("created_at", { ascending: false }).limit(500), "accounting_imports"),
    all(db.from("settlement_rows").select("*").order("settled_on", { ascending: false }).limit(10000), "settlement_rows"),
    all(db.from("reconciliation_matches").select("*").order("decided_at", { ascending: false }), "reconciliation_matches"),
    all(db.from("collection_actions").select("*").order("at", { ascending: false }).limit(5000), "collection_actions"),
    all(db.from("month_closes").select("*").order("month", { ascending: false }), "month_closes"),
    all(db.from("accounting_audit").select("*").order("at", { ascending: false }).limit(300), "accounting_audit"),
    all(db.from("accounting_settings").select("*").eq("id", true), "accounting_settings"),
    all(db.from("partner_tax_info").select("*"), "partner_tax_info"),
    all(db.from("charges").select("id, gateway, gateway_reference"), "charges"),
  ]);
  const s = settings[0];
  const chargeMeta: Record<string, ChargeMeta> = {};
  for (const c of charges) chargeMeta[text(c.id)] = { gateway: orNull(text(c.gateway)), reference: orNull(text(c.gateway_reference)) };
  return {
    demo: false,
    expenses: expenses.map(expenseFromRow),
    recurring: recurring.map(
      (r): RecurringRule => ({
        id: text(r.id),
        vendor: text(r.vendor),
        description: text(r.description),
        category: (isCategoryKey(r.category_key) ? r.category_key : "other") as CategoryKey,
        amountCents: Number(r.amount_cents),
        dayOfMonth: Number(r.day_of_month),
        paymentMethod: (isPaymentMethod(r.payment_method) ? r.payment_method : "other") as PaymentMethod,
        startsOn: day(r.starts_on),
        endsOn: r.ends_on ? day(r.ends_on) : null,
        active: r.active === true,
        createdBy: text(r.created_by_name),
        createdAt: iso(r.created_at),
      }),
    ),
    otherIncome: income.map(
      (r): OtherIncome => ({
        id: text(r.id),
        kind: r.kind === "monitoring_commission" ? "monitoring_commission" : "other",
        source: text(r.source),
        receivedOn: day(r.received_on),
        amountCents: Number(r.amount_cents),
        note: text(r.note),
        importId: orNull(text(r.import_id)),
        adjustsMonth: orNull(text(r.adjusts_month)),
        voidedAt: r.voided_at ? iso(r.voided_at) : null,
        voidReason: orNull(text(r.void_reason)),
        createdBy: text(r.created_by_name),
        createdAt: iso(r.created_at),
      }),
    ),
    imports: imports.map(
      (r): ImportRecord => ({
        id: text(r.id),
        kind: r.kind as ImportRecord["kind"],
        gateway: (orNull(text(r.gateway)) as ImportRecord["gateway"]) ?? null,
        fileName: text(r.file_name),
        fileSha256: text(r.file_sha256),
        rowCount: Number(r.row_count),
        addedCount: Number(r.added_count),
        duplicateCount: Number(r.duplicate_count),
        createdBy: text(r.created_by_name),
        createdAt: iso(r.created_at),
      }),
    ),
    settlement: settlement.map(
      (r): SettlementRow => ({
        id: text(r.id),
        importId: text(r.import_id),
        gateway: r.gateway as SettlementRow["gateway"],
        transactionId: text(r.transaction_id),
        orderId: orNull(text(r.order_id)),
        kind: r.kind as SettlementRow["kind"],
        status: r.status as SettlementRow["status"],
        amountCents: Number(r.amount_cents),
        feeCents: Number(r.fee_cents),
        settledOn: day(r.settled_on),
        batchId: orNull(text(r.batch_id)),
      }),
    ),
    decisions: decisions.map(
      (r): MatchDecision => ({ id: text(r.id), settlementRowId: orNull(text(r.settlement_row_id)), chargeId: orNull(text(r.charge_id)), decision: r.decision as MatchDecision["decision"], note: text(r.note), by: text(r.decided_by_name), at: iso(r.decided_at) }),
    ),
    collectionActions: actions.map((r): CollectionAction => ({ id: text(r.id), chargeId: text(r.charge_id), clientId: text(r.user_id), kind: r.kind as CollectionAction["kind"], note: text(r.note), by: text(r.by_name), at: iso(r.at) })),
    closes: closes.map((r): MonthClose => ({ month: text(r.month), closedAt: iso(r.closed_at), closedBy: text(r.closed_by_name), totals: r.totals as MonthClose["totals"], note: text(r.note) })),
    audit: audit.map((r): AuditEntry => ({ id: text(r.id), at: iso(r.at), actor: text(r.actor_name), action: text(r.action), entity: text(r.entity), entityId: orNull(text(r.entity_id)), detail: (r.detail as Record<string, unknown>) ?? {} })),
    settings: s ? { taxSetAsideBps: Number(s.tax_set_aside_bps), bankFeedProvider: s.bank_feed_provider === "plaid" ? "plaid" : "none" } : DEFAULT_SETTINGS,
    partnerTax: tax.map((r): PartnerTaxInfo => ({ partnerId: text(r.partner_id), legalName: text(r.legal_name), w9ReceivedOn: r.w9_received_on ? day(r.w9_received_on) : null, exempt: r.exempt === true })),
    chargeMeta,
  };
}

/** Partner commission records, read with the service role (the switch is enforced where they are written). */
export async function loadCommissions(db: SupabaseClient): Promise<CommissionRecord[]> {
  const rows = await all(db.from("partner_commissions").select("*"), "partner_commissions");
  return rows.map((r) => ({
    id: text(r.id),
    partnerId: text(r.partner_id),
    kind: r.kind === "paid" ? "paid" : "owed",
    amountCents: Number(r.amount_cents),
    referralId: orNull(text(r.referral_id)),
    note: orNull(text(r.note)),
    recordedAt: iso(r.recorded_at),
    recordedBy: text(r.recorded_by_name),
  }));
}

export type StoreResult = { ok: true; message?: Bilingual } | { ok: false; status: number; message: Bilingual };

const dbFail = (error: { message: string }): StoreResult => ({ ok: false, status: 409, message: { en: `The database refused it: ${error.message}`, es: `La base de datos lo rechazó: ${error.message}` } });

async function write(query: PromiseLike<{ error: { message: string } | null }>): Promise<{ message: string } | null> {
  const { error } = await query;
  return error;
}

/**
 * One change to the books. `clients` are the console's clients as this
 * member reads them (their own connection): needed to close a month (its
 * figures) and for a collections step (the client's opt-out and the rules).
 */
export async function runAction(db: SupabaseClient, action: AccountingAction, actor: Actor, clients: readonly StaffClient[] | null, now = new Date()): Promise<StoreResult> {
  const book = await loadBook(db);
  const facts = chargeFacts(clients ?? [], book.chargeMeta);
  const commissions = action.action === "close_month" ? await loadCommissions(db) : [];
  const result: ActionResult = applyAction(book, action, {
    actor: actor.name,
    now,
    newId: randomUUID,
    totalsFor: (month) => totalsFor({ facts, expenses: book.expenses, otherIncome: book.otherIncome, commissions, collectionActions: book.collectionActions }, [month]),
    collections: collectionItems(facts, clients ?? [], book.collectionActions, now),
    chargeClient: new Map(clients ? facts.map((f) => [f.id, f.clientId]) : Object.keys(book.chargeMeta).map((id) => [id, ""])),
  });
  if (!result.ok) return { ok: false, status: 422, message: result.message };
  const next = result.book;
  const by = actor.name.slice(0, 80);
  const oldIds = new Set(book.expenses.map((e) => e.id));
  const newExpenses = next.expenses.filter((e) => !oldIds.has(e.id));
  let error: { message: string } | null = null;

  switch (action.action) {
    case "add_expense":
    case "add_adjustment":
    case "post_recurring":
      if (newExpenses.length) error = await write(db.from("expenses").insert(newExpenses.map((e) => rowOfExpense(e, actor))));
      break;
    case "import_bank": {
      const record = next.imports[0]!;
      error = await write(db.from("accounting_imports").insert({ id: record.id, kind: record.kind, gateway: null, file_name: record.fileName, file_sha256: record.fileSha256, row_count: record.rowCount, added_count: record.addedCount, duplicate_count: record.duplicateCount, created_by: actor.userId, created_by_name: by }));
      if (!error && newExpenses.length) error = await write(db.from("expenses").insert(newExpenses.map((e) => rowOfExpense(e, actor))));
      break;
    }
    case "update_expense": {
      const e = next.expenses.find((x) => x.id === action.id)!;
      error = await write(db.from("expenses").update({ spent_on: e.spentOn, amount_cents: e.amountCents, category_key: e.category, vendor: e.vendor, description: e.description, payment_method: e.paymentMethod }).eq("id", e.id));
      break;
    }
    case "void_expense": {
      const e = next.expenses.find((x) => x.id === action.id)!;
      error = await write(db.from("expenses").update({ voided_at: e.voidedAt, void_reason: e.voidReason }).eq("id", e.id));
      break;
    }
    case "add_recurring": {
      const r = next.recurring[0]!;
      error = await write(db.from("accounting_recurring").insert({ id: r.id, vendor: r.vendor, description: r.description, category_key: r.category, amount_cents: r.amountCents, day_of_month: r.dayOfMonth, payment_method: r.paymentMethod, starts_on: r.startsOn, ends_on: r.endsOn, created_by: actor.userId, created_by_name: by }));
      break;
    }
    case "set_recurring_active":
      error = await write(db.from("accounting_recurring").update({ active: action.active }).eq("id", action.id));
      break;
    case "add_income": {
      const i = next.otherIncome[0]!;
      error = await write(db.from("other_income").insert({ id: i.id, kind: i.kind, source: i.source, received_on: i.receivedOn, amount_cents: i.amountCents, note: i.note, created_by: actor.userId, created_by_name: by }));
      break;
    }
    case "void_income": {
      const i = next.otherIncome.find((x) => x.id === action.id)!;
      error = await write(db.from("other_income").update({ voided_at: i.voidedAt, void_reason: i.voidReason }).eq("id", i.id));
      break;
    }
    case "import_settlement": {
      const record = next.imports[0]!;
      error = await write(db.from("accounting_imports").insert({ id: record.id, kind: record.kind, gateway: record.gateway, file_name: record.fileName, file_sha256: record.fileSha256, row_count: record.rowCount, added_count: record.addedCount, duplicate_count: record.duplicateCount, created_by: actor.userId, created_by_name: by }));
      const rows = next.settlement.filter((r) => r.importId === record.id);
      if (!error && rows.length)
        error = await write(
          db.from("settlement_rows").upsert(
            rows.map((r) => ({ id: r.id, import_id: r.importId, gateway: r.gateway, transaction_id: r.transactionId, order_id: r.orderId, kind: r.kind, status: r.status, amount_cents: r.amountCents, fee_cents: r.feeCents, settled_on: r.settledOn, batch_id: r.batchId })),
            { onConflict: "gateway,transaction_id,kind", ignoreDuplicates: true },
          ),
        );
      break;
    }
    case "decide_match": {
      const d = next.decisions[0]!;
      error = await write(db.from("reconciliation_matches").insert({ id: d.id, settlement_row_id: d.settlementRowId, charge_id: d.chargeId, decision: d.decision, note: d.note, decided_by: actor.userId, decided_by_name: by }));
      break;
    }
    case "collection": {
      const c = next.collectionActions[0]!;
      error = await write(db.from("collection_actions").insert({ id: c.id, charge_id: c.chargeId, user_id: c.clientId, kind: c.kind, note: c.note, by_user: actor.userId, by_name: by }));
      break;
    }
    case "close_month": {
      const c = next.closes[0]!;
      error = await write(db.from("month_closes").insert({ month: c.month, closed_by: actor.userId, closed_by_name: by, totals: c.totals, note: c.note }));
      break;
    }
    case "set_tax_rate":
      error = await write(db.from("accounting_settings").update({ tax_set_aside_bps: action.bps, updated_at: now.toISOString(), updated_by: actor.userId }).eq("id", true));
      break;
    case "partner_tax": {
      const p = next.partnerTax[0]!;
      error = await write(db.from("partner_tax_info").upsert({ partner_id: p.partnerId, legal_name: p.legalName, w9_received_on: p.w9ReceivedOn, exempt: p.exempt, updated_at: now.toISOString(), updated_by: actor.userId }));
      break;
    }
  }
  if (error) return dbFail(error);
  const log = next.audit.filter((a) => !book.audit.some((b) => b.id === a.id));
  if (log.length) {
    const auditError = await write(
      db.from("accounting_audit").insert(log.map((a) => ({ id: a.id, actor: actor.userId, actor_name: by, action: a.action, entity: a.entity, entity_id: a.entityId, detail: a.detail }))),
    );
    if (auditError) return dbFail(auditError);
  }
  return { ok: true, ...(result.message ? { message: result.message } : {}) };
}

// ── Receipts ────────────────────────────────────────────────────────────

/** Keep a receipt for an expense in the private bucket and note it on the expense. */
export async function attachReceipt(db: SupabaseClient, expenseId: string, bytes: Uint8Array, fileName: string | null, actor: Actor): Promise<StoreResult> {
  const check = checkReceipt(bytes);
  if (!check.ok) return { ok: false, status: check.status, message: check.message };
  const rows = await all(db.from("expenses").select("id, voided_at").eq("id", expenseId), "expenses");
  if (!rows[0]) return { ok: false, status: 404, message: { en: "That expense is not in the books.", es: "Ese gasto no está en los libros." } };
  if (rows[0].voided_at) return { ok: false, status: 409, message: { en: "This expense was voided.", es: "Este gasto fue anulado." } };
  const path = `${expenseId}/${randomUUID()}.${check.extension}`;
  const { error: upload } = await db.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: check.mediaType, upsert: false });
  if (upload) return { ok: false, status: 502, message: { en: "The receipt could not be saved. Try again.", es: "No se pudo guardar el recibo. Inténtalo de nuevo." } };
  const name = (fileName ?? `receipt.${check.extension}`).replace(/[^\w .()-]/g, "_").slice(0, 200);
  const error = await write(db.from("expenses").update({ receipt_path: path, receipt_kind: check.kind, receipt_bytes: bytes.length, receipt_name: name, receipt_uploaded_at: new Date().toISOString() }).eq("id", expenseId));
  if (error) return dbFail(error);
  await write(db.from("accounting_audit").insert({ actor: actor.userId, actor_name: actor.name.slice(0, 80), action: "receipt_attached", entity: "expense", entity_id: expenseId, detail: { kind: check.kind, bytes: bytes.length } }));
  return { ok: true };
}

/** A link to the receipt that works for two minutes. */
export async function receiptLink(db: SupabaseClient, expenseId: string): Promise<string | null> {
  const rows = await all(db.from("expenses").select("receipt_path").eq("id", expenseId), "expenses");
  const path = rows[0]?.receipt_path;
  if (typeof path !== "string") return null;
  const { data } = await db.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
}
