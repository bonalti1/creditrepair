import type { ClientHold, OptOutRecord, OutboundMessage } from "../autopilot/types";
import type { BillingAccount } from "../billing/types";
import type { ChatRole, ChatSource } from "../chat/history";
import type { EscalationStage, ItemCategory, LetterTarget, NormalizedReport, ReportItem } from "../domain/types";
import type { DisputeReasonCode } from "../letters/reasons";
import type { LetterMail, MailClass } from "../mail/types";
import type { IntakeRecord } from "../intake/types";
import type { LeadSource } from "../leads/source";
import type { PulseRow } from "../pulse/pulse";

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
  | {
      status: "inaccurate";
      reason: string;
      reasonCode?: DisputeReasonCode;
      confirmedAt: string;
      /**
       * The data checks (domain/checks.ts) whose facts the client chose to put
       * in their letter (item_flags.check_ids, migration 0021). Staff read it;
       * only the client sets it. Absent: none.
       */
      checkIds?: string[];
    };

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
  /**
   * The report facts the client chose to include for each item, by
   * fingerprint (LetterContext.itemDetails). Printed after the item's reason.
   * Absent: none.
   */
  itemDetails?: Record<string, string>;
  mailStatus: MailStatus;
  /**
   * How this letter is to be mailed, chosen on the send screen; absent means
   * the default for its kind (mail/classes.ts: defaultMailClass).
   */
  mailClass?: MailClass;
  /**
   * How it was mailed and what the post office has said since (mail_events,
   * migration 0013): class, tracking number, the mailing and delivery dates,
   * and each tracking event. Absent until it is sent, and on letters recorded
   * before tracking existed. `mailStatus` above is kept equal to its status.
   */
  mail?: LetterMail;
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
  // Added with the re-import summary (reports/reimport.ts). Absent on older records.
  /** The provider the report came from (report.source). */
  source?: string;
  /** Personal-information entries not added again: already in the file, or listed twice. */
  skippedPersonalInfo?: number;
  /** Items a past round saw disappear that this report lists again. */
  reappeared?: number;
  /** Each disputed name, address, birth date or employer: no longer appears, or still reporting. */
  personalInfo?: import("../reports/reimport").PersonalInfoChangeRecord[];
}

/**
 * One report in the client's file, for the Reports tab: every import, whether
 * staff brought it in or the monitoring pull did (report_pulls). Built from the
 * import records (reports/history.ts) and, with a database, from every pull.
 */
export interface ReportHistoryEntry {
  /** report_pulls.id with a database; a stable id of its own in the demo. */
  id: string;
  /** When it came into the file. */
  at: string;
  /** The report's own date. */
  reportDate: string;
  /** The provider it came from (report.source). */
  source: string;
  /** The reader that read it; null when the monitoring pull brought it in by itself. */
  readerKey: string | null;
  /** The teammate who imported it; null when it came in by itself. */
  by: string | null;
  itemCount: number;
  /** True for the client's first report: nothing to compare with. */
  first: boolean;
  removed: number;
  added: number;
  changed: number;
  closedRound: number | null;
  skippedPersonalInfo: number;
  reappeared: number;
  personalInfo: import("../reports/reimport").PersonalInfoChangeRecord[];
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
 * read it. `role: "user"` is the client. `role: "assistant"` is the assistant, unless
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
  /**
   * Every report in the file, oldest first, with a database (every report_pulls
   * row this member may read). Absent in the demo: reports/history.ts builds
   * the list from the import records there.
   */
  reportHistory?: ReportHistoryEntry[];
}

export const fullName = (client: Pick<StaffClient, "firstName" | "lastName">): string =>
  `${client.firstName} ${client.lastName}`.trim();

// ── Team: roles, assignment and who did what ────────────────────────────
//
// Additions for the team screen, roles and the activity log
// (permissions.ts, team.ts, activity.ts). All optional on the records above,
// so a record made before they existed still reads.

/** Same values as staff_members.role (migration 0007). */
export type StaffRole = "admin" | "specialist" | "sales";

/** One time a client was given to a teammate (or taken from one). Oldest first on the client. */
export interface ClientAssignment {
  at: string;
  /** Handle of the teammate the client was given to; null when the client was left unassigned. */
  to: string | null;
  /** Handle of whoever did it, or "sistema" for the automatic round-robin. */
  by: string;
  /** True when the round-robin did it. */
  auto: boolean;
}

/**
 * Fields the team features add to a client. Kept in their own interface and
 * merged into StaffClient below, so the record above stays as it was.
 */
export interface StaffClientTeamFields {
  /** Handle of the teammate who works this client. Absent or null: nobody yet. */
  assignedTo?: string | null;
  /** Every assignment, oldest first. Absent: never assigned. */
  assignments?: ClientAssignment[];
  /** Email, when the client gave one to sales. Optional. */
  email?: string | null;
  /** The goal sales wrote down (sales/invite.ts GOALS key). */
  goal?: string | null;
  /** Handle of the teammate who added this person by hand; absent when they came another way. */
  addedBy?: string | null;
}

/** Fields the team features add to a round. */
export interface StaffRoundTeamFields {
  /** Handle of the teammate who mailed (or marked as mailed) the round. Absent on older records. */
  sentBy?: string | null;
}

// Declaration merging keeps the additions apart from the original fields.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientTeamFields {}

// ── AI intake (src/lib/intake, migration 0016) ──────────────────────────

/** What the AI intake recorded about this client's documents. */
export interface StaffClientIntakeFields {
  /** ID and proof-of-address checks, bureau letters, report readings; oldest first. Absent: none. */
  intake?: IntakeRecord[];
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientIntakeFields {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffRound extends StaffRoundTeamFields {}

// ── Piloto automático ───────────────────────────────────────────────────
//
// What the system did and may do by itself for a client (src/lib/autopilot,
// migration 0015). All optional: a record without them reads as "nothing sent,
// no hold, no opt-out".

/** Fields the autopilot adds to a client. */
export interface StaffClientAutopilotFields {
  /** The client's language for messages (profiles.locale). Absent: English. */
  locale?: "es" | "en";
  /** Every automatic message, oldest first (outbound_messages). */
  outbound?: OutboundMessage[];
  /** Set while the client has asked for no automatic messages (BAJA / STOP / unsubscribe). */
  optOut?: OptOutRecord | null;
  /** Every hold placed on the client, oldest first; the open one has no releasedAt. */
  holds?: ClientHold[];
  /** The client's last WhatsApp message to us: inside 24 hours, plain text may be sent. */
  lastInboundAt?: string | null;
}

/** Fields the autopilot adds to a round. */
export interface StaffRoundAutopilotFields {
  /**
   * When the system first saw this round ready to send, with these letters
   * (autopilot_ready_rounds). The review window counts from here.
   */
  readyAt?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientAutopilotFields {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffRound extends StaffRoundAutopilotFields {}

// ── Where the person came from (migration 0017) ─────────────────────────

/** Fields lead sources add to a client: HighLevel, a referral partner, or added by hand. */
export interface StaffClientSourceFields {
  /** Absent: nothing on record (an older record, or someone who came straight to the app). */
  leadSource?: LeadSource | null;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientSourceFields {}

// ── "¿Cómo vamos?" (migration 0018) ──────────────────────────────────────

/** The client's answers to the satisfaction pulse, as this member may read them (admin; the assigned specialist). */
export interface StaffClientPulseFields {
  /** Absent: none, or a role that may not read them (sales). */
  pulses?: PulseRow[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientPulseFields {}

// ── What fixes itself (migration 0022) ──────────────────────────────────
//
// Additions for the things that used to wait for a person and now go to the
// client or the system first (docs/AUTOPILOT.md, "Lo que se arregla solo").
// All optional: a record without them reads as before.

/** The client's address, asked to be confirmed (address_confirmations): the newest request. */
export interface AddressCheck {
  id: string;
  /** Why: the check before mailing, or a letter that came back. */
  reason: "verification" | "returned_letter";
  /** What the post office's data said about the address on file. */
  finding: "undeliverable" | "ambiguous";
  requestedAt: string;
  inputLines: string[];
  /** What the post office suggests; empty when it suggests nothing. */
  suggestionLines: string[];
  letterId: string | null;
  roundNumber: number | null;
  confirmedAt: string | null;
  confirmedLines: string[] | null;
  closedAt: string | null;
  /** How many times the client has been asked, this request included. */
  requests: number;
}

/** One thing the system resolved by itself (autopilot_resolutions). */
export interface SelfResolution {
  id: string;
  kind: "address_corrected" | "address_confirmed" | "letter_remailed" | "payment_fixed" | "document_reuploaded" | "furnisher_matched";
  at: string;
  /** One line for the team, in Spanish. */
  text: string;
}

export interface StaffClientSelfHealingFields {
  addressCheck?: AddressCheck | null;
  resolutions?: SelfResolution[];
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientSelfHealingFields {}

/** Fields the re-mail adds to a letter. */
export interface StaffLetterSelfHealingFields {
  /** Set on a letter that re-mails one that came back: the returned letter's id (same round, never charged again). */
  remailOf?: string | null;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffLetter extends StaffLetterSelfHealingFields {}

// ── Billing plans, the agreement record and the authorization (migration 0026) ──

export interface StaffClientBillingRecordFields {
  /** The plan snapshot kept with the signature. Null: signed before plans existed (per round at agreementMonthlyFee). */
  agreementPlan?: import("../billing/plans").PlanSnapshot | null;
  /** What the signature recorded, for the chargeback evidence pack. */
  agreementRecord?: { documentHash: string | null; signerName: string | null; signerIp: string | null; signerUserAgent: string | null; locale: "es" | "en" } | null;
  /** The authorization accepted with the payment method on file. */
  methodAuthorization?: { hash: string; locale: "es" | "en"; ip: string | null; userAgent: string | null; gateway: string } | null;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientBillingRecordFields {}

// ── Households (migration 0027) ─────────────────────────────────────────

export interface StaffClientHouseholdFields {
  /** The other person in this client's household, when there is one. Each keeps their own case: only the link is shared. */
  household?: import("../household/household").HouseholdLink | null;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientHouseholdFields {}

// ── After-care (migration 0030, docs/AFTERCARE.md) ──────────────────────

export interface StaffClientAftercareFields {
  /** Social Security number or ITIN: the kind only, never the number. Absent or null: not answered. */
  idType?: "ssn" | "itin" | null;
  /** The client's "Mark as done" marks on the build-your-credit plan and the home-ready track. */
  aftercareMarks?: import("../aftercare/plan").MarkState;
  /** The client finished the program (graduation). */
  graduation?: import("../aftercare/graduation").Graduation | null;
  /** The open "Connect me with a loan officer" request. */
  loanOfficerRequest?: { partnerName: string; how: "referred" | "accepting"; at: string } | null;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientAftercareFields {}

// ── Fulfillment (migration 0041, docs/FULFILLMENT.md) ───────────────────

export interface StaffClientFulfillmentFields {
  /** The client's notification settings (notification_settings). Absent or null: never chosen (every channel, every message). */
  notificationSettings?: import("../fulfillment/notifications").NotificationSettings | null;
  /** What the team checked about the client's credit monitoring (monitoring_checks), oldest first. */
  monitoringChecks?: import("../fulfillment/monitoring").MonitoringCheck[];
  /** A person's reviews of the client's documents (document_reviews), oldest first. */
  documentReviews?: import("../fulfillment/documents").DocumentReview[];
  /** The other documents the client gave the team (client_files), oldest first. */
  files?: import("../fulfillment/documents").ClientFile[];
  /** When each identity document on file was uploaded (identity_documents.uploaded_at), by kind. */
  documentUploadedAt?: Partial<Record<DocumentKind, string>>;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StaffClient extends StaffClientFulfillmentFields {}
