import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECK_KIND_LABEL,
  CHECK_KINDS,
  checksForItem,
  checksReadAloud,
  checksSupporting,
  dataChecks,
  letterFacts,
  relatedReasons,
  relatedReasonsForItem,
  sameAccountKey,
  type CheckKind,
  type DataCheck,
} from "../domain/checks";
import { parseReport, type RawReport } from "../domain/parser";
import type { ReportItem } from "../domain/types";
import { DEMO_CLIENT_REPORT, DEMO_REPORT } from "../demo";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { reasonsFor } from "../letters/reasons";
import { itemLines } from "../letters/parts";
import { renderLetter } from "../letters/templates";
import { builtinSource, renderSource } from "../letters/versions/source";
import { EMPTY_DRAFT, includedCheckIds, type DisputeDraft } from "../ux/disputeReason";
import { flagPutSchema, storedCheckIds } from "../ux/flagsApi";
import { normalizeFlags } from "../ux/flagsStore";
import { sessionPlan } from "../ux/sessionPlan";
import { CHECKS_COPY } from "../ux/checksCopy";
import { itemDetailsFromRows, planNextRound } from "../rounds/plan";
import { staffLetterText } from "../staff/letters";
import type { StaffClient, StaffLetter, StaffRound } from "../staff/types";

// ── Building reports ────────────────────────────────────────────────────

type Tradeline = RawReport["bureaus"]["equifax"] extends infer S ? (S extends { tradelines: Array<infer T> } ? Partial<T> : never) : never;

const AS_OF = "2026-07-01T00:00:00.000Z";

function report(sections: Partial<Record<"equifax" | "experian" | "transunion", { tradelines?: Tradeline[]; inquiries?: Array<{ inquirer: string; date: string; type?: string }>; publicRecords?: Array<{ recordType: string; court?: string; filedAt?: string; status?: string }>; personalInfo?: Array<{ field: string; value: string }> }>>) {
  const bureaus: Record<string, unknown> = {};
  for (const [bureau, section] of Object.entries(sections)) {
    bureaus[bureau] = {
      tradelines: (section!.tradelines ?? []).map((t) => ({ creditor: "Acme Bank", accountNumberMasked: "****1111", ...t })),
      inquiries: section!.inquiries ?? [],
      publicRecords: section!.publicRecords ?? [],
      personalInfo: section!.personalInfo ?? [],
    };
  }
  return parseReport({ source: "test", pulledAt: AS_OF, bureaus });
}

const checksOf = (r: ReturnType<typeof report>) => dataChecks(r.items, r.pulledAt);
const kinds = (checks: DataCheck[]) => checks.map((c) => c.kind);
const only = (checks: DataCheck[], kind: CheckKind) => checks.filter((c) => c.kind === kind);

const COLLECTION: Tradeline = { creditor: "Midland", accountNumberMasked: "****8821", accountType: "collection", status: "collection", balance: 1250, openedAt: "2024-02-20", firstDelinquencyAt: "2023-07-15" };
const CARD: Tradeline = { accountType: "credit_card", status: "open", paymentStatus: "current", balance: 480, creditLimit: 1500, openedAt: "2021-09-10", lastPaymentAt: "2026-06-05", lastReportedAt: "2026-06-20" };

// ── Across bureaus ──────────────────────────────────────────────────────

describe("data checks: the same account across bureaus", () => {
  it("finds a balance difference on a collection, says both figures, and calls it objective", () => {
    const r = report({ equifax: { tradelines: [COLLECTION] }, experian: { tradelines: [{ ...COLLECTION, balance: 900 }] } });
    const [check] = only(checksOf(r), "balance_mismatch");
    expect(check).toBeDefined();
    expect(check!.strength).toBe("objective");
    expect(check!.items).toHaveLength(2);
    expect(check!.bureaus).toEqual(["equifax", "experian"]);
    expect(check!.fields).toEqual(["balance"]);
    expect(check!.suggestedReasons).toEqual(["wrong_balance"]);
    expect(check!.explanation.es).toContain("Equifax muestra $1,250 y Experian muestra $900");
    expect(check!.explanation.en).toContain("Equifax shows $1,250 and Experian shows $900");
    expect(check!.letterFact).toBe("The balance reported for this account is not the same at every credit bureau: Equifax reports $1,250 and Experian reports $900.");
  });

  it("is only worth checking when an open card's balance was reported on different days", () => {
    const r = report({
      equifax: { tradelines: [CARD] },
      experian: { tradelines: [{ ...CARD, balance: 520, lastReportedAt: "2026-06-02" }] },
    });
    const [check] = only(checksOf(r), "balance_mismatch");
    expect(check!.strength).toBe("worth_checking");
    expect(check!.explanation.es).toContain("cada buró lo actualizó en una fecha distinta");
  });

  it("says nothing when the copies agree, when only one bureau reports a field, or for different accounts", () => {
    const same = report({ equifax: { tradelines: [COLLECTION] }, experian: { tradelines: [COLLECTION] } });
    expect(checksOf(same)).toEqual([]);
    const oneSided = report({ equifax: { tradelines: [COLLECTION] }, experian: { tradelines: [{ ...COLLECTION, balance: undefined }] } });
    expect(only(checksOf(oneSided), "balance_mismatch")).toEqual([]);
    const different = report({ equifax: { tradelines: [COLLECTION] }, experian: { tradelines: [{ ...COLLECTION, accountNumberMasked: "****0000", balance: 10 }] } });
    expect(only(checksOf(different), "balance_mismatch")).toEqual([]);
  });

  it("compares limits, high credit and past-due amounts", () => {
    const r = report({
      equifax: { tradelines: [{ ...CARD, highCredit: 900, pastDue: 0 }] },
      experian: { tradelines: [{ ...CARD, creditLimit: 1000, highCredit: 700, pastDue: 35 }] },
    });
    const c = checksOf(r);
    expect(only(c, "limit_mismatch").map((x) => x.fields[0])).toEqual(["creditLimit", "highCredit"]);
    expect(only(c, "limit_mismatch")[0]!.strength).toBe("objective");
    expect(only(c, "past_due_mismatch")[0]!.suggestedReasons).toEqual(["wrong_balance", "never_late"]);
  });

  it("compares statuses, offering only reasons that fit the words used", () => {
    const r = report({
      equifax: { tradelines: [{ ...CARD, paymentStatus: "30 days late" }] },
      experian: { tradelines: [{ ...CARD, paymentStatus: "paid" }] },
    });
    const [check] = only(checksOf(r), "status_mismatch");
    expect(check!.fields).toEqual(["paymentStatus"]);
    expect(check!.suggestedReasons).toEqual(["never_late", "paid_or_settled"]);
    expect(check!.explanation.es).toContain("30 días de atraso");
    // "Charge-off" and "charge_off" are the same status.
    const same = report({ equifax: { tradelines: [{ ...COLLECTION, status: "Charge-Off" }] }, experian: { tradelines: [{ ...COLLECTION, status: "charge_off" }] } });
    expect(only(checksOf(same), "status_mismatch")).toEqual([]);
  });

  it("compares the dates opened, of last payment and closed, at the precision both give", () => {
    const r = report({
      equifax: { tradelines: [{ ...CARD, closedAt: "2026-01-10" }] },
      experian: { tradelines: [{ ...CARD, openedAt: "2021-10-01", closedAt: "2026-01" }] },
    });
    const c = only(checksOf(r), "date_mismatch");
    expect(c.map((x) => x.fields[0])).toEqual(["openedAt"]); // "2026-01" and "2026-01-10" agree
    expect(c[0]!.suggestedReasons).toEqual(["wrong_dates"]);
  });

  it("flags a first delinquency that differs across bureaus as possible re-aging, objective", () => {
    const r = report({ equifax: { tradelines: [COLLECTION] }, transunion: { tradelines: [{ ...COLLECTION, firstDelinquencyAt: "2024-01-15" }] } });
    const [check] = only(checksOf(r), "possible_reaging");
    expect(check!.strength).toBe("objective");
    expect(check!.explanation.es).toContain("no debería cambiar nunca");
    expect(check!.letterFact).toContain("TransUnion reports January 15, 2024");
  });

  it("compares payment history month by month, naming the months", () => {
    const history = (march: string) => [
      { month: "2025-02", status: "OK" },
      { month: "2025-03", status: march },
    ];
    const r = report({ equifax: { tradelines: [{ ...CARD, paymentHistory: history("OK") }] }, experian: { tradelines: [{ ...CARD, paymentHistory: history("30") }] } });
    const [check] = only(checksOf(r), "payment_history_mismatch");
    expect(check!.explanation.es).toContain("en marzo de 2025, Equifax muestra al corriente y Experian muestra 30 días de atraso");
    expect(check!.suggestedReasons).toEqual(["never_late"]);
    // Both late, different lengths: still a difference? No: neither says on time.
    const bothLate = report({ equifax: { tradelines: [{ ...CARD, paymentHistory: history("60") }] }, experian: { tradelines: [{ ...CARD, paymentHistory: history("30") }] } });
    expect(only(checksOf(bothLate), "payment_history_mismatch")).toEqual([]);
  });

  it("compares account type and responsibility", () => {
    const r = report({
      equifax: { tradelines: [{ ...CARD, ownership: "individual" }] },
      experian: { tradelines: [{ ...CARD, accountType: "installment", ownership: "authorized_user" }] },
    });
    const c = checksOf(r);
    expect(only(c, "account_type_mismatch")).toHaveLength(1);
    const [own] = only(c, "ownership_mismatch");
    expect(own!.explanation.es).toContain("Equifax muestra Individual y Experian muestra Usuario autorizado");
  });

  it("matches accounts the same way the review's cross-bureau note does", () => {
    const [a, b] = report({ equifax: { tradelines: [CARD] }, experian: { tradelines: [{ ...CARD, creditor: "  ACME   bank " }] } }).items;
    expect(sameAccountKey(a!)).toBe(sameAccountKey(b!));
  });
});

// ── One item ────────────────────────────────────────────────────────────

describe("data checks: one item by itself", () => {
  it("obsolescence: a collection past 7 years + 180 days from its first delinquency, by the report's date (FCRA § 605(c))", () => {
    const r = report({ transunion: { tradelines: [{ ...COLLECTION, firstDelinquencyAt: "2017-03-02", openedAt: "2018-01-10" }] } });
    const [check] = only(checksOf(r), "obsolete");
    expect(check!.strength).toBe("objective");
    expect(check!.suggestedReasons).toEqual(["obsolete"]);
    expect(check!.explanation.es).toContain("29 de agosto de 2024");
    expect(check!.letterFact).toContain("Section 605(c)");
    // One day short of the period: nothing.
    const inside = report({ transunion: { tradelines: [{ ...COLLECTION, firstDelinquencyAt: "2019-01-03", openedAt: "2019-06-01" }] } });
    expect(only(checksOf(inside), "obsolete")).toEqual([]);
  });

  it("obsolescence: a late payment at 7 years, a bankruptcy at 10, and not for an account in good standing", () => {
    const late = report({ equifax: { tradelines: [{ ...CARD, paymentStatus: "60 days late", firstDelinquencyAt: "2019-05-01" }] } });
    expect(only(checksOf(late), "obsolete")[0]!.explanation.es).toContain("7 años");
    const bk = report({ equifax: { publicRecords: [{ recordType: "chapter_7_bankruptcy", filedAt: "2015-01-10" }] } });
    expect(only(checksOf(bk), "obsolete")[0]!.letterFact).toContain("10 years");
    const lien = report({ equifax: { publicRecords: [{ recordType: "tax_lien", filedAt: "2005-01-10" }] } });
    expect(only(checksOf(lien), "obsolete")).toEqual([]); // no fixed period the data can show
    const good = report({ equifax: { tradelines: [{ ...CARD, firstDelinquencyAt: "2010-01-01" }] } });
    expect(only(checksOf(good), "obsolete")).toEqual([]);
  });

  it("missing first delinquency on a collection or charge-off, naming a bureau that does show it", () => {
    const r = report({
      equifax: { tradelines: [{ ...COLLECTION, firstDelinquencyAt: undefined }] },
      experian: { tradelines: [COLLECTION] },
    });
    const [check] = only(checksOf(r), "missing_first_delinquency");
    expect(check!.strength).toBe("worth_checking");
    expect(check!.explanation.es).toContain("aunque Experian sí la muestra");
    expect(check!.suggestedReasons).toEqual(["wrong_dates", "obsolete"]);
    const card = report({ equifax: { tradelines: [CARD] } });
    expect(only(checksOf(card), "missing_first_delinquency")).toEqual([]);
  });

  it("impossible dates: last payment or first delinquency before opening, closed before opened, collection before delinquency", () => {
    const r = report({
      equifax: {
        tradelines: [
          { ...CARD, accountNumberMasked: "****0001", lastPaymentAt: "2019-02-01", openedAt: "2019-06-15", lastReportedAt: "2026-06-01" },
          { ...CARD, accountNumberMasked: "****0002", closedAt: "2018-01-01", openedAt: "2019-06-15" },
          { ...COLLECTION, openedAt: "2023-01-10", firstDelinquencyAt: "2023-07-15" },
        ],
      },
    });
    const c = only(checksOf(r), "impossible_dates");
    expect(c.map((x) => x.fields)).toEqual([["lastPaymentAt", "openedAt"], ["closedAt", "openedAt"], ["openedAt", "firstDelinquencyAt"]]);
    expect(c[2]!.explanation.es).toContain("no puede pasar a cobranza antes de su primer atraso");
    // A collector's own "opened" date after the original creditor's last payment is normal.
    const normal = report({ equifax: { tradelines: [{ ...COLLECTION, lastPaymentAt: "2023-05-01" }] } });
    expect(only(checksOf(normal), "impossible_dates")).toEqual([]);
  });

  it("dates after the report's own date, with a day of slack", () => {
    const r = report({
      equifax: { tradelines: [{ ...CARD, lastReportedAt: "2026-08-15" }], inquiries: [{ inquirer: "X", date: "2026-07-02" }] },
    });
    const c = only(checksOf(r), "future_date");
    expect(c).toHaveLength(1);
    expect(c[0]!.explanation.es).toContain("es posterior a la fecha de este reporte (1 de julio de 2026)");
    const inquiry = report({ equifax: { inquiries: [{ inquirer: "X", date: "2026-09-01" }] } });
    expect(only(checksOf(inquiry), "future_date")[0]!.suggestedReasons).toEqual(["other"]);
  });

  it("a balance on an account reported paid or settled, and not on one merely closed", () => {
    const paid = report({ equifax: { tradelines: [{ ...CARD, status: "closed", paymentStatus: "paid", balance: 310 }] } });
    const [check] = only(checksOf(paid), "balance_on_paid");
    expect(check!.suggestedReasons).toEqual(["paid_or_settled", "wrong_balance"]);
    expect(check!.explanation.es).toContain("$310");
    const closed = report({ equifax: { tradelines: [{ ...CARD, status: "closed", balance: 310 }] } });
    expect(only(checksOf(closed), "balance_on_paid")).toEqual([]);
    const paidZero = report({ equifax: { tradelines: [{ ...CARD, paymentStatus: "paid", balance: 0 }] } });
    expect(only(checksOf(paidZero), "balance_on_paid")).toEqual([]);
  });

  it("past due greater than the balance", () => {
    const r = report({ equifax: { tradelines: [{ ...CARD, pastDue: 600 }] } });
    expect(only(checksOf(r), "past_due_over_balance")[0]!.explanation.en).toContain("$600");
    const ok = report({ equifax: { tradelines: [{ ...CARD, pastDue: 480 }] } });
    expect(only(checksOf(ok), "past_due_over_balance")).toEqual([]);
  });
});

// ── Duplicates ──────────────────────────────────────────────────────────

describe("data checks: the same debt twice on one bureau", () => {
  const original: Tradeline = { creditor: "Synchrony Bank", accountNumberMasked: "****3390", accountType: "credit_card", status: "charge_off", balance: 640 };
  const collector: Tradeline = { creditor: "Portfolio Recovery", accountNumberMasked: "****7712", accountType: "collection", status: "collection", balance: 640, originalCreditor: "SYNCHRONY BANK", firstDelinquencyAt: "2022-03-02" };

  it("an original creditor and its collector both with a balance", () => {
    const r = report({ transunion: { tradelines: [original, collector] } });
    const [check] = only(checksOf(r), "duplicate_debt");
    expect(check!.items).toHaveLength(2);
    expect(check!.strength).toBe("worth_checking");
    expect(check!.suggestedReasons).toEqual(["duplicate", "wrong_balance"]);
    expect(check!.explanation.es).toContain("normalmente queda en $0");
  });

  it("not when the original account shows $0, or on different bureaus", () => {
    expect(only(checksOf(report({ transunion: { tradelines: [{ ...original, balance: 0 }, collector] } })), "duplicate_debt")).toEqual([]);
    expect(only(checksOf(report({ equifax: { tradelines: [original] }, transunion: { tradelines: [collector] } })), "duplicate_debt")).toEqual([]);
  });

  it("two collectors for the same debt, by original creditor or by first delinquency and balance", () => {
    const second: Tradeline = { ...collector, creditor: "LVNV Funding", accountNumberMasked: "****5555" };
    const byOriginal = report({ experian: { tradelines: [collector, second] } });
    expect(only(checksOf(byOriginal), "duplicate_debt")[0]!.explanation.es).toContain("parecen cobrar la misma deuda de SYNCHRONY BANK");
    const noOriginal = report({ experian: { tradelines: [{ ...collector, originalCreditor: undefined }, { ...second, originalCreditor: undefined }] } });
    expect(only(checksOf(noOriginal), "duplicate_debt")).toHaveLength(1);
    const otherDebt = report({ experian: { tradelines: [{ ...collector, originalCreditor: undefined }, { ...second, originalCreditor: undefined, balance: 99 }] } });
    expect(only(checksOf(otherDebt), "duplicate_debt")).toEqual([]);
  });
});

// ── Personal information ────────────────────────────────────────────────

describe("data checks: personal information", () => {
  it("lists the other versions of a name or address on each one, without repeating the review's questions", () => {
    const r = report({
      equifax: { personalInfo: [{ field: "name", value: "R. MARTINEZ JR" }, { field: "address", value: "1 Main St" }] },
      experian: { personalInfo: [{ field: "name", value: "ROSA MARTINEZ" }, { field: "address", value: "1 Main St" }] },
    });
    const c = checksOf(r);
    const variants = only(c, "personal_info_variants");
    expect(variants).toHaveLength(2); // one per name; the address is the same on both
    expect(variants[0]!.items).toHaveLength(1);
    expect(variants[0]!.explanation.es).toContain("«ROSA MARTINEZ»");
    expect(variants[0]!.strength).toBe("worth_checking");
    expect(only(c, "name_suffix")[0]!.explanation.es).toContain("«JR»");
  });

  it("two dates of birth is objective: a person has one", () => {
    const r = report({ equifax: { personalInfo: [{ field: "dob", value: "1980-01-02" }] }, experian: { personalInfo: [{ field: "dob", value: "1980-02-01" }] } });
    expect(only(checksOf(r), "personal_info_variants").every((c) => c.strength === "objective")).toBe(true);
  });
});

// ── The whole catalogue ─────────────────────────────────────────────────

describe("data checks: the catalogue and its wording", () => {
  const demo = dataChecks(DEMO_CLIENT_REPORT.items, DEMO_CLIENT_REPORT.pulledAt);

  it("the client demo report shows an example of most kinds", () => {
    const shown = new Set(kinds(demo));
    const missing = CHECK_KINDS.filter((k) => !shown.has(k));
    // Not in the demo (covered above): differences of past due, status, dates, account type, responsibility; past due over balance.
    expect(missing).toEqual(["past_due_mismatch", "status_mismatch", "date_mismatch", "account_type_mismatch", "ownership_mismatch", "past_due_over_balance"]);
    expect(shown.size).toBeGreaterThanOrEqual(12);
  });

  it("the base sample report (tests, fixtures, the team's demo clients) has only the name check", () => {
    expect(kinds(dataChecks(DEMO_REPORT.items, DEMO_REPORT.pulledAt))).toEqual(["name_suffix"]);
  });

  it("every kind has a label, every suggested reason applies to the item it is shown on", () => {
    for (const kind of CHECK_KINDS) expect(CHECK_KIND_LABEL[kind].es.length).toBeGreaterThan(3);
    for (const check of demo) {
      for (const fp of check.items) {
        const item = DEMO_CLIENT_REPORT.items.find((i) => i.fingerprint === fp)!;
        const allowed = reasonsFor(item.category).map((r) => r.code);
        expect(relatedReasons(check, item.category).every((c) => allowed.includes(c))).toBe(true);
        expect(relatedReasons(check, item.category).length).toBeGreaterThan(0);
      }
    }
  });

  it("is pure and stable: same input, same checks and ids; the items are not changed", () => {
    const before = JSON.stringify(DEMO_CLIENT_REPORT.items);
    const again = dataChecks(DEMO_CLIENT_REPORT.items, DEMO_CLIENT_REPORT.pulledAt);
    expect(again).toEqual(demo);
    expect(new Set(demo.map((c) => c.id)).size).toBe(demo.length);
    expect(JSON.stringify(DEMO_CLIENT_REPORT.items)).toBe(before);
    for (const c of demo) expect(c.id).toMatch(/^[a-z_]{2,40}:[A-Za-z+]{1,120}:[0-9a-f.]{1,200}$/); // migration 0021's check
  });

  it("never says an item is wrong: it says what the data shows", () => {
    const VERDICT_ES = /\b(es|está|son|están)\s+(incorrect|equivocad|inexact|mal\b|falso|err[oó]ne)|\berror\b|\bilegal\b|debes disputar|te (recomendamos|sugerimos)/i;
    const VERDICT_EN = /\b(is|are)\s+(wrong|incorrect|inaccurate|false|illegal|an error)\b|\byou should dispute\b|\bwe recommend\b/i;
    for (const c of demo) {
      expect(c.explanation.es).not.toMatch(VERDICT_ES);
      expect(c.explanation.en).not.toMatch(VERDICT_EN);
      expect(c.letterFact).not.toMatch(/\b(is|are) (wrong|incorrect|inaccurate)\b/i);
    }
  });

  it("all of it passes the claim guardrails, the client copy included", () => {
    const texts: string[] = [
      ...demo.flatMap((c) => [c.explanation.es, c.explanation.en, c.letterFact]),
      ...Object.values(CHECKS_COPY).flatMap((copy) => Object.values(copy).flatMap((v): string[] => (typeof v === "string" ? [v] : Object.values(v as Record<string, string>)))),
      checksReadAloud(demo, "es"),
      checksReadAloud(demo, "en"),
    ];
    for (const text of texts) expect(checkClaimGuardrails(text, "full_service"), text).toEqual([]);
  });

  it("the read-aloud ends by saying the client decides", () => {
    expect(checksReadAloud(demo.slice(0, 1), "es")).toMatch(/Tú decides\.$/);
    expect(checksReadAloud([], "es")).toBe("");
  });
});

// ── The client still decides ────────────────────────────────────────────

describe("data checks never decide for the client", () => {
  const items = DEMO_CLIENT_REPORT.items;
  const checks = dataChecks(items, DEMO_CLIENT_REPORT.pulledAt);
  const midland = items.find((i) => i.bureau === "experian" && i.name === "Midland Credit Management")!;
  const onMidland = checksForItem(checks, midland.fingerprint);
  const balanceCheck = onMidland.find((c) => c.kind === "balance_mismatch")!;

  it("with checks on every item and no answers, nothing is marked, planned or put in a letter", () => {
    const plan = sessionPlan(items, {}, DEMO_CLIENT_REPORT.pulledAt);
    expect(plan.attestedFlags).toEqual([]);
    expect(plan.plan.letters).toEqual([]);
    expect(plan.itemReasons).toEqual({});
    expect(plan.itemDetails).toEqual({});
  });

  it("the form opens with no reason, nothing included, nothing checked, whatever the checks say", () => {
    expect(EMPTY_DRAFT).toEqual({ reasonCode: null, note: "", attested: false });
    expect(includedCheckIds(onMidland, midland.fingerprint, EMPTY_DRAFT)).toEqual([]);
    // A reason the checks relate to, without ticking "include": still nothing.
    expect(includedCheckIds(onMidland, midland.fingerprint, { ...EMPTY_DRAFT, reasonCode: "wrong_balance" })).toEqual([]);
    // Ticked: only the checks that relate to the reason picked.
    const ticked: DisputeDraft = { ...EMPTY_DRAFT, reasonCode: "wrong_balance", includeFacts: true };
    expect(includedCheckIds(onMidland, midland.fingerprint, ticked)).toEqual([balanceCheck.id]);
    // Ticked, then a reason no check relates to: nothing.
    expect(includedCheckIds(onMidland, midland.fingerprint, { ...ticked, reasonCode: "not_mine" })).toEqual([]);
  });

  it("an item the client calls correct, or only flagged without the attestation, gets no facts", () => {
    const ids = [balanceCheck.id];
    expect(letterFacts(checks, { [midland.fingerprint]: { state: "correct", checkIds: ids } })).toEqual({});
    expect(letterFacts(checks, { [midland.fingerprint]: { state: "flagged", reasonCode: "wrong_balance", checkIds: ids } })).toEqual({});
    expect(letterFacts(checks, { [midland.fingerprint]: { state: "attested", reasonCode: "wrong_balance", checkIds: ids } })).toEqual({}); // no time
  });

  it("facts reach the letter only for the reason the client picked, and only the ones they chose", () => {
    const at = "2026-07-02T00:00:00.000Z";
    const reaging = onMidland.find((c) => c.kind === "possible_reaging")!;
    const facts = letterFacts(checks, { [midland.fingerprint]: { state: "attested", reasonCode: "wrong_balance", attestedAt: at, checkIds: [balanceCheck.id, reaging.id, "made_up:balance:abc"] } });
    expect(facts).toEqual({ [midland.fingerprint]: balanceCheck.letterFact }); // re-aging relates to dates, not balance
    const otherReason = letterFacts(checks, { [midland.fingerprint]: { state: "attested", reasonCode: "not_mine", attestedAt: at, checkIds: [balanceCheck.id] } });
    expect(otherReason).toEqual({});
  });

  it("no source file that uses the checks sets a reason, an answer or the attestation from them", () => {
    const files = sourceFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"));
    const users = files.filter((f) => /from "(@\/lib|\.\.?(\/\.\.)*)\/domain\/checks"|from "\.\/checks"/.test(readFileSync(f, "utf8")));
    expect(users.length).toBeGreaterThanOrEqual(8);
    for (const file of users) {
      const code = readFileSync(file, "utf8");
      // A suggested reason is read for display only: never indexed into, never assigned as the reason.
      expect(code, file).not.toMatch(/suggestedReasons\s*\[/);
      expect(code, file).not.toMatch(/reasonCode\s*[:=]\s*[^,}\n;]*(suggestedReasons|relatedReasons|checksSupporting|checksForItem)/);
      expect(code, file).not.toMatch(/setDraft\([^)]*(suggestedReasons|relatedReasons)/);
      // Screens: the attestation and "include" boxes are only ever what the client ticked.
      if (file.endsWith(".tsx")) {
        expect(code, file).not.toMatch(/attested\s*:\s*true/);
        expect(code, file).not.toMatch(/includeFacts\s*:\s*true/);
      }
      expect(code, file).not.toMatch(/review\([^)]*"attested"[^)]*suggested/);
    }
    // The checks box shows; it has nothing to press.
    const box = readFileSync("src/components/DataChecks.tsx", "utf8");
    expect(box).not.toMatch(/<button|<input|onClick|onChange/);
  });

  it("the server keeps only ids of checks on the item that relate to the reason, and only on a confirmed answer", () => {
    const put = (p: object) => flagPutSchema.parse({ fingerprint: midland.fingerprint, ...p });
    expect(storedCheckIds(put({ state: "attested", reasonCode: "wrong_balance", checkIds: [balanceCheck.id, "x:y:0"] }), onMidland)).toEqual([balanceCheck.id]);
    expect(storedCheckIds(put({ state: "attested", reasonCode: "not_mine", checkIds: [balanceCheck.id] }), onMidland)).toEqual([]);
    expect(storedCheckIds(put({ state: "correct", checkIds: [balanceCheck.id] }), onMidland)).toEqual([]);
    expect(storedCheckIds(put({ state: "attested", reasonCode: "wrong_balance" }), onMidland)).toEqual([]);
    // A confirmed answer still needs the client's reason; ids do not stand in for it.
    expect(flagPutSchema.safeParse({ fingerprint: "x", state: "attested", checkIds: [balanceCheck.id] }).success).toBe(false);
  });

  it("stored answers read back their check ids, and drop anything that is not one", () => {
    const flags = normalizeFlags({ a: { state: "attested", reasonCode: "wrong_balance", attestedAt: "x", checkIds: ["k:balance:ab", 3, ""] }, b: { state: "correct", checkIds: "nope" } });
    expect(flags.a!.checkIds).toEqual(["k:balance:ab"]);
    expect(flags.b).toEqual({ state: "correct" });
  });

  it("the reasons related to an item come in the catalogue's order", () => {
    expect(relatedReasonsForItem(onMidland, "tradeline")).toEqual(["wrong_balance", "wrong_dates"]);
    expect(checksSupporting(onMidland, midland.fingerprint, null)).toEqual([]);
  });
});

// ── In the letter ───────────────────────────────────────────────────────

describe("data checks in the letter", () => {
  const items = DEMO_CLIENT_REPORT.items;
  const checks = dataChecks(items, DEMO_CLIENT_REPORT.pulledAt);
  const midland = items.find((i) => i.bureau === "experian" && i.name === "Midland Credit Management")!;
  const balance = checksForItem(checks, midland.fingerprint).find((c) => c.kind === "balance_mismatch")!;
  const at = "2026-07-02T00:00:00.000Z";
  const flags = { [midland.fingerprint]: { state: "attested", reasonCode: "wrong_balance", attestedAt: at, checkIds: [balance.id] } };
  const user = { id: "u", fullName: "Rosa Martinez", addressLines: ["1 A St", "Houston, TX 77002"], locale: "es" as const };

  it("prints the facts after the reason, on the item's one line; without facts the line is as before", () => {
    const reasons = { [midland.fingerprint]: "wrong_balance" };
    const details = { [midland.fingerprint]: balance.letterFact };
    expect(itemLines([midland], reasons, details)).toBe(
      "- Midland Credit Management (****8821 · collection): The balance or credit limit reported for this account does not match my records and is not accurate. The balance reported for this account is not the same at every credit bureau: Equifax reports $1,250 and Experian reports $900.",
    );
    expect(itemLines([midland], reasons)).toBe(itemLines([midland], reasons, {}));
    // Facts never print without a reason.
    expect(itemLines([midland], {}, details)).toBe("- Midland Credit Management (****8821 · collection)");
    // A line break in a fact cannot make a second item line.
    expect(itemLines([midland], reasons, { [midland.fingerprint]: "A\n- B" }).split("\n")).toHaveLength(1);
  });

  it("the round's own letter (dispute_611_accounts) carries them, and the approved-version renderer prints the same", () => {
    const session = sessionPlan(items, flags, DEMO_CLIENT_REPORT.pulledAt);
    expect(session.itemDetails).toEqual({ [midland.fingerprint]: balance.letterFact });
    const letter = session.plan.letters.find((l) => l.itemFingerprints.includes(midland.fingerprint))!;
    expect(letter.templateKey).toBe("dispute_611_accounts");
    const ctx = { user, target: letter.target, items: [midland], date: at, roundNumber: 2, itemReasons: session.itemReasons, itemDetails: session.itemDetails };
    const text = renderLetter(letter.templateKey, ctx);
    expect(text).toContain("Equifax reports $1,250 and Experian reports $900.");
    expect(renderSource(letter.templateKey, builtinSource(letter.templateKey), ctx)).toBe(text);
  });

  it("letters that never print reasons never print facts either (collector validation, goodwill)", () => {
    for (const key of ["debt_validation", "goodwill_adjustment", "collector_validation_30_day"]) {
      const ctx = { user, target: { type: "furnisher" as const, key: "m", name: "Midland", addressLines: ["x"] }, items: [midland], date: at, roundNumber: 3, itemReasons: { [midland.fingerprint]: "wrong_balance" }, itemDetails: { [midland.fingerprint]: balance.letterFact } };
      expect(renderLetter(key, ctx)).not.toContain("Equifax reports");
      expect(renderSource(key, builtinSource(key), ctx)).not.toContain("Equifax reports");
    }
  });

  it("the server works the facts out again from its own rows (item_flags.check_ids), never from text a browser sent", () => {
    const itemRows = items.map((i, n) => ({ id: `i${n}`, fingerprint: i.fingerprint, bureau: i.bureau, category: i.category, name: i.name, furnisher: i.furnisher, data: i.data, negative: i.negative, status: "active" }));
    const idOf = (fp: string) => itemRows.find((r) => r.fingerprint === fp)!.id;
    const flagRow = { item_id: idOf(midland.fingerprint), state: "attested", attested: true, attested_at: at, attestation_text: "I certify", reason_code: "wrong_balance", check_ids: [balance.id] };
    const idToFp = new Map(itemRows.map((r) => [r.id, r.fingerprint]));
    expect(itemDetailsFromRows(items, [flagRow], idToFp, DEMO_CLIENT_REPORT.pulledAt)).toEqual({ [midland.fingerprint]: balance.letterFact });
    // No attestation text on record: nothing.
    expect(itemDetailsFromRows(items, [{ ...flagRow, attestation_text: null }], idToFp, DEMO_CLIENT_REPORT.pulledAt)).toEqual({});
    const next = planNextRound({ itemRows, flagRows: [flagRow], roundRows: [], letterRows: [], letterItemRows: [], reportDate: DEMO_CLIENT_REPORT.pulledAt });
    expect(next!.itemDetails).toEqual({ [midland.fingerprint]: balance.letterFact });
    expect(planNextRound({ itemRows, flagRows: [flagRow], roundRows: [], letterRows: [], letterItemRows: [] })!.itemDetails).toEqual({});
  });

  it("the team's letter preview prints what the letter carries", () => {
    const letter: StaffLetter = {
      id: "l1",
      recipient: { type: "bureau", key: "experian", name: "Experian", addressLines: ["P.O. Box 4500", "Allen, TX 75013"] },
      templateKey: "dispute_611_accounts",
      category: "tradeline",
      stage: "dispute",
      items: [midland],
      itemReasons: { [midland.fingerprint]: "wrong_balance" },
      itemDetails: { [midland.fingerprint]: balance.letterFact },
      mailStatus: "not_sent",
    };
    const client = { id: "c", firstName: "Rosa", lastName: "Martinez", addressLines: ["1 A St"], documents: [] } as unknown as StaffClient;
    const round = { number: 2, status: "ready", mailedAt: null, respondedAt: null, letters: [letter] } as StaffRound;
    expect(staffLetterText(client, round, letter, new Date(at))).toContain("Experian reports $900.");
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

// Keep the type import used.
export type { ReportItem };
