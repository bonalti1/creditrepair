import type { CategoryKey, PaymentMethod } from "./categories";
import type { MonthKey } from "./periods";

// The accounting department's own records (migration 0036). Income from
// clients is NOT here: it is read from the billing records as they are
// (charges, refunds, chargebacks, returns), so the books can never disagree
// with billing. What is here is what billing does not know: what the company
// spent, money from elsewhere (monitoring commissions), the processor's own
// files, decisions people made, and closed months.
//
// Money is whole cents. Calendar days are "YYYY-MM-DD" (Texas), instants ISO.

export type ExpenseSource = "manual" | "recurring" | "bank_import" | "adjustment";

export type ReceiptKind = "pdf" | "jpeg" | "png";

export interface ReceiptInfo {
  name: string;
  kind: ReceiptKind;
  bytes: number;
  /** Storage path with a database; a data: URL in the demo (this browser only). */
  ref: string;
  uploadedAt: string;
}

export interface Expense {
  id: string;
  /** The day the money went out (Texas calendar day). */
  spentOn: string;
  /** Positive. Only an adjustment to a closed month may be negative. */
  amountCents: number;
  category: CategoryKey;
  vendor: string;
  description: string;
  paymentMethod: PaymentMethod;
  source: ExpenseSource;
  recurringId: string | null;
  importId: string | null;
  /** A bank line's fingerprint (date|amount|words), to find the same line imported twice. */
  bankFingerprint: string | null;
  /** An adjustment: the closed month it corrects. */
  adjustsMonth: MonthKey | null;
  receipt: ReceiptInfo | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdBy: string;
  createdAt: string;
}

/** A monthly expense rule: the same amount on the same day each month (software, rent, the bond premium spread). */
export interface RecurringRule {
  id: string;
  vendor: string;
  description: string;
  category: CategoryKey;
  amountCents: number;
  /** 1–31; a short month uses its last day. */
  dayOfMonth: number;
  paymentMethod: PaymentMethod;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export type OtherIncomeKind = "monitoring_commission" | "other";

/** Money that did not come from a client's charge: IdentityIQ's referral commissions, interest, other. */
export interface OtherIncome {
  id: string;
  kind: OtherIncomeKind;
  /** "IdentityIQ (IDIQ)" */
  source: string;
  receivedOn: string;
  amountCents: number;
  note: string;
  importId: string | null;
  adjustsMonth: MonthKey | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdBy: string;
  createdAt: string;
}

export type ImportKind = "bank_statement" | "processor_settlement" | "other_income";

export interface ImportRecord {
  id: string;
  kind: ImportKind;
  gateway: Gateway | null;
  fileName: string;
  /** SHA-256 of the file: the same file twice is refused. */
  fileSha256: string;
  rowCount: number;
  addedCount: number;
  duplicateCount: number;
  createdBy: string;
  createdAt: string;
}

export type Gateway = "nmi" | "authorize_net";

export type SettlementKind = "sale" | "refund" | "void" | "chargeback" | "return" | "fee" | "other";
export type SettlementStatus = "settled" | "declined" | "voided" | "pending" | "other";

/** One line of a processor's transaction or settlement export. */
export interface SettlementRow {
  id: string;
  importId: string;
  gateway: Gateway;
  transactionId: string;
  /** NMI's orderid / Authorize.Net's invoice number: our key for the attempt. */
  orderId: string | null;
  kind: SettlementKind;
  status: SettlementStatus;
  /** Always positive; the kind says which way it went. */
  amountCents: number;
  /** What the processor kept on this line, when the file says. */
  feeCents: number;
  /** The day it settled (or was submitted, when the file has no settlement date). */
  settledOn: string;
  batchId: string | null;
}

export type MatchDecisionKind = "manual_match" | "explained";

/** A person's decision on a reconciliation line: paired by hand, or a difference explained. */
export interface MatchDecision {
  id: string;
  settlementRowId: string | null;
  chargeId: string | null;
  decision: MatchDecisionKind;
  note: string;
  by: string;
  at: string;
}

/** Reminders are WhatsApp or email only. There is no SMS kind, here or in the database. */
export const COLLECTION_ACTION_KINDS = ["reminder_whatsapp", "reminder_email", "called", "note", "decided_wait", "decided_write_off", "decided_pause"] as const;
export type CollectionActionKind = (typeof COLLECTION_ACTION_KINDS)[number];

export interface CollectionAction {
  id: string;
  chargeId: string;
  clientId: string;
  kind: CollectionActionKind;
  note: string;
  by: string;
  at: string;
}

/** What a closed month looked like when it was closed. */
export interface MonthTotalsSnapshot {
  revenueCents: number;
  refundsCents: number;
  chargebacksCents: number;
  otherIncomeCents: number;
  expensesCents: number;
  feesCents: number;
  partnerCommissionsCents: number;
  netProfitCents: number;
}

export interface MonthClose {
  month: MonthKey;
  closedAt: string;
  closedBy: string;
  totals: MonthTotalsSnapshot;
  note: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: Record<string, unknown>;
}

export interface AccountingSettings {
  /** The share of profit to put aside for taxes, in basis points (2500 = 25%). The owner sets it. */
  taxSetAsideBps: number;
  /** Bank feeds: off ("none") until the owner connects a provider. */
  bankFeedProvider: "none" | "plaid";
}

export const DEFAULT_SETTINGS: AccountingSettings = { taxSetAsideBps: 2500, bankFeedProvider: "none" };

/** What the books need to file a 1099-NEC for a partner. Never the TIN itself: only whether the W-9 is on file. */
export interface PartnerTaxInfo {
  partnerId: string;
  legalName: string;
  w9ReceivedOn: string | null;
  /** Exempt from 1099-NEC (for example a corporation, per the W-9). The CPA confirms. */
  exempt: boolean;
}

/** What billing knows about a charge that the console's client list does not carry. */
export interface ChargeMeta {
  gateway: string | null;
  reference: string | null;
}

/** Everything the accounting screens read besides the clients. */
export interface AccountingBook {
  demo: boolean;
  expenses: Expense[];
  recurring: RecurringRule[];
  otherIncome: OtherIncome[];
  imports: ImportRecord[];
  settlement: SettlementRow[];
  decisions: MatchDecision[];
  collectionActions: CollectionAction[];
  closes: MonthClose[];
  audit: AuditEntry[];
  settings: AccountingSettings;
  partnerTax: PartnerTaxInfo[];
  /** charge id → processor and reference. */
  chargeMeta: Record<string, ChargeMeta>;
}

export const EMPTY_BOOK: AccountingBook = {
  demo: false,
  expenses: [],
  recurring: [],
  otherIncome: [],
  imports: [],
  settlement: [],
  decisions: [],
  collectionActions: [],
  closes: [],
  audit: [],
  settings: DEFAULT_SETTINGS,
  partnerTax: [],
  chargeMeta: {},
};

export type Bilingual = { en: string; es: string };
