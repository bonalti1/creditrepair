import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agreementReadiness, readinessFrom } from "../agreement/readiness";
import { agreementDocumentsFor } from "../agreement/stateDocuments";
import { resolveTerms } from "../agreement/terms";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { openingSteps, STATE_LAW } from "../compliance/stateRules";
import { ALL_STATES, isStateOpen, NOT_OPEN_COPY, openingProblems, openStates, stateStatus } from "../compliance/states";

// The state-by-state checklist (src/lib/compliance/stateRules.ts) and the
// switch that opens a state (states.ts): every state and DC, sourced and
// dated; the big markets researched; nothing opens without the attorney.

const BIG = ["TX", "CA", "FL", "NY", "IL", "AZ", "NJ", "GA", "NC", "NV", "CO", "WA", "PA", "OH", "MI", "VA"];

describe("state rules: the data", () => {
  it("covers every state and DC, once, with a name, a source and a date", () => {
    expect(Object.keys(STATE_LAW).sort()).toEqual([...ALL_STATES].sort());
    for (const code of ALL_STATES) {
      const r = STATE_LAW[code]!;
      expect(r.code).toBe(code);
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.source).toMatch(/^https:\/\//);
      expect(r.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["open", "registration", "restricted", "not_reviewed"]).toContain(r.status);
      // A cancellation period is written only when it is longer than the federal 3 business days.
      if (r.cancellationDays !== null) expect(r.cancellationDays).toBeGreaterThan(3);
      // Anything not verified says what was not confirmed.
      if (!r.verified) expect(r.unconfirmed?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("researches every big market (none 'not reviewed')", () => {
    for (const code of BIG) expect(STATE_LAW[code]!.status, code).not.toBe("not_reviewed");
  });

  it("states what the statutes say for the ones confirmed", () => {
    expect(STATE_LAW.TX).toMatchObject({ status: "registration", verified: true });
    expect(STATE_LAW.TX!.bond).toMatch(/\$10,000/);
    expect(STATE_LAW.CA).toMatchObject({ status: "registration", cancellationDays: 5, verified: true });
    expect(STATE_LAW.CA!.bond).toMatch(/\$100,000/);
    expect(STATE_LAW.WA).toMatchObject({ cancellationDays: 5, verified: true });
    expect(STATE_LAW.IL!.bond).toMatch(/\$100,000/);
    expect(STATE_LAW.OH!.bond).toMatch(/\$50,000/);
    expect(STATE_LAW.LA!.bond).toMatch(/\$100,000/);
    expect(STATE_LAW.GA).toMatchObject({ status: "restricted", verified: true });
    expect(STATE_LAW.NY!.restrictions.join(" ")).toMatch(/fully performed/);
  });

  it("counts, for the docs table", () => {
    const by = (s: string) => ALL_STATES.filter((c) => STATE_LAW[c]!.status === s).length;
    expect(by("open") + by("registration") + by("restricted") + by("not_reviewed")).toBe(51);
    expect(by("restricted")).toBe(1);
    expect(ALL_STATES.filter((c) => STATE_LAW[c]!.verified).length).toBeGreaterThanOrEqual(15);
  });

  it("docs/STATES.md lists every state and says each one needs the attorney", () => {
    const doc = readFileSync("docs/STATES.md", "utf8");
    for (const code of ALL_STATES) expect(doc, code).toMatch(new RegExp(`\\| ${STATE_LAW[code]!.name} \\(${code}\\) \\|`));
    expect(doc).toMatch(/attorney/i);
  });

  it("opening steps always end with the attorney's review", () => {
    for (const code of ALL_STATES) {
      const steps = openingSteps(STATE_LAW[code]!, "en");
      expect(steps.some((s) => /Attorney review/.test(s))).toBe(true);
    }
  });
});

describe("state rules: opening a state", () => {
  const today = new Date("2026-11-24T12:00:00Z");
  const reviewed = { attorneyName: "Lic. Ana Prieto", attorneyReviewedOn: "2026-11-20" };

  it("Texas is open by default; nothing else", () => {
    expect(openStates()).toEqual(["TX"]);
    expect(isStateOpen("CA")).toBe(false);
    expect(isStateOpen(null)).toBe(false);
  });

  it("an opened state is open; a restricted one never, whatever the list says", () => {
    expect(stateStatus("CA", ["TX", "CA"])).toBe("open");
    expect(stateStatus("GA", ["TX", "GA"])).toBe("blocked");
    expect(openStates(["TX", "GA", "NY"])).toEqual(["NY", "TX"]);
  });

  it("needs the attorney, and the registration and bond where the law asks", () => {
    expect(openingProblems({ state: "CA", opened: true }, today)).toEqual(expect.arrayContaining(["attorney_name", "attorney_date", "registration_ref", "bond"]));
    expect(openingProblems({ state: "CA", opened: true, ...reviewed, registrationRef: "CSO-12345", bondConfirmed: true }, today)).toEqual([]);
    // New York: no registration, no bond found; the attorney is still required.
    expect(openingProblems({ state: "NY", opened: true }, today)).toEqual(["attorney_name", "attorney_date"]);
    expect(openingProblems({ state: "NY", opened: true, ...reviewed }, today)).toEqual([]);
    // A review dated in the future is not a review.
    expect(openingProblems({ state: "NY", opened: true, attorneyName: "Lic. Ana Prieto", attorneyReviewedOn: "2027-06-01" }, today)).toContain("attorney_date");
  });

  it("refuses a restricted or unreviewed state; closing is always allowed", () => {
    expect(openingProblems({ state: "GA", opened: true, ...reviewed }, today)).toContain("restricted");
    expect(openingProblems({ state: "WY", opened: true, ...reviewed }, today)).toContain("not_reviewed");
    expect(openingProblems({ state: "ZZ", opened: true, ...reviewed }, today)).toEqual(["unknown_state"]);
    expect(openingProblems({ state: "GA", opened: false }, today)).toEqual([]);
  });

  it("the words a person from a closed state reads: polite, no promise", () => {
    for (const locale of ["en", "es"] as const) {
      const c = NOT_OPEN_COPY[locale];
      for (const text of [c.title("California"), c.body, c.blocked]) {
        expect(checkClaimGuardrails(text)).toEqual([]);
        expect(checkMarketingCopy(text)).toEqual([]);
      }
    }
  });
});

describe("state rules: the agreement per state", () => {
  const complete = {
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

  it("Texas has its documents; every other state needs the attorney's text", () => {
    expect(agreementDocumentsFor("TX").status).toBe("built");
    expect(agreementDocumentsFor(null)).toEqual({ state: "TX", status: "built" });
    for (const code of ALL_STATES.filter((c) => c !== "TX")) expect(agreementDocumentsFor(code).status).toBe("needs_attorney_text");
  });

  it("a client in a state without documents cannot sign, even with everything else approved, even in the demo", () => {
    const terms = resolveTerms(complete);
    const approvedVersion = readinessFrom(complete, null, false, []).version;
    const at = (state: string, demo = false) => agreementReadiness({ terms, approvedVersion, demo, unverifiedStatutes: [], state });
    expect(at("TX")).toMatchObject({ ready: true, mode: "ready", stateDocuments: { state: "TX", status: "built" } });
    expect(at("CA")).toMatchObject({ ready: false, mode: "blocked", canSign: false, stateDocuments: { state: "CA", status: "needs_attorney_text" } });
    expect(at("CA", true)).toMatchObject({ mode: "blocked", canSign: false });
    expect(agreementReadiness({ demo: true, state: "TX" }).mode).toBe("demo_draft");
  });
});
