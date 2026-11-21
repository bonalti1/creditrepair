import type { MailStatus } from "../staff/types";

// Mail, as data: how a letter is sent and what the post office has said about
// it since. One record per letter. The dates that matter legally live here:
//
//   - mailedAt: the day the letter went out. Billing counts work from it
//     (src/lib/billing/rules.ts), and it is the start of the bureaus' response
//     window when nothing later is known.
//   - deliveredAt: the day the post office recorded delivery. Known for
//     certified letters (USPS scans them at the door); when it is known, the
//     response window counts from it (see responseWindowStart in tracking.ts).

export type { MailStatus };

/** How a letter travels. Every class is USPS First-Class Mail; certified adds tracking and proof of delivery. */
export type MailClass = "first_class" | "certified" | "certified_return_receipt";

export const MAIL_CLASSES: readonly MailClass[] = ["first_class", "certified", "certified_return_receipt"];

/**
 * Who mailed it. "simulated" is the stand-in used when no Lob key is
 * configured (and always in the demo): nothing reaches the post office.
 * "print" is a letter printed in the office and mailed by hand.
 */
export type MailProvider = "lob" | "simulated" | "print";

/** One step the mail service reported, normalized from its own event names (tracking.ts). */
export type MailEventKind =
  | "created"
  | "mailed"
  | "in_transit"
  | "in_local_area"
  | "processed_for_delivery"
  | "pickup_available"
  | "re_routed"
  | "delivered"
  | "returned_to_sender"
  | "issue"
  | "failed"
  | "cancelled"
  | "other";

export interface MailEventRecord {
  /** The provider's own event id. Each one is recorded once (dedupe key). */
  id: string;
  /** When the post office registered it (ISO). */
  at: string;
  kind: MailEventKind;
  /** The status this event moves the letter to; null when it only adds detail. */
  status: MailStatus | null;
  /** ZIP code or facility, when the provider gives one. */
  location?: string | null;
  /** The provider's wording, for staff ("Processed for Delivery", "package_undeliverable"). */
  detail?: string | null;
}

/** What is known about how one letter was sent and where it is. */
export interface LetterMail {
  mailClass: MailClass;
  provider: MailProvider;
  /** The provider's id for the piece (Lob: "ltr_…"); null for a printed letter. */
  externalId: string | null;
  /** USPS tracking number; certified letters only, once the provider has it. */
  trackingNumber: string | null;
  /** The day it went out (ISO). */
  mailedAt: string | null;
  /** The day the post office recorded delivery (ISO), when it did. */
  deliveredAt: string | null;
  /** The day the post office sent it back or gave up on it (ISO). */
  returnedAt: string | null;
  /** Why it came back, in staff's words ("Returned to Sender", "package_undeliverable"). */
  returnReason: string | null;
  /** The address it was sent to, exactly as given to the provider. */
  toAddressLines?: string[];
  /** Oldest first, each provider event once. */
  events: MailEventRecord[];
}
