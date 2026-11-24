// The product facts the website is allowed to state as "ours", each with the
// file that makes it true. A claim on the site that compares us to anyone
// names the facts it rests on (copy.ts, `comparison`), and the test suite
// (src/lib/__tests__/site.test.ts) checks that every fact's source file exists
// and still contains its evidence. If the code changes and the evidence goes,
// the test fails and the claim has to come off the site.
//
// About the other column of the comparison ("many companies"): it describes
// only what was observed on the public website of the leading credit repair
// company on ConsumerAffairs, on 2026-11-24 (benchmark notes in
// docs/WEBSITE.md): tiered monthly plans plus a first work fee, inquiry
// challenges and three-bureau reports only in the higher tiers, a separate
// Spanish website, score-change examples in its marketing. The site never
// names that company or any other.

export interface ProductFact {
  id: string;
  /** What is true, in one line (for the docs and the test output). */
  fact: string;
  /** The file that makes it true. */
  source: string;
  /** Text that must be in that file for the fact to hold. */
  evidence: RegExp;
}

export const PRODUCT_FACTS: ProductFact[] = [
  {
    id: "charge-after-work",
    fact: "No charge before a round is recorded as mailed; every plan type charges after the work it pays for.",
    source: "src/lib/billing/plans.ts",
    evidence: /never by a date on a calendar/,
  },
  {
    id: "no-setup-fee",
    fact: "No setup, enrollment or sign-up fee exists; such a field is refused.",
    source: "src/lib/billing/plans.ts",
    evidence: /No setup, enrollment or sign-up fee/,
  },
  {
    id: "first-work-fee-after-round",
    fact: "A first work fee, when a plan has one, is charged only after the first round is mailed.",
    source: "src/lib/billing/plans.ts",
    evidence: /Charged after the first round is mailed — never at signup\./,
  },
  {
    id: "most-youll-pay",
    fact: "Every plan has a most-you'll-pay cap printed in the agreement and on My payments.",
    source: "src/lib/billing/plans.ts",
    evidence: /Most you'll pay: \$\{money\(e\.maxTotalCents\)\} in total, whatever happens/,
  },
  {
    id: "every-30-days",
    fact: "Never more than one charge every 30 days.",
    source: "src/lib/billing/plans.ts",
    evidence: /We never charge more than once every 30 days\./,
  },
  {
    id: "no-feature-tiers",
    fact: "Plans differ only in how they charge: the plan terms have no feature fields, so every client gets the same service.",
    source: "src/lib/billing/plans.ts",
    evidence: /export interface PlanTerms \{\n  type: PlanType;\n  \/\*\* CRC's "first work fee"/,
  },
  {
    id: "three-bureaus",
    fact: "Reports from all three national bureaus are imported for every client.",
    source: "src/lib/agreement/documents.ts",
    evidence: /three national credit bureaus \(Equifax, Experian and TransUnion\)/,
  },
  {
    id: "creditor-collector-letters",
    fact: "Letters go to the bureaus and, where appropriate, to the creditor or the debt collector.",
    source: "src/lib/agreement/documents.ts",
    evidence: /to the company that reported the information \(the creditor\) or to a debt collector/,
  },
  {
    id: "inquiry-letters",
    fact: "Unauthorized inquiries have their own dispute letter.",
    source: "src/lib/letters/bureauTemplates.ts",
    evidence: /bureau_unauthorized_inquiry/,
  },
  {
    id: "certified-mail",
    fact: "Letters to creditors and collectors, and follow-ups, go by certified mail.",
    source: "src/lib/mail/classes.ts",
    evidence: /collector: "certified"/,
  },
  {
    id: "case-timeline",
    fact: "Mi caso shows every letter, who it went to, and the dates it was mailed and delivered.",
    source: "src/lib/case/timeline.ts",
    evidence: /letters were mailed/,
  },
  {
    id: "bilingual-one-site",
    fact: "The same site and app in English or Spanish, switched with one tap.",
    source: "src/lib/i18n/detect.ts",
    evidence: /English first, Spanish if needed/,
  },
  {
    id: "assistant-explains",
    fact: "Alti, the AI assistant, explains each account, collection or inquiry in plain words.",
    source: "src/lib/i18n/marketing.ts",
    evidence: /explains each account, collection or inquiry in plain words/,
  },
  {
    id: "client-decides",
    fact: "Only what the client confirms as inaccurate goes into a letter.",
    source: "src/lib/agreement/documents.ts",
    evidence: /no item goes into a letter unless you confirmed it/,
  },
  {
    id: "no-outcome-claims",
    fact: "Outcome and score claims are blocked by the claim rules on every marketing line.",
    source: "src/lib/compliance/guardrails.ts",
    evidence: /Outcome is banned in every service mode/,
  },
  {
    id: "end-any-time",
    fact: "After the cancellation window the client can end the service at any time; ending costs nothing.",
    source: "src/lib/agreement/documents.ts",
    evidence: /you can still end the service at any time and for any reason, from the app or by writing to us\. Ending it costs nothing\./,
  },
  {
    id: "three-day-cancel",
    fact: "Three business days after signing to cancel at no cost.",
    source: "src/lib/agreement/statutes.ts",
    evidence: /within 3 business days from the date you signed it/,
  },
  {
    id: "autopilot",
    fact: "Routine follow-up and the mailing of ready rounds run on schedule (autopilot).",
    source: "docs/AUTOPILOT.md",
    evidence: /the system does the\s+routine follow-up/,
  },
  {
    id: "partner-consent-sharing",
    fact: "A partner sees a client's progress only if the client chooses a sharing level, and never their credit information.",
    source: "src/lib/partners/sharing.ts",
    evidence: /A client lets a partner follow their progress/,
  },
  {
    id: "hosted-card-fields",
    fact: "Card and bank numbers are entered in the processor's hosted fields; the app only gets a token.",
    source: "docs/BILLING.md",
    evidence: /The app gets a token; it never\s+sees a card, account or routing number\./,
  },
  {
    id: "row-level-security",
    fact: "Each client's case is protected by row level security in the database.",
    source: "docs/DATABASE.md",
    evidence: /Row level security protects the data/,
  },
];

export function factById(id: string): ProductFact | undefined {
  return PRODUCT_FACTS.find((f) => f.id === id);
}
