// Which states the service agreement has its own documents for.
//
// The agreement is written for Texas (documents.ts: the Texas disclosure
// statement, the contract's Texas section, the Finance Code ch. 393 notices).
// Another state's law asks for its own statements, cancellation period,
// registration and bond wording (compliance/stateRules.ts), so a client in
// another state cannot sign until that state's documents are written by the
// attorney, built here and approved: until then readiness.ts blocks signing
// ("needs attorney text") even in the demo, and the screen says so.

export type StateDocumentsStatus = "built" | "needs_attorney_text";

/** States whose agreement documents exist in documents.ts. */
export const STATE_AGREEMENT_DOCUMENTS: Readonly<Record<string, { documents: readonly string[] }>> = {
  TX: { documents: ["federal_disclosure", "texas_disclosure", "esign_consent", "contract", "authorization", "cancellation_notice"] },
};

/** The launch state: a profile without a state (from before the state step existed) reads as Texas. */
export const AGREEMENT_DEFAULT_STATE = "TX";

export function agreementDocumentsFor(state: string | null | undefined): { state: string; status: StateDocumentsStatus } {
  const code = (state ?? AGREEMENT_DEFAULT_STATE).toUpperCase();
  return { state: code, status: STATE_AGREEMENT_DOCUMENTS[code] ? "built" : "needs_attorney_text" };
}
