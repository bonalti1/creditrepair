import { describe, expect, it } from "vitest";
import { cancellationDeadline, firstWorkingDay } from "../agreement/businessDays";
import type { AgreementRecord } from "../agreement/gate";
import { caseNext, EMPTY_CASE_FACTS, type CaseFacts } from "../case/timeline";
import { nextAction } from "../ux/journey";
import {
  ESTIMATED_CYCLE_DAYS,
  MAX_CYCLE_DAYS,
  nextRoundDue,
  nextRoundDueForCaseRound,
  nextRoundDueForStaffRound,
  nextRoundDueFromRows,
  REINVESTIGATION_DAYS,
  RESPONSE_BUFFER_DAYS,
  roundOneMailDate,
  TRANSIT_BUFFER_DAYS,
} from "../rounds/timing";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";

// When the next round is due (src/lib/rounds/timing.ts): from the certified
// delivery when the post office scanned it, else the mailing date + 5 days;
// 30 days (FCRA § 611(a)(1)(A)) + 5 for the answer; at most 45 days from
// mailing, never before the legal window.

const DAY = 24 * 60 * 60 * 1000;
const MAILED = "2026-11-02T17:00:00.000Z";
const plus = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

describe("nextRoundDue: the rule", () => {
  it("has the documented constants", () => {
    expect([REINVESTIGATION_DAYS, TRANSIT_BUFFER_DAYS, RESPONSE_BUFFER_DAYS, MAX_CYCLE_DAYS, ESTIMATED_CYCLE_DAYS]).toEqual([30, 5, 5, 45, 40]);
  });

  it("is null for a round not mailed", () => {
    expect(nextRoundDue({ mailedAt: null }, [])).toBeNull();
    expect(nextRoundDue({ mailedAt: "not a date" }, [])).toBeNull();
  });

  it("no tracking at all: mailing + 5 transit + 30 + 5 = 40 days, an estimate", () => {
    const due = nextRoundDue({ mailedAt: MAILED }, [{ mailClass: "first_class" }])!;
    expect(due.basis).toBe("estimate");
    expect(due.receiptKnown).toBe(false);
    expect(daysBetween(MAILED, due.receivedAt)).toBe(5);
    expect(daysBetween(MAILED, due.windowEndsAt)).toBe(35);
    expect(due.daysFromMailing).toBe(40);
    // A round with no letter rows reads the same.
    expect(nextRoundDue({ mailedAt: MAILED })!.dueAt).toBe(due.dueAt);
  });

  it("certified, delivered on day 3: 35 days from delivery (38 from mailing), never before day 33", () => {
    const delivered = plus(MAILED, 3);
    const due = nextRoundDue({ mailedAt: MAILED }, [{ mailClass: "certified", deliveredAt: delivered, status: "delivered" }])!;
    expect(due).toMatchObject({ basis: "delivery", receiptKnown: true, receivedAt: delivered, windowEndsAt: plus(delivered, 30), dueAt: plus(delivered, 35), daysFromMailing: 38 });
  });

  it("the latest receipt counts: every letter gets its full 30 days", () => {
    const due = nextRoundDue({ mailedAt: MAILED }, [
      { mailClass: "certified", deliveredAt: plus(MAILED, 2), status: "delivered" },
      { mailClass: "certified", deliveredAt: plus(MAILED, 6), status: "delivered" },
    ])!;
    expect(due.receivedAt).toBe(plus(MAILED, 6));
    expect(due.daysFromMailing).toBe(41);
  });

  it("one certified letter not yet scanned: that letter's receipt is estimated (mailing + 5)", () => {
    const due = nextRoundDue({ mailedAt: MAILED }, [
      { mailClass: "certified", deliveredAt: plus(MAILED, 2), status: "delivered" },
      { mailClass: "certified", deliveredAt: null, status: "in_transit" },
    ])!;
    expect(due.basis).toBe("estimate");
    expect(due.receivedAt).toBe(plus(MAILED, 5));
    expect(due.daysFromMailing).toBe(40);
  });

  it("a First-Class 'delivered' is an estimate: it can push the date later, never earlier", () => {
    const early = nextRoundDue({ mailedAt: MAILED }, [{ mailClass: "first_class", deliveredAt: plus(MAILED, 2), status: "delivered" }])!;
    expect(early.daysFromMailing).toBe(40);
    const late = nextRoundDue({ mailedAt: MAILED }, [{ mailClass: "first_class", deliveredAt: plus(MAILED, 8), status: "delivered" }])!;
    expect(late.receivedAt).toBe(plus(MAILED, 8));
    expect(late.daysFromMailing).toBe(43);
  });

  it("a slow delivery is capped at 45 days from mailing, while the window is still over", () => {
    const due = nextRoundDue({ mailedAt: MAILED }, [{ mailClass: "certified", deliveredAt: plus(MAILED, 12), status: "delivered" }])!;
    expect(due.basis).toBe("upper_bound");
    expect(due.daysFromMailing).toBe(45);
    expect(Date.parse(due.dueAt)).toBeGreaterThanOrEqual(Date.parse(due.windowEndsAt));
  });

  it("never before the legal window: a delivery on day 20 waits for day 50", () => {
    const due = nextRoundDue({ mailedAt: MAILED }, [{ mailClass: "certified_return_receipt", deliveredAt: plus(MAILED, 20), status: "delivered" }])!;
    expect(due.basis).toBe("legal_window");
    expect(due.dueAt).toBe(plus(MAILED, 50));
    expect(due.dueAt).toBe(due.windowEndsAt);
  });

  it("returned letters do not count; a re-mail counts from its own mailing date", () => {
    const remailed = plus(MAILED, 10);
    const due = nextRoundDue({ mailedAt: MAILED }, [
      { mailClass: "certified", deliveredAt: plus(MAILED, 3), status: "delivered" },
      { mailClass: "first_class", status: "returned" },
      { mailClass: "first_class", mailedAt: remailed, status: "in_transit" },
    ])!;
    expect(due.receivedAt).toBe(plus(remailed, 5));
    // 10 + 5 + 30 = 45: the window ends on the cap itself.
    expect(due.dueAt).toBe(plus(MAILED, 45));
    // Every letter back: nothing was received; the estimate from mailing stands.
    expect(nextRoundDue({ mailedAt: MAILED }, [{ status: "returned" }])!.daysFromMailing).toBe(40);
  });

  it("tracking by letter id overrides the rows", () => {
    const due = nextRoundDue({ mailedAt: MAILED }, [{ id: "l1", mailClass: "certified" }], { l1: { deliveredAt: plus(MAILED, 4), status: "delivered" } })!;
    expect(due.daysFromMailing).toBe(39);
  });

  it("is never earlier than 30 days from mailing and, for 2+ letters, never earlier than any letter's window (property)", () => {
    for (let a = 0; a <= 25; a++) {
      for (let b = 0; b <= 25; b += 5) {
        const letters = [
          { mailClass: "certified" as const, deliveredAt: plus(MAILED, a), status: "delivered" as const },
          { mailClass: "certified" as const, deliveredAt: plus(MAILED, b), status: "delivered" as const },
        ];
        const due = nextRoundDue({ mailedAt: MAILED }, letters)!;
        for (const l of letters) expect(Date.parse(due.dueAt)).toBeGreaterThanOrEqual(Date.parse(l.deliveredAt) + 30 * DAY);
        expect(due.daysFromMailing).toBeGreaterThanOrEqual(30);
        // The cap holds whenever the law allows it.
        if (Math.max(a, b) + 30 <= 45) expect(due.daysFromMailing).toBeLessThanOrEqual(45);
      }
    }
  });
});

describe("nextRoundDue: the shapes the app carries", () => {
  it("a staff round, a case round and database rows give the same date", () => {
    const delivered = plus(MAILED, 4);
    const staff = nextRoundDueForStaffRound({
      mailedAt: MAILED,
      letters: [{ mailStatus: "delivered", mail: { mailClass: "certified", mailedAt: MAILED, deliveredAt: delivered } }],
    })!;
    const kase = nextRoundDueForCaseRound({ mailedAt: MAILED, letters: [{ mailClass: "certified", status: "delivered", mailedAt: MAILED, deliveredAt: delivered }] })!;
    const rows = nextRoundDueFromRows(MAILED, [{ id: "x", mail_class: "certified", mail_status: "delivered", mailed_at: MAILED, delivered_at: delivered }])!;
    expect(staff.dueAt).toBe(plus(delivered, 35));
    expect(kase.dueAt).toBe(staff.dueAt);
    expect(rows.dueAt).toBe(staff.dueAt);
  });

  it("the client's journey waits for the same date", () => {
    const state = { reportImported: true, totalItems: 2, reviewedCount: 2, attestedCount: 1, roundApproved: true, mailedAt: MAILED };
    const agreement: AgreementRecord = { disclosureAcknowledgedAt: "2026-10-01T00:00:00Z", signedAt: "2026-10-01T00:01:00Z", cancellationDeadline: "2026-10-06T04:59:59Z", cancelledAt: null, serviceEndRequestedAt: null };
    const step = (now: string, extra = {}) => nextAction({ ...state, agreement, ...extra }, "en", { mode: "full_service", now: new Date(now) }).key;
    expect(step(plus(MAILED, 39))).toBe("waiting");
    expect(step(plus(MAILED, 40))).toBe("next-round");
    // With a certified delivery on day 2, the next round comes on day 37.
    expect(step(plus(MAILED, 37), { nextRoundDueAt: plus(MAILED, 37) })).toBe("next-round");
  });
});

describe("round 1: the first working day after the cancellation window", () => {
  // Signed Wednesday 18 November 2026 (Texas): the 3 business days are Thu 19, Fri 20, Mon 23. Round 1: Tue 24.
  const signedAt = new Date("2026-11-18T16:00:00.000Z");
  const deadline = cancellationDeadline(signedAt);
  const agreement: AgreementRecord = {
    disclosureAcknowledgedAt: new Date(signedAt.getTime() - 60_000).toISOString(),
    signedAt: signedAt.toISOString(),
    cancellationDeadline: deadline.toISOString(),
    cancelledAt: null,
    serviceEndRequestedAt: null,
  };

  it("is the first working day after the deadline, and today once that day has come", () => {
    const day = roundOneMailDate(agreement, new Date("2026-11-19T15:00:00Z"))!;
    expect(day.toISOString()).toBe(firstWorkingDay(deadline).toISOString());
    expect(day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" })).toBe("Tuesday, November 24");
    const later = new Date("2026-11-30T15:00:00Z");
    expect(roundOneMailDate(agreement, later)!.toISOString()).toBe(later.toISOString());
    expect(roundOneMailDate({ ...agreement, cancelledAt: "2026-11-19T00:00:00Z" }, later)).toBeNull();
    expect(roundOneMailDate(null, later)).toBeNull();
  });

  const reviewed: CaseFacts = {
    ...EMPTY_CASE_FACTS,
    agreement,
    reportImports: ["2026-11-18T18:00:00.000Z"],
    review: { total: 6, reviewed: 6, confirmed: 2, finishedAt: "2026-11-19T01:00:00.000Z" },
  };

  it("Mi caso says when round 1 goes out, and the round 2 date that follows, in both languages", () => {
    const now = new Date("2026-11-20T15:00:00Z");
    const en = caseNext(reviewed, "en", now);
    const es = caseNext(reviewed, "es", now);
    expect(en.map((n) => n.key)).toEqual(["cancel-until", "round-1"]);
    expect(en[1]!.title).toBe("Your round 1 letters go out on November 24");
    expect(en[1]!.detail).toBe("It is the first working day after your time to cancel. Your next round is prepared around January 3.");
    expect(es[1]!.title).toBe("Tus cartas de la ronda 1 salen el 24 de noviembre");
    for (const line of [...en, ...es]) {
      expect(checkClaimGuardrails(`${line.title} ${line.detail ?? ""}`)).toEqual([]);
      expect(checkMarketingCopy(`${line.title} ${line.detail ?? ""}`)).toEqual([]);
    }
  });

  it("before the review is done the line stays 'your team starts working'", () => {
    const now = new Date("2026-11-20T15:00:00Z");
    const notYet = { ...reviewed, review: { total: 6, reviewed: 3, confirmed: 1, finishedAt: null } };
    expect(caseNext(notYet, "en", now).map((n) => n.key)).toEqual(["cancel-until", "team-starts"]);
  });
});
