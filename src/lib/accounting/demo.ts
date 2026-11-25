import { sha256Hex } from "../agreement/sha256";
import { feeEstimateCents } from "../billing/invoices";
import { toCsv } from "../billing/invoices";
import type { StaffClient } from "../staff/types";
import type { CategoryKey, PaymentMethod } from "./categories";
import { chargeFacts } from "./facts";
import { centsToDecimal } from "./money";
import { addMonths, dayInMonth, dayOf, monthOf } from "./periods";
import { DEFAULT_SETTINGS, type AccountingBook, type ChargeMeta, type Expense, type OtherIncome, type RecurringRule } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// DEMO BOOKS. Every vendor amount below is invented for the demo, like the
// demo clients. None is a quote, a fee schedule or advice (the CSO
// registration and bond lines are examples of where those costs go, not
// what they cost). Dates count back from "now", so the demo looks the same
// whenever it is opened.
// ─────────────────────────────────────────────────────────────────────────

/** The demo charge that went through the demo gateway: a test charge, shown as excluded. */
export const DEMO_TEST_CHARGE = "c36-ch1";

export function demoChargeMeta(clients: readonly StaffClient[]): Record<string, ChargeMeta> {
  const meta: Record<string, ChargeMeta> = {};
  for (const c of clients)
    for (const ch of c.billing.charges) {
      meta[ch.id] = ch.id === DEMO_TEST_CHARGE ? { gateway: "demo", reference: `demo_${ch.id}` } : { gateway: "nmi", reference: ch.chargedAt ? `${10_400_000_000 + parseInt(sha256Hex(ch.id).slice(0, 6), 16)}` : null };
    }
  return meta;
}

export function buildDemoBook(clients: readonly StaffClient[], now: Date): AccountingBook {
  const month = monthOf(now);
  const today = dayOf(now);
  const at = (m: string, d: number) => dayInMonth(m, d);
  let n = 0;
  const id = (prefix: string) => `${prefix}-${String(++n).padStart(3, "0")}`;
  const created = new Date(now.getTime() - 86_400_000).toISOString();
  const expense = (spentOn: string, cents: number, category: CategoryKey, vendor: string, description: string, paymentMethod: PaymentMethod = "business_card", extra: Partial<Expense> = {}): Expense => ({
    id: id("demo-exp"),
    spentOn,
    amountCents: cents,
    category,
    vendor,
    description,
    paymentMethod,
    source: "manual",
    recurringId: null,
    importId: null,
    bankFingerprint: null,
    adjustsMonth: null,
    receipt: null,
    voidedAt: null,
    voidReason: null,
    createdBy: "carmen",
    createdAt: created,
    ...extra,
  });

  const rules: RecurringRule[] = [
    { vendor: "Supabase", description: "Database and sign-in (Pro plan)", category: "software", cents: 2500, day: 3 },
    { vendor: "Vercel", description: "Hosting", category: "software", cents: 2000, day: 5 },
    { vendor: "HighLevel", description: "CRM and WhatsApp inbox", category: "software", cents: 9700, day: 8 },
    { vendor: "Google Workspace", description: "Email, 2 seats", category: "software", cents: 2800, day: 1 },
    { vendor: "T-Mobile", description: "Business phone line", category: "phone_whatsapp", cents: 4500, day: 20 },
  ].map((r) => ({
    id: id("demo-rule"),
    vendor: r.vendor,
    description: r.description,
    category: r.category as CategoryKey,
    amountCents: r.cents,
    dayOfMonth: r.day,
    paymentMethod: "business_card" as const,
    startsOn: `${addMonths(month, -5)}-01`,
    endsOn: null,
    active: true,
    createdBy: "carmen",
    createdAt: created,
  }));

  const expenses: Expense[] = [];
  // The last six months, oldest first.
  for (let back = 5; back >= 0; back--) {
    const m = addMonths(month, -back);
    const last = back === 0;
    const upTo = (d: number) => !last || at(m, d) <= today;
    for (const rule of rules) {
      // This month's are left for "Post monthly expenses" once their day has come.
      if (last) continue;
      expenses.push(expense(at(m, rule.dayOfMonth), rule.amountCents, rule.category, rule.vendor, rule.description, rule.paymentMethod, { source: "recurring", recurringId: rule.id }));
    }
    const meta = [18000, 22000, 26000, 30000, 34000, 19000][5 - back]!;
    if (upTo(7)) expenses.push(expense(at(m, 7), Math.round(meta / 2), "advertising_meta", "Meta", "Lead ads to WhatsApp, first half"));
    if (upTo(21)) expenses.push(expense(at(m, 21), meta - Math.round(meta / 2), "advertising_meta", "Meta", "Lead ads to WhatsApp, second half"));
    if (back <= 3 && upTo(12)) expenses.push(expense(at(m, 12), [6000, 8000, 9000, 4500][3 - back]!, "advertising_google", "Google Ads", "Search: credit repair Houston"));
    if (back === 1 && upTo(15)) expenses.push(expense(at(m, 15), 12000, "advertising_tiktok", "TikTok for Business", "Test campaign, Spanish video"));
    if (upTo(26)) expenses.push(expense(at(m, 26), [6420, 7380, 8810, 9940, 11250, 4210][5 - back]!, "postage", "Lob", "Dispute letters, certified mail"));
    if (upTo(27) && back % 2 === 0) expenses.push(expense(at(m, 27), 2945, "postage", "USPS", "Certified mail, return receipts", "cash"));
    if (upTo(10)) expenses.push(expense(at(m, 10), 3149, "credit_monitoring", "IdentityIQ", "Test account for report imports"));
    if (upTo(28)) expenses.push(expense(at(m, 28), 1500, "bank_fees", "Chase", "Monthly maintenance fee", "bank_transfer"));
    if (!last && upTo(28)) expenses.push(expense(at(m, 28), [3480, 4310, 5120, 5870, 6440][4 - (back - 1)] ?? 4000, "processing_fees", "NMI", "Merchant statement: discount and transaction fees", "ach"));
    if (back === 4) {
      expenses.push(expense(at(m, 2), 10000, "legal_compliance", "Texas Secretary of State", "Credit services organization registration (example amount)", "business_card"));
      expenses.push(expense(at(m, 2), 25000, "legal_compliance", "Surety company", "$10,000 surety bond, yearly premium (example amount)", "business_card"));
      expenses.push(expense(at(m, 18), 75000, "legal_compliance", "Law office", "Agreement and plan review", "check"));
      expenses.push(expense(at(m, 19), 54000, "insurance", "Next Insurance", "General liability and E&O, yearly", "business_card"));
    }
    if (back === 2) expenses.push(expense(at(m, 14), 30000, "contractors", "Upwork", "Spanish ad videos, 3 edits", "business_card"));
    if (back === 1) expenses.push(expense(at(m, 9), 8999, "office_rent", "Office Depot", "Printer toner and envelopes", "business_card"));
  }
  // One expense with its receipt on file (a placeholder name; the demo keeps no file).
  const lob = expenses.filter((e) => e.vendor === "Lob").at(-2);
  if (lob) lob.receipt = { name: "lob-invoice.pdf", kind: "pdf", bytes: 48_213, ref: "", uploadedAt: created };

  const otherIncome: OtherIncome[] = [];
  for (let back = 4; back >= 1; back--) {
    const m = addMonths(month, -back);
    const count = [2, 3, 3, 4][4 - back]!;
    otherIncome.push({
      id: id("demo-inc"),
      kind: "monitoring_commission",
      source: "IdentityIQ (IDIQ)",
      receivedOn: at(m, 15),
      amountCents: count * 4000,
      note: `${count} enrollments through the partner link (example rate)`,
      importId: null,
      adjustsMonth: null,
      voidedAt: null,
      voidReason: null,
      createdBy: "carmen",
      createdAt: created,
    });
  }

  const failed = clients.flatMap((c) => c.billing.charges.filter((ch) => ch.status === "failed").map((ch) => ({ c, ch })));
  const firstFailed = failed[0];

  return {
    demo: true,
    expenses: expenses.sort((a, b) => b.spentOn.localeCompare(a.spentOn)),
    recurring: rules,
    otherIncome: otherIncome.sort((a, b) => b.receivedOn.localeCompare(a.receivedOn)),
    imports: [],
    settlement: [],
    decisions: [],
    collectionActions: firstFailed
      ? [{ id: id("demo-col"), chargeId: firstFailed.ch.id, clientId: firstFailed.c.id, kind: "called", note: "No answer. Left a voicemail asking them to update the card in the app.", by: "carmen", at: new Date(now.getTime() - 4 * 86_400_000).toISOString() }]
      : [],
    closes: [],
    audit: [],
    settings: DEFAULT_SETTINGS,
    partnerTax: [{ partnerId: "p-laura", legalName: "Laura Benítez Realty LLC", w9ReceivedOn: `${addMonths(month, -5)}-04`, exempt: false }],
    chargeMeta: demoChargeMeta(clients),
  };
}

/** The demo closes the month before last, to show what a closed month looks like. */
export const demoClosedMonth = (now: Date): string => addMonths(monthOf(now), -2);

/**
 * A sample NMI transaction export for the demo's reconciliation, made from
 * the demo charges of the last 40 days, with three differences put in on
 * purpose: a sale the app does not have, a charge the processor does not
 * show, and an amount that differs.
 */
export function demoSettlementCsv(clients: readonly StaffClient[], now: Date): string {
  const facts = chargeFacts(clients, demoChargeMeta(clients)).filter((f) => !f.test && f.charge.chargedAt && now.getTime() - Date.parse(f.charge.chargedAt) < 40 * 86_400_000);
  const rows: Array<Array<string | number>> = [];
  facts.forEach((f, i) => {
    if (i === 1) return; // in the app, not in the processor
    const day = dayOf(new Date(Date.parse(f.charge.chargedAt!) + 86_400_000));
    const amount = i === 3 ? f.collectedCents - 1000 : f.collectedCents;
    rows.push([f.reference!, `${f.id}:${f.charge.attempts}`, "sale", "complete", centsToDecimal(amount), centsToDecimal(feeEstimateCents({ ...f.charge, methodKind: f.method })), day, `B${day.replace(/-/g, "")}`]);
    if (f.charge.refund?.completedAt) {
      const back = dayOf(new Date(Date.parse(f.charge.refund.completedAt) + 86_400_000));
      rows.push([`${f.reference}R`, `${f.id}:${f.charge.attempts}`, "refund", "complete", centsToDecimal(f.charge.refund.amountCents), "0.00", back, `B${back.replace(/-/g, "")}`]);
    }
  });
  const stray = dayOf(new Date(now.getTime() - 6 * 86_400_000));
  rows.push(["10499999901", "", "sale", "complete", "89.00", "3.77", stray, `B${stray.replace(/-/g, "")}`]);
  rows.push(["10499999902", "", "sale", "failed", "89.00", "0.00", stray, ""]);
  return toCsv(["transaction_id", "order_id", "action_type", "condition", "amount", "fee", "action_date", "batch_id"], rows);
}

/** A sample bank statement for the demo's import: card purchases of this month, one already in the books, one twice. */
export function demoBankCsv(now: Date): string {
  const month = monthOf(now);
  const d = (day: number) => {
    const iso = dayInMonth(month, Math.min(day, Number(dayOf(now).slice(8))));
    const [y, m, dd] = iso.split("-");
    return `${m}/${dd}/${y}`;
  };
  return [
    "Details,Posting Date,Description,Amount,Type,Balance",
    `DEBIT,${d(1)},"GOOGLE *WORKSPACE CREDALTI",-28.00,DEBIT_CARD,10234.11`,
    `DEBIT,${d(3)},"SUPABASE PRO 8005550100",-25.00,DEBIT_CARD,10209.11`,
    `DEBIT,${d(7)},"FACEBK *ADS 6505434800 CA",-95.00,DEBIT_CARD,10019.11`,
    `DEBIT,${d(7)},"FACEBK *ADS 6505434800 CA",-95.00,DEBIT_CARD,9829.11`,
    `CREDIT,${d(9)},"NMI DEPOSIT BATCH 2241",412.65,ACH_CREDIT,10241.76`,
    `DEBIT,${d(10)},"IDENTITYIQ.COM 877-555-0142",-31.49,DEBIT_CARD,10210.27`,
    `DEBIT,${d(12)},"GOOGLE ADS 8662467521",-45.00,DEBIT_CARD,10120.27`,
    `DEBIT,${d(14)},"LOB.COM SAN FRANCISCO",-38.40,DEBIT_CARD,10081.87`,
    `DEBIT,${d(16)},"COFFEE BEAN 0042",-6.75,DEBIT_CARD,10075.12`,
  ].join("\r\n") + "\r\n";
}
