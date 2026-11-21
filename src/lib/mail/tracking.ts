import type { StaffLetter, StaffRound } from "../staff/types";
import type { LetterMail, MailEventKind, MailEventRecord, MailStatus } from "./types";

// What the post office said about a letter, turned into one status and the
// dates that matter.
//
// Lob reports progress two ways, and both are read here:
//   - webhook events, named "letter.<event>" for ordinary letters and
//     "letter.certified.<event>" for certified ones (LOB_EVENT_TYPES below);
//   - the tracking events listed on the letter itself (tracking_events[].name:
//     "In Transit", "Delivered", "Returned to Sender"… LOB_TRACKING_NAMES).
//
// VERIFIED (Lob's API schema, @lob/lob-typescript-sdk 1.4.2, models
// tracking-event-normal / tracking-event-certified / tracking-event-details):
// the tracking event names, the certified "details.event" codes, and the
// event fields (id "evnt_…", time, location).
// PARTLY VERIFIED: the webhook event type ids. Lob's help center lists
// letter.mailed, .in_transit, .in_local_area, .processed_for_delivery,
// .re-routed, .returned_to_sender, .delivered and letter.certified.mailed,
// .in_transit, .delivered, .pickup_available, .issue (seen through search
// results; docs.lob.com could not be opened from the build environment).
// UNVERIFIED: letter.certified.in_local_area, .processed_for_delivery,
// .re-routed, .returned_to_sender, and the "failed"/"deleted" names. Unknown
// names are recorded with no status change, so a wrong guess here loses
// nothing: the event is kept and a person can read it.

// ── Mapping ─────────────────────────────────────────────────────────────

interface Mapped {
  kind: MailEventKind;
  status: MailStatus | null;
}

/**
 * Event (the part after "letter." or "letter.certified.", hyphens as
 * underscores) → what it means. `status: null` adds detail without moving the
 * letter.
 */
export const LOB_EVENT_TYPES: Record<string, Mapped> = {
  created: { kind: "created", status: null },
  rendered_pdf: { kind: "created", status: null },
  rendered_thumbnails: { kind: "created", status: null },
  mailed: { kind: "mailed", status: "in_transit" },
  in_transit: { kind: "in_transit", status: "in_transit" },
  in_local_area: { kind: "in_local_area", status: "in_transit" },
  processed_for_delivery: { kind: "processed_for_delivery", status: "in_transit" },
  pickup_available: { kind: "pickup_available", status: "in_transit" },
  // Forwarded (a change of address on file, or a relabel): still moving.
  re_routed: { kind: "re_routed", status: "in_transit" },
  delivered: { kind: "delivered", status: "delivered" },
  returned_to_sender: { kind: "returned_to_sender", status: "returned" },
  // Certified only. What it means depends on details.event (ISSUE_DETAILS).
  issue: { kind: "issue", status: null },
  // Outside the US: never ours. Recorded, nothing else.
  international_exit: { kind: "other", status: null },
  // UNVERIFIED names: a letter that could not be produced, or was cancelled before printing.
  failed: { kind: "failed", status: "undeliverable" },
  rendering_failed: { kind: "failed", status: "undeliverable" },
  deleted: { kind: "cancelled", status: null },
};

/** Lob's tracking event names (VERIFIED, see above) → the same meanings. */
export const LOB_TRACKING_NAMES: Record<string, string> = {
  Mailed: "mailed",
  "In Transit": "in_transit",
  "In Local Area": "in_local_area",
  "Processed for Delivery": "processed_for_delivery",
  "Pickup Available": "pickup_available",
  Delivered: "delivered",
  "Re-Routed": "re_routed",
  "Returned to Sender": "returned_to_sender",
  Issue: "issue",
};

/**
 * Certified "Issue" events carry a detail code (VERIFIED list). These mean the
 * letter will not reach the recipient; every other issue (a delay, a notice
 * left, an attempted delivery) is recorded and the letter stays in transit.
 */
export const ISSUE_DETAILS: Record<string, MailStatus> = {
  returned_to_sender: "returned",
  package_undeliverable: "undeliverable",
  package_lost: "undeliverable",
  package_disposed: "undeliverable",
  package_unclaimed: "returned",
  package_damaged: "undeliverable",
};

/** The meaning of one Lob event type id ("letter.certified.delivered"); null when it is not about a letter. */
export function mapLobEventType(eventType: string, detail?: string | null): Mapped | null {
  const match = /^letter\.(?:certified\.)?(.+)$/.exec(eventType.trim().toLowerCase());
  if (!match) return null;
  const key = match[1]!.replace(/-/g, "_");
  const mapped = LOB_EVENT_TYPES[key] ?? { kind: "other" as const, status: null };
  if (mapped.kind === "issue" && detail && ISSUE_DETAILS[detail]) {
    return { kind: "issue", status: ISSUE_DETAILS[detail]! };
  }
  return mapped;
}

// ── The webhook payload ─────────────────────────────────────────────────

/** What a Lob webhook delivery carries that we use. */
export interface LobWebhookEvent {
  /** "evt_…": unique per event, the dedupe key. */
  eventId: string;
  eventType: string;
  /** The letter ("ltr_…"). */
  letterId: string;
  /** When the post office registered it, or when Lob created the event. */
  at: string;
  trackingNumber: string | null;
  location: string | null;
  detail: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const validDate = (v: string | null): string | null => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);

/**
 * Reads a Lob event: { id, event_type: { id }, reference_id, date_created,
 * body: <the letter as it was> }. The scan time and place come from the
 * newest tracking event on the letter whose name matches the event, when
 * there is one. Null for anything that is not a letter event with an id.
 */
export function parseLobEvent(payload: unknown): LobWebhookEvent | null {
  const root = obj(payload);
  if (!root) return null;
  const eventId = str(root.id);
  const eventType = str(obj(root.event_type)?.id) ?? str(root.event_type);
  const body = obj(root.body);
  const letterId = str(root.reference_id) ?? str(body?.id);
  if (!eventId || !eventType || !letterId || !eventType.startsWith("letter.")) return null;

  const suffix = eventType.replace(/^letter\.(?:certified\.)?/, "").replace(/-/g, "_");
  const tracking = Array.isArray(body?.tracking_events) ? (body!.tracking_events as unknown[]).map(obj).filter((e): e is Obj => e !== null) : [];
  const matching = tracking
    .filter((e) => LOB_TRACKING_NAMES[str(e.name) ?? ""] === suffix)
    .sort((a, b) => (str(a.time) ?? "").localeCompare(str(b.time) ?? ""));
  const scan = matching[matching.length - 1] ?? null;
  const at = validDate(str(scan?.time)) ?? validDate(str(root.date_created)) ?? validDate(str(body?.date_modified));
  if (!at) return null;

  return {
    eventId,
    eventType,
    letterId,
    at,
    trackingNumber: str(body?.tracking_number),
    location: str(scan?.location),
    detail: str(obj(scan?.details)?.event) ?? (suffix === "issue" ? null : str(scan?.name)),
  };
}

/** The record kept for one event (mail_events row / LetterMail.events entry). */
export function eventRecord(event: LobWebhookEvent): MailEventRecord | null {
  const mapped = mapLobEventType(event.eventType, event.detail);
  if (!mapped) return null;
  return { id: event.eventId, at: event.at, kind: mapped.kind, status: mapped.status, location: event.location, detail: event.detail ?? event.eventType };
}

// ── From events to a status ─────────────────────────────────────────────

export interface MailState {
  status: MailStatus;
  deliveredAt: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  events: MailEventRecord[];
}

const RANK: Record<MailStatus, number> = { not_sent: 0, in_transit: 1, delivered: 2, returned: 3, undeliverable: 3 };

/**
 * One status from every event on record, whatever order they arrived in.
 *
 * Events are de-duplicated by id and read in the order the post office
 * registered them. The rules:
 *   - a letter that came back stays back. USPS scans a returned certified
 *     letter "Delivered" when it reaches the sender again; that is not a
 *     delivery to the bureau and must not count as one;
 *   - a delivered letter does not go back to "in transit" because a late scan
 *     from the route arrived after the delivery scan;
 *   - the delivery date is the first delivery scan.
 */
export function mailState(events: readonly MailEventRecord[], mailed: boolean): MailState {
  const seen = new Set<string>();
  const unique = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  const ordered = [...unique].sort((a, b) => a.at.localeCompare(b.at) || (RANK[a.status ?? "not_sent"] - RANK[b.status ?? "not_sent"]));

  let status: MailStatus = mailed ? "in_transit" : "not_sent";
  let deliveredAt: string | null = null;
  let returnedAt: string | null = null;
  let returnReason: string | null = null;
  for (const event of ordered) {
    if (!event.status) continue;
    if (status === "returned" || status === "undeliverable") break;
    if (event.status === "returned" || event.status === "undeliverable") {
      status = event.status;
      returnedAt = event.at;
      returnReason = event.detail ?? event.kind;
      continue;
    }
    if (event.status === "delivered") {
      status = "delivered";
      deliveredAt ??= event.at;
      continue;
    }
    if (RANK[event.status] > RANK[status]) status = event.status;
  }
  return { status, deliveredAt, returnedAt, returnReason, events: ordered };
}

/** A letter's mail record with one more event applied. Pure: returns a new record. */
export function withEvent(mail: LetterMail, event: MailEventRecord): LetterMail {
  const state = mailState([...mail.events, event], Boolean(mail.mailedAt));
  return { ...mail, deliveredAt: state.deliveredAt, returnedAt: state.returnedAt, returnReason: state.returnReason, events: state.events };
}

// ── The response window ─────────────────────────────────────────────────

/**
 * When the bureaus' 30-day reinvestigation period starts for a round.
 *
 * The rule: FCRA §611(a)(1)(A) gives a bureau 30 days from the date it
 * RECEIVES the dispute; a furnisher's direct dispute runs the same way (12
 * C.F.R. §1022.43(e)). So the day that counts is the delivery date, when the
 * post office recorded one (certified mail always has one). When it did not,
 * the mailing date stands in: it is earlier than receipt, so the window shown
 * never ends later than the real one — it may end a few days early, never late.
 * For a round, the window ends when the last letter's window ends: the latest
 * start among its letters that reached someone. Letters that came back do not
 * count. Only a certified letter's delivery counts: USPS scans it at the door.
 * For ordinary First-Class Mail, Lob's "Delivered" is an estimate (it is not a
 * USPS scan), so it is shown but does not move the window.
 * Billing still counts from the mailing date (the work was done then).
 */
export function responseWindowStart(round: Pick<StaffRound, "mailedAt" | "letters">): string | null {
  if (!round.mailedAt) return null;
  let start = round.mailedAt;
  for (const letter of round.letters) {
    const delivered = letterDeliveredAt(letter);
    if (delivered && delivered > start && letter.mailStatus !== "returned" && letter.mailStatus !== "undeliverable") start = delivered;
  }
  return start;
}

/** The delivery date of one letter, when USPS scanned it (certified letters only). */
export function letterDeliveredAt(letter: Pick<StaffLetter, "mail">): string | null {
  const mail = letter.mail;
  if (!mail || (mail.mailClass !== "certified" && mail.mailClass !== "certified_return_receipt")) return null;
  return mail.deliveredAt ?? null;
}

// ── Words ───────────────────────────────────────────────────────────────

const RETURN_REASON_ES: Record<string, string> = {
  "Returned to Sender": "devuelta al remitente",
  returned_to_sender: "devuelta al remitente",
  package_undeliverable: "no se pudo entregar",
  package_lost: "el correo la perdió",
  package_disposed: "el correo la desechó",
  package_unclaimed: "nadie la recogió",
  package_damaged: "llegó dañada",
  failed: "el servicio de correo no pudo producirla",
  rendering_failed: "el servicio de correo no pudo producirla",
  address_issue: "problema con la dirección",
  contact_carrier: "el correo pide que lo contacten",
  delayed: "entrega retrasada",
  delivery_attempted: "intentaron entregarla",
  delivery_rescheduled: "entrega reprogramada",
  location_inaccessible: "no pudieron llegar al lugar",
  notice_left: "dejaron un aviso",
  package_held: "retenida en el correo",
  reschedule_delivery: "hay que reprogramar la entrega",
};

/** Why a letter came back, in staff's words; the provider's own text when it is not one we know. */
export function returnReasonEs(reason: string): string {
  return RETURN_REASON_ES[reason] ?? RETURN_REASON_ES[reason.replace(/^letter\.(certified\.)?/, "")] ?? reason;
}

const EVENT_ES: Record<MailEventKind, string> = {
  created: "El servicio de correo recibió la carta",
  mailed: "Entró al correo (USPS)",
  in_transit: "En camino",
  in_local_area: "En la zona del destinatario",
  processed_for_delivery: "Lista para entrega",
  pickup_available: "Disponible para recoger en el correo",
  re_routed: "Reenviada a otra dirección",
  delivered: "Entregada",
  returned_to_sender: "Devuelta al remitente",
  issue: "Aviso del correo",
  failed: "No se pudo producir",
  cancelled: "Cancelada antes de imprimirse",
  other: "Aviso del servicio de correo",
};

/** One event as a line for the staff timeline. */
export function mailEventLabelEs(event: MailEventRecord): string {
  if (event.kind === "issue" && event.detail) return `${EVENT_ES.issue}: ${returnReasonEs(event.detail)}`;
  return EVENT_ES[event.kind];
}

// ── Tracking links ──────────────────────────────────────────────────────

/** USPS's public tracking page for a tracking number. */
export function uspsTrackingUrl(trackingNumber: string): string {
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber.replace(/\s+/g, ""))}`;
}

/** "9407 1000 0000 0000 0000 00" — groups of four, for reading aloud. */
export function formatTrackingNumber(trackingNumber: string): string {
  return trackingNumber.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}
