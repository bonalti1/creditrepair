import { firstWorkingDay } from "../agreement/businessDays";
import { deadlineOf, type AgreementRecord } from "../agreement/gate";
import type { MailClass, MailStatus } from "../mail/types";

// When the next round is due: one rule, from the evidence, for every screen
// and job (docs/AUTOPILOT.md, «When the next round is due»).
//
// It replaces the fixed 40 days (ROUND_CYCLE_DAYS) everywhere: the client's
// journey and "Mi caso", the staff console's next steps and stage, the
// business dashboard, the partner view, the send path that records
// next_round_due_at, the Lob webhook that moves it when a delivery is
// scanned, and the hourly re-pull (/api/cron/rounds).
//
// The law: a bureau has 30 days to finish a reinvestigation, counted from the
// day it RECEIVES the dispute (FCRA § 611(a)(1)(A), 15 U.S.C. § 1681i(a)(1)(A));
// a furnisher's direct dispute runs the same 30 days (12 C.F.R. § 1022.43(e)).
// The bureau then has 5 business days to mail the results (§ 611(a)(6)(A)).
//
// The rule, per round:
//   1. Receipt, per letter that reached someone (returned letters do not count):
//      - a certified letter's delivery scan, when the post office recorded one
//        (USPS scans certified mail at the door: the receipt is known);
//      - otherwise its mailing date + TRANSIT_BUFFER_DAYS (5). A First-Class
//        "Delivered" from Lob is only an estimate; it is used only when it is
//        LATER than that, never to move the date earlier.
//      The round's receipt is the latest one: every letter must have had its 30 days.
//   2. The legal window ends 30 days after that receipt. Nothing is due before it.
//   3. Then RESPONSE_BUFFER_DAYS (5) for the bureau's mailed answer and the
//      report to refresh: that is when the report is pulled again and the next
//      round prepared.
//   4. Never later than MAX_CYCLE_DAYS (45) after the mailing date, unless the
//      legal window itself ends later (a late delivery scan): the window wins.
//
// So: certified, delivered 3 days after mailing → due 38 days after mailing
// (35 from delivery). No scan → 40 days. Delivered 12 days after → 45 (the
// cap). Delivered 20 days after → 50 (the window: never early).

const DAY_MS = 24 * 60 * 60 * 1000;

/** FCRA § 611(a)(1)(A): days the bureau has, from receipt. */
export const REINVESTIGATION_DAYS = 30;
/** Days a letter is assumed to travel when no delivery scan is on record. */
export const TRANSIT_BUFFER_DAYS = 5;
/** Days after the window for the bureau's mailed answer and the report to refresh. */
export const RESPONSE_BUFFER_DAYS = 5;
/** The upper bound, from the mailing date, unless the legal window ends later. */
export const MAX_CYCLE_DAYS = 45;
/** The date with no tracking at all: transit + window + answer = 40 days. Copy says "about 40 days". */
export const ESTIMATED_CYCLE_DAYS = TRANSIT_BUFFER_DAYS + REINVESTIGATION_DAYS + RESPONSE_BUFFER_DAYS;

export interface TimingRound {
  /** When the round was mailed (ISO). Null: not mailed, nothing is due. */
  mailedAt: string | null;
}

export interface TimingLetter {
  /** For the tracking lookup. */
  id?: string;
  mailClass?: MailClass | null;
  /** The letter's own mailing date (a re-mail goes later than its round). Defaults to the round's. */
  mailedAt?: string | null;
  deliveredAt?: string | null;
  status?: MailStatus | null;
}

/** What the post office said, by letter id; overrides what the letter rows carry. */
export type TimingTracking = Record<string, { mailClass?: MailClass | null; deliveredAt?: string | null; status?: MailStatus | null }>;

export type DueBasis =
  /** Every letter that counts has a certified delivery scan. */
  | "delivery"
  /** At least one receipt is estimated (mailing date + transit). */
  | "estimate"
  /** The 45-day upper bound came first. */
  | "upper_bound"
  /** The legal window ends after the upper bound: the window wins. */
  | "legal_window";

export interface RoundDue {
  mailedAt: string;
  /** The latest receipt the window counts from, known or estimated. */
  receivedAt: string;
  /** True when every counted letter's receipt is a certified delivery scan. */
  receiptKnown: boolean;
  /** receivedAt + 30 days: the earliest moment the next round may be prepared. */
  windowEndsAt: string;
  /** When the report is pulled again and the next round prepared. */
  dueAt: string;
  basis: DueBasis;
  /** dueAt − mailedAt, in whole days (rounded up). */
  daysFromMailing: number;
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);
const ok = (n: number) => Number.isFinite(n);
const certified = (c: MailClass | null | undefined) => c === "certified" || c === "certified_return_receipt";
const back = (s: MailStatus | null | undefined) => s === "returned" || s === "undeliverable";

/**
 * When the next round is due for a mailed round. Pure. Null for a round that
 * was not mailed (or whose date cannot be read).
 */
export function nextRoundDue(round: TimingRound, letters: readonly TimingLetter[] = [], tracking: TimingTracking = {}): RoundDue | null {
  const mailed = ms(round.mailedAt);
  if (!ok(mailed)) return null;

  const merged = letters.map((l) => {
    const t = l.id ? tracking[l.id] : undefined;
    return {
      mailClass: t?.mailClass ?? l.mailClass ?? null,
      mailedAt: ok(ms(l.mailedAt)) ? ms(l.mailedAt) : mailed,
      deliveredAt: ms(t?.deliveredAt ?? l.deliveredAt ?? null),
      status: t?.status ?? l.status ?? null,
    };
  });
  const counted = merged.filter((l) => !back(l.status));

  let received = mailed + TRANSIT_BUFFER_DAYS * DAY_MS;
  let known = counted.length > 0;
  if (counted.length > 0) {
    received = -Infinity;
    for (const l of counted) {
      let receipt: number;
      if (certified(l.mailClass) && ok(l.deliveredAt)) {
        receipt = Math.max(l.deliveredAt, l.mailedAt);
      } else {
        known = false;
        receipt = l.mailedAt + TRANSIT_BUFFER_DAYS * DAY_MS;
        // A First-Class "Delivered" is an estimate: it may only push the date later.
        if (ok(l.deliveredAt) && l.deliveredAt > receipt) receipt = l.deliveredAt;
      }
      received = Math.max(received, receipt);
    }
  } else {
    known = false;
  }

  const windowEnds = received + REINVESTIGATION_DAYS * DAY_MS;
  const target = windowEnds + RESPONSE_BUFFER_DAYS * DAY_MS;
  const cap = mailed + MAX_CYCLE_DAYS * DAY_MS;
  let due: number;
  let basis: DueBasis;
  if (target <= cap) {
    due = target;
    basis = known ? "delivery" : "estimate";
  } else if (windowEnds <= cap) {
    due = cap;
    basis = "upper_bound";
  } else {
    due = windowEnds;
    basis = "legal_window";
  }
  return {
    mailedAt: new Date(mailed).toISOString(),
    receivedAt: new Date(received).toISOString(),
    receiptKnown: known,
    windowEndsAt: new Date(windowEnds).toISOString(),
    dueAt: new Date(due).toISOString(),
    basis,
    daysFromMailing: Math.ceil((due - mailed) / DAY_MS),
  };
}

/** The due date alone, or null. */
export function nextRoundDueAt(round: TimingRound, letters: readonly TimingLetter[] = [], tracking: TimingTracking = {}): string | null {
  return nextRoundDue(round, letters, tracking)?.dueAt ?? null;
}

// ── Adapters for the shapes the app carries ───────────────────────────────

/** A staff console round (StaffRound): each letter's mail record carries the dates. */
export function nextRoundDueForStaffRound(round: {
  mailedAt: string | null;
  letters: ReadonlyArray<{ mailStatus?: MailStatus; mailClass?: MailClass; mail?: { mailClass: MailClass; mailedAt: string | null; deliveredAt: string | null } | null }>;
}): RoundDue | null {
  return nextRoundDue(
    round,
    round.letters.map((l) => ({
      mailClass: l.mail?.mailClass ?? l.mailClass ?? null,
      mailedAt: l.mail?.mailedAt ?? null,
      deliveredAt: l.mail?.deliveredAt ?? null,
      status: l.mailStatus ?? null,
    })),
  );
}

/** A "Mi caso" round (CaseRoundFact). */
export function nextRoundDueForCaseRound(round: {
  mailedAt: string | null;
  letters: ReadonlyArray<{ mailClass: MailClass; status: MailStatus; mailedAt: string | null; deliveredAt: string | null }>;
}): RoundDue | null {
  return nextRoundDue(round, round.letters);
}

/** Database rows: attack_rounds.mailed_at and its letters (mail_class, mail_status, mailed_at, delivered_at). */
export function nextRoundDueFromRows(mailedAt: unknown, letterRows: ReadonlyArray<Record<string, unknown>>): RoundDue | null {
  const s = (v: unknown) => (typeof v === "string" && v ? v : v instanceof Date ? v.toISOString() : null);
  return nextRoundDue(
    { mailedAt: s(mailedAt) },
    letterRows.map((r) => ({
      id: s(r.id) ?? undefined,
      mailClass: (s(r.mail_class) as MailClass | null) ?? null,
      mailedAt: s(r.mailed_at),
      deliveredAt: s(r.delivered_at),
      status: (s(r.mail_status) as MailStatus | null) ?? null,
    })),
  );
}

// ── Round 1 ─────────────────────────────────────────────────────────────

/**
 * The day round 1 goes out: the first working day after the cancellation
 * window (businessDays.ts: firstWorkingDay), or `now` once that day has come.
 * Null before the agreement is signed or after it was cancelled. Work itself
 * may start only when the gate says so (gate.ts: workMayStart); this is the
 * date the team, or the autopilot's next run, mails a round that is ready.
 */
export function roundOneMailDate(agreement: AgreementRecord | null | undefined, now: Date): Date | null {
  if (!agreement?.signedAt || agreement.cancelledAt || agreement.serviceEndRequestedAt) return null;
  const deadline = deadlineOf(agreement);
  if (!deadline) return null;
  const first = firstWorkingDay(deadline);
  return first.getTime() > now.getTime() ? first : now;
}
