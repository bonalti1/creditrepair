import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAgreementRow, notifyTeam } from "../agreement/server";
import { agreementFromRow, type AgreementState } from "../agreement/record";
import { BRAND } from "../brand";
import { sendWhatsAppText } from "../integrations/whatsapp";
import { reportError } from "../observability/errors";
import type { AuthorizationTerms } from "./authorization";
import { runClientBilling, type ChargeStore, type ClientBillingReport, type PaymentHandle } from "./collect";
import { paymentFailedMessage, paymentMethodNeededMessage } from "./dunning";
import type { PaymentGateway } from "./gateway";
import { receiptFor, receiptMessage } from "./receipts";
import { CHARGE_DELAY_DAYS } from "./rules";
import type {
  BillableRound,
  BillingAccount,
  BillingCharge,
  BillingContext,
  BillingRefund,
  ChargeStatus,
  L,
  PaymentMethodSummary,
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
  };
}

export function chargeFromRow(row: Row, refund: Row | null | undefined = null): BillingCharge {
  const status = STATUSES.find((s) => s === row.status) ?? "pending";
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
  };
}

export function paymentMethodFromRow(row: Row): PaymentMethodSummary {
  return {
    brand: text(row.brand),
    last4: text(row.last4),
    addedAt: iso(row.created_at) ?? "",
    authorizationVersion: text(row.authorization_version),
    authorizedAt: iso(row.authorized_at) ?? "",
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
    loadAgreementRow(db, userId),
    rows(db.from("attack_rounds").select("id, round_number, status, mailed_at").eq("user_id", userId), "attack_rounds"),
    rows(db.from("letters").select("round_id, target_type, target_key, target_name, status, mail_status").eq("user_id", userId), "letters"),
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
    if (vault[0]) handle = { customerRef: text(vault[0].customer_ref), paymentMethodRef: text(vault[0].payment_method_ref) };
  }

  const terms = agreement?.signedAt ? agreement.terms : null;
  return {
    agreement,
    authorizationTerms: {
      companyLegalName: terms?.companyLegalName ?? null,
      companyEmail: terms?.companyEmail ?? null,
      monthlyFee: terms?.monthlyFee ?? null,
    },
    context: {
      agreement,
      // The fee the client SIGNED, from the snapshot kept with the signature. Never today's configuration.
      signedMonthlyFee: terms?.monthlyFee ?? null,
      rounds: roundRows.map((round) => billableRoundFromRows(round, lettersByRound.get(text(round.id)) ?? [])),
      account,
    },
    roundIds: new Map(roundRows.map((round) => [Number(round.round_number), text(round.id)])),
    paymentMethodId: method ? text(method.id) : null,
    handle,
  };
}

// ── The store the collection code writes through ────────────────────────

/**
 * The database as a ChargeStore. createCharge only inserts (user, round,
 * amount): the trigger in migration 0011 checks the work and the agreement,
 * and fills in the round number, the work date and the agreement. If the
 * database refuses, no processor is ever asked.
 */
export function databaseChargeStore(db: SupabaseClient, userId: string, roundIds: Map<number, string>, gatewayName: string): ChargeStore {
  return {
    async createCharge({ roundNumber, amountCents }) {
      const roundId = roundIds.get(roundNumber);
      if (!roundId) return { created: false, reason: `round ${roundNumber} has no row` };
      const { data, error } = await db
        .from("charges")
        .insert({ user_id: userId, round_id: roundId, amount_cents: amountCents })
        .select("*")
        .single();
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

/** A notice to the client: WhatsApp when there is a number, and a line in their in-app thread. */
async function tellClient(db: SupabaseClient, userId: string, message: { es: string; en: string }, context: string): Promise<void> {
  try {
    const { data: profile } = await db.from("profiles").select("phone_e164, locale").eq("id", userId).maybeSingle();
    const locale: L = profile?.locale === "en" ? "en" : "es";
    const body = message[locale];
    await db.from("chat_messages").insert({ user_id: userId, channel: "app", role: "assistant", source: "journey", body });
    if (profile?.phone_e164) await sendWhatsAppText(profile.phone_e164 as string, body, context);
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
export async function runBillingForUser(db: SupabaseClient, gateway: PaymentGateway, userId: string, now: Date): Promise<UserBillingSummary> {
  const loaded = await loadBilling(db, userId, { withHandle: true });
  const store = databaseChargeStore(db, userId, loaded.roundIds, gateway.name);
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
      const receipt = receiptFor(charge, roundOf(charge));
      if (receipt) await tellClient(db, userId, receiptMessage(receipt), "billing:receipt");
    } else if (attempt.outcome === "declined" || attempt.outcome === "exhausted") {
      summary[attempt.outcome] += 1;
      await db.from("events").insert({
        user_id: userId,
        kind: attempt.outcome === "exhausted" ? "charge_retries_exhausted" : "charge_declined",
        payload: { chargeId: charge.id, roundNumber: charge.roundNumber, attempts: charge.attempts, code: charge.failureCode },
      });
      await tellClient(db, userId, paymentFailedMessage({ firstName: name, charge }), "billing:declined");
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
        await tellClient(db, userId, paymentMethodNeededMessage({ firstName: name, roundNumber, workDate: round.mailedAt }), "billing:method-needed");
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
  return [...users].slice(0, limit);
}
