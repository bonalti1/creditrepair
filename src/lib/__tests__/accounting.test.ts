import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyAction, type ActionContext } from "../accounting/actions";
import { accountingBodySchema } from "../accounting/api";
import { bankFeedProvider, BankFeedOff } from "../accounting/bankFeeds";
import { CATEGORIES, CATEGORY_KEYS, suggestCategory } from "../accounting/categories";
import { checkClose, closeChecklist, drift } from "../accounting/close";
import { BLOCK_TEXT, collectionItems, mayRecord, reminderLinks, reminderText } from "../accounting/collections";
import { form1099List, partnerPayables } from "../accounting/commissions";
import { bankFingerprint, guessBankMapping, parseCsv, parseDay, planBankImport, readBankLines, vendorFromDescription } from "../accounting/csv";
import { buildDemoBook, demoBankCsv, demoChargeMeta, demoSettlementCsv, DEMO_TEST_CHARGE } from "../accounting/demo";
import { expensesAdSpend, unitEconomics } from "../accounting/economics";
import { checkExpense, checkReceipt, recurringDue } from "../accounting/expenses";
import { chargeFacts, maskName } from "../accounting/facts";
import { buildLedger, testChargesExcluded } from "../accounting/ledger";
import { parseMoney, parsePositiveAmount } from "../accounting/money";
import { addMonths, dayInMonth, isDay, monthEnded, monthOf, yearToDate } from "../accounting/periods";
import { guessSettlementMapping, readSettlement, reconcile } from "../accounting/reconcile";
import { accountantCsv, cashFlow, ledgerCsv, profitAndLoss } from "../accounting/reports";
import { dashboard, receivables, totalsFor, type BooksInput } from "../accounting/summary";
import { taxSetAside, upcomingDeadlines } from "../accounting/taxes";
import { EMPTY_BOOK, type AccountingBook, type Expense } from "../accounting/types";
import type { BillingCharge } from "../billing/types";
import type { CommissionRecord, Partner } from "../partners/rules";
import { buildDemoClients } from "../staff/demoClients";
import { can, rolesThatCan } from "../staff/permissions";
import type { StaffClient } from "../staff/types";

// The accounting department's rules, without a database: the one money rule,
// test charges, closed months, imports and their duplicates, reconciliation,
// collections (never SMS, opt-outs, quiet hours), "No data yet", 1099 list,
// taxes, and the migration's shape. The database side is db/accounting.test.ts.

const NOW = new Date("2026-11-20T17:00:00Z"); // 11 a.m. in Texas
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function charge(id: string, fields: Partial<BillingCharge> = {}): BillingCharge {
  return {
    id,
    roundNumber: 1,
    amountCents: 8900,
    status: "succeeded",
    workDate: ago(11),
    createdAt: ago(10),
    attempts: 1,
    lastAttemptAt: ago(10),
    nextAttemptAt: null,
    chargedAt: ago(10),
    failureCode: null,
    refund: null,
    ...fields,
  };
}

function client(id: string, charges: BillingCharge[], fields: Partial<StaffClient> = {}): StaffClient {
  return {
    id,
    firstName: "Rosa",
    lastName: "Martínez",
    phone: "+17135550142",
    state: "TX",
    addressLines: [],
    salesperson: "ana",
    createdAt: ago(60),
    signedUpAt: ago(55),
    agreementSignedAt: ago(50),
    documents: [],
    report: null,
    answers: {},
    rounds: [],
    billing: { paymentMethod: null, charges, pause: null },
    lastActivityAt: ago(1),
    notes: [],
    questions: [],
    handled: {},
    ...fields,
  } as StaffClient;
}

function expense(id: string, spentOn: string, amountCents: number, category: Expense["category"], extra: Partial<Expense> = {}): Expense {
  return { id, spentOn, amountCents, category, vendor: "Vendor", description: "", paymentMethod: "business_card", source: "manual", recurringId: null, importId: null, bankFingerprint: null, adjustsMonth: null, receipt: null, voidedAt: null, voidReason: null, createdBy: "carmen", createdAt: ago(1), ...extra };
}

let idCounter = 0;
const ctx = (book: AccountingBook, facts: ReturnType<typeof chargeFacts> = [], clients: StaffClient[] = []): ActionContext => ({
  actor: "carmen",
  now: NOW,
  newId: () => `id-${++idCounter}`,
  totalsFor: (month) => totalsFor({ facts, expenses: book.expenses, otherIncome: book.otherIncome, commissions: [], collectionActions: book.collectionActions }, [month]),
  collections: collectionItems(facts, clients, book.collectionActions, NOW),
  chargeClient: new Map(facts.map((f) => [f.id, f.clientId])),
});

describe("accounting: one money rule", () => {
  it("parses money a person or a bank wrote, in whole cents, and nothing else", () => {
    expect(parseMoney("$1,234.56")).toBe(123456);
    expect(parseMoney("-12.5")).toBe(-1250);
    expect(parseMoney("(40.00)")).toBe(-4000);
    expect(parseMoney("40.00-")).toBe(-4000);
    expect(parseMoney("USD 7")).toBe(700);
    expect(parseMoney(".5")).toBe(50);
    for (const bad of ["", "1.234", "12,34", "1,23,456", "abc", "--5", "1e3", "$-"]) expect(parseMoney(bad), bad).toBeNull();
    expect(parsePositiveAmount("0")).toBeNull();
    expect(parsePositiveAmount("1000000.01")).toBeNull();
    expect(parsePositiveAmount("49.99")).toBe(4999);
  });

  it("counts only money a processor took for a real charge; tests, declines, pending refunds and open chargebacks move nothing", () => {
    const c = client("c1", [
      charge("paid"),
      charge("credit", { creditCents: 2000 }),
      charge("refunded", { status: "refunded", refund: { id: "r", amountCents: 8900, reason: "Mailed to the wrong address.", by: "carmen", at: ago(5), completedAt: ago(4) } }),
      charge("refund-pending", { refund: { id: "r2", amountCents: 8900, reason: "Client asked for it back.", by: "carmen", at: ago(1), completedAt: null } }),
      charge("declined", { status: "failed", chargedAt: null, attempts: 2, failureCode: "card_declined", lastAttemptAt: ago(2) }),
      charge("returned", { status: "failed", chargedAt: null, returnCode: "R01", methodKind: "ach" }),
      charge("cb-open", { chargeback: { id: "cb", status: "open", reasonCode: "13.6", amountCents: 8900, receivedAt: ago(3), source: "manual", respondedAt: null } }),
      charge("cb-lost", { chargeback: { id: "cb2", status: "lost", reasonCode: "13.1", amountCents: 8900, receivedAt: ago(3), source: "webhook", respondedAt: ago(2) } }),
      charge("test-charge"),
    ]);
    const facts = chargeFacts([c], { "test-charge": { gateway: "demo", reference: "demo_1" }, paid: { gateway: "nmi", reference: "1001" } });
    expect(testChargesExcluded(facts)).toEqual({ count: 1, amountCents: 8900 });
    const ledger = buildLedger(facts, []);
    expect(ledger.some((e) => e.chargeId === "test-charge")).toBe(false);
    const month = monthOf(NOW);
    const t = totalsFor({ facts, expenses: [], otherIncome: [], commissions: [], collectionActions: [] }, [month]);
    // paid, credit (6900), refunded, refund-pending, cb-open, cb-lost = 5×8900 + 6900
    expect(t.revenueCents).toBe(5 * 8900 + 6900);
    expect(t.refundsCents).toBe(8900);
    expect(t.chargebacksCents).toBe(8900);
    expect(t.openChargebacksCents).toBe(8900);
    expect(t.failedCount).toBe(2);
    expect(t.netRevenueCents).toBe(t.revenueCents - 2 * 8900);
    expect(ledger.find((e) => e.kind === "ach_return")?.detail).toBe("R01");
    expect(ledger.filter((e) => e.amountCents === 0).map((e) => e.kind).sort()).toEqual(["ach_return", "chargeback_open", "failed_attempt", "refund_pending"]);
  });

  it("uses the processor's statement for fees when entered, the estimate otherwise, never both", () => {
    const facts = chargeFacts([client("c1", [charge("a"), charge("b")])]);
    const month = monthOf(NOW);
    const input: BooksInput = { facts, expenses: [], otherIncome: [], commissions: [], collectionActions: [] };
    const estimated = totalsFor(input, [month]);
    expect(estimated.feesEstimated).toBe(true);
    expect(estimated.feesCents).toBeGreaterThan(0);
    const measured = totalsFor({ ...input, expenses: [expense("f", dayInMonth(month, 2), 777, "processing_fees"), expense("m", dayInMonth(month, 3), 5000, "advertising_meta")] }, [month]);
    expect(measured).toMatchObject({ feesEstimated: false, feesCents: 777, expensesCents: 5000 });
    expect(measured.netProfitCents).toBe(measured.revenueCents - 777 - 5000);
    const pnl = profitAndLoss(measured);
    expect(pnl.expenseTotal).toBe(777 + 5000);
    expect(pnl.expenses.some((l) => l.estimate)).toBe(false);
    expect(cashFlow(measured).outCents).toBe(777 + 5000);
  });

  it("says there is no data instead of a $0 when nothing happened", () => {
    const d = dashboard({ facts: [], expenses: [], otherIncome: [], commissions: [], collectionActions: [] }, monthOf(NOW), NOW, false);
    expect(d.empty).toBe(true);
    expect(d.thisMonth.hasData).toBe(false);
    expect(d.partnerPayableCents).toBeNull();
  });

  it("receivable is only charges for work already done that are not collected, and a write-off leaves it", () => {
    const facts = chargeFacts([client("c1", [charge("paid"), charge("late", { status: "failed", chargedAt: null, workDate: ago(45) }), charge("new", { status: "pending", chargedAt: null, workDate: ago(1) })])]);
    const ar = receivables({ facts, collectionActions: [] }, NOW);
    expect(ar.totalCents).toBe(17800);
    expect(ar.buckets["31-60"]).toBe(8900);
    const off = receivables({ facts, collectionActions: [{ id: "x", chargeId: "late", clientId: "c1", kind: "decided_write_off", note: "Client moved abroad.", by: "carmen", at: ago(1) }] }, NOW);
    expect(off.totalCents).toBe(8900);
    expect(off.writtenOff.map((r) => r.fact.id)).toEqual(["late"]);
  });

  it("masks client names by default", () => {
    expect(maskName("María González")).toBe("M•••• G••••••");
    expect(ledgerCsv(buildLedger(chargeFacts([client("c1", [charge("a")])]), []), false)).not.toContain("Martínez");
    expect(ledgerCsv(buildLedger(chargeFacts([client("c1", [charge("a")])]), []), true)).toContain("Rosa Martínez");
  });
});

describe("accounting: expenses, monthly rules and closed months", () => {
  const month = monthOf(NOW);
  const last = addMonths(month, -1);
  const closes = [{ month: last, closedAt: ago(5), closedBy: "carmen", totals: { revenueCents: 0, refundsCents: 0, chargebacksCents: 0, otherIncomeCents: 0, expensesCents: 0, feesCents: 0, partnerCommissionsCents: 0, netProfitCents: 0 }, note: "" }];
  const today = "2026-11-20";

  it("checks an expense, refuses the future and a closed month, and takes an adjustment only there", () => {
    const base = { spentOn: today, amountCents: 4999, category: "postage", vendor: "Lob", description: "", paymentMethod: "business_card" };
    expect(checkExpense(base, { today, closes }).ok).toBe(true);
    expect(checkExpense({ ...base, spentOn: "2026-11-21" }, { today, closes }).ok).toBe(false);
    expect(checkExpense({ ...base, amountCents: 49.99 }, { today, closes }).ok).toBe(false);
    expect(checkExpense({ ...base, category: "lunch" }, { today, closes }).ok).toBe(false);
    const closed = checkExpense({ ...base, spentOn: `${last}-10` }, { today, closes });
    expect(closed.ok || closed.problems[0]!.message.en).toMatch(/closed/);
    expect(checkExpense({ ...base, spentOn: `${last}-10`, amountCents: -500, description: "Vendor credited a duplicate." }, { today, closes, adjustment: true }).ok).toBe(true);
    expect(checkExpense({ ...base, amountCents: -500, description: "Vendor credited a duplicate." }, { today, closes, adjustment: true }).ok).toBe(false);
  });

  it("the reducer refuses edits in a closed month, keeps adjustments append-only, and writes the audit", () => {
    let book: AccountingBook = { ...EMPTY_BOOK, closes, expenses: [expense("old", `${last}-10`, 1000, "software")] };
    const edit = applyAction(book, { action: "update_expense", id: "old", spentOn: `${last}-10`, amountCents: 900, category: "software", vendor: "Vendor", description: "", paymentMethod: "business_card" }, ctx(book));
    expect(edit.ok).toBe(false);
    expect(applyAction(book, { action: "void_expense", id: "old", reason: "Entered twice." }, ctx(book)).ok).toBe(false);
    const adj = applyAction(book, { action: "add_adjustment", spentOn: `${last}-10`, amountCents: -1000, category: "software", vendor: "Vendor", description: "Entered twice before the close.", paymentMethod: "business_card" }, ctx(book));
    expect(adj.ok).toBe(true);
    book = (adj as { book: AccountingBook }).book;
    const added = book.expenses.find((e) => e.source === "adjustment")!;
    expect(added).toMatchObject({ adjustsMonth: last, amountCents: -1000 });
    expect(applyAction(book, { action: "void_expense", id: added.id, reason: "Changed my mind." }, ctx(book)).ok).toBe(false);
    expect(book.audit[0]).toMatchObject({ action: "adjustment_added", actor: "carmen" });
    // The closed figures stay; the live ones move: that is the drift the report shows.
    const live = totalsFor({ facts: [], expenses: book.expenses, otherIncome: [], commissions: [], collectionActions: [] }, [last]);
    expect(drift(closes[0]!.totals, live)).toEqual({ netProfitCents: 0, changed: false });
    expect(live.expensesCents).toBe(0);
  });

  it("posts each monthly rule once per month, never in the future, never in a closed month, never twice after a bank import", () => {
    const rule = { id: "r1", vendor: "Supabase", description: "", category: "software" as const, amountCents: 2500, dayOfMonth: 31, paymentMethod: "business_card" as const, startsOn: "2026-09-01", endsOn: null, active: true, createdBy: "carmen", createdAt: ago(90) };
    const months = ["2026-09", "2026-10", "2026-11"];
    const due = recurringDue([rule], [], months, today, closes);
    // 31 → the 30th in a 30-day month; November's day has not come; October is closed.
    expect(due.map((d) => d.spentOn)).toEqual(["2026-09-30"]);
    const posted = recurringDue([rule], [expense("p", "2026-09-30", 2500, "software", { source: "recurring", recurringId: "r1" })], months, today, closes);
    expect(posted).toEqual([]);
    const later = recurringDue([{ ...rule, dayOfMonth: 3 }], [expense("b", "2026-11-03", 2500, "software", { vendor: "Supabase Pro", source: "bank_import" })], ["2026-11"], today, []);
    expect(later).toEqual([]);
  });

  it("accepts a receipt by its bytes: JPG, PNG or PDF up to 10 MB; never HEIC or HTML", () => {
    expect(checkReceipt(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toMatchObject({ ok: true, kind: "pdf" });
    expect(checkReceipt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ ok: true, kind: "jpeg" });
    expect(checkReceipt(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatchObject({ ok: true, kind: "png" });
    expect(checkReceipt(new TextEncoder().encode("<html><body>x</body></html>"))).toMatchObject({ ok: false, status: 415 });
    expect(checkReceipt(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toMatchObject({ ok: false, status: 415 });
    expect(checkReceipt(new Uint8Array(10 * 1024 * 1024 + 1))).toMatchObject({ ok: false, status: 413 });
    expect(checkReceipt(new Uint8Array())).toMatchObject({ ok: false, status: 400 });
  });
});

describe("accounting: bank statement import", () => {
  it("reads quoted CSV, guesses the columns, and keeps money in out of expenses", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDay("3/7/26")).toBe("2026-03-07");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("07 Mar 2026")).toBe("2026-03-07");
    const rows = parseCsv(demoBankCsv(NOW));
    const m = guessBankMapping(rows);
    expect(rows[m.headerRow]![m.description!]).toBe("Description");
    expect(rows[m.headerRow]![m.amount!]).toBe("Amount");
    const split = guessBankMapping([["Date", "Payee", "Withdrawal", "Deposit"], ["11/02/2026", "LOB.COM", "12.00", ""]]);
    expect(split).toMatchObject({ amount: null, debit: 2, credit: 3 });
    expect(readBankLines([["Date", "Payee", "Withdrawal", "Deposit"], ["11/02/2026", "LOB.COM", "12.00", ""]], split)[0]).toMatchObject({ amountCents: -1200, day: "2026-11-02" });
  });

  it("flags the same line twice, a line already in the books, closed months and unreadable lines", () => {
    const rows = [
      ["Date", "Description", "Amount"],
      ["11/07/2026", "FACEBK *ADS 650543", "-95.00"],
      ["11/07/2026", "FACEBK *ADS 650543", "-95.00"],
      ["11/08/2026", "META ADS", "-40.00"],
      ["11/09/2026", "NMI DEPOSIT", "412.65"],
      ["10/02/2026", "LOB.COM", "-10.00"],
      ["xx", "LOB.COM", "-10.00"],
      ["11/10/2026", "LOB.COM SAN FRANCISCO", "-38.40"],
    ];
    const existing = [expense("hand", "2026-11-09", 4000, "advertising_meta", { vendor: "Meta" })];
    const plan = planBankImport(readBankLines(rows, guessBankMapping(rows)), existing, [{ month: "2026-10", closedAt: ago(10), closedBy: "carmen", totals: {} as never, note: "" }]);
    expect(plan.map((l) => l.status)).toEqual(["new", "duplicate_file", "duplicate_books", "inflow", "closed_month", "invalid", "new"]);
    expect(plan[0]!.suggested).toBe("advertising_meta");
    expect(plan[6]!.suggested).toBe("postage");
    expect(vendorFromDescription("POS PURCHASE LOB.COM SAN FRANCISCO")).toBe("Lob.com San Francisco");
    expect(bankFingerprint("2026-11-07", -9500, "FACEBK *ADS 650543 CA")).toBe(bankFingerprint("2026-11-07", -9500, "facebk  *ads 6505434800 ca"));
  });

  it("the import adds each line once, refuses the same file twice, and records the import", () => {
    const action = { action: "import_bank" as const, fileName: "nov.csv", fileSha256: "a".repeat(64), lines: [{ line: 2, day: "2026-11-10", description: "LOB.COM", vendor: "Lob.com", amountCents: -3840, category: "postage" as const }], skipped: 3 };
    const first = applyAction(EMPTY_BOOK, action, ctx(EMPTY_BOOK));
    expect(first.ok).toBe(true);
    const book = (first as { book: AccountingBook }).book;
    expect(book.expenses[0]).toMatchObject({ amountCents: 3840, source: "bank_import", category: "postage" });
    expect(book.imports[0]).toMatchObject({ addedCount: 1, duplicateCount: 3 });
    expect(applyAction(book, action, ctx(book)).ok).toBe(false);
    const again = applyAction(book, { ...action, fileSha256: "b".repeat(64) }, ctx(book));
    expect((again as { book: AccountingBook }).book.expenses).toHaveLength(1);
  });

  it("has no bank feed turned on, and the placeholder makes no call", async () => {
    expect(bankFeedProvider(undefined)).toMatchObject({ id: "none", enabled: false });
    expect(bankFeedProvider("plaid").enabled).toBe(false);
    await expect(bankFeedProvider("plaid").listTransactions("2026-11-01", "2026-11-30")).rejects.toBeInstanceOf(BankFeedOff);
    expect(readFileSync("src/lib/accounting/bankFeeds.ts", "utf8")).not.toMatch(/fetch\(|https?:\/\//);
  });
});

describe("accounting: reconciliation", () => {
  const clients = buildDemoClients(NOW);
  const meta = demoChargeMeta(clients);
  const facts = chargeFacts(clients, meta);

  it("reads the processor's export and flags each kind of difference", () => {
    const rows = parseCsv(demoSettlementCsv(clients, NOW));
    const mapping = guessSettlementMapping(rows[0]!, "nmi");
    expect(mapping.transactionId).toBe(0);
    const read = readSettlement(rows, mapping, "nmi");
    expect(read.problems).toEqual([]);
    const settlement = read.rows.map((r, i) => ({ ...r, id: `s${i}`, importId: "imp" }));
    const recon = reconcile(facts, settlement, []);
    expect(recon.counts.matched).toBeGreaterThan(3);
    expect(recon.counts.amount_mismatch).toBe(1);
    expect(recon.counts.processor_only).toBe(1);
    expect(recon.counts.app_only).toBe(1);
    expect(recon.lines.find((l) => l.status === "amount_mismatch")!.differenceCents).toBe(1000);
    expect(recon.feesCents).toBeGreaterThan(0);
    expect(recon.deposits[0]!.netCents).toBe(recon.deposits[0]!.salesCents - recon.deposits[0]!.refundsCents - recon.deposits[0]!.chargebacksCents - recon.deposits[0]!.feesCents);
    // A test charge is never expected at the processor.
    expect(recon.lines.some((l) => l.fact?.id === DEMO_TEST_CHARGE)).toBe(false);
    // A person explains a difference: it stops asking.
    const odd = recon.lines.find((l) => l.status === "processor_only")!;
    const explained = reconcile(facts, settlement, [{ id: "d", settlementRowId: odd.row!.id, chargeId: null, decision: "explained", note: "Charged by hand in the processor.", by: "carmen", at: ago(0) }]);
    expect(explained.counts.processor_only).toBe(0);
    expect(explained.counts.explained).toBe(1);
  });

  it("matches by our attempt key when the processor's reference is not on the charge", () => {
    const f = chargeFacts([client("c1", [charge("11111111-2222-4333-8444-555555555555")])]);
    const row = { id: "r", importId: "i", gateway: "nmi" as const, transactionId: "999", orderId: "11111111-2222-4333-8444-555555555555:1", kind: "sale" as const, status: "settled" as const, amountCents: 8900, feeCents: 0, settledOn: f[0]!.charge.chargedAt!.slice(0, 10), batchId: null };
    expect(reconcile(f, [row], []).counts.matched).toBe(1);
  });
});

describe("accounting: collections", () => {
  const failed = charge("ch-f", { status: "failed", chargedAt: null, attempts: 3, failureCode: "card_declined", lastAttemptAt: ago(6) });

  it("lists only unpaid charges, drafts the reminder in the client's language, and never offers SMS", () => {
    const c = client("c1", [charge("paid"), failed], { locale: "es", email: "rosa@example.com" });
    const items = collectionItems(chargeFacts([c]), [c], [], NOW);
    expect(items.map((i) => i.fact.id)).toEqual(["ch-f"]);
    expect(items[0]!.standing).toBe("needs_person");
    expect(reminderText(c, items[0]!.fact).body).toMatch(/^Hola Rosa/);
    const links = reminderLinks(c, items[0]!.fact);
    expect(links.whatsapp).toMatch(/^https:\/\/wa\.me\/17135550142\?text=/);
    expect(links.email).toMatch(/^mailto:/);
    expect(mayRecord(items[0]!, "reminder_whatsapp").ok).toBe(true);
    expect(accountingBodySchema.safeParse({ action: "collection", chargeId: "ch-f", kind: "reminder_sms", note: "" }).success).toBe(false);
    expect(readFileSync("supabase/migrations/0036_accounting.sql", "utf8")).not.toMatch(/'reminder_sms'|'sms'/);
  });

  it("blocks reminders after an opt-out, after a cancellation or a request to end, in quiet hours, and within 3 days of the last", () => {
    const at = (iso: string) => collectionItems(chargeFacts([client("c1", [failed])]), [client("c1", [failed])], [], new Date(iso))[0]!;
    expect(at("2026-11-21T04:00:00Z").whatsappBlocks).toContain("quiet_hours"); // 10 p.m. in Texas
    expect(at("2026-11-20T17:00:00Z").whatsappBlocks).toEqual([]);
    const optedOut = client("c1", [failed], { optOut: { at: ago(2), keyword: "STOP", channel: "whatsapp" } });
    expect(collectionItems(chargeFacts([optedOut]), [optedOut], [], NOW)[0]!.whatsappBlocks).toContain("opted_out");
    const ended = client("c1", [failed], { serviceEndRequestedAt: ago(1) });
    expect(collectionItems(chargeFacts([ended]), [ended], [], NOW)[0]!.emailBlocks).toEqual(expect.arrayContaining(["service_end", "no_email"]));
    const recent = collectionItems(chargeFacts([client("c1", [failed])]), [client("c1", [failed])], [{ id: "a", chargeId: "ch-f", clientId: "c1", kind: "reminder_whatsapp", note: "", by: "carmen", at: ago(1) }], NOW)[0]!;
    expect(mayRecord(recent, "reminder_whatsapp")).toEqual({ ok: false, reasons: ["recent_reminder"] });
    // A person's decision is always theirs, with a note.
    const c = client("c1", [failed]);
    const facts = chargeFacts([c]);
    expect(applyAction(EMPTY_BOOK, { action: "collection", chargeId: "ch-f", kind: "decided_write_off", note: "" }, ctx(EMPTY_BOOK, facts, [c])).ok).toBe(false);
    expect(applyAction(EMPTY_BOOK, { action: "collection", chargeId: "ch-f", kind: "decided_write_off", note: "Client passed away; family informed." }, ctx(EMPTY_BOOK, facts, [c])).ok).toBe(true);
    expect(applyAction(EMPTY_BOOK, { action: "collection", chargeId: "ch-f", kind: "reminder_whatsapp", note: "" }, ctx(EMPTY_BOOK, chargeFacts([optedOut]), [optedOut]))).toMatchObject({ ok: false, message: BLOCK_TEXT.opted_out });
  });
});

describe("accounting: unit economics, commissions, taxes, close", () => {
  it("unit economics: no ad spend, no cost per lead; nobody left, no lifetime", () => {
    const c = client("c1", [charge("a", { chargedAt: ago(40) }), charge("b")], { createdAt: ago(20), agreementSignedAt: ago(15) });
    const none = unitEconomics([c], chargeFacts([c]), expensesAdSpend([]), NOW, 90);
    expect(none.costPerLeadCents.value).toBeNull();
    expect(none.costPerLeadCents.missing?.en).toMatch(/No data yet/);
    expect(none.lifetimeValueCents.value).toBeNull();
    const spend = unitEconomics([c], chargeFacts([c]), expensesAdSpend([expense("m", "2026-11-01", 30000, "advertising_meta"), expense("s", "2026-11-01", 999, "software")]), NOW, 90);
    expect(spend).toMatchObject({ adSpendCents: 30000, leads: 1, signed: 1 });
    expect(spend.costPerLeadCents.value).toBe(30000);
    expect(spend.revenuePerClientCents.value).toBe(17800);
    expect(spend.paybackMonths.value).not.toBeNull();
  });

  it("1099-NEC: partners paid $600 or more in the calendar year, with the W-9 status", () => {
    const partner = (id: string, name: string) => ({ id, name, company: null, kind: "realtor", phone: "+17135550161", email: null, state: "TX", status: "approved", referralCode: id, salesperson: null, commissionBasis: "signed_client", commissionCents: 10000, commissionNote: null, appliedAt: ago(300), decidedAt: ago(290) }) as Partner;
    const rec = (partnerId: string, kind: "owed" | "paid", cents: number, at: string): CommissionRecord => ({ id: `${partnerId}-${at}-${kind}`, partnerId, kind, amountCents: cents, referralId: null, note: null, recordedAt: at, recordedBy: "carmen" });
    const partners = [partner("p1", "Laura"), partner("p2", "Jorge")];
    const records = [rec("p1", "owed", 70000, "2026-02-01T12:00:00Z"), rec("p1", "paid", 60000, "2026-06-01T12:00:00Z"), rec("p2", "paid", 59999, "2026-06-01T12:00:00Z"), rec("p2", "paid", 50000, "2025-12-31T12:00:00Z")];
    expect(partnerPayables(partners, records).find((p) => p.partner.id === "p1")).toMatchObject({ owedCents: 70000, paidCents: 60000, balanceCents: 10000 });
    const list = form1099List(partners, records, [], 2026);
    expect(list.map((l) => l.partner.id)).toEqual(["p1"]);
    expect(list[0]!.todo?.en).toMatch(/W-9/);
    const ready = form1099List(partners, records, [{ partnerId: "p1", legalName: "Laura Realty LLC", w9ReceivedOn: "2026-01-05", exempt: false }], 2026);
    expect(ready[0]).toMatchObject({ legalName: "Laura Realty LLC", todo: null });
    expect(applyAction(EMPTY_BOOK, { action: "partner_tax", partnerId: "p1", legalName: "Laura 123-45-6789", w9ReceivedOn: null, exempt: false }, ctx(EMPTY_BOOK)).ok).toBe(false);
  });

  it("taxes: the owner's percentage of profit so far, never below zero; the usual dates, off weekends", () => {
    expect(taxSetAside(1_000_000, 2500)).toBe(250_000);
    expect(taxSetAside(-50_000, 2500)).toBe(0);
    const dates = upcomingDeadlines("2026-11-25");
    expect(dates[0]!.due).toBe("2027-01-15");
    expect(dates.map((d) => d.title.en).join(" ")).toMatch(/Texas franchise tax report 2027/);
    // 2027-05-15 is a Saturday: moved to Monday.
    expect(dates.find((d) => d.title.en.startsWith("Texas franchise"))!.due).toBe("2027-05-17");
    for (const d of dates) expect([0, 6]).not.toContain(new Date(`${d.due}T12:00:00Z`).getUTCDay());
  });

  it("a month closes once it is over, with its figures; the checklist is advice", () => {
    const t = totalsFor({ facts: [], expenses: [], otherIncome: [], commissions: [], collectionActions: [] }, ["2026-11"]);
    expect(checkClose("2026-11", t, EMPTY_BOOK, NOW).ok).toBe(false);
    expect(checkClose("2026-10", t, EMPTY_BOOK, NOW).ok).toBe(true);
    expect(monthEnded("2026-10", NOW)).toBe(true);
    const closed = applyAction(EMPTY_BOOK, { action: "close_month", month: "2026-10", note: "" }, ctx(EMPTY_BOOK));
    expect(closed.ok).toBe(true);
    const book = (closed as { book: AccountingBook }).book;
    expect(applyAction(book, { action: "close_month", month: "2026-10", note: "" }, ctx(book)).ok).toBe(false);
    expect(applyAction(book, { action: "add_expense", spentOn: "2026-10-05", amountCents: 100, category: "other", vendor: "Late", description: "", paymentMethod: "cash" }, ctx(book)).ok).toBe(false);
    expect(closeChecklist("2026-10", book, null, "2026-11-20").find((c) => c.key === "recon")!.done).toBe(false);
  });

  it("periods: Texas months, real days, the year so far", () => {
    expect(monthOf("2026-11-01T03:00:00Z")).toBe("2026-10"); // 10 p.m. on Oct 31 in Texas
    expect(isDay("2026-02-29")).toBe(false);
    expect(yearToDate("2026-03")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("accounting: files for the accountant", () => {
  it("writes the QuickBooks / Xero file with signed amounts, accounts, classes, no names and no formulas", () => {
    const c = client("c1", [charge("a", { invoiceNumber: "INV-2026-000001" })]);
    const csv = accountantCsv(buildLedger(chargeFacts([c]), []), [expense("e", "2026-11-03", 2500, "software", { vendor: "=HYPERLINK(evil)" })], ["2026-11"]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Account,Description,Amount,Class");
    expect(csv).toContain("Sales:Credit Repair Services");
    expect(csv).toContain("-25.00");
    expect(csv).toContain("89.00");
    expect(csv).not.toContain("Martínez");
    expect(csv).toMatch(/'=HYPERLINK/);
    expect(lines[1]).toMatch(/^11\/03\/2026,/);
  });
});

describe("accounting: who may open it, and the database's shape", () => {
  it("is the owner's and administrators': not sales, not specialists", () => {
    expect(rolesThatCan("accounting")).toEqual(["admin"]);
    expect(can("sales", "accounting")).toBe(false);
    expect(can("specialist", "accounting")).toBe(false);
  });

  it("seeds the same categories the code has, and every policy is read-only for accounting staff", () => {
    const sql = readFileSync("supabase/migrations/0036_accounting.sql", "utf8");
    const seeded = [...sql.matchAll(/^  \('([a-z_]+)', '(advertising|operations|people|compliance|financial|other)', '/gm)].map((m) => [m[1], m[2]]);
    expect(seeded).toEqual(CATEGORIES.map((c) => [c.key, c.group]));
    expect(CATEGORY_KEYS.length).toBe(17);
    const policies = sql.match(/create policy[^;]+;/g) ?? [];
    expect(policies.length).toBe(12);
    for (const p of policies) {
      expect(p).toMatch(/for select using \(public\.staff_can_see_accounting\(\)\)/);
      expect(p).not.toMatch(/for (all|insert|update|delete)|with check/);
    }
    // Billing enforcement is untouched: no billing table, trigger or function is altered here.
    expect(sql).not.toMatch(/alter table public\.(charges|refunds|chargebacks|payment_returns)|create or replace function public\.(charges|refunds|billing)/);
    expect(readFileSync("supabase/setup.sql", "utf8")).toContain("-- ===== 0036_accounting.sql =====");
  });

  it("suggests categories from bank words, and the demo books are consistent", () => {
    expect(suggestCategory("FACEBK *ADS")).toBe("advertising_meta");
    expect(suggestCategory("IDENTITYIQ.COM")).toBe("credit_monitoring");
    expect(suggestCategory("Chase monthly maintenance fee")).toBe("bank_fees");
    expect(suggestCategory("Coffee")).toBeNull();
    const clients = buildDemoClients(NOW);
    const book = buildDemoBook(clients, NOW);
    expect(book.demo).toBe(true);
    for (const e of book.expenses) expect(Number.isInteger(e.amountCents) && e.amountCents > 0 && e.spentOn <= "2026-11-20").toBe(true);
    expect(chargeFacts(clients, book.chargeMeta).filter((f) => f.test).map((f) => f.id)).toEqual([DEMO_TEST_CHARGE]);
  });
});
