import type { AccountingAction } from "./api";
import { checkClose } from "./close";
import { BLOCK_TEXT, mayRecord, type CollectionItem } from "./collections";
import { checkLegalName } from "./commissions";
import { bankFingerprint } from "./csv";
import { checkExpense, checkRecurring, CLOSED_MONTH, editableExpense, isClosed, recurringDue } from "./expenses";
import { settlementKey } from "./reconcile";
import { addMonths, dayOf, isDay, monthOf, type MonthKey } from "./periods";
import type { MonthTotals } from "./summary";
import type { AccountingBook, AuditEntry, Bilingual, Expense } from "./types";

// Every change to the books, worked out without a database: the demo applies
// it to the book kept in this browser, and the server runs the same checks
// before it writes (store.ts), with the database checking again. Each change
// adds a line to the audit trail.

export type ActionResult = { ok: true; book: AccountingBook; message?: Bilingual } | { ok: false; message: Bilingual };

export interface ActionContext {
  actor: string;
  now: Date;
  newId: () => string;
  /** The live totals of a month (for closing it). */
  totalsFor: (month: MonthKey) => MonthTotals;
  /** The collections list as it stands (for the reminder rules). */
  collections: readonly CollectionItem[];
  /** Charge id → client id, for charges that exist. */
  chargeClient: ReadonlyMap<string, string>;
}

const fail = (en: string, es: string): ActionResult => ({ ok: false, message: { en, es } });
const firstProblem = (problems: Array<{ message: Bilingual }>): ActionResult => ({ ok: false, message: problems[0]!.message });

/** The months a monthly rule may still need posting for: from its start, at most 24 back, to this month. */
export function monthsToPost(book: Pick<AccountingBook, "recurring">, now: Date): MonthKey[] {
  const current = monthOf(now);
  const earliest = book.recurring.map((r) => monthOf(r.startsOn)).sort()[0] ?? current;
  const floor = addMonths(current, -23);
  const out: MonthKey[] = [];
  for (let m = earliest < floor ? floor : earliest; m <= current; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function applyAction(book: AccountingBook, action: AccountingAction, ctx: ActionContext): ActionResult {
  const at = ctx.now.toISOString();
  const today = dayOf(ctx.now);
  const audit = (entry: Omit<AuditEntry, "id" | "at" | "actor">): AuditEntry => ({ id: ctx.newId(), at, actor: ctx.actor, ...entry });
  const done = (next: Partial<AccountingBook>, log: Omit<AuditEntry, "id" | "at" | "actor">, message?: Bilingual): ActionResult => ({
    ok: true,
    book: { ...book, ...next, audit: [audit(log), ...book.audit] },
    ...(message ? { message } : {}),
  });
  const newExpense = (fields: Pick<Expense, "spentOn" | "amountCents" | "category" | "vendor" | "description" | "paymentMethod">, extra: Partial<Expense> = {}): Expense => ({
    id: ctx.newId(),
    ...fields,
    source: "manual",
    recurringId: null,
    importId: null,
    bankFingerprint: null,
    adjustsMonth: null,
    receipt: null,
    voidedAt: null,
    voidReason: null,
    createdBy: ctx.actor,
    createdAt: at,
    ...extra,
  });

  switch (action.action) {
    case "add_expense": {
      const checked = checkExpense(action, { today, closes: book.closes });
      if (!checked.ok) return firstProblem(checked.problems);
      const expense = newExpense(checked.value);
      return done({ expenses: [expense, ...book.expenses] }, { action: "expense_added", entity: "expense", entityId: expense.id, detail: { amountCents: expense.amountCents, category: expense.category } });
    }
    case "update_expense": {
      const old = book.expenses.find((e) => e.id === action.id);
      if (!old) return fail("That expense is not in the books.", "Ese gasto no está en los libros.");
      const editable = editableExpense(old, book.closes);
      if (!editable.ok) return { ok: false, message: editable.message };
      const checked = checkExpense(action, { today, closes: book.closes });
      if (!checked.ok) return firstProblem(checked.problems);
      const next = { ...old, ...checked.value };
      return done({ expenses: book.expenses.map((e) => (e.id === old.id ? next : e)) }, { action: "expense_changed", entity: "expense", entityId: old.id, detail: { from: { amountCents: old.amountCents, category: old.category, spentOn: old.spentOn }, to: { amountCents: next.amountCents, category: next.category, spentOn: next.spentOn } } });
    }
    case "void_expense": {
      const old = book.expenses.find((e) => e.id === action.id);
      if (!old) return fail("That expense is not in the books.", "Ese gasto no está en los libros.");
      const editable = editableExpense(old, book.closes);
      if (!editable.ok) return { ok: false, message: editable.message };
      return done({ expenses: book.expenses.map((e) => (e.id === old.id ? { ...e, voidedAt: at, voidReason: action.reason.trim() } : e)) }, { action: "expense_voided", entity: "expense", entityId: old.id, detail: { reason: action.reason.trim() } });
    }
    case "add_adjustment": {
      const checked = checkExpense(action, { today, closes: book.closes, adjustment: true });
      if (!checked.ok) return firstProblem(checked.problems);
      const expense = newExpense(checked.value, { source: "adjustment", adjustsMonth: monthOf(checked.value.spentOn) });
      return done({ expenses: [expense, ...book.expenses] }, { action: "adjustment_added", entity: "expense", entityId: expense.id, detail: { month: expense.adjustsMonth, amountCents: expense.amountCents } });
    }
    case "add_recurring": {
      const checked = checkRecurring(action);
      if (!checked.ok) return firstProblem(checked.problems);
      const rule = { id: ctx.newId(), ...checked.value, active: true, createdBy: ctx.actor, createdAt: at };
      return done({ recurring: [rule, ...book.recurring] }, { action: "recurring_added", entity: "recurring", entityId: rule.id, detail: { amountCents: rule.amountCents, dayOfMonth: rule.dayOfMonth } });
    }
    case "set_recurring_active": {
      const rule = book.recurring.find((r) => r.id === action.id);
      if (!rule) return fail("That monthly expense is not in the books.", "Ese gasto mensual no está en los libros.");
      return done({ recurring: book.recurring.map((r) => (r.id === rule.id ? { ...r, active: action.active } : r)) }, { action: action.active ? "recurring_resumed" : "recurring_stopped", entity: "recurring", entityId: rule.id, detail: {} });
    }
    case "post_recurring": {
      const due = recurringDue(book.recurring, book.expenses, monthsToPost(book, ctx.now), today, book.closes);
      if (due.length === 0) return { ok: true, book, message: { en: "Nothing to post: every monthly expense is in.", es: "Nada que registrar: todos los gastos mensuales están." } };
      const posted = due.map(({ rule, spentOn }) =>
        newExpense({ spentOn, amountCents: rule.amountCents, category: rule.category, vendor: rule.vendor, description: rule.description, paymentMethod: rule.paymentMethod }, { source: "recurring", recurringId: rule.id }),
      );
      return done({ expenses: [...posted, ...book.expenses] }, { action: "recurring_posted", entity: "expense", entityId: null, detail: { count: posted.length } }, { en: `${posted.length} monthly expense(s) posted.`, es: `${posted.length} gasto(s) mensual(es) registrado(s).` });
    }
    case "import_bank": {
      if (book.imports.some((i) => i.kind === "bank_statement" && i.fileSha256 === action.fileSha256)) return fail("This exact file was already imported.", "Este mismo archivo ya se importó.");
      const prints = new Set(book.expenses.filter((e) => !e.voidedAt && e.bankFingerprint).map((e) => e.bankFingerprint!));
      const importId = ctx.newId();
      const added: Expense[] = [];
      let duplicates = 0;
      for (const l of action.lines) {
        const fp = bankFingerprint(l.day, l.amountCents, l.description);
        if (prints.has(fp) || isClosed(monthOf(l.day), book.closes) || !isDay(l.day) || l.day > today) {
          duplicates += 1;
          continue;
        }
        prints.add(fp);
        added.push(newExpense({ spentOn: l.day, amountCents: -l.amountCents, category: l.category, vendor: (l.vendor || l.description).slice(0, 120), description: l.description, paymentMethod: "business_card" }, { source: "bank_import", importId, bankFingerprint: fp }));
      }
      const record = { id: importId, kind: "bank_statement" as const, gateway: null, fileName: action.fileName, fileSha256: action.fileSha256, rowCount: action.lines.length + action.skipped, addedCount: added.length, duplicateCount: duplicates + action.skipped, createdBy: ctx.actor, createdAt: at };
      return done({ expenses: [...added, ...book.expenses], imports: [record, ...book.imports] }, { action: "bank_imported", entity: "import", entityId: importId, detail: { added: added.length, duplicates } }, { en: `${added.length} expense(s) added, ${duplicates + action.skipped} line(s) left out.`, es: `${added.length} gasto(s) agregado(s), ${duplicates + action.skipped} línea(s) sin agregar.` });
    }
    case "add_income": {
      if (!isDay(action.receivedOn) || action.receivedOn > today) return fail("Pick the day it was received (not in the future).", "Elige el día en que se recibió (no futuro).");
      if (isClosed(monthOf(action.receivedOn), book.closes)) return { ok: false, message: CLOSED_MONTH };
      const source = action.source.replace(/\s+/g, " ").trim();
      if (source.length < 2) return fail("Who paid it? (for example IdentityIQ)", "¿Quién lo pagó? (por ejemplo IdentityIQ)");
      const income = { id: ctx.newId(), kind: action.kind, source, receivedOn: action.receivedOn, amountCents: action.amountCents, note: action.note.trim(), importId: null, adjustsMonth: null, voidedAt: null, voidReason: null, createdBy: ctx.actor, createdAt: at };
      return done({ otherIncome: [income, ...book.otherIncome] }, { action: "income_added", entity: "other_income", entityId: income.id, detail: { kind: income.kind, amountCents: income.amountCents } });
    }
    case "void_income": {
      const old = book.otherIncome.find((i) => i.id === action.id);
      if (!old || old.voidedAt) return fail("That income line is not in the books.", "Esa línea de ingreso no está en los libros.");
      if (isClosed(monthOf(old.receivedOn), book.closes)) return { ok: false, message: CLOSED_MONTH };
      return done({ otherIncome: book.otherIncome.map((i) => (i.id === old.id ? { ...i, voidedAt: at, voidReason: action.reason.trim() } : i)) }, { action: "income_voided", entity: "other_income", entityId: old.id, detail: { reason: action.reason.trim() } });
    }
    case "import_settlement": {
      if (book.imports.some((i) => i.kind === "processor_settlement" && i.fileSha256 === action.fileSha256)) return fail("This exact file was already imported.", "Este mismo archivo ya se importó.");
      const known = new Set(book.settlement.map(settlementKey));
      const importId = ctx.newId();
      const fresh = action.rows.filter((r) => !known.has(settlementKey({ ...r, gateway: action.gateway })) && (known.add(settlementKey({ ...r, gateway: action.gateway })), true));
      const rows = fresh.map((r) => ({ ...r, id: ctx.newId(), importId, gateway: action.gateway }));
      const record = { id: importId, kind: "processor_settlement" as const, gateway: action.gateway, fileName: action.fileName, fileSha256: action.fileSha256, rowCount: action.rows.length, addedCount: rows.length, duplicateCount: action.rows.length - rows.length, createdBy: ctx.actor, createdAt: at };
      return done({ settlement: [...rows, ...book.settlement], imports: [record, ...book.imports] }, { action: "settlement_imported", entity: "import", entityId: importId, detail: { gateway: action.gateway, added: rows.length } }, { en: `${rows.length} processor line(s) added, ${action.rows.length - rows.length} already in.`, es: `${rows.length} línea(s) del procesador agregada(s), ${action.rows.length - rows.length} ya estaban.` });
    }
    case "decide_match": {
      if (!action.settlementRowId && !action.chargeId) return fail("Pick the line to decide on.", "Elige la línea a decidir.");
      if (action.settlementRowId && !book.settlement.some((r) => r.id === action.settlementRowId)) return fail("That processor line is not in the books.", "Esa línea del procesador no está en los libros.");
      if (action.chargeId && !ctx.chargeClient.has(action.chargeId)) return fail("That charge does not exist.", "Ese cobro no existe.");
      if (action.decision === "manual_match" && (!action.settlementRowId || !action.chargeId)) return fail("A match pairs a processor line with a charge.", "Una coincidencia une una línea del procesador con un cobro.");
      const decision = { id: ctx.newId(), settlementRowId: action.settlementRowId, chargeId: action.chargeId, decision: action.decision, note: action.note.trim(), by: ctx.actor, at };
      return done({ decisions: [decision, ...book.decisions] }, { action: "reconciliation_decided", entity: "reconciliation", entityId: decision.id, detail: { decision: decision.decision } });
    }
    case "collection": {
      const clientId = ctx.chargeClient.get(action.chargeId);
      if (!clientId) return fail("That charge does not exist.", "Ese cobro no existe.");
      const item = ctx.collections.find((c) => c.fact.id === action.chargeId);
      if (!item) return fail("That charge is not past due.", "Ese cobro no está vencido.");
      const allowed = mayRecord(item, action.kind);
      if (!allowed.ok) return { ok: false, message: BLOCK_TEXT[allowed.reasons[0]!] };
      if ((action.kind === "note" || action.kind.startsWith("decided_")) && action.note.trim().length < 5) return fail("Write a short note: what was decided and why.", "Escribe una nota corta: qué se decidió y por qué.");
      const entry = { id: ctx.newId(), chargeId: action.chargeId, clientId, kind: action.kind, note: action.note.trim(), by: ctx.actor, at };
      return done({ collectionActions: [entry, ...book.collectionActions] }, { action: `collection_${action.kind}`, entity: "charge", entityId: action.chargeId, detail: {} });
    }
    case "close_month": {
      const checked = checkClose(action.month, ctx.totalsFor(action.month), book, ctx.now);
      if (!checked.ok) return { ok: false, message: checked.message };
      const close = { month: action.month, closedAt: at, closedBy: ctx.actor, totals: checked.snapshot, note: action.note.trim() };
      return done({ closes: [close, ...book.closes] }, { action: "month_closed", entity: "month", entityId: action.month, detail: { netProfitCents: close.totals.netProfitCents } }, { en: "Month closed. Corrections from now on are adjustments.", es: "Mes cerrado. De ahora en adelante las correcciones son ajustes." });
    }
    case "set_tax_rate":
      return done({ settings: { ...book.settings, taxSetAsideBps: action.bps } }, { action: "tax_rate_set", entity: "settings", entityId: null, detail: { from: book.settings.taxSetAsideBps, to: action.bps } });
    case "partner_tax": {
      const legalName = action.legalName.trim() ? checkLegalName(action.legalName) : "";
      if (legalName === null) return fail("Write the legal name only (no tax id numbers).", "Escribe solo el nombre legal (sin números de identificación fiscal).");
      if (action.w9ReceivedOn && (!isDay(action.w9ReceivedOn) || action.w9ReceivedOn > today)) return fail("Pick the day the W-9 arrived.", "Elige el día en que llegó el W-9.");
      const info = { partnerId: action.partnerId, legalName, w9ReceivedOn: action.w9ReceivedOn, exempt: action.exempt };
      return done({ partnerTax: [info, ...book.partnerTax.filter((p) => p.partnerId !== action.partnerId)] }, { action: "partner_tax_set", entity: "partner", entityId: action.partnerId, detail: { w9: Boolean(action.w9ReceivedOn), exempt: action.exempt } });
    }
  }
}
