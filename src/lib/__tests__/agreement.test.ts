import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import {
  businessDayAfter,
  calendarDayIn,
  cancellationDeadline,
  dayKey,
  endOfDayIn,
  federalHolidays,
  firstWorkingDay,
  isBusinessDay,
  isFederalHoliday,
  startOfDayIn,
} from "../agreement/businessDays";
import {
  AGREEMENT_VERSION,
  DIY_AGREEMENT_VERSION,
  agreementDocument,
  agreementDocuments,
  CONTRACT_STEP,
  DISCLOSURE_STEP,
  disclosureHash,
  documentHash,
  documentText,
  isTexasSpecific,
} from "../agreement/documents";
import {
  agreementPhase,
  canCancelWithoutPenalty,
  deadlineOf,
  NO_AGREEMENT,
  workMayStart,
  type AgreementRecord,
} from "../agreement/gate";
import { agreementReadiness, readinessFrom, unverifiedStatuteCitations } from "../agreement/readiness";
import { agreementFromRow, normalizeAgreement } from "../agreement/record";
import { sha256Hex } from "../agreement/sha256";
import { isFullName, signerNameMatches } from "../agreement/signature";
import {
  CROA_CANCELLATION_FORM,
  CROA_CONTRACT_CANCEL_SENTENCE,
  CROA_DISCLOSURE,
  STATUTE_TEXTS,
  TEXAS_CANCELLATION_FORM,
  TEXAS_CONTRACT_CANCEL_SENTENCE,
} from "../agreement/statutes";
import { missingTerms, PLACEHOLDER_PATTERN, REQUIRED_TERMS, resolveTerms, TERM_ENV, type TermsSource } from "../agreement/terms";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { DEMO_REPORT } from "../demo";
import { DEFAULT_SERVICE_MODE } from "../service/mode";
import { buildDemoClients } from "../staff/demoClients";
import { exceptionMessage } from "../staff/messages";
import {
  agreementLine,
  clientExceptions,
  clientStage,
  nextAutomaticStep,
  nextStep,
  PIPELINE_STAGES,
  sendableRound,
  sendBlockReason,
  workStartsAt,
} from "../staff/stage";
import { clientTimeline } from "../staff/timeline";
import { nextAction, sessionJourneyState, type JourneyState } from "../ux/journey";
import { setStaffLocaleFallback } from "../staff/i18n/locale";

// Written against the Spanish console: the sentences these tests pin are the Spanish ones.
setStaffLocaleFallback("es");

// The agreement: the days the law counts, the gate that holds every letter,
// what the documents must contain, who may sign, and how the journey and the
// staff console read all of it.

const iso = (date: Date) => date.toISOString();
/** A moment on the Texas clock, written as its UTC instant. CST = UTC-6, CDT = UTC-5. */
const cst = (ymd: string, time = "12:00:00") => new Date(`${ymd}T${time}-06:00`);
const cdt = (ymd: string, time = "12:00:00") => new Date(`${ymd}T${time}-05:00`);

const COMPLETE: TermsSource = {
  companyLegalName: "Credalti LLC",
  companyAddress: "100 Example Street, Suite 200, Houston, TX 77002",
  companyEmail: "ayuda@example.com",
  monthlyFee: "89",
  estimatedMonths: "6",
  texasRegistrationNumber: "20260000",
  bondSuretyName: "Example Surety Company",
  bondSuretyAddress: "1 Bond Plaza, Dallas, TX 75201",
  texasAgentName: "Example Registered Agent Inc.",
  texasAgentAddress: "2 Agent Way, Austin, TX 78701",
};
const complete = resolveTerms(COMPLETE);
const empty = resolveTerms({});

describe("service mode", () => {
  it("is chosen per client, and is full service (Credalti Complete) when nothing says otherwise", () => {
    expect(DEFAULT_SERVICE_MODE).toBe("full_service");
  });
});

describe("federal holidays", () => {
  const dates = (year: number) => Object.fromEntries(federalHolidays(year).map((h) => [h.name, [dayKey(h.date), dayKey(h.observed)]]));

  it("computes the eleven holidays of 2026 from their rules", () => {
    expect(federalHolidays(2026)).toHaveLength(11);
    expect(dates(2026)).toEqual({
      "New Year's Day": ["2026-01-01", "2026-01-01"],
      "Birthday of Martin Luther King, Jr.": ["2026-01-19", "2026-01-19"],
      "Washington's Birthday": ["2026-02-16", "2026-02-16"],
      "Memorial Day": ["2026-05-25", "2026-05-25"],
      "Juneteenth National Independence Day": ["2026-06-19", "2026-06-19"],
      // The 4th is a Saturday: offices close on Friday the 3rd.
      "Independence Day": ["2026-07-04", "2026-07-03"],
      "Labor Day": ["2026-09-07", "2026-09-07"],
      "Columbus Day": ["2026-10-12", "2026-10-12"],
      "Veterans Day": ["2026-11-11", "2026-11-11"],
      "Thanksgiving Day": ["2026-11-26", "2026-11-26"],
      "Christmas Day": ["2026-12-25", "2026-12-25"],
    });
  });

  it("moves a weekend holiday to the nearest weekday, also across the year's end", () => {
    // 2027: Juneteenth on Saturday, Independence Day on Sunday, Christmas on Saturday.
    expect(dates(2027)["Juneteenth National Independence Day"]).toEqual(["2027-06-19", "2027-06-18"]);
    expect(dates(2027)["Independence Day"]).toEqual(["2027-07-04", "2027-07-05"]);
    expect(dates(2027)["Christmas Day"]).toEqual(["2027-12-25", "2027-12-24"]);
    // New Year's Day 2028 is a Saturday: observed on Friday 31 December 2027.
    expect(dates(2028)["New Year's Day"]).toEqual(["2028-01-01", "2027-12-31"]);
    expect(isFederalHoliday({ year: 2027, month: 12, day: 31 })).toBe(true);
    expect(isBusinessDay({ year: 2027, month: 12, day: 31 })).toBe(false);
  });

  it("works for any year without a list to maintain", () => {
    expect(dates(2040)["Thanksgiving Day"]![0]).toBe("2040-11-22");
    expect(dates(2040)["Memorial Day"]![0]).toBe("2040-05-28");
    expect(federalHolidays(2020).some((h) => h.name.startsWith("Juneteenth"))).toBe(false);
  });

  it("does not count weekends or holidays as business days", () => {
    expect(isBusinessDay({ year: 2026, month: 11, day: 21 })).toBe(false); // Saturday
    expect(isBusinessDay({ year: 2026, month: 11, day: 22 })).toBe(false); // Sunday
    expect(isBusinessDay({ year: 2026, month: 11, day: 26 })).toBe(false); // Thanksgiving
    expect(isBusinessDay({ year: 2026, month: 11, day: 27 })).toBe(true); // the Friday after is not a federal holiday
    expect(isBusinessDay({ year: 2026, month: 7, day: 3 })).toBe(false); // Independence Day observed
    expect(businessDayAfter({ year: 2026, month: 11, day: 20 }, 3)).toEqual({ year: 2026, month: 11, day: 25 });
  });
});

describe("cancellation deadline: midnight of the 3rd business day after signing", () => {
  it("an ordinary week: signed Monday, ends with Thursday", () => {
    const deadline = cancellationDeadline(cst("2026-11-16", "10:00:00"));
    expect(iso(deadline)).toBe("2026-11-20T05:59:59.999Z"); // Thursday 19, 23:59:59.999 in Texas
    expect(calendarDayIn(deadline)).toEqual({ year: 2026, month: 11, day: 19 });
  });

  it("signed on a Friday: the weekend does not count, ends with Wednesday", () => {
    expect(iso(cancellationDeadline(cst("2026-11-13", "09:00:00")))).toBe("2026-11-19T05:59:59.999Z");
    // Saturday and Sunday signings also end with Wednesday.
    expect(iso(cancellationDeadline(cst("2026-11-14", "15:00:00")))).toBe("2026-11-19T05:59:59.999Z");
    expect(iso(cancellationDeadline(cst("2026-11-15", "23:30:00")))).toBe("2026-11-19T05:59:59.999Z");
  });

  it("uses the Texas date of signing, not the UTC date: one minute to midnight and one minute after", () => {
    // Monday 23:59 in Texas is already Tuesday in UTC. It is still a Monday signing.
    const lateMonday = cst("2026-11-16", "23:59:00");
    expect(lateMonday.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(iso(cancellationDeadline(lateMonday))).toBe("2026-11-20T05:59:59.999Z");
    // Two minutes later it is Tuesday in Texas: one more day.
    expect(iso(cancellationDeadline(cst("2026-11-17", "00:01:00")))).toBe("2026-11-21T05:59:59.999Z");
  });

  it("the hour of signing never shortens the window", () => {
    const morning = cancellationDeadline(cst("2026-11-16", "00:00:01"));
    const night = cancellationDeadline(cst("2026-11-16", "23:59:59"));
    expect(iso(morning)).toBe(iso(night));
  });

  it("before Thanksgiving: the holiday is skipped", () => {
    // Tuesday: Wed 25, (Thu 26 holiday), Fri 27, Mon 30.
    expect(iso(cancellationDeadline(cst("2026-11-24")))).toBe("2026-12-01T05:59:59.999Z");
    // Wednesday: (Thu holiday), Fri 27, Mon 30, Tue 1 December.
    expect(iso(cancellationDeadline(cst("2026-11-25")))).toBe("2026-12-02T05:59:59.999Z");
  });

  it("across New Year", () => {
    // Wednesday 30 December 2026: Thu 31, (Fri 1 January holiday), Mon 4, Tue 5.
    expect(iso(cancellationDeadline(cst("2026-12-30")))).toBe("2027-01-06T05:59:59.999Z");
    // Thursday 30 December 2027: Friday 31 is New Year's Day observed, so Mon 3, Tue 4, Wed 5 January 2028.
    expect(iso(cancellationDeadline(cst("2027-12-30")))).toBe("2028-01-06T05:59:59.999Z");
  });

  it("across the clock changes: the last instant of the day is still 23:59:59.999 local", () => {
    // Clocks go forward on Sunday 14 March 2027. Signed Thursday 11 (CST): Fri 12, Mon 15, Tue 16 (CDT).
    expect(iso(cancellationDeadline(cst("2027-03-11")))).toBe("2027-03-17T04:59:59.999Z");
    // Clocks go back on Sunday 1 November 2026. Signed Thursday 29 October (CDT): Fri 30, Mon 2, Tue 3 (CST).
    expect(iso(cancellationDeadline(cdt("2026-10-29")))).toBe("2026-11-04T05:59:59.999Z");
    // The days of the change themselves are 23 and 25 hours long.
    const springDay = { year: 2027, month: 3, day: 14 };
    expect(endOfDayIn(springDay).getTime() - startOfDayIn(springDay).getTime() + 1).toBe(23 * 3600 * 1000);
    const fallDay = { year: 2026, month: 11, day: 1 };
    expect(endOfDayIn(fallDay).getTime() - startOfDayIn(fallDay).getTime() + 1).toBe(25 * 3600 * 1000);
  });

  it("counts on the calendar of the zone it is given", () => {
    // 23:30 Monday in Texas is 21:30 Monday in Los Angeles: same signing day there, later midnight.
    expect(iso(cancellationDeadline(cst("2026-11-16", "23:30:00"), "America/Los_Angeles"))).toBe("2026-11-20T07:59:59.999Z");
    // 01:00 Tuesday in Texas is still Monday in Los Angeles.
    expect(iso(cancellationDeadline(cst("2026-11-17", "01:00:00"), "America/Los_Angeles"))).toBe("2026-11-20T07:59:59.999Z");
  });

  it("for every signing hour over three years: at least 3 full days, never 7, always ending a business day at 23:59:59.999", () => {
    const start = Date.UTC(2026, 0, 1, 6);
    for (let hour = 0; hour < 3 * 366 * 24; hour += 7) {
      const signedAt = new Date(start + hour * 3600 * 1000);
      const deadline = cancellationDeadline(signedAt);
      const days = (deadline.getTime() - signedAt.getTime()) / (24 * 3600 * 1000);
      expect(days, iso(signedAt)).toBeGreaterThan(3);
      expect(days, iso(signedAt)).toBeLessThan(7);
      expect(isBusinessDay(calendarDayIn(deadline)), iso(signedAt)).toBe(true);
      // One millisecond later it is the next day in Texas.
      expect(calendarDayIn(new Date(deadline.getTime() + 1))).not.toEqual(calendarDayIn(deadline));
      // Exactly three business days lie between the signing day and the deadline day, inclusive of the last.
      expect(businessDayAfter(calendarDayIn(signedAt), 3)).toEqual(calendarDayIn(deadline));
    }
  });

  it("the team's first working day is the business day after the window", () => {
    // Deadline Wednesday 25 November 2026; Thursday is Thanksgiving; the team starts Friday.
    const deadline = cancellationDeadline(cst("2026-11-20"));
    expect(iso(deadline)).toBe("2026-11-26T05:59:59.999Z");
    expect(iso(firstWorkingDay(deadline))).toBe("2026-11-27T06:00:00.000Z");
    // Deadline on a Friday (signed Tuesday 3 November): the team starts Monday.
    expect(iso(firstWorkingDay(cancellationDeadline(cst("2026-11-03"))))).toBe("2026-11-09T06:00:00.000Z");
    // Signed Tuesday 10 November: Wednesday 11 is Veterans Day, so Thu 12, Fri 13, Mon 16; the team starts Tuesday 17.
    expect(iso(cancellationDeadline(cst("2026-11-10")))).toBe("2026-11-17T05:59:59.999Z");
    expect(iso(firstWorkingDay(cancellationDeadline(cst("2026-11-10"))))).toBe("2026-11-17T06:00:00.000Z");
  });
});

// A contract signed on Monday 16 November 2026 at 10:00 in Texas.
const SIGNED_AT = cst("2026-11-16", "10:00:00");
const DEADLINE = cancellationDeadline(SIGNED_AT);
const signed = (overrides: Partial<AgreementRecord> = {}): AgreementRecord => ({
  disclosureAcknowledgedAt: iso(new Date(SIGNED_AT.getTime() - 5 * 60 * 1000)),
  signedAt: iso(SIGNED_AT),
  cancellationDeadline: iso(DEADLINE),
  cancelledAt: null,
  serviceEndRequestedAt: null,
  ...overrides,
});
const after = (ms: number) => new Date(DEADLINE.getTime() + ms);

describe("the gate: when work may start", () => {
  it("is closed with nothing on record, and says the disclosure comes first", () => {
    for (const nothing of [null, undefined, NO_AGREEMENT]) {
      const gate = workMayStart(nothing, SIGNED_AT);
      expect(gate.allowed).toBe(false);
      expect(gate).toMatchObject({ code: "disclosure_not_acknowledged" });
    }
  });

  it("is closed while the contract is unsigned", () => {
    const gate = workMayStart(signed({ signedAt: null, cancellationDeadline: null }), SIGNED_AT);
    expect(gate).toMatchObject({ allowed: false, code: "not_signed" });
  });

  it("is closed through the whole cancellation period, to its last millisecond", () => {
    for (const now of [SIGNED_AT, cst("2026-11-18"), DEADLINE]) {
      const gate = workMayStart(signed(), now);
      expect(gate, iso(now)).toMatchObject({ allowed: false, code: "in_cancellation_window" });
      if (!gate.allowed) {
        // Deadline Thursday 19; the team may begin Friday 20.
        expect(gate.startsAt).toBe("2026-11-20T06:00:00.000Z");
        expect(gate.reason.es).toMatch(/periodo de cancelación de 3 días hábiles.*viernes, 20 de noviembre/);
        expect(gate.reason.en).toMatch(/3-business-day cancellation period.*Friday, November 20/);
      }
    }
  });

  it("opens one millisecond after the deadline", () => {
    expect(workMayStart(signed(), after(1))).toEqual({ allowed: true });
  });

  it("stays closed for a cancelled agreement, for ever", () => {
    const cancelled = signed({ cancelledAt: iso(cst("2026-11-17")) });
    for (const now of [cst("2026-11-17", "13:00:00"), after(1), cst("2027-06-01")]) {
      expect(workMayStart(cancelled, now)).toMatchObject({ allowed: false, code: "cancelled" });
    }
  });

  it("closes again when the client asks to end the service", () => {
    const gate = workMayStart(signed({ serviceEndRequestedAt: iso(cst("2026-12-10")) }), cst("2026-12-11"));
    expect(gate).toMatchObject({ allowed: false, code: "service_end_requested" });
  });

  it("a signature without the earlier acknowledgement does not open it", () => {
    expect(workMayStart(signed({ disclosureAcknowledgedAt: null }), after(1))).toMatchObject({
      allowed: false,
      code: "disclosure_not_acknowledged",
    });
  });

  it("gives every refusal a sentence in Spanish and in English", () => {
    const cases = [
      workMayStart(null, SIGNED_AT),
      workMayStart(signed({ signedAt: null }), SIGNED_AT),
      workMayStart(signed(), SIGNED_AT),
      workMayStart(signed({ cancelledAt: iso(SIGNED_AT) }), after(1)),
      workMayStart(signed({ serviceEndRequestedAt: iso(after(5)) }), after(10)),
    ];
    expect(new Set(cases.map((c) => (c.allowed ? "" : c.code))).size).toBe(5);
    for (const gate of cases) {
      expect(gate.allowed).toBe(false);
      if (!gate.allowed) {
        expect(gate.reason.es.length).toBeGreaterThan(30);
        expect(gate.reason.en.length).toBeGreaterThan(30);
        expect(checkClaimGuardrails(`${gate.reason.es} ${gate.reason.en}`)).toEqual([]);
      }
    }
  });

  it("works out the deadline from the signing time when none was stored, and never trusts an unreadable date", () => {
    const noStored = signed({ cancellationDeadline: null });
    expect(deadlineOf(noStored)).toEqual(DEADLINE);
    expect(workMayStart(noStored, DEADLINE)).toMatchObject({ allowed: false, code: "in_cancellation_window" });
    expect(workMayStart(noStored, after(1))).toEqual({ allowed: true });
    expect(deadlineOf(signed({ cancellationDeadline: "not a date" }))).toEqual(DEADLINE);
    // A signature whose own date cannot be read counts as still inside the window.
    expect(workMayStart(signed({ signedAt: "garbage", cancellationDeadline: null }), cst("2030-01-01"))).toMatchObject({
      allowed: false,
      code: "in_cancellation_window",
    });
  });
});

describe("cancelling without penalty", () => {
  it("is possible from the signature to the deadline, inclusive, and not after", () => {
    expect(canCancelWithoutPenalty(signed(), SIGNED_AT)).toBe(true);
    expect(canCancelWithoutPenalty(signed(), DEADLINE)).toBe(true);
    expect(canCancelWithoutPenalty(signed(), after(1))).toBe(false);
  });

  it("is not possible without a signature or twice", () => {
    expect(canCancelWithoutPenalty(null, SIGNED_AT)).toBe(false);
    expect(canCancelWithoutPenalty(signed({ signedAt: null }), SIGNED_AT)).toBe(false);
    expect(canCancelWithoutPenalty(signed({ cancelledAt: iso(SIGNED_AT) }), SIGNED_AT)).toBe(false);
  });

  it("names where an agreement stands", () => {
    expect(agreementPhase(null, SIGNED_AT)).toBe("none");
    expect(agreementPhase(signed({ signedAt: null }), SIGNED_AT)).toBe("disclosed");
    expect(agreementPhase(signed(), DEADLINE)).toBe("in_window");
    expect(agreementPhase(signed(), after(1))).toBe("active");
    expect(agreementPhase(signed({ cancelledAt: iso(SIGNED_AT) }), after(1))).toBe("cancelled");
    expect(agreementPhase(signed({ serviceEndRequestedAt: iso(after(5)) }), after(10))).toBe("end_requested");
  });
});

describe("terms: the business facts the owner fills in", () => {
  it("are all missing until set, each with its own variable", () => {
    expect(missingTerms(empty)).toEqual([...REQUIRED_TERMS]);
    expect(missingTerms(complete)).toEqual([]);
    for (const key of REQUIRED_TERMS) expect(TERM_ENV[key]).toMatch(/^NEXT_PUBLIC_[A-Z_]+$/);
    expect(TERM_ENV.companyLegalName).toBe("NEXT_PUBLIC_COMPANY_LEGAL_NAME");
    expect(TERM_ENV.companyAddress).toBe("NEXT_PUBLIC_COMPANY_ADDRESS");
    expect(TERM_ENV.monthlyFee).toBe("NEXT_PUBLIC_PLAN_MONTHLY_FEE");
  });

  it("reads amounts carefully and works out the total", () => {
    expect(complete.monthlyFee).toBe("89.00");
    expect(complete.estimatedMonths).toBe(6);
    expect(complete.estimatedTotal).toBe("534.00");
    expect(resolveTerms({ monthlyFee: "$1,089.5", estimatedMonths: "3" }).estimatedTotal).toBe("3268.50");
    for (const bad of ["", " ", "free", "0", "-5", "89.999", "8 9"]) {
      expect(resolveTerms({ monthlyFee: bad }).monthlyFee, bad).toBeNull();
    }
    for (const bad of ["", "0", "six", "2.5", "-1"]) {
      expect(resolveTerms({ estimatedMonths: bad }).estimatedMonths, bad).toBeNull();
    }
    expect(resolveTerms({ companyLegalName: "   " }).companyLegalName).toBeNull();
  });

  it("the phone is optional", () => {
    expect(REQUIRED_TERMS).not.toContain("companyPhone");
  });
});

describe("readiness: who may sign", () => {
  it("is ready only with complete terms, verified statutory text and this version approved", () => {
    const ready = readinessFrom(COMPLETE, AGREEMENT_VERSION, false, []);
    expect(ready).toMatchObject({ ready: true, mode: "ready", canSign: true, termsComplete: true, approved: true });
  });

  it("a real database with missing terms is blocked, and says which variables are missing", () => {
    const r = readinessFrom({ ...COMPLETE, monthlyFee: undefined, bondSuretyName: "" }, AGREEMENT_VERSION, false, []);
    expect(r).toMatchObject({ ready: false, mode: "blocked", canSign: false, termsComplete: false });
    expect(r.missing).toEqual([
      { key: "monthlyFee", env: "NEXT_PUBLIC_PLAN_MONTHLY_FEE" },
      { key: "bondSuretyName", env: "NEXT_PUBLIC_TX_BOND_SURETY_NAME" },
    ]);
  });

  it("an approval of another version does not count", () => {
    for (const approved of [null, "", "2025-01-01", `${AGREEMENT_VERSION}-b`]) {
      expect(readinessFrom(COMPLETE, approved, false, []), String(approved)).toMatchObject({ ready: false, approved: false, mode: "blocked" });
    }
    expect(readinessFrom(COMPLETE, ` ${AGREEMENT_VERSION} `, false, []).approved).toBe(true);
  });

  it("unverified statutory text blocks real signing even with an approval on record", () => {
    const r = readinessFrom(COMPLETE, AGREEMENT_VERSION, false, ["15 U.S.C. §1679c(a)"]);
    expect(r).toMatchObject({ ready: false, mode: "blocked", canSign: false });
  });

  it("the demo may sign a draft for demonstration, and is never 'ready' by itself", () => {
    const r = readinessFrom({}, null, true);
    expect(r).toMatchObject({ ready: false, mode: "demo_draft", canSign: true, demo: true });
  });

  it("as shipped: nothing is approved, the statutory text is unverified, and the test environment is the demo", () => {
    const r = agreementReadiness();
    expect(r.ready).toBe(false);
    expect(r.approved).toBe(false);
    expect(r.mode).toBe("demo_draft");
    expect(r.unverifiedStatutes).toEqual(unverifiedStatuteCitations());
    expect(r.missing.map((m) => m.key)).toEqual([...REQUIRED_TERMS]);
    // The same build with a database configured refuses to take a signature.
    expect(agreementReadiness({ demo: false })).toMatchObject({ mode: "blocked", canSign: false });
  });
});

describe("statutory text", () => {
  it("every passage names its section, the page to compare it with and the day it was checked", () => {
    for (const text of Object.values(STATUTE_TEXTS)) {
      expect(text.citation).toMatch(/15 U\.S\.C\. §1679|Tex\. Fin\. Code §393/);
      expect(text.compareWith).toMatch(/^https:\/\/(uscode\.house\.gov|statutes\.capitol\.texas\.gov)\//);
      expect(text.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(text.note.length).toBeGreaterThan(40);
    }
  });

  it("is marked unverified until someone compares it with the official page (change this test when that is done)", () => {
    // None of these could be compared word for word when they were written.
    // Flip a flag only after the comparison, and bump AGREEMENT_VERSION if a word changes.
    expect(Object.values(STATUTE_TEXTS).filter((t) => t.verified)).toEqual([]);
  });

  it("carries the sentence the Act puts next to the signature, exactly", () => {
    expect(CROA_CONTRACT_CANCEL_SENTENCE.text).toBe(
      "You may cancel this contract without penalty or obligation at any time before midnight of the 3rd business day after the date on which you signed the contract. See the attached notice of cancellation form for an explanation of this right.",
    );
  });

  it("carries the federal disclosure under its statutory heading", () => {
    expect(CROA_DISCLOSURE.heading).toBe("Consumer Credit File Rights Under State and Federal Law");
    expect(CROA_DISCLOSURE.paragraphs[0]).toMatch(/^You have a right to dispute inaccurate information in your credit report by contacting the credit bureau directly\./);
    expect(CROA_DISCLOSURE.paragraphs.join(" ")).toContain(
      "You have the right to cancel your contract with any credit repair organization for any reason within 3 business days from the date you signed it.",
    );
    expect(CROA_DISCLOSURE.contact).toEqual(["The Public Reference Branch", "Federal Trade Commission", "Washington, D.C. 20580"]);
  });
});

describe("the documents", () => {
  const es = agreementDocuments("es", complete);
  const en = agreementDocuments("en", complete);
  const text = (docs: typeof es, key: Parameters<typeof agreementDocument>[0]) => documentText(docs.find((d) => d.key === key)!);

  it("are six, in the order the client meets them, all pending the attorney", () => {
    for (const docs of [es, en]) {
      expect(docs.map((d) => d.key)).toEqual([
        "federal_disclosure",
        "texas_disclosure",
        "esign_consent",
        "contract",
        "authorization",
        "cancellation_notice",
      ]);
      for (const d of docs) {
        expect(d.reviewStatus).toBe("attorney_pending");
        expect(d.verified).toBe(false);
        expect(d.title.length).toBeGreaterThan(8);
        expect(d.blocks.length).toBeGreaterThan(3);
      }
    }
    expect([...DISCLOSURE_STEP, ...CONTRACT_STEP]).toEqual(es.map((d) => d.key));
  });

  it("the federal disclosure is its own document, before the contract, with the statute's English text in both languages", () => {
    for (const docs of [es, en]) {
      expect(docs[0]!.key).toBe("federal_disclosure");
      const body = text(docs, "federal_disclosure");
      expect(body).toContain(CROA_DISCLOSURE.heading);
      for (const paragraph of CROA_DISCLOSURE.paragraphs) expect(body).toContain(paragraph);
      for (const line of CROA_DISCLOSURE.contact) expect(body).toContain(line);
      // Nothing of the contract is in it.
      expect(body).not.toMatch(/\$89|Credalti LLC/);
    }
    // In English it is the statute's text and nothing else.
    expect(en[0]!.blocks.every((b) => b.origin === "federal_statute")).toBe(true);
  });

  it("the Spanish version adds a translation, labelled as one, and says the English controls", () => {
    const doc = es[0]!;
    expect(doc.blocks.some((b) => b.origin === "translation" && /Usted tiene derecho a disputar la información inexacta/.test(b.text))).toBe(true);
    expect(doc.blocks.some((b) => b.origin === "translation" && /prevalece el texto en inglés/.test(b.text))).toBe(true);
    expect(doc.blocks.some((b) => b.origin === "translation" && b.kind === "heading" && /Texto oficial en inglés/.test(b.text))).toBe(true);
    // Every statutory paragraph has a translated counterpart.
    expect(doc.blocks.filter((b) => b.origin === "translation" && b.kind === "paragraph").length).toBe(CROA_DISCLOSURE.paragraphs.length + 1);
  });

  it("the Texas disclosure covers each topic the statute lists, and every passage is marked for the attorney", () => {
    for (const docs of [es, en]) {
      const doc = docs.find((d) => d.key === "texas_disclosure")!;
      expect(doc.blocks.every((b) => isTexasSpecific(b.origin))).toBe(true);
      expect(doc.blocks.filter((b) => b.kind === "heading")).toHaveLength(10);
    }
    const body = text(en, "texas_disclosure");
    for (const topic of [
      /services and their total cost/,
      /proceed against our surety bond/,
      /Example Surety Company, 1 Bond Plaza, Dallas, TX 75201/,
      /right to review any file that a consumer reporting agency/,
      /not later than the 30th day after the date you received notice that credit was denied/,
      /dispute directly with a consumer reporting agency the completeness or accuracy/,
      /Accurate information cannot be permanently removed from the files of a consumer reporting agency/,
      /becomes obsolete 7 years/,
      /Nonprofit credit counseling services are available/,
      /registration number 20260000/,
    ]) {
      expect(body).toMatch(topic);
    }
    expect(text(es, "texas_disclosure")).toMatch(/La información exacta no puede quitarse de forma permanente/);
  });

  it("the contract carries the Act's cancellation sentence in bold, among the statements placed by the signature", () => {
    for (const docs of [es, en]) {
      const contract = docs.find((d) => d.key === "contract")!;
      const statements = contract.signatureStatements!;
      const federal = statements.find((b) => b.origin === "federal_statute")!;
      expect(federal.text).toBe(CROA_CONTRACT_CANCEL_SENTENCE.text);
      expect(federal.bold).toBe(true);
      const texas = statements.find((b) => b.origin === "texas_statute")!;
      expect(texas.text).toBe(TEXAS_CONTRACT_CANCEL_SENTENCE.text);
      expect(texas.bold).toBe(true);
      // And it is part of the text that is hashed and printed.
      expect(documentText(contract)).toContain(`**${CROA_CONTRACT_CANCEL_SENTENCE.text}**`);
    }
    // In Spanish each is preceded by its translation, also in bold.
    const esStatements = es.find((d) => d.key === "contract")!.signatureStatements!;
    expect(esStatements[0]).toMatchObject({ origin: "translation", bold: true });
    expect(esStatements[0]!.text).toMatch(/antes de la medianoche del 3\.er día hábil/);
  });

  it("the contract states who the company is, what it does, what it costs, how long, and that nothing is guaranteed", () => {
    const body = text(en, "contract");
    // The company's name and principal business address.
    expect(body).toContain("Credalti LLC");
    expect(body).toContain("100 Example Street, Suite 200, Houston, TX 77002");
    // A full description of the services, as the product works.
    expect(body).toMatch(/Import your credit report\..*credit monitoring subscription/);
    expect(body).toMatch(/You, and only you, tell us which items you believe are inaccurate/);
    expect(body).toMatch(/We never decide for you what is inaccurate/);
    expect(body).toMatch(/Prepare your dispute letters\..*credit bureaus.*creditor.*debt collector/);
    expect(body).toMatch(/Print and mail the letters/);
    expect(body).toMatch(/about one round every 40 days/);
    expect(body).toMatch(/we import your new report, compare it with the one before/);
    // No guarantee, said plainly.
    expect(body).toMatch(/We do not guarantee any result/);
    expect(body).toMatch(/We give no guarantee of results/);
    // Payment terms and the total.
    expect(body).toMatch(/Our fee: \$89\.00 for each month of service/);
    expect(body).toMatch(/the total you pay us is \$534\.00/);
    expect(body).toMatch(/credit monitoring subscription, which you buy and pay for directly/);
    expect(body).toMatch(/earns a commission from the monitoring service/);
    // Nothing before the service is fully performed.
    expect(body).toMatch(/We do not charge or receive any money or other valuable consideration for a service before that service has been fully performed \(15 U\.S\.C\. §1679b\(b\)\)/);
    // The estimated length, and when work begins.
    expect(body).toMatch(/will take 6 months from the day work begins/);
    expect(body).toMatch(/We do not begin any work during the cancellation period/);
    // Texas: registration, bond and agent for service of process.
    expect(body).toMatch(/registration number 20260000/);
    expect(body).toMatch(/\$10,000 surety bond issued by Example Surety Company/);
    expect(body).toMatch(/authorized to receive service of process is Example Registered Agent Inc\./);
    // The right to cancel, the attached notice, and ending later at no cost.
    expect(body).toMatch(/A notice of cancellation form is attached to this agreement, in duplicate/);
    expect(body).toMatch(/Ending it costs nothing/);
    expect(body).not.toMatch(PLACEHOLDER_PATTERN);
    PLACEHOLDER_PATTERN.lastIndex = 0;

    const spanish = text(es, "contract");
    expect(spanish).toMatch(/No garantizamos ningún resultado/);
    expect(spanish).toMatch(/Nunca cobramos por adelantado/);
    expect(spanish).toMatch(/Nosotros nunca decidimos por usted qué es inexacto/);
    expect(spanish).toMatch(/\$534\.00/);
  });

  it("shows a visible placeholder for every term the owner has not set", () => {
    for (const locale of ["es", "en"] as const) {
      const all = agreementDocuments(locale, empty).map(documentText).join("\n");
      const found = new Set(all.match(new RegExp(PLACEHOLDER_PATTERN.source, "g")) ?? []);
      const word = locale === "es" ? "PENDIENTE" : "PENDING";
      expect(found.size).toBeGreaterThanOrEqual(REQUIRED_TERMS.length);
      for (const p of found) expect(p.startsWith(`[${word}: `) || (locale === "es" && p.startsWith("[PENDING: "))).toBe(true);
      expect(all).toContain(locale === "es" ? "[PENDIENTE: cuota mensual]" : "[PENDING: monthly fee]");
      expect(all).toContain(locale === "es" ? "[PENDIENTE: nombre de la afianzadora]" : "[PENDING: surety company name]");
      expect(all).toContain(locale === "es" ? "[PENDIENTE: número de registro en Texas]" : "[PENDING: Texas registration number]");
    }
    const filled = agreementDocuments("es", complete).map(documentText).join("\n");
    expect(filled.match(new RegExp(PLACEHOLDER_PATTERN.source, "g"))).toBeNull();
  });

  it("the notice of cancellation is the statutory form with the company, its address and the deadline filled in", () => {
    const deadline = cancellationDeadline(cst("2026-11-20", "15:00:00")); // ends Wednesday 25 November
    for (const locale of ["es", "en"] as const) {
      const notice = agreementDocument("cancellation_notice", locale, complete, { deadline });
      const body = documentText(notice);
      expect(body).toContain(`## ${CROA_CANCELLATION_FORM.heading}`);
      expect(body).toContain(`**${CROA_CANCELLATION_FORM.statement}**`);
      expect(body).toContain(
        "**To cancel this contract, mail or deliver a signed, dated copy of this cancellation notice, or any other written notice to Credalti LLC at 100 Example Street, Suite 200, Houston, TX 77002 before midnight on November 25, 2026**",
      );
      expect(body).toContain("**I hereby cancel this transaction,**");
      expect(body).toMatch(/\*\*_+ \(date\)\*\*/);
      expect(body).toMatch(/\*\*_+ \(purchaser's signature\)\*\*/);
      // The Texas form, which adds the 10-day refund.
      expect(body).toContain(`**${TEXAS_CANCELLATION_FORM.statement}**`);
      expect(body).toContain(`**${TEXAS_CANCELLATION_FORM.refund}**`);
      expect(body).toContain("not later than midnight November 25, 2026");
      // Every statutory line of the form is in bold.
      expect(notice.blocks.filter((b) => b.origin === "federal_statute" && b.kind !== "heading").every((b) => b.bold)).toBe(true);
      expect(notice.blocks.filter((b) => b.origin === "texas_statute" && b.kind !== "heading").every((b) => b.bold)).toBe(true);
    }
    expect(documentText(agreementDocument("cancellation_notice", "es", complete, { deadline }))).toMatch(
      /antes de la medianoche del 25 de noviembre de 2026/,
    );
    // Before signing there is no date yet, and the slot says so.
    expect(documentText(agreementDocument("cancellation_notice", "en", complete))).toMatch(/\[the date is written in when you sign/);
  });

  it("the authorization is narrow, revocable, and says the company never decides what is inaccurate", () => {
    const body = text(en, "authorization");
    expect(body).toMatch(/and nothing else/);
    expect(body).toMatch(/items on my credit reports that I personally reviewed and confirmed/);
    expect(body).toMatch(/follow-up letters about those same items/);
    expect(body).toMatch(/receive and read the answers/);
    expect(body).toMatch(/Credalti never decides what is inaccurate/);
    expect(body).toMatch(/may not add an item, change my answer or choose a reason for me/);
    expect(body).toMatch(/I can revoke this authorization at any time/);
    expect(body).toMatch(/It is not a general power of attorney/);
    const spanish = text(es, "authorization");
    expect(spanish).toMatch(/Credalti nunca decide qué es inexacto/);
    expect(spanish).toMatch(/Puedo revocar esta autorización en cualquier momento/);
  });

  it("the consent to electronic records says how to get a paper copy and how to withdraw", () => {
    expect(text(en, "esign_consent")).toMatch(/paper copy of any of these documents by writing to ayuda@example\.com/);
    expect(text(en, "esign_consent")).toMatch(/withdraw this consent at any time/);
    expect(text(es, "esign_consent")).toMatch(/copia en papel/);
  });

  it("stay within the claim rules and the house wording, in both languages", () => {
    for (const docs of [es, en, agreementDocuments("es", empty), agreementDocuments("en", empty)]) {
      for (const d of docs) {
        const body = documentText(d);
        expect(checkClaimGuardrails(body), `${d.key}: ${body.slice(0, 60)}`).toEqual([]);
        expect(body).not.toMatch(new RegExp(`ataque|CreditCapi|${BRAND.internalName}`, "i"));
        expect(body).not.toMatch(/\b(eliminamos|reparamos|arreglamos|borramos)\b/i);
      }
    }
  });
});

describe("the fingerprint of what was signed", () => {
  it("sha256Hex agrees with Node's SHA-256", () => {
    const samples = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(119), "a".repeat(1000),
      "Usted, el comprador — «3.er día hábil» ñ á ü 🙂", documentText(agreementDocuments("es", complete)[3]!)];
    for (const sample of samples) {
      expect(sha256Hex(sample), `${sample.length} chars`).toBe(createHash("sha256").update(sample, "utf8").digest("hex"));
    }
  });

  it("is stable, and changes with the version, the language or any term", () => {
    const hash = documentHash(AGREEMENT_VERSION, "es", complete);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(documentHash(AGREEMENT_VERSION, "es", resolveTerms(COMPLETE))).toBe(hash);
    expect(documentHash(`${AGREEMENT_VERSION}.x`, "es", complete)).not.toBe(hash);
    expect(documentHash(AGREEMENT_VERSION, "en", complete)).not.toBe(hash);
    expect(documentHash(AGREEMENT_VERSION, "es", resolveTerms({ ...COMPLETE, monthlyFee: "90" }))).not.toBe(hash);
    expect(documentHash(AGREEMENT_VERSION, "es", resolveTerms({ ...COMPLETE, bondSuretyAddress: "Other" }))).not.toBe(hash);
    expect(documentHash(AGREEMENT_VERSION, "es", empty)).not.toBe(hash);
  });

  it("the step-1 fingerprint covers the disclosures only", () => {
    const base = disclosureHash(AGREEMENT_VERSION, "es", complete);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).not.toBe(documentHash(AGREEMENT_VERSION, "es", complete));
    // The agent for service of process appears in the contract only.
    const otherAgent = resolveTerms({ ...COMPLETE, texasAgentName: "Another Agent" });
    expect(disclosureHash(AGREEMENT_VERSION, "es", otherAgent)).toBe(base);
    expect(documentHash(AGREEMENT_VERSION, "es", otherAgent)).not.toBe(documentHash(AGREEMENT_VERSION, "es", complete));
    // The surety is in the Texas disclosure.
    expect(disclosureHash(AGREEMENT_VERSION, "es", resolveTerms({ ...COMPLETE, bondSuretyName: "Other Surety" }))).not.toBe(base);
  });
});

describe("the typed signature", () => {
  it("wants a full name", () => {
    for (const good of ["Ana Pérez", "María José Hernández López", "José O'Neill", "Jean-Luc Picard", "Li Wu"]) {
      expect(isFullName(good), good).toBe(true);
    }
    for (const bad of ["", "Ana", "  Ana  ", "A", "Ana 123", "ana@example.com", "x".repeat(121) + " y"]) {
      expect(isFullName(bad), bad).toBe(false);
    }
  });

  it("matches the profile name without being fussy about accents, capitals or a missing second name", () => {
    const profile = "María José Hernández López";
    for (const typed of ["María José Hernández López", "maria jose hernandez lopez", "MARIA HERNANDEZ", "María Hernández López", "Hernández López María José"]) {
      expect(signerNameMatches(typed, profile), typed).toBe(true);
    }
    // The longer form of a shorter profile name.
    expect(signerNameMatches("Juan Carlos Pérez García", "Juan Pérez")).toBe(true);
    for (const typed of ["Juan Pérez", "María", "María Gómez", "José López Martínez", ""]) {
      expect(signerNameMatches(typed, profile), typed).toBe(false);
    }
    // A one-word profile name only has to be contained.
    expect(signerNameMatches("Ana Ejemplo", "Ana")).toBe(true);
    expect(signerNameMatches("Luis Ejemplo", "Ana")).toBe(false);
  });

  it("has nothing to compare with when the profile has no name", () => {
    expect(signerNameMatches("Ana Ejemplo", "")).toBe(true);
    expect(signerNameMatches("Ana Ejemplo", null)).toBe(true);
    expect(signerNameMatches("Ana Ejemplo", undefined)).toBe(true);
  });
});

describe("the record", () => {
  it("reads a database row", () => {
    const state = agreementFromRow({
      disclosure_acknowledged_at: "2026-11-16T15:55:00+00:00",
      disclosure_locale: "es",
      signed_at: "2026-11-16T16:00:00+00:00",
      locale: "en",
      document_version: AGREEMENT_VERSION,
      document_hash: "a".repeat(64),
      signer_name: "Ana Ejemplo",
      cancellation_deadline: "2026-11-20T05:59:59.999+00:00",
      cancelled_at: null,
      cancelled_within_window: null,
      terms: { monthlyFee: "89.00" },
    });
    expect(state).toMatchObject({
      disclosureAcknowledgedAt: "2026-11-16T15:55:00.000Z",
      signedAt: "2026-11-16T16:00:00.000Z",
      cancellationDeadline: "2026-11-20T05:59:59.999Z",
      cancelledAt: null,
      serviceEndRequestedAt: null,
      locale: "en",
      signerName: "Ana Ejemplo",
      version: AGREEMENT_VERSION,
    });
    expect(workMayStart(state, new Date("2026-11-20T06:00:00.000Z"))).toEqual({ allowed: true });
    // Before signing, the language is the one the disclosures were shown in.
    expect(agreementFromRow({ disclosure_acknowledged_at: "2026-11-16T15:55:00Z", disclosure_locale: "es" }).locale).toBe("es");
  });

  it("drops what is not a record when read back from the browser", () => {
    for (const junk of [null, undefined, "x", 3, [], {}, { signedAt: "2026-11-16T16:00:00.000Z" }, { disclosureAcknowledgedAt: "nope" }]) {
      expect(normalizeAgreement(junk)).toBeNull();
    }
    const kept = normalizeAgreement({ disclosureAcknowledgedAt: "2026-11-16T15:55:00.000Z", signedAt: 5, locale: "fr", extra: true });
    expect(kept).toMatchObject({ disclosureAcknowledgedAt: "2026-11-16T15:55:00.000Z", signedAt: null, locale: null });
    expect(kept).not.toHaveProperty("extra");
  });
});

describe("the journey", () => {
  const items = DEMO_REPORT.items;
  const every = (state: string) => Object.fromEntries(items.map((i) => [i.fingerprint, { state }]));
  const some = { [items[0]!.fingerprint]: { state: "attested" } };
  const base = (flags: Record<string, { state: string }>, roundApproved: boolean, agreement: AgreementRecord | null): JourneyState =>
    sessionJourneyState(items, flags, roundApproved, agreement);
  const full = (state: JourneyState, now: Date) => nextAction(state, "es", { mode: "full_service", now });
  const self = (state: JourneyState, now: Date) => nextAction(state, "es", { mode: "diy", now });
  const NOW = cst("2026-11-17");
  const LATER = after(24 * 3600 * 1000);

  it("full service starts with the agreement, before the report or the review", () => {
    for (const flags of [{}, some, every("attested")]) {
      const step = full(base(flags, false, null), NOW);
      expect(step).toMatchObject({ key: "agreement", step: 1, totalSteps: 6, href: "/acuerdo" });
      expect(step.title).toBe("Primero: tu acuerdo de servicio");
    }
    // Even with no report yet, the agreement is first.
    expect(full({ ...base({}, false, null), reportImported: false }, NOW).key).toBe("agreement");
    // Read the disclosures, not yet signed.
    const disclosed = full(base({}, false, signed({ signedAt: null, cancellationDeadline: null })), NOW);
    expect(disclosed).toMatchObject({ key: "agreement", href: "/acuerdo", title: "Te falta firmar tu acuerdo" });
  });

  it("with no agreement given, a screen falls back to this device's copy, which is none on the server", () => {
    expect(sessionJourneyState(items, {}, false).agreement).toBeNull();
    expect(nextAction(sessionJourneyState(items, {}, false), "es", { mode: "full_service" }).key).toBe("agreement");
  });

  it("after signing, the client's part is the report and the review", () => {
    const noReport = full({ ...base({}, false, signed()), reportImported: false }, NOW);
    expect(noReport).toMatchObject({ key: "import", step: 2, href: "/onboarding" });
    expect(full(base({}, false, signed()), NOW)).toMatchObject({ key: "review", step: 3, href: "/asistente" });
    expect(full(base(some, false, signed()), NOW)).toMatchObject({ key: "review", step: 3 });
    expect(full(base(every("correct"), false, signed()), LATER)).toMatchObject({ key: "review-empty", step: 3, href: "/items" });
  });

  it("once the review is done, the team prepares and mails: no step asks the client to send or approve", () => {
    const step = full(base(every("attested"), false, signed()), LATER);
    expect(step).toMatchObject({ key: "team-preparing", step: 4, title: "Listo: tu equipo prepara y envía tus cartas" });
    expect(step.description).toMatch(/Tú ya terminaste: tu equipo prepara las cartas y las envía por correo/);

    const states = [
      base(every("attested"), false, signed()),
      base(every("attested"), true, signed()),
      { ...base(every("attested"), true, signed()), mailedAt: iso(new Date(LATER.getTime() - 50 * 24 * 3600 * 1000)) },
    ];
    for (const locale of ["es", "en"] as const) {
      for (const state of states) {
        const s = nextAction(state, locale, { mode: "full_service", now: LATER });
        const words = `${s.title} ${s.description} ${s.cta}`;
        expect(words).not.toMatch(/aprueba|aprobar|apruebas|revisa(r)? (mis|tus) cartas|armas|tú envías|approve|you send|you build|review my letters/i);
        expect(checkClaimGuardrails(words)).toEqual([]);
      }
    }
  });

  it("never says letters were sent while the cancellation period is open, and says when the team starts", () => {
    // The review is done and even a round is marked as mailed: inside the window nothing has gone out.
    for (const roundApproved of [false, true]) {
      const step = full(base(every("attested"), roundApproved, signed()), NOW);
      expect(step).toMatchObject({ key: "team-starts-soon", step: 4, href: "/acuerdo" });
      expect(step.description).toMatch(/Tu equipo empieza el viernes, 20 de noviembre, cuando termina tu plazo de 3 días hábiles/);
      expect(`${step.title} ${step.description}`).not.toMatch(/en camino|ya las envió|on their way/);
    }
    const english = nextAction(base(every("attested"), true, signed()), "en", { mode: "full_service", now: NOW });
    expect(english.description).toMatch(/Your team starts on Friday, November 20/);
  });

  it("after the window: mailed letters are on their way, then the team prepares the next round", () => {
    const mailed = { ...base(every("attested"), true, signed()), mailedAt: iso(LATER) };
    const waiting = full(mailed, new Date(LATER.getTime() + 5 * 24 * 3600 * 1000));
    expect(waiting).toMatchObject({ key: "waiting", step: 5, href: "/rounds" });
    expect(waiting.description).toMatch(/Tu equipo ya las envió.*quedan ~25/);
    const next = full(mailed, new Date(LATER.getTime() + 41 * 24 * 3600 * 1000));
    expect(next).toMatchObject({ key: "next-round", step: 6, title: "Tu equipo prepara la siguiente ronda" });
    expect(next.description).toMatch(/No tienes que hacer nada/);
  });

  it("a cancelled agreement stops everything, and a request to end the service is said plainly", () => {
    const cancelled = full(base(every("attested"), true, signed({ cancelledAt: iso(NOW) })), LATER);
    expect(cancelled).toMatchObject({ key: "agreement-cancelled", href: "/acuerdo", title: "Cancelaste tu acuerdo" });
    expect(cancelled.description).toMatch(/no debes nada/);
    const ending = full(base(every("attested"), true, signed({ serviceEndRequestedAt: iso(LATER) })), new Date(LATER.getTime() + 1000));
    expect(ending).toMatchObject({ key: "end-requested", href: "/acuerdo" });
  });

  it("self-serve keeps its five steps and does not ask for an agreement", () => {
    expect(self({ ...base({}, false, null), reportImported: false }, NOW)).toMatchObject({ key: "import", step: 1, totalSteps: 5 });
    expect(self(base({}, false, null), NOW)).toMatchObject({ key: "review", step: 2 });
    expect(self(base(every("correct"), false, null), NOW)).toMatchObject({ key: "review-empty", step: 2 });
    const letters = self(base(every("attested"), false, null), NOW);
    expect(letters).toMatchObject({ key: "attack", step: 3, title: "Tus cartas están listas para tu revisión" });
    expect(self(base(every("attested"), true, null), NOW)).toMatchObject({ key: "waiting", step: 4, href: "/rounds" });
    const mailedLongAgo = { ...base(every("attested"), true, null), mailedAt: iso(new Date(NOW.getTime() - 41 * 24 * 3600 * 1000)) };
    expect(self(mailedLongAgo, NOW)).toMatchObject({ key: "next-round", step: 5 });
  });

  it("the app runs the full-service journey by default", () => {
    expect(nextAction(base({}, false, null), "es").key).toBe("agreement");
  });
});

describe("the staff console and the agreement", () => {
  // Noon in Texas on Saturday 5 December 2026.
  const NOW = new Date("2026-12-05T18:00:00.000Z");
  const clients = buildDemoClients(NOW);
  const later = new Date(NOW.getTime() + 5 * 60 * 1000);
  const byId = (id: string) => clients.find((c) => c.id === id)!;
  const inWindow = byId("c17");
  const cancelled = byId("c18");
  const ending = byId("c19");

  it("every signed demo client has the whole record: acknowledged first, a version and a deadline", () => {
    for (const c of clients.filter((c) => c.agreementSignedAt)) {
      expect(c.disclosureAcknowledgedAt! < c.agreementSignedAt!, c.id).toBe(true);
      // Each option has its own agreement text and version (docs/SERVICE-OPTIONS.md).
      expect(c.agreementVersion, c.id).toBe(c.serviceOption === "diy" ? DIY_AGREEMENT_VERSION : AGREEMENT_VERSION);
      expect(c.cancellationDeadline).toBe(cancellationDeadline(new Date(c.agreementSignedAt!)).toISOString());
    }
    for (const c of clients.filter((c) => !c.agreementSignedAt)) {
      expect(c.disclosureAcknowledgedAt, c.id).toBeNull();
      expect(c.cancellationDeadline, c.id).toBeNull();
    }
  });

  it("a client inside the window is in a visible stage, is nobody's problem, and the system says when work starts", () => {
    expect(clientStage(inWindow, later)).toBe("cancellation_window");
    expect(clientExceptions(inWindow, later)).toEqual([]);
    // Signed Friday 4 December: Mon 7, Tue 8, Wed 9. The team may begin Thursday 10.
    expect(workStartsAt(inWindow, later)?.toISOString()).toBe("2026-12-10T06:00:00.000Z");
    expect(nextAutomaticStep(inWindow, later)).toEqual({ text: "Empezar el 10 de diciembre", at: "2026-12-10T06:00:00.000Z" });
    expect(nextStep(inWindow, later)).toMatchObject({ actor: "system", text: "Empezar el 10 de diciembre" });
    expect(agreementLine(inWindow, later)).toBe("En periodo de cancelación — se puede empezar el 10 de diciembre");
    expect(clientTimeline(inWindow, later)[0]).toMatchObject({ kind: "upcoming", text: "Empezar el 10 de diciembre" });
  });

  it("sending is blocked inside the window, with a plain sentence, even if a round is prepared", () => {
    const ready = byId("c07");
    expect(sendableRound(ready, later)).not.toBeNull();
    const justSigned = {
      ...ready,
      agreementSignedAt: inWindow.agreementSignedAt,
      disclosureAcknowledgedAt: inWindow.disclosureAcknowledgedAt,
      cancellationDeadline: inWindow.cancellationDeadline,
    };
    expect(clientStage(justSigned, later)).toBe("cancellation_window");
    expect(sendableRound(justSigned, later)).toBeNull();
    expect(sendBlockReason(justSigned, later)).toBe(
      "El cliente está en su periodo de cancelación de 3 días hábiles y la ley no permite empezar antes. Se puede enviar a partir del 10 de diciembre.",
    );
    // The day the window is over, the same client is ready to send again.
    const afterWindow = new Date("2026-12-10T15:00:00.000Z");
    expect(clientStage(justSigned, afterWindow)).toBe("ready_to_send");
    expect(sendBlockReason(justSigned, afterWindow)).toBeNull();
  });

  it("a cancelled client leaves the pipeline and their round can never be sent", () => {
    expect(clientStage(cancelled, later)).toBe("cancelled");
    expect(PIPELINE_STAGES).not.toContain("cancelled");
    expect(cancelled.rounds[0]!.status).toBe("ready");
    expect(clientExceptions(cancelled, later)).toEqual([]);
    expect(nextAutomaticStep(cancelled, later)).toBeNull();
    expect(nextStep(cancelled, later)).toMatchObject({ actor: "staff", text: "Canceló su acuerdo: nada pendiente" });
    expect(sendBlockReason(cancelled, later)).toBe("El cliente canceló su acuerdo. Sus cartas no se envían.");
    for (const when of [later, new Date("2027-06-01T12:00:00.000Z")]) expect(sendableRound(cancelled, when)).toBeNull();
    expect(agreementLine(cancelled, later)).toMatch(/^Cancelado el 30 de noviembre, dentro del plazo$/);
    expect(clientTimeline(cancelled, later).map((e) => e.text)).toContain(
      "Canceló su acuerdo dentro del plazo de 3 días hábiles. No se le cobra ni se le envía nada",
    );
  });

  it("a request to end the service is an exception for a person, and holds every further letter", () => {
    const exceptions = clientExceptions(ending, later);
    expect(exceptions.map((e) => e.kind)).toEqual(["service_end_requested"]);
    expect(exceptions[0]).toMatchObject({ severity: "high", action: "whatsapp" });
    expect(exceptions[0]!.sentence).toMatch(/^Pidió terminar el servicio: «Me voy a mudar fuera de Texas el próximo mes\.»\. No se envía nada más/);
    expect(nextAutomaticStep(ending, later)).toBeNull();
    expect(nextStep(ending, later)).toMatchObject({ actor: "staff", text: "Confirmar con el cliente que termina el servicio" });
    expect(sendBlockReason(ending, later)).toMatch(/pidió terminar el servicio/);
    // With a prepared round in hand it still cannot be sent.
    const withRound = { ...byId("c07"), serviceEndRequestedAt: ending.serviceEndRequestedAt };
    expect(sendableRound(withRound, later)).toBeNull();
    const draft = exceptionMessage(ending, exceptions[0]!);
    expect(checkClaimGuardrails(draft)).toEqual([]);
    expect(draft).toMatch(/ya no se envía ninguna carta más/);
    // No persuading the client to stay.
    expect(draft).not.toMatch(/seguro|piénsalo|descuento|oferta|quédate|no te vayas/i);
  });

  it("an unsigned or older record still reads: the signing date stands in for the acknowledgement", () => {
    const legacy = { ...byId("c07"), disclosureAcknowledgedAt: undefined, cancellationDeadline: undefined };
    expect(sendBlockReason(legacy, later)).toBeNull();
    expect(sendableRound(legacy, later)).not.toBeNull();
    // An explicit "never acknowledged" does block.
    expect(sendBlockReason({ ...byId("c07"), disclosureAcknowledgedAt: null }, later)).toMatch(/declaración de sus derechos/);
    expect(agreementLine(byId("c02"), later)).toBe("Sin firmar");
    expect(agreementLine(byId("c07"), later)).toBe("Vigente — el periodo de cancelación ya terminó");
  });
});

describe("the endpoints without a database (demo)", () => {
  const post = (body: unknown) =>
    new Request("http://localhost/api/agreement/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.50" },
      body: JSON.stringify(body),
    });

  it("status answers 'not signed in', like the other stores' endpoints", async () => {
    const { GET } = await import("@/app/api/agreement/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false, agreement: null });
  });

  it("acknowledge, sign and cancel refuse a caller who is not signed in", async () => {
    const { POST: acknowledge } = await import("@/app/api/agreement/acknowledge/route");
    const { POST: sign } = await import("@/app/api/agreement/sign/route");
    const { POST: cancel } = await import("@/app/api/agreement/cancel/route");
    for (const handler of [acknowledge, sign, cancel]) {
      const res = await handler(post({}));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Not signed in" });
    }
  });

  it("are rate limited", async () => {
    const { POST: sign } = await import("@/app/api/agreement/sign/route");
    const from = (ip: string) =>
      new Request("http://localhost/api/agreement/sign", { method: "POST", headers: { "x-forwarded-for": ip }, body: "{}" });
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await sign(from("203.0.113.99"))).status;
    expect(last).toBe(429);
    expect((await sign(from("203.0.113.100"))).status).toBe(401);
  });
});

describe("where it is wired", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("the letters endpoint checks the gate under full service, before anything is mailed", () => {
    // Under full service the client's approval refuses outright: letters leave only from the staff send.
    const route = read("src/app/api/attacks/approve/route.ts");
    expect(route).toMatch(/if \(isFullService\) \{[\s\S]*full_service_team_sends[\s\S]*status: 409/);
    expect(route.indexOf("isFullService) {")).toBeLessThan(route.indexOf("sendRound("));
    // The one mailing path (approve and the staff send) checks the gate before anything is mailed.
    const send = read("src/lib/rounds/send.ts");
    expect(send).toMatch(/if \(options\.requireAgreement\) \{[\s\S]*workGate\(/);
    expect(send).toMatch(/workMayStart\(agreement, now\)[\s\S]*refuse\(409/);
    expect(send.indexOf("await workGate(")).toBeLessThan(send.indexOf("await mail({"));
    expect(read("src/lib/staff/actions.ts")).toMatch(/requireAgreement: true/);
  });

  it("the agreement pages are behind the login gate", () => {
    expect(read("src/proxy.ts")).toContain('"/acuerdo/:path*"');
  });

  it("the migration keeps the table read-only for clients and staff and protects the record", () => {
    const sql = read("supabase/migrations/0010_service_agreements.sql");
    expect(sql).toMatch(/alter table public\.service_agreements enable row level security/);
    expect(sql.match(/create policy/g)).toHaveLength(2);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/);
    expect(sql).toMatch(/for select using \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/for select using \(public\.is_staff\(\)\)/);
    expect(sql).toMatch(/before update or delete on public\.service_agreements/);
    expect(sql).toMatch(/on delete restrict/);
  });

  it("the signing endpoints refuse while the agreement is not ready, and compute the deadline themselves", () => {
    const sign = read("src/app/api/agreement/sign/route.ts");
    expect(sign).toMatch(/if \(!readiness\.ready\)[\s\S]*agreement_not_ready[\s\S]*status: 409/);
    expect(sign).toMatch(/cancellationDeadline\(now\)/);
    expect(sign).toMatch(/disclosure_not_acknowledged/);
    expect(sign).not.toMatch(/parsed\.data\.(deadline|signedAt|cancellationDeadline)/);
    expect(read("src/app/api/agreement/acknowledge/route.ts")).toMatch(/if \(!readiness\.ready\)[\s\S]*status: 409/);
    // Cancelling never depends on readiness.
    expect(read("src/app/api/agreement/cancel/route.ts")).not.toMatch(/agreementReadiness/);
  });
});
