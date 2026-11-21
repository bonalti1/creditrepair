import type { EscalationStage, ItemCategory, LetterTarget, NormalizedReport, ReportItem } from "../domain/types";
import type { DisputeReasonCode } from "../letters/reasons";

// The staff-side view of one client: everything the console needs to say where
// a person is and why, in one object. It mirrors what the database already
// records (profiles, report pulls, item flags, rounds, letters, identity
// documents, events), so the database implementation is a mapping, not a
// redesign.
//
// One rule runs through these types: staff see the client's answers, they do
// not make them. Nothing here lets a member of staff mark an item as disputed.

/** Same kinds as identity_documents.kind in the database. */
export type DocumentKind = "government_id" | "proof_of_address" | "ssn_card" | "identity_theft_report";

/** The two documents every mailed dispute needs enclosed. */
export const REQUIRED_DOCUMENTS: readonly DocumentKind[] = ["government_id", "proof_of_address"];

/**
 * What the client said about one report item. Only the client can set this,
 * the reason included.
 *
 * `reasonCode` is the standard reason the client picked (letters/reasons.ts,
 * item_flags.reason_code); the letter prints its sentence after the item. It is
 * missing on an answer confirmed before reasons existed: that answer still
 * counts, and its letter line carries no reason. `reason` is the client's own
 * words (item_flags.reason): staff read it, it is never printed in a letter.
 */
export type ItemAnswer =
  | { status: "pending" }
  | { status: "correct"; answeredAt: string }
  | { status: "inaccurate"; reason: string; reasonCode?: DisputeReasonCode; confirmedAt: string };

export type RoundStatus = "draft" | "ready" | "mailed" | "responded";

export type MailStatus = "not_sent" | "in_transit" | "delivered" | "returned" | "undeliverable";

export interface StaffLetter {
  id: string;
  /** Who the letter goes to: a bureau, a secondary bureau or a furnisher. */
  recipient: LetterTarget;
  templateKey: string;
  category: ItemCategory;
  stage: EscalationStage | "personal_info_cleanup";
  /**
   * The report items this letter covers, as they stood when it was written
   * (a later report may no longer list them). All client-confirmed. Empty for
   * a file request to a secondary bureau.
   */
  items: ReportItem[];
  /**
   * The reason the client gave for each item, by fingerprint, as it stood when
   * the letter was written. No entry for an item confirmed before reasons
   * existed; absent on a letter written before then.
   */
  itemReasons?: Record<string, DisputeReasonCode>;
  mailStatus: MailStatus;
}

export interface StaffRound {
  number: number;
  status: RoundStatus;
  /** ISO timestamp the round was mailed; null until then. */
  mailedAt: string | null;
  /** ISO timestamp the bureaus' answers arrived (a new report was imported); null until then. */
  respondedAt: string | null;
  letters: StaffLetter[];
}

export type BillingStatus = "none" | "active" | "past_due" | "canceled";

export interface StaffNote {
  id: string;
  at: string;
  author: string;
  text: string;
}

/** A question the assistant could not answer and passed to the team. */
export interface EscalatedQuestion {
  id: string;
  askedAt: string;
  text: string;
  /** ISO timestamp a person answered it; null while it waits. */
  answeredAt: string | null;
}

export interface StaffClient {
  id: string;
  firstName: string;
  lastName: string;
  /** E.164, for example "+17135550142". */
  phone: string;
  /** Two-letter US state. */
  state: string;
  /** Mailing address as it goes on the letters. Empty until the client gives it. */
  addressLines: string[];
  /** Handle of the salesperson who brought the client in (profiles.referred_by). */
  salesperson: string;
  /** First contact: the day sales started the conversation. */
  createdAt: string;
  /** The day the client created their account; null while they are only a lead. */
  signedUpAt: string | null;
  /** The day the service agreement was signed; null until then. */
  agreementSignedAt: string | null;
  /** Kinds of identity document on file. */
  documents: DocumentKind[];
  /** The newest report; its date is report.pulledAt. Null until the first import. */
  report: NormalizedReport | null;
  /** The client's answer per report item, by fingerprint. A missing entry means pending. */
  answers: Record<string, ItemAnswer>;
  rounds: StaffRound[];
  /** Placeholder until billing is built. */
  billing: BillingStatus;
  lastActivityAt: string;
  notes: StaffNote[];
  questions: EscalatedQuestion[];
  /**
   * Exceptions a member of staff marked as handled: exception key → when.
   * A handled exception stays off the list for a few days and comes back if
   * the situation has not changed (see stage.ts).
   */
  handled: Record<string, string>;
}

export const fullName = (client: Pick<StaffClient, "firstName" | "lastName">): string =>
  `${client.firstName} ${client.lastName}`.trim();
