import type { BillingAccount } from "../billing/types";
import type { ChatRole, ChatSource } from "../chat/history";
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

/**
 * What a later report showed for one item a round disputed. The only outcome
 * recorded is the one a report can prove by itself: the item is gone.
 */
export interface RoundResult {
  fingerprint: string;
  outcome: "removed";
  /** The date of the report that no longer lists the item (report.pulledAt). */
  reportDate: string;
}

export interface StaffRound {
  number: number;
  status: RoundStatus;
  /** ISO timestamp the round was mailed; null until then. */
  mailedAt: string | null;
  /** ISO timestamp the bureaus' answers arrived (a new report was imported); null until then. */
  respondedAt: string | null;
  letters: StaffLetter[];
  /**
   * Items of this round that a report imported after mailing no longer lists.
   * Written when a report is imported (reports/merge.ts); absent on a round no
   * import has touched.
   */
  results?: RoundResult[];
}

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

/**
 * One report brought in by a member of staff from the client page
 * (reports/merge.ts). The report itself is `StaffClient.report`; this is the
 * record of who imported what, for the client's history.
 */
export interface ReportImport {
  /** When it was saved (ISO). */
  at: string;
  /** The teammate who imported it. */
  by: string;
  /** The reader that read it (reports/readers.ts). */
  readerKey: string;
  /** The report's own date (report.pulledAt). */
  reportDate: string;
  itemCount: number;
  /** Against the report it replaced. All zero on a first report. */
  removed: number;
  added: number;
  changed: number;
  /** The mailed round this report brought the answers to, if it closed one. */
  closedRound: number | null;
}

/**
 * A report page kept as it was received, for a provider that has no reader
 * yet. Nothing is read from it: it waits until a reader for that provider is
 * built against real samples. Saving one never changes the client's stage.
 */
export interface ReportSample {
  id: string;
  /** Reader key of the provider it came from (reports/readers.ts). */
  provider: string;
  savedAt: string;
  savedBy: string;
  /** The file's name when it came from a file; null when it was pasted. */
  fileName: string | null;
  /** The raw text, untouched. */
  text: string;
}

/**
 * One message of the client's in-app conversation (chat_messages), as staff
 * read it. `role: "user"` is the client. `role: "assistant"` is Capi, unless
 * `source` is "human": then a teammate wrote it and `authorName` says who.
 */
export interface StaffChatMessage {
  id: string;
  at: string;
  role: ChatRole;
  source: ChatSource;
  /** The teammate's name. Only on a message with source "human". */
  authorName?: string;
  text: string;
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
  // The rest of the agreement record (service_agreements, migration 0010; the
  // rules are in src/lib/agreement/gate.ts). Optional so a record made before
  // these were kept still reads: absent means "nothing on record".
  /**
   * When the client acknowledged the disclosure statements, which comes before
   * the contract. Absent on an older record: the signing date stands in.
   */
  disclosureAcknowledgedAt?: string | null;
  /** The version of the agreement text the client signed. */
  agreementVersion?: string | null;
  /**
   * The end of the 3-business-day cancellation window, as computed when the
   * client signed. No work may start before it. Absent: computed from the
   * signing date.
   */
  cancellationDeadline?: string | null;
  /** When the client cancelled the agreement. After this, nothing is ever sent. */
  agreementCancelledAt?: string | null;
  /** True when the cancellation was inside the window (no penalty, no obligation). */
  cancelledWithinWindow?: boolean | null;
  /** After the window: when the client asked to end the service. A person handles it. */
  serviceEndRequestedAt?: string | null;
  /** What the client wrote when asking to end the service, if anything. */
  serviceEndReason?: string | null;
  /** Kinds of identity document on file. */
  documents: DocumentKind[];
  /** The newest report; its date is report.pulledAt. Null until the first import. */
  report: NormalizedReport | null;
  /** The client's answer per report item, by fingerprint. A missing entry means pending. */
  answers: Record<string, ItemAnswer>;
  rounds: StaffRound[];
  /**
   * The monthly fee printed in the agreement the client signed ("89.00"), from
   * the terms snapshot kept with the signature (service_agreements.terms).
   * Every charge is this amount: never today's configuration, never a typed one.
   */
  agreementMonthlyFee?: string | null;
  /**
   * Billing as it is on record (migration 0011; the rules are in
   * src/lib/billing): the payment method on file, each charge with the round
   * it paid for, refunds, and a pause placed by staff. The console never sets
   * a billing "status": the stage and the exceptions are derived from this.
   */
  billing: BillingAccount;
  lastActivityAt: string;
  notes: StaffNote[];
  questions: EscalatedQuestion[];
  /**
   * Exceptions a member of staff marked as handled: exception key → when.
   * A handled exception stays off the list for a few days and comes back if
   * the situation has not changed (see stage.ts).
   */
  handled: Record<string, string>;
  /** The client's in-app conversation, oldest first. Absent means no messages. */
  conversation?: StaffChatMessage[];
  /** Reports staff brought in, oldest first. Absent means none. */
  reportImports?: ReportImport[];
  /** Report pages kept for providers that have no reader yet, oldest first. Absent means none. */
  reportSamples?: ReportSample[];
}

export const fullName = (client: Pick<StaffClient, "firstName" | "lastName">): string =>
  `${client.firstName} ${client.lastName}`.trim();
