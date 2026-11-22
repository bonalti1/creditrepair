import type { Bureau } from "../domain/types";

// What AI intake records about one document (intake_documents, migration
// 0016), as the staff console and the client app read it. Only the outcome of
// a check and its reasons are kept: never an ID number, never a date of birth,
// never the name or address the model read off an ID.

export type IntakeKind = "credit_report" | "government_id" | "proof_of_address" | "bureau_letter";

/**
 *   accepted       the automatic check passed ("Revisado automáticamente")
 *   needs_person   something is doubtful: a person looks (an exception on the console)
 *   read           a credit report was read and waits for staff to review it on the import screen
 *   failed         nothing usable came back (the model failed or the answer was thrown away)
 */
export type IntakeStatus = "accepted" | "needs_person" | "read" | "failed";

/** What a bureau's letter says about one item, in the letter's own terms. */
export type LetterOutcome =
  | "deleted"
  | "verified"
  | "updated"
  | "in_investigation"
  | "more_info_requested"
  | "frivolous"
  | "unclear";

export interface LetterItemResult {
  /** The creditor and account as the letter prints them (account already reduced to its last 4 digits). */
  creditor: string;
  account: string | null;
  outcome: LetterOutcome;
  /** The report item it was matched to, by creditor + last 4 digits; null when no single item matched. */
  fingerprint: string | null;
  citation: { page: number | null; quote: string } | null;
}

export interface BureauLetterSummary {
  bureau: Bureau | null;
  /** The letter's own date (YYYY-MM-DD), when it could be read. */
  letterDate: string | null;
  items: LetterItemResult[];
}

export interface IntakeRecord {
  id: string;
  kind: IntakeKind;
  /** When it was uploaded (ISO). */
  at: string;
  status: IntakeStatus;
  /** True when no AI looked at it (no key configured, or the demo). */
  simulated: boolean;
  /** Plain Spanish: why it was accepted, or what a person must look at. */
  reasons: string[];
  /** Bureau letters only. */
  letter?: BureauLetterSummary | null;
  /** Estimated cost of the AI call in US dollars (cost.ts). */
  costUsd?: number;
}
