import type { SupabaseClient } from "@supabase/supabase-js";
import { loadGoverningAgreementRow, notifyTeam } from "../agreement/server";
import { agreementFromRow, type AgreementState } from "../agreement/record";
import { BRAND } from "../brand";
import { isOptedOut, queueStatus } from "../autopilot/store";
import { sendWhatsAppText } from "../integrations/whatsapp";
import { reportError } from "../observability/errors";
import type { AuthorizationTerms } from "./authorization";
import { runClientBilling, type ChargeStore, type ClientBillingReport, type PaymentHandle } from "./collect";
import { paymentFailedMessage, paymentMethodNeededMessage } from "./dunning";
import type { PaymentGateway } from "./gateway";
import { receiptFor, receiptMessage } from "./receipts";
import { readPlanSnapshot } from "./plans";
import { billingDay, CHARGE_DELAY_DAYS, formatCents } from "./rules";
import { recordResolution } from "../autopilot/resolutions";
import type {
  BillableRound,
  BillingAccount,
  BillingCharge,
  BillingContext,
  BillingRefund,
  BillingSwitches,
  ChargeStatus,
  ChargeUnit,
  ChargebackSummary,
  L,
  MailingWork,
  MethodKind,
  PaymentMethodSummary,
  ProvenResult,
} from "./types";

// Billing against the database (migration 0011). Reads map rows to the types
// the pure rules work on; the one write path that asks for money is
// runBillingForUser, which is runClientBilling (collect.ts) with the database
// as its store. Every write uses the service role: clients and staff have no
// write policy on any billing table.

type Row = Record<string, unknown>;

const iso = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const STATUSES: readonly ChargeStatus[] = ["pending", "succeeded", "failed", "refunded"];
const BUREAU_SHORT: Record<string, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

// ── Rows → types ────────────────────────────────────────────────────────

export function refundFromRow(row: Row): BillingRefund {
  return {
    id: text(row.id),
    amountCents: Number(row.amount_cents),
    reason: text(row.reason),
    by: text(row.requested_by_name) || "equipo",
    at: iso(row.created_at) ?? "",
    completedAt: iso(row.completed_at),
    kind: row.kind === "void" ? "void" : "refund",
  };
}

const UNITS: readonly ChargeUnit[] = ["round", "period", "installment", "flat", "results", "first_work", "diy_period", "mailing"];

export function chargebackFromRow(row: Row): ChargebackSummary {
  const status = row.status === "won" || row.status === "lost" || row.status === "accepted" ? row.status : "open";
  return {
    id: text(row.id),
    status,
    reasonCode: text(row.reason_code) || null,
    amountCents: Number(row.amount_cents),
    receivedAt: iso(row.received_at) ?? "",
    source: row.source === "webhook" ? "webhook" : "manual",
    respondedAt: iso(row.responded_at),
  };
}

export function chargeFromRow(row: Row, refund: Row | null | undefined = null, chargeback: Row | null | undefined = null): BillingCharge {
  const status = STATUSES.find((s) => s === row.status) ?? "pending";
  const unit = UNITS.find((u) => u === row.unit);
  return {
    id: text(row.id),
    roundNumber: Number(row.round_number),
    amountCents: Number(row.amount_cents),
    status,
    workDate: iso(row.work_date) ?? "",
    createdAt: iso(row.created_at) ?? "",
    attempts: Number(row.attempts ?? 0),
    lastAttemptAt: iso(row.last_attempt_at),
    nextAttemptAt: iso(row.next_attempt_at),
    chargedAt: iso(row.charged_at),
    failureCode: text(row.failure_code) || null,
    refund: refund ? refundFromRow(refund) : null,
    ...(unit ? { unit } : {}),
    ...(row.plan_type ? { planType: row.plan_type as BillingCharge["planType"] } : {}),
    ...(row.period_start ? { periodStart: iso(row.period_start), periodEnd: iso(row.period_end) } : {}),
    ...(row.installment_number ? { installmentNumber: Number(row.installment_number) } : {}),
    ...(row.first_work_cents !== undefined ? { firstWorkCents: Number(row.first_work_cents ?? 0) } : {}),
    ...(row.credit_cents !== undefined ? { creditCents: Number(row.credit_cents ?? 0) } : {}),
    ...(Array.isArray(row.result_item_ids) && row.result_item_ids.length > 0 ? { resultItemIds: (row.result_item_ids as unknown[]).map(String) } : {}),
    ...(row.invoice_number ? { invoiceNumber: text(row.invoice_number) } : {}),
    ...(row.method_kind ? { methodKind: (row.method_kind === "ach" ? "ach" : "card") as MethodKind } : {}),
    ...(row.return_code ? { returnCode: text(row.return_code) } : {}),
    ...(chargeback ? { chargeback: chargebackFromRow(chargeback) } : {}),
    ...(row.mail_request_id ? { mailRequestId: text(row.mail_request_id) } : {}),
    ...(row.agreement_id ? { agreementId: text(row.agreement_id) } : {}),
  };
}

/** A "Mail them for me" request (mail_requests, migration 0042) as billing reads it. */
export function mailingFromRow(row: Row, roundNumber: number, letters: Row[]): MailingWork {
  const ids = Array.isArray(row.letter_ids) ? (row.letter_ids as unknown[]).map(String) : [];
  const mine = letters.filter((l) => ids.includes(text(l.id)));
  const status = row.status === "mailed" || row.status === "cancelled" ? row.status : "requested";
  return {
    id: text(row.id),
    roundNumber,
    letterCount: Number(row.letter_count ?? ids.length),
    feeCents: Number(row.fee_cents ?? 0),
    totalCents: Number(row.total_cents ?? 0),
    status,
    requestedAt: iso(row.accepted_at) ?? iso(row.created_at) ?? "",
    mailedAt: iso(row.mailed_at),
    allReturned: mine.length > 0 && mine.every((l) => l.status === "failed" || l.mail_status === "returned" || l.mail_status === "undeliverable"),
    agreementId: text(row.agreement_id) || null,
  };
}

export function paymentMethodFromRow(row: Row): PaymentMethodSummary {
  return {
    brand: text(row.brand),
    last4: text(row.last4),
    addedAt: iso(row.created_at) ?? "",
    authorizationVersion: text(row.authorization_version),
    authorizedAt: iso(row.authorized_at) ?? "",
    ...(row.kind ? { kind: (row.kind === "ach" ? "ach" : "card") as MethodKind } : {}),
  };
}

/**
 * A round and its letters as billing reads them. A letter counts as returned
 * when the mail service failed it, or when the post office returned it or
 * could not deliver it (letters.mail_status, written by the Lob tracking
 * webhook: migration 0013). A round whose letters ALL came back is not
 * charged without a person (rules.ts: all_letters_returned).
 */
export function billableRoundFromRows(round: Row, letters: Row[]): BillableRound {
  const mailedAt = iso(round.mailed_at);
  return {
    number: Number(round.round_number),
    mailed: (round.status === "mailed" || round.status === "complete") && mailedAt !== null,
    mailedAt,
    letters: letters
      .filter((letter) => letter.status !== "draft")
      .map((letter) => ({
        recipient:
          letter.target_type === "bureau" && BUREAU_SHORT[text(letter.target_key)]
            ? BUREAU_SHORT[text(letter.target_key)]!
            : text(letter.target_name),
        returned: letter.status === "failed" || letter.mail_status === "returned" || letter.mail_status === "undeliverable",
      })),
  };
}

// ── Loading ─────────────────────────────────────────────────────────────

export interface LoadedBilling {
  context: BillingContext;
  agreement: AgreementState | null;
  /** The business facts of the SIGNED agreement, for the authorization text. */
  authorizationTerms: AuthorizationTerms;
  /** Round number → attack_rounds.id. */
  roundIds: Map<number, string>;
  /** The method in use, or null. */
  paymentMethodId: string | null;
  /** The processor's handles. Loaded only when asked for, and only the service role can read them. */
  handle: PaymentHandle | null;
}

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

/**
 * One client's billing. With the client's own (cookie-bound) connection, row
 * level security shows them their own rows, hides the pause note and the
 * token vault. With the service role and `withHandle`, the processor's
 * handles are loaded too, for the collection run.
 */
export async function loadBilling(db: SupabaseClient, userId: string, options: { withHandle?: boolean } = {}): Promise<LoadedBilling> {
  const [agreementRow, roundRows, letterRows, methodRows, chargeRows, refundRows, pauseRows] = await Promise.all([
    loadGoverningAgreementRow(db, userId),
    rows(db.from("attack_rounds").select("id, round_number, status, mailed_at").eq("user_id", userId), "attack_rounds"),
    rows(db.from("letters").select("id, round_id, target_type, target_key, target_name, status, mail_status").eq("user_id", userId), "letters"),
    rows(db.from("payment_methods").select("*").eq("user_id", userId).is("removed_at", null).limit(1), "payment_methods"),
    rows(db.from("charges").select("*").eq("user_id", userId).order("work_date", { ascending: true }), "charges"),
    rows(db.from("refunds").select("*").eq("user_id", userId), "refunds"),
    rows(db.from("billing_pauses").select("reason, paused_by_name, created_at").eq("user_id", userId).is("lifted_at", null).limit(1), "billing_pauses"),
  ]);

  const agreement = agreementRow ? agreementFromRow(agreementRow) : null;
  const refundByCharge = new Map(refundRows.map((row) => [text(row.charge_id), row]));
  const lettersByRound = new Map<string, Row[]>();
  for (const letter of letterRows) {
    const list = lettersByRound.get(text(letter.round_id)) ?? [];
    list.push(letter);
    lettersByRound.set(text(letter.round_id), list);
  }
  const method = methodRows[0] ?? null;
  const pause = pauseRows[0] ?? null;

  const account: BillingAccount = {
    paymentMethod: method ? paymentMethodFromRow(method) : null,
    charges: chargeRows.map((row) => chargeFromRow(row, refundByCharge.get(text(row.id)))),
    pause: pause ? { at: iso(pause.created_at) ?? "", by: text(pause.paused_by_name) || "equipo", reason: text(pause.reason) } : null,
  };

  let handle: PaymentHandle | null = null;
  if (options.withHandle && method) {
    const vault = await rows(
      db.from("payment_method_vault").select("customer_ref, payment_method_ref").eq("payment_method_id", text(method.id)).limit(1),
      "payment_method_vault",
    );
    if (vault[0]) handle = { customerRef: text(vault[0].customer_ref), paymentMethodRef: text(vault[0].payment_method_ref), methodKind: method.kind === "ach" ? "ach" : "card" };
  }

  const terms = agreement?.signedAt ? agreement.terms : null;
  const plan = readPlanSnapshot((terms as { plan?: unknown } | null)?.plan);
  const chargebacks = chargeRows.length > 0 ? await optionalRows(db.from("chargebacks").select("*").eq("user_id", userId)) : [];
  if (chargebacks.length > 0) {
    const byCharge = new Map(chargebacks.map((row) => [text(row.charge_id), row]));
    account.charges = chargeRows.map((row) => chargeFromRow(row, refundByCharge.get(text(row.id)), byCharge.get(text(row.id))));
  }
  const switches = plan ? await loadSwitches(db) : undefined;
  const creditBalanceCents = switches?.referralCredits ? await creditBalance(db, userId) : 0;
  const results = plan?.terms.type === "pay_per_delete" ? await loadProvenResults(db, userId, roundRows, letterRows) : undefined;
  // Credalti DIY: the mailings the client asked for (migration 0042).
  const roundNumberOf = new Map(roundRows.map((r) => [text(r.id), Number(r.round_number)]));
  const mailings =
    plan?.terms.type === "diy_subscription"
      ? (await optionalRows(db.from("mail_requests").select("*").eq("user_id", userId))).map((m) => mailingFromRow(m, roundNumberOf.get(text(m.round_id)) ?? 0, letterRows))
      : undefined;
  return {
    agreement,
    authorizationTerms: {
      companyLegalName: terms?.companyLegalName ?? null,
      companyEmail: terms?.companyEmail ?? null,
      monthlyFee: terms?.monthlyFee ?? null,
      ...(plan ? { plan } : {}),
    },
    context: {
      agreement,
      // The fee the client SIGNED, from the snapshot kept with the signature. Never today's configuration.
      signedMonthlyFee: terms?.monthlyFee ?? null,
      rounds: roundRows.map((round) => billableRoundFromRows(round, lettersByRound.get(text(round.id)) ?? [])),
      account,
      ...(plan ? { plan, switches, creditBalanceCents, ...(results ? { results } : {}), ...(mailings ? { mailings } : {}) } : {}),
      ...(agreementRow?.id ? { agreementId: text(agreementRow.id) } : {}),
    },
    roundIds: new Map(roundRows.map((round) => [Number(round.round_number), text(round.id)])),
    paymentMethodId: method ? text(method.id) : null,
    handle,
  };
}

/** Rows from a table a reader may not see (row level security): none, rather than an error. */
async function optionalRows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await query;
  return error ? [] : ((data as Row[] | null) ?? []);
}

/** The attorney-approved switches (migration 0026). Off when they cannot be read. */
export async function loadSwitches(db: SupabaseClient): Promise<BillingSwitches> {
  const read = async (name: string) => {
    const { data, error } = await db.rpc("billing_switch_on", { name });
    return !error && data === true;
  };
  const [payPerDelete, referralCredits] = await Promise.all([read("pay_per_delete"), read("referral_credits")]);
  return { payPerDelete, referralCredits };
}

async function creditBalance(db: SupabaseClient, userId: string): Promise<number> {
  const credits = await optionalRows(db.from("client_credits").select("cents").eq("user_id", userId));
  return credits.reduce((n, row) => n + Number(row.cents ?? 0), 0);
}

const BUREAU_LABEL: Record<string, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

/**
 * Pay per delete: each item disputed through us (a letter of a mailed round
 * names it) that a later report proved gone (item_results). The rule and the
 * trigger decide what may be charged; this only reads.
 */
export async function loadProvenResults(db: SupabaseClient, userId: string, roundRows: Row[], letterRows: Row[]): Promise<ProvenResult[]> {
  const proofs = await optionalRows(db.from("item_results").select("item_id, outcome, proof_pull_id").eq("user_id", userId));
  if (proofs.length === 0) return [];
  const itemIds = [...new Set(proofs.map((p) => text(p.item_id)))];
  const letterIds = letterRows.filter((l) => l.status === "queued" || l.status === "mailed" || l.status === "delivered").map((l) => text(l.id));
  const [pulls, items, links] = await Promise.all([
    optionalRows(db.from("report_pulls").select("id, pulled_at").eq("user_id", userId)),
    optionalRows(db.from("report_items").select("id, bureau, name, status, last_seen_pull").in("id", itemIds)),
    letterIds.length === 0 ? Promise.resolve([] as Row[]) : optionalRows(db.from("letter_items").select("letter_id, item_id").in("letter_id", letterIds).in("item_id", itemIds)),
  ]);
  const pulledAt = new Map(pulls.map((p) => [text(p.id), iso(p.pulled_at)]));
  const roundOfLetter = new Map(letterRows.map((l) => [text(l.id), text(l.round_id)]));
  const round = new Map(roundRows.map((r) => [text(r.id), r]));
  const out: ProvenResult[] = [];
  for (const item of items) {
    const id = text(item.id);
    const disputes = links
      .filter((l) => text(l.item_id) === id)
      .map((l) => round.get(roundOfLetter.get(text(l.letter_id)) ?? ""))
      .filter((r): r is Row => Boolean(r && (r.status === "mailed" || r.status === "complete") && iso(r.mailed_at)))
      .sort((a, b) => text(a.mailed_at).localeCompare(text(b.mailed_at)));
    const dispute = disputes[0];
    if (!dispute) continue;
    const disputedAt = iso(dispute.mailed_at)!;
    const lastSeen = pulledAt.get(text(item.last_seen_pull)) ?? null;
    for (const proof of proofs.filter((p) => text(p.item_id) === id)) {
      const provedAt = pulledAt.get(text(proof.proof_pull_id));
      if (!provedAt || provedAt <= disputedAt) continue;
      const outcome = proof.outcome === "updated" ? "updated" : "deleted";
      out.push({
        itemId: id,
        label: `${BUREAU_LABEL[text(item.bureau)] ?? text(item.bureau)} · ${text(item.name)}`,
        outcome,
        disputedRound: Number(dispute.round_number),
        disputedAt,
        provedAt,
        stillGone: outcome === "updated" || (item.status === "deleted" && (!lastSeen || lastSeen < provedAt)),
      });
      break;
    }
  }
  return out;
}

// ── The store the collection code writes through ────────────────────────

/**
 * The database as a ChargeStore. createCharge only inserts (user, round,
 * amount): the trigger in migration 0011 checks the work and the agreement,
 * and fills in the round number, the work date and the agreement. If the
 * database refuses, no processor is ever asked.
 */
export function databaseChargeStore(
  db: SupabaseClient,
  userId: string,
  roundIds: Map<number, string>,
  gatewayName: string,
  methodKind: MethodKind = "card",
): ChargeStore {
  return {
    async createCharge({ roundNumber, amountCents, unit, firstWorkCents, creditCents, resultItemIds, mailRequestId }) {
      const roundless = unit === "results" || unit === "diy_period";
      const roundId = roundless ? null : roundIds.get(roundNumber);
      if (!roundless && !roundId) return { created: false, reason: `round ${roundNumber} has no row` };
      // The work and the amount; the trigger fills in the rest (work date, period, installment, invoice) and refuses anything else.
      const row: Record<string, unknown> = { user_id: userId, round_id: roundId, amount_cents: amountCents };
      if (unit) {
        row.unit = unit;
        row.first_work_cents = firstWorkCents ?? 0;
        row.credit_cents = creditCents ?? 0;
        if (unit === "results") row.result_item_ids = resultItemIds ?? [];
        if (unit === "mailing") row.mail_request_id = mailRequestId ?? null;
      }
      const { data, error } = await db.from("charges").insert(row).select("*").single();
      if (error || !data) return { created: false, reason: error?.message ?? "insert returned no row" };
      return { created: true, charge: chargeFromRow(data as Row) };
    },
    async saveAttempt(charge, gatewayReference) {
      const { error } = await db
        .from("charges")
        .update({
          status: charge.status,
          attempts: charge.attempts,
          last_attempt_at: charge.lastAttemptAt,
          next_attempt_at: charge.nextAttemptAt,
          charged_at: charge.chargedAt,
          failure_code: charge.failureCode,
          gateway: gatewayName,
          method_kind: methodKind,
          ...(gatewayReference ? { gateway_reference: gatewayReference } : {}),
        })
        .eq("id", charge.id);
      // If this write is lost after the processor took the money, the row still
      // shows the attempt as not made; the next run sends the SAME idempotency
      // key and the processor answers with the same charge, which is then saved.
      if (error) throw new Error(`charges: could not save attempt: ${error.message}`);
    },
  };
}

// ── Telling people ──────────────────────────────────────────────────────

/**
 * A notice to the client: a line in their in-app thread, and WhatsApp when
 * there is a number and the client has not opted out of automatic messages.
 * `whatsapp: false` when the message goes through the autopilot's outbound
 * log instead (the receipt).
 */
async function tellClient(db: SupabaseClient, userId: string, message: { es: string; en: string }, context: string, options: { whatsapp?: boolean } = {}): Promise<void> {
  try {
    const { data: profile } = await db.from("profiles").select("phone_e164, locale").eq("id", userId).maybeSingle();
    const locale: L = profile?.locale === "es" ? "es" : "en";
    const body = message[locale];
    await db.from("chat_messages").insert({ user_id: userId, channel: "app", role: "assistant", source: "journey", body });
    if (options.whatsapp !== false && profile?.phone_e164 && !(await isOptedOut(db, userId))) await sendWhatsAppText(profile.phone_e164 as string, body, context);
  } catch (error) {
    // A notice that could not be sent must not undo a recorded charge.
    await reportError(error, { where: context, userId });
  }
}

/** Tell the team once about something only a person can settle (keyed, so the hourly run does not repeat it). */
async function tellTeamOnce(db: SupabaseClient, userId: string, key: string, message: string): Promise<void> {
  const { data } = await db.from("events").select("id").eq("user_id", userId).eq("kind", "billing_needs_person").eq("payload->>key", key).limit(1);
  if (data && data.length > 0) return;
  await db.from("events").insert({ user_id: userId, kind: "billing_needs_person", payload: { key } });
  await notifyTeam(message);
}

async function firstName(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data?.full_name as string | undefined)?.trim().split(/\s+/)[0] || null;
}

// ── The run ─────────────────────────────────────────────────────────────

export interface UserBillingSummary {
  userId: string;
  paid: number;
  declined: number;
  exhausted: number;
  errors: number;
  /** Why no new charge was created, when none was. */
  notCharged: string | null;
  needsPerson: boolean;
}

/**
 * Everything billing does for one client now: retry what is due, then create
 * and collect the next charge if the rule allows it, record it and tell
 * whoever needs to know. Used by the cron route for every client with
 * something to look at, and right after a client puts a new payment method on
 * file, so that paying resumes the case at once.
 */
export async function runBillingForUser(
  db: SupabaseClient,
  gateway: PaymentGateway,
  userId: string,
  now: Date,
  options: { afterCardUpdate?: boolean } = {},
): Promise<UserBillingSummary> {
  const loaded = await loadBilling(db, userId, { withHandle: true });
  const store = databaseChargeStore(db, userId, loaded.roundIds, gateway.name, loaded.context.account.paymentMethod?.kind ?? "card");
  const report: ClientBillingReport = await runClientBilling({ gateway, store }, loaded.context, loaded.handle, now);
  const summary: UserBillingSummary = {
    userId,
    paid: 0,
    declined: 0,
    exhausted: 0,
    errors: 0,
    notCharged: report.eligibility.eligible ? null : report.eligibility.code,
    needsPerson: false,
  };
  const name = await firstName(db, userId);
  const roundOf = (charge: BillingCharge) => loaded.context.rounds.find((round) => round.number === charge.roundNumber);

  for (const attempt of report.attempts) {
    const { charge } = attempt;
    if (attempt.outcome === "paid") {
      summary.paid += 1;
      await db.from("events").insert({
        user_id: userId,
        kind: "charge_succeeded",
        payload: { chargeId: charge.id, roundNumber: charge.roundNumber, amountCents: charge.amountCents },
      });
      // A charge that had been declined and is now paid: resolved without a person ("Resuelto solo").
      if (charge.attempts > 1) {
        await recordResolution(db, {
          userId,
          kind: "payment_fixed",
          detail: { chargeId: charge.id, roundNumber: charge.roundNumber, attempts: charge.attempts, afterCardUpdate: options.afterCardUpdate === true },
          dedupeKey: `payment_fixed:${charge.id}`,
          at: now,
        });
      }
      const receipt = receiptFor(charge, roundOf(charge));
      if (receipt) {
        // In the app at once; on WhatsApp or email through the autopilot's outbound log (opt-out, quiet hours, cap).
        await tellClient(db, userId, receiptMessage(receipt), "billing:receipt", { whatsapp: false });
        await queueStatus(db, userId, {
          kind: "payment_receipt",
          chargeId: charge.id,
          receiptNumber: receipt.number,
          amount: receipt.amount,
          date: receipt.date,
          work: receipt.paidFor,
        });
      }
    } else if (attempt.outcome === "declined" || attempt.outcome === "exhausted") {
      summary[attempt.outcome] += 1;
      await db.from("events").insert({
        user_id: userId,
        kind: attempt.outcome === "exhausted" ? "charge_retries_exhausted" : "charge_declined",
        payload: { chargeId: charge.id, roundNumber: charge.roundNumber, attempts: charge.attempts, code: charge.failureCode },
      });
      // In the app at once; on WhatsApp or email through the autopilot's outbound log (opt-out, quiet hours,
      // the cap, dedupe), with the one-tap «Actualizar mi tarjeta» link. The words the client gets are kept
      // there, so the person's card shows exactly what was sent if it ever reaches one.
      await tellClient(db, userId, paymentFailedMessage({ firstName: name, charge }), "billing:declined", { whatsapp: false });
      await queueStatus(
        db,
        userId,
        {
          kind: "payment_declined",
          chargeId: charge.id,
          attempts: charge.attempts,
          roundNumber: charge.roundNumber,
          amount: formatCents(charge.amountCents),
          retryOn: charge.nextAttemptAt ? { es: billingDay(charge.nextAttemptAt, "es"), en: billingDay(charge.nextAttemptAt, "en") } : null,
        },
        now,
      );
      if (attempt.outcome === "exhausted") {
        summary.needsPerson = true;
        await notifyTeam(
          `${BRAND.name}: el cobro de la ronda ${charge.roundNumber} de un cliente no pasó después de ${charge.attempts} intentos. Su caso queda en pausa hasta que actualice su método de pago. Cuenta: ${userId}`,
        );
      }
    } else {
      summary.errors += 1;
      await reportError(new Error(attempt.message ?? "payment processor gave no answer"), {
        where: "billing:charge",
        userId,
        extra: { chargeId: charge.id, roundNumber: charge.roundNumber },
      });
    }
  }

  // The rule said yes and the database said no: the two disagree, which is a bug to look at. Nothing was charged.
  if (report.refused) {
    summary.errors += 1;
    await reportError(new Error(`charge refused by the database: ${report.refused}`), { where: "billing:create", userId });
  }

  for (const skipped of report.skipped.filter((s) => s.needsPerson)) {
    summary.needsPerson = true;
    await tellTeamOnce(
      db,
      userId,
      `retry:${skipped.charge.id}:${skipped.code}`,
      `${BRAND.name}: el cobro de la ronda ${skipped.charge.roundNumber} de un cliente quedó sin pagar y el sistema no lo intenta (${skipped.code}). Lo decide una persona. Cuenta: ${userId}`,
    );
  }

  if (!report.eligibility.eligible && report.eligibility.needsPerson) {
    summary.needsPerson = true;
    const { code, roundNumber, reason } = report.eligibility;
    await tellTeamOnce(db, userId, `charge:${roundNumber ?? 0}:${code}`, `${BRAND.name}: ${reason.es} Cuenta: ${userId}`);
    if (code === "no_payment_method" && roundNumber !== undefined) {
      const round = loaded.context.rounds.find((r) => r.number === roundNumber);
      const { data: told } = await db
        .from("events")
        .select("id")
        .eq("user_id", userId)
        .eq("kind", "payment_method_requested")
        .eq("payload->>roundNumber", String(roundNumber))
        .limit(1);
      if (round?.mailedAt && (!told || told.length === 0)) {
        await db.from("events").insert({ user_id: userId, kind: "payment_method_requested", payload: { roundNumber } });
        await tellClient(db, userId, paymentMethodNeededMessage({ firstName: name, roundNumber, workDate: round.mailedAt }), "billing:method-needed", { whatsapp: false });
        await queueStatus(
          db,
          userId,
          { kind: "payment_method_needed", roundNumber, workDate: { es: billingDay(round.mailedAt, "es"), en: billingDay(round.mailedAt, "en") } },
          now,
        );
      }
    }
  }

  return summary;
}

/** How many clients one run looks at. The run is hourly; the rest wait for the next one. */
export const BILLING_RUN_LIMIT = 50;

/**
 * The clients billing has something to look at: a declined charge whose retry
 * is due, a charge still waiting on the processor's first answer, or a round
 * mailed at least CHARGE_DELAY_DAYS ago that has no charge.
 */
export async function billingCandidates(db: SupabaseClient, now: Date, limit = BILLING_RUN_LIMIT): Promise<string[]> {
  const cutoff = new Date(now.getTime() - CHARGE_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [due, waiting, mailed] = await Promise.all([
    rows(db.from("charges").select("user_id").eq("status", "failed").lte("next_attempt_at", now.toISOString()).limit(500), "charges"),
    rows(db.from("charges").select("user_id").eq("status", "pending").limit(500), "charges"),
    rows(
      db
        .from("attack_rounds")
        .select("id, user_id")
        .in("status", ["mailed", "complete"])
        .lte("mailed_at", cutoff)
        .order("mailed_at", { ascending: false })
        .limit(1000),
      "attack_rounds",
    ),
  ]);
  const roundIds = mailed.map((round) => text(round.id));
  const charged =
    roundIds.length === 0
      ? new Set<string>()
      : new Set((await rows(db.from("charges").select("round_id").in("round_id", roundIds), "charges")).map((row) => text(row.round_id)));
  const users = new Set<string>();
  for (const row of [...due, ...waiting]) users.add(text(row.user_id));
  for (const round of mailed) if (!charged.has(text(round.id))) users.add(text(round.user_id));
  // Under a plan the next unit of work is not always a new round: a subscription period that ended, a
  // flat fee's last round, a report that proved a disputed item gone. Every client whose agreement in
  // force carries a plan is looked at; the rule decides (and charges nothing when nothing is due).
  const agreements = await rows(db.from("service_agreements").select("user_id, terms, signed_at, cancelled_at").limit(5000), "service_agreements");
  for (const a of agreements) {
    const terms = a.terms as { plan?: unknown } | null;
    if (a.signed_at && !a.cancelled_at && terms?.plan) users.add(text(a.user_id));
  }
  return [...users].slice(0, limit);
}
