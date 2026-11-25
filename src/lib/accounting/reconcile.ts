import { attemptKey } from "../billing/gateway";
import { shortKey } from "../billing/gateways/shared";
import { parseDay } from "./csv";
import type { ChargeFact } from "./facts";
import { parseMoney } from "./money";
import { addDaysToDay, daysBetween, dayOf } from "./periods";
import type { Bilingual, Gateway, MatchDecision, SettlementKind, SettlementRow, SettlementStatus } from "./types";

// Reconciliation: the app's charges against the processor's own export.
//
// The processor is the record of what money really moved; the app is the
// record of what it asked for. Each processor line is matched to a charge by
// the processor's transaction id (charges.gateway_reference), else by our
// key for the attempt (NMI orderid = "<charge id>:<attempt>"; Authorize.Net
// invoiceNumber = the first 20 hex of its SHA-256), else, as a suggestion
// only, by amount within two days. What is left on either side is flagged.
//
// The export column names below are UNVERIFIED (from memory of NMI's
// transaction report and Authorize.Net's transaction search / settlement
// download); the mapping step lets a person point at the right columns, and
// the aliases are easy to extend once a real export is in hand.

export interface SettlementMapping {
  transactionId: number | null;
  orderId: number | null;
  type: number | null;
  status: number | null;
  amount: number | null;
  fee: number | null;
  date: number | null;
  batch: number | null;
}

export const SETTLEMENT_FIELDS = ["transactionId", "orderId", "type", "status", "amount", "fee", "date", "batch"] as const;

const ALIASES: Record<Gateway, Record<keyof SettlementMapping, string[]>> = {
  nmi: {
    transactionId: ["transaction_id", "transactionid", "transaction id"],
    orderId: ["order_id", "orderid", "order id"],
    type: ["action_type", "transaction_type", "type", "action"],
    status: ["condition", "status", "response_text"],
    amount: ["amount", "action_amount", "settled_amount"],
    fee: ["fee", "processor_fee", "fees"],
    date: ["settlement_date", "action_date", "date", "transaction_date"],
    batch: ["batch_id", "batch", "settlement_batch_id"],
  },
  authorize_net: {
    transactionId: ["transaction id", "trans id", "transid", "transaction_id"],
    orderId: ["invoice number", "invoice #", "invoice", "invoicenumber"],
    type: ["transaction type", "type"],
    status: ["transaction status", "status"],
    amount: ["settlement amount", "amount", "auth amount"],
    fee: ["fee", "fees"],
    date: ["settlement date time", "settlement date", "submit date/time", "submit date", "date"],
    batch: ["batch id", "settlement batch", "batch"],
  },
};

export function guessSettlementMapping(header: readonly string[], gateway: Gateway): SettlementMapping {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (names: string[]) => {
    for (const n of names) {
      const i = h.indexOf(n);
      if (i >= 0) return i;
    }
    return null;
  };
  const a = ALIASES[gateway];
  return {
    transactionId: find(a.transactionId),
    orderId: find(a.orderId),
    type: find(a.type),
    status: find(a.status),
    amount: find(a.amount),
    fee: find(a.fee),
    date: find(a.date),
    batch: find(a.batch),
  };
}

function kindOf(raw: string): SettlementKind {
  const t = raw.toLowerCase();
  if (/charge ?back|dispute|retrieval/.test(t)) return "chargeback";
  if (/return/.test(t)) return "return";
  if (/void/.test(t)) return "void";
  if (/refund|credit/.test(t)) return "refund";
  if (/fee/.test(t)) return "fee";
  if (/sale|capture|auth.*capture|purchase|settle|^$/.test(t)) return "sale";
  return "other";
}

function statusOf(raw: string): SettlementStatus {
  const t = raw.toLowerCase();
  if (/declin|fail|error|reject/.test(t)) return "declined";
  if (/void/.test(t)) return "voided";
  if (/pending|unsettled|captured pending|authorized/.test(t)) return "pending";
  if (/settled|complete|success|approved|^$/.test(t)) return "settled";
  return "other";
}

export interface ReadSettlement {
  rows: Omit<SettlementRow, "id" | "importId">[];
  problems: Array<{ line: number; message: Bilingual }>;
}

/** The processor file's lines, as the books keep them. Lines that can't be read are listed, not guessed. */
export function readSettlement(rows: string[][], m: SettlementMapping, gateway: Gateway): ReadSettlement {
  const out: ReadSettlement = { rows: [], problems: [] };
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (k: keyof SettlementMapping) => (m[k] === null ? "" : (r[m[k]!] ?? "").trim());
    const transactionId = cell("transactionId").slice(0, 120);
    const amount = parseMoney(cell("amount"));
    const day = parseDay(cell("date"));
    if (!transactionId) return out.problems.push({ line, message: { en: "No transaction id.", es: "Sin número de transacción." } });
    if (amount === null) return out.problems.push({ line, message: { en: "The amount can't be read.", es: "No se puede leer el monto." } });
    if (!day) return out.problems.push({ line, message: { en: "The date can't be read.", es: "No se puede leer la fecha." } });
    let kind = kindOf(cell("type"));
    // Some exports write a refund as a negative sale.
    if (kind === "sale" && amount < 0) kind = "refund";
    const fee = parseMoney(cell("fee"));
    out.rows.push({
      gateway,
      transactionId,
      orderId: cell("orderId").slice(0, 120) || null,
      kind,
      status: statusOf(cell("status")),
      amountCents: Math.abs(amount),
      feeCents: fee === null ? 0 : Math.abs(fee),
      settledOn: day,
      batchId: cell("batch").slice(0, 80) || null,
    });
  });
  return out;
}

// ── Matching ────────────────────────────────────────────────────────────

export type ReconStatus = "matched" | "amount_mismatch" | "processor_only" | "app_only" | "suggested" | "explained";

export const RECON_STATUS_LABEL: Record<ReconStatus, Bilingual> = {
  matched: { en: "Matched", es: "Coincide" },
  amount_mismatch: { en: "Amounts differ", es: "Montos distintos" },
  processor_only: { en: "In the processor, not in the app", es: "En el procesador, no en la app" },
  app_only: { en: "In the app, not in the processor", es: "En la app, no en el procesador" },
  suggested: { en: "Probable match (same amount, close date): confirm", es: "Posible coincidencia (mismo monto, fecha cercana): confirma" },
  explained: { en: "Explained by a person", es: "Explicado por una persona" },
};

export interface ReconLine {
  key: string;
  status: ReconStatus;
  row: SettlementRow | null;
  fact: ChargeFact | null;
  /** App amount − processor amount, for a mismatch. */
  differenceCents: number;
  decision: MatchDecision | null;
}

export interface DepositDay {
  day: string;
  batchId: string | null;
  salesCents: number;
  refundsCents: number;
  chargebacksCents: number;
  feesCents: number;
  netCents: number;
  lines: number;
}

export interface Reconciliation {
  lines: ReconLine[];
  counts: Record<ReconStatus, number>;
  feesCents: number;
  deposits: DepositDay[];
  /** The days the processor file covers (the app side is compared only inside them). */
  from: string | null;
  to: string | null;
}

/** Our keys for every attempt of a charge, as each processor carries them. */
function attemptKeys(fact: ChargeFact): Set<string> {
  const keys = new Set<string>();
  const n = Math.max(1, fact.charge.attempts);
  for (let i = 1; i <= n + 1; i++) {
    const key = attemptKey(fact.id, i);
    keys.add(key.toLowerCase());
    keys.add(shortKey(key).toLowerCase());
  }
  return keys;
}

/**
 * Processor lines against the app's real charges. A sale is compared with
 * what the app says was collected; a refund or void with the app's refund.
 * Declined and pending processor lines move no money and are not compared.
 */
export function reconcile(facts: readonly ChargeFact[], rows: readonly SettlementRow[], decisions: readonly MatchDecision[], gateway: Gateway | "all" = "all"): Reconciliation {
  const mine = rows.filter((r) => gateway === "all" || r.gateway === gateway);
  const real = facts.filter((f) => !f.test);
  const decisionFor = (rowId: string | null, chargeId: string | null) =>
    decisions.find((d) => (rowId && d.settlementRowId === rowId) || (!rowId && chargeId && d.chargeId === chargeId && !d.settlementRowId)) ?? null;
  const byRef = new Map(real.filter((f) => f.reference).map((f) => [f.reference!.toLowerCase(), f]));
  const keyIndex = new Map<string, ChargeFact>();
  for (const f of real) for (const k of attemptKeys(f)) keyIndex.set(k, f);
  const byId = new Map(real.map((f) => [f.id, f]));

  const lines: ReconLine[] = [];
  const usedSale = new Set<string>();
  const usedRefund = new Set<string>();
  const moving = mine.filter((r) => r.status === "settled" && r.kind !== "fee" && r.kind !== "other");
  const days = mine.map((r) => r.settledOn).sort();
  const from = days[0] ?? null;
  const to = days.at(-1) ?? null;

  for (const row of moving) {
    const manual = decisions.find((d) => d.settlementRowId === row.id && d.decision === "manual_match" && d.chargeId);
    let fact = manual ? (byId.get(manual.chargeId!) ?? null) : null;
    fact ??= byRef.get(row.transactionId.toLowerCase()) ?? null;
    if (!fact && row.orderId) {
      const order = row.orderId.toLowerCase();
      fact = keyIndex.get(order) ?? byId.get(order.split(":")[0]!) ?? null;
    }
    const decision = decisionFor(row.id, null);
    if (row.kind === "sale") {
      if (fact && !usedSale.has(fact.id)) {
        usedSale.add(fact.id);
        const app = fact.collectedCents;
        const diff = app - row.amountCents;
        lines.push({ key: `row:${row.id}`, status: diff === 0 ? "matched" : decision?.decision === "explained" ? "explained" : "amount_mismatch", row, fact, differenceCents: diff, decision });
        continue;
      }
      // A suggestion only: same amount, within two days, and a charge with no processor
      // reference on record (one with a reference is a different transaction).
      const near = real.find(
        (f) => !usedSale.has(f.id) && f.charge.chargedAt && f.collectedCents === row.amountCents && Math.abs(daysBetween(dayOf(f.charge.chargedAt), row.settledOn)) <= 2 && !f.reference,
      );
      lines.push({ key: `row:${row.id}`, status: decision?.decision === "explained" ? "explained" : near ? "suggested" : "processor_only", row, fact: near ?? null, differenceCents: -row.amountCents, decision });
      continue;
    }
    // Refunds, voids, chargebacks, returns: money going back.
    if (fact && !usedRefund.has(fact.id)) {
      usedRefund.add(fact.id);
      const appBack =
        row.kind === "chargeback" ? (fact.charge.chargeback?.amountCents ?? 0) : row.kind === "return" ? (fact.charge.returnCode ? fact.collectedCents || fact.amountCents : 0) : fact.charge.refund ? Math.min(fact.charge.refund.amountCents, fact.collectedCents || fact.charge.refund.amountCents) : 0;
      const diff = appBack - row.amountCents;
      lines.push({ key: `row:${row.id}`, status: diff === 0 ? "matched" : decision?.decision === "explained" ? "explained" : appBack === 0 ? "processor_only" : "amount_mismatch", row, fact, differenceCents: diff, decision });
    } else lines.push({ key: `row:${row.id}`, status: decision?.decision === "explained" ? "explained" : "processor_only", row, fact: null, differenceCents: -row.amountCents, decision });
  }

  // The app side: money the app says was taken inside the file's days, with no processor line.
  if (from && to) {
    for (const f of real) {
      if (!f.charge.chargedAt || f.collectedCents === 0 || usedSale.has(f.id)) continue;
      if (gateway !== "all" && f.gateway && f.gateway !== gateway) continue;
      const day = dayOf(f.charge.chargedAt);
      // A day of slack each side: a late-night payment settles the next day.
      if (day < addDaysToDay(from, 1) || day > addDaysToDay(to, -1)) continue;
      if (lines.some((l) => l.status === "suggested" && l.fact?.id === f.id)) continue;
      const decision = decisionFor(null, f.id);
      lines.push({ key: `charge:${f.id}`, status: decision?.decision === "explained" ? "explained" : "app_only", row: null, fact: f, differenceCents: f.collectedCents, decision });
    }
  }

  const counts = { matched: 0, amount_mismatch: 0, processor_only: 0, app_only: 0, suggested: 0, explained: 0 } as Record<ReconStatus, number>;
  for (const l of lines) counts[l.status] += 1;
  const feesCents = mine.filter((r) => r.status === "settled").reduce((a, r) => a + r.feeCents + (r.kind === "fee" ? r.amountCents : 0), 0);
  return { lines: lines.sort((a, b) => order(a.status) - order(b.status)), counts, feesCents, deposits: depositsByDay(mine), from, to };
}

const order = (s: ReconStatus) => ["amount_mismatch", "processor_only", "app_only", "suggested", "explained", "matched"].indexOf(s);

/** What the processor should have sent to the bank, by settlement day (or batch). */
export function depositsByDay(rows: readonly SettlementRow[]): DepositDay[] {
  const map = new Map<string, DepositDay>();
  for (const r of rows) {
    if (r.status !== "settled") continue;
    const key = `${r.settledOn}|${r.batchId ?? ""}`;
    const d = map.get(key) ?? { day: r.settledOn, batchId: r.batchId, salesCents: 0, refundsCents: 0, chargebacksCents: 0, feesCents: 0, netCents: 0, lines: 0 };
    if (r.kind === "sale") d.salesCents += r.amountCents;
    else if (r.kind === "refund" || r.kind === "void" || r.kind === "return") d.refundsCents += r.amountCents;
    else if (r.kind === "chargeback") d.chargebacksCents += r.amountCents;
    else if (r.kind === "fee") d.feesCents += r.amountCents;
    d.feesCents += r.feeCents;
    d.lines += 1;
    d.netCents = d.salesCents - d.refundsCents - d.chargebacksCents - d.feesCents;
    map.set(key, d);
  }
  return [...map.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/** A processor file's identity for the duplicate check: its rows' (gateway, transaction, kind). */
export function settlementKey(row: Pick<SettlementRow, "gateway" | "transactionId" | "kind">): string {
  return `${row.gateway}|${row.transactionId}|${row.kind}`;
}
