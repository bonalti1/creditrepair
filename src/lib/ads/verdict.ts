// What to do with each ad: Winner, Looking good, Testing, Needs data or Turn
// off. Transparent rules, written on the screen with these very numbers
// (components/staff/ads/RulesCard.tsx), the same for every ad, after ALTO
// Control's ads report (its "v3": every ad is tested first; then the cost per
// result decides; a clear dud is turned off early).
//
//   1. No spend in these dates                              → Needs data
//   2. Spent $150 or more with no result and no lead        → Turn off (even during the test)
//   3. Fewer than 7 days with spend                         → Testing ("day 3 of 7")
//   4. 2 or more signed clients at $300 or less each        → Winner
//   5. Cost per result over $45, after spending $50         → Turn off
//   6. Fewer than 10 results                                → Testing ("6 of 10 results")
//   7. Cost per result $25 or less                          → Winner
//   8. Cost per result $45 or less                          → Looking good
//   9. Anything else                                        → Turn off
//
// "Result" is Meta's own result for the ad set's goal (what Ads Manager's
// Results column counts) when Meta reported one; otherwise (or when Meta
// counted none while Credalti has leads) the leads Credalti attributed to
// the ad. Signed clients are always Credalti's own,
// verified by a signed service agreement. A verdict is a suggestion for a
// person: nothing here turns an ad on or off (Meta is read only).

export const VERDICTS = ["winner", "good", "testing", "needs_data", "turn_off"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface AdRules {
  /** Days with spend before an ad is judged. */
  testDays: number;
  /** Results before an ad may be called a winner. */
  testResults: number;
  /** A winner's cost per result, at most. */
  goodCostCents: number;
  /** Above this cost per result (after the test), turn it off. */
  okCostCents: number;
  /** Spent this much with no result at all: turn it off, test or not. */
  noResultCutCents: number;
  /** The cost per result is only judged after this much spend. */
  judgeAfterCents: number;
  /** Signed clients that make a winner on their own… */
  winSigned: number;
  /** …each costing at most this. */
  winSignedCostCents: number;
}

export const AD_RULES: AdRules = {
  testDays: 7,
  testResults: 10,
  goodCostCents: 2_500,
  okCostCents: 4_500,
  noResultCutCents: 15_000,
  judgeAfterCents: 5_000,
  winSigned: 2,
  winSignedCostCents: 30_000,
};

export interface VerdictInput {
  spendCents: number;
  /** Meta's results; null: Meta reported none we could read. */
  results: number | null;
  /** Leads Credalti attributed to the ad (verified in our own records). */
  leads: number;
  /** Of those, the ones who signed the service agreement. */
  signed: number;
  /** Days in the window on which the ad spent anything. */
  daysWithSpend: number;
}

export type VerdictReason =
  | { code: "no_spend" }
  | { code: "no_result_spent"; spentCents: number; limitCents: number }
  | { code: "testing_days"; day: number; of: number }
  | { code: "too_expensive"; costCents: number; limitCents: number }
  | { code: "testing_results"; have: number; need: number }
  | { code: "signed_winner"; signed: number; costCents: number; limitCents: number }
  | { code: "cheap"; costCents: number; limitCents: number }
  | { code: "ok"; costCents: number; limitCents: number }
  | { code: "expensive"; costCents: number; limitCents: number };

export interface VerdictResult {
  verdict: Verdict;
  /** Which count the cost per result was measured on. */
  basis: "meta" | "credalti";
  /** Results used: Meta's, or Credalti's leads. */
  results: number;
  /** Cents per result; null with no result. */
  costPerResultCents: number | null;
  reason: VerdictReason;
}

const per = (cents: number, n: number): number | null => (n > 0 ? Math.round(cents / n) : null);

export function adVerdict(input: VerdictInput, rules: AdRules = AD_RULES): VerdictResult {
  // Meta's count when it has one; Credalti's verified leads when Meta has none (or counted none while we have leads).
  const basis = input.results !== null && (input.results > 0 || input.leads === 0) ? "meta" : "credalti";
  const results = basis === "meta" ? input.results! : input.leads;
  const cost = per(input.spendCents, results);
  const out = (verdict: Verdict, reason: VerdictReason): VerdictResult => ({ verdict, basis, results, costPerResultCents: cost, reason });

  if (input.spendCents <= 0) return out("needs_data", { code: "no_spend" });
  if (results === 0 && input.leads === 0 && input.spendCents >= rules.noResultCutCents) {
    return out("turn_off", { code: "no_result_spent", spentCents: input.spendCents, limitCents: rules.noResultCutCents });
  }
  if (input.daysWithSpend < rules.testDays) return out("testing", { code: "testing_days", day: input.daysWithSpend, of: rules.testDays });
  const perSigned = per(input.spendCents, input.signed);
  if (input.signed >= rules.winSigned && perSigned !== null && perSigned <= rules.winSignedCostCents) {
    return out("winner", { code: "signed_winner", signed: input.signed, costCents: perSigned, limitCents: rules.winSignedCostCents });
  }
  const costOrInfinity = cost ?? Number.POSITIVE_INFINITY;
  if (costOrInfinity > rules.okCostCents && input.spendCents >= rules.judgeAfterCents) {
    if (cost === null) return out("turn_off", { code: "no_result_spent", spentCents: input.spendCents, limitCents: rules.judgeAfterCents });
    return out("turn_off", { code: "too_expensive", costCents: cost, limitCents: rules.okCostCents });
  }
  if (results < rules.testResults) return out("testing", { code: "testing_results", have: results, need: rules.testResults });
  if (costOrInfinity <= rules.goodCostCents) return out("winner", { code: "cheap", costCents: cost!, limitCents: rules.goodCostCents });
  if (costOrInfinity <= rules.okCostCents) return out("good", { code: "ok", costCents: cost!, limitCents: rules.okCostCents });
  return out("turn_off", { code: "expensive", costCents: cost ?? input.spendCents, limitCents: rules.okCostCents });
}

/** The order ads are listed in: winners first, then looking good, testing, needs data, turn off. */
export const VERDICT_RANK: Record<Verdict, number> = { winner: 0, good: 1, testing: 2, needs_data: 3, turn_off: 4 };
