import { currentOptOut } from "../autopilot/optout";
import { fulfillmentFields } from "../fulfillment/rows";
import { roundPlanKey } from "../autopilot/planKey";
import { parseIdType } from "../aftercare/itin";
import { marksFromRows } from "../aftercare/plan";
import { graduationFromRow } from "../aftercare/server";
import type { OptOutRecord, OutboundMessage } from "../autopilot/types";
import { readPlanSnapshot } from "../billing/plans";
import { chargeFromRow, paymentMethodFromRow } from "../billing/server";
import type { BillingAccount, BillingPause } from "../billing/types";
import type { ChatRole, ChatSource } from "../chat/history";
import { parseReport } from "../domain/parser";
import type { ItemCategory, LetterTarget, NormalizedReport, ReportItem } from "../domain/types";
import type { DisputeReasonCode } from "../letters/reasons";
import { intakeRecordFromRow } from "../intake/rows";
import type { IntakeRecord } from "../intake/types";
import type { LetterMail, MailClass, MailEventKind, MailEventRecord, MailProvider } from "../mail/types";
import { itemFromRow, letterKey, planNextRound } from "../rounds/plan";
import { isDisputeReasonCode } from "../ux/disputeReason";
import { leadSourceFromRows } from "../leads/fromRows";
import { pulseFromRow, type PulseRow } from "../pulse/pulse";
import { resolutionFromRow } from "../autopilot/resolutions";
import { historyFromPullRows } from "../reports/history";
import type { HouseholdLink } from "../household/household";
import { readChangeRecords } from "../reports/reimport";
import { optionOfTerms } from "../service/options";
import type {
  ClientAssignment,
  DocumentKind,
  EscalatedQuestion,
  ItemAnswer,
  MailStatus,
  ReportImport,
  ReportSample,
  RoundResult,
  StaffChatMessage,
  StaffClient,
  StaffLetter,
  StaffMailRequest,
  StaffNote,
  StaffRound,
} from "./types";

// The staff console's clients, from database rows. Pure: the rows a member's
// own connection could read go in (row level security already left out what
// their role may not see), StaffClient records come out. Nothing here reads
// the database, trusts the browser or writes anything.
//
// StaffClient was designed to mirror the tables, so this is a mapping:
//
//   profiles                 → who the client is (id, name, phone, state, address, salesperson, goal)
//   prospects                → people sales added by hand who have no account yet
//   service_agreements       → the agreement fields (the newest row) and the fee in its terms
//   identity_documents       → documents on file
//   report_pulls             → the newest report (its raw JSON, read again) and who imported each one
//   report_items, item_flags → the client's answers, by fingerprint
//   attack_rounds, letters,
//   letter_items, mail_events → mailed rounds with their letters and tracking
//   (the same rows)          → the next round, when one is due: the letters the
//                              engine would write now (rounds/plan.ts), "ready"
//   payment_methods, charges,
//   refunds, billing_pauses  → billing
//   chat_messages            → the in-app conversation
//   staff_notes, exception_marks, report_samples → the team's own records (migration 0014)
//   client_assignments, team_audit, staff_members → who works the client, and since when
//
// A member who may not see part of a case (sales: no report, no letters, no
// money) simply has no rows for it, and the record reads as empty there.

type Row = Record<string, unknown>;

export interface StaffRows {
  /** chargebacks (migration 0026). Administrators only; absent or empty otherwise. */
  chargebacks?: Row[];
  profiles: Row[];
  prospects: Row[];
  staffMembers: Row[];
  agreements: Row[];
  documents: Row[];
  /** report_pulls without `raw`, every one. */
  pulls: Row[];
  /** report_pulls.raw of the newest pull of each client: pull id → raw. */
  newestRaw: Record<string, unknown>;
  items: Row[];
  flags: Row[];
  rounds: Row[];
  letters: Row[];
  letterItems: Row[];
  mailEvents: Row[];
  paymentMethods: Row[];
  charges: Row[];
  refunds: Row[];
  pauses: Row[];
  chat: Row[];
  events: Row[];
  notes: Row[];
  marks: Row[];
  samples: Row[];
  assignments: Row[];
  audit: Row[];
  // Piloto automático (migration 0015). Empty on a database without it.
  /** outbound_messages. */
  outbound?: Row[];
  /** message_opt_outs. */
  optOuts?: Row[];
  /** autopilot_holds. */
  holds?: Row[];
  /** autopilot_ready_rounds. */
  readyRounds?: Row[];
  /** The client's own WhatsApp messages (chat_messages: user_id, created_at), newest first. */
  inbound?: Row[];
  /** intake_documents (migration 0016), without the report readings. Absent: none read. */
  intake?: Row[];
  /** Referral partners this member may read (admin, sales), for the partner's name on a lead source (migration 0017). */
  partners?: Row[];
  /** client_pulses (migration 0018), as this member may read them: admin all, a specialist their assigned clients, sales none. */
  pulses?: Row[];
  // What fixes itself (migration 0022). Absent or empty on a database without it.
  /** address_confirmations. */
  addressConfirmations?: Row[];
  /** autopilot_resolutions. */
  resolutions?: Row[];
  /** letters (id, remail_of) that re-mail one that came back. */
  remails?: Row[];
  // Households (migration 0027). Absent or empty on a database without it.
  /** household_members this member may read (by role, like the people in them). */
  households?: Row[];
  /** household_links (migration 0026): two clients linked for the household discount. */
  householdLinks?: Row[];
  // After-care (migration 0030). Absent or empty on a database without it.
  /** aftercare_marks (the case's readers: admin, the assigned specialist). */
  aftercareMarks?: Row[];
  /** program_completions. */
  completions?: Row[];
  /** loan_officer_requests. */
  loanOfficerRequests?: Row[];
  // Fulfillment (migration 0041). Absent or empty on a database without it.
  /** notification_settings. */
  notificationSettings?: Row[];
  /** monitoring_checks. */
  monitoringChecks?: Row[];
  /** document_reviews. */
  documentReviews?: Row[];
  /** client_files (the record only; the file stays in its private bucket). */
  clientFiles?: Row[];
  // Service options (migration 0042). Absent or empty on a database without it.
  /** client_service_options: the option each client chose. */
  serviceOptions?: Row[];
  /** mail_requests: DIY "Mail them for me". */
  mailRequests?: Row[];
}

export const EMPTY_STAFF_ROWS: StaffRows = {
  profiles: [],
  prospects: [],
  staffMembers: [],
  agreements: [],
  documents: [],
  pulls: [],
  newestRaw: {},
  items: [],
  flags: [],
  rounds: [],
  letters: [],
  letterItems: [],
  mailEvents: [],
  paymentMethods: [],
  charges: [],
  refunds: [],
  pauses: [],
  chat: [],
  events: [],
  notes: [],
  marks: [],
  samples: [],
  assignments: [],
  audit: [],
  outbound: [],
  optOuts: [],
  holds: [],
  readyRounds: [],
  inbound: [],
};

// ── Small readers ───────────────────────────────────────────────────────

/** A mail_requests row (migration 0042). Its letters by the console's planned ids when known, and by row id. */
function mailRequestFromRow(row: Row, roundNumber: number, plannedIdOfRow: Map<string, string>): StaffMailRequest {
  const rowIds = Array.isArray(row.letter_ids) ? (row.letter_ids as unknown[]).map((v) => (typeof v === "string" ? v : String(v))) : [];
  const status = row.status === "mailed" || row.status === "cancelled" ? row.status : "requested";
  return {
    id: typeof row.id === "string" ? row.id : String(row.id),
    roundNumber,
    letterIds: rowIds.map((rid) => plannedIdOfRow.get(rid) ?? rid),
    letterRowIds: rowIds,
    letterCount: Number(row.letter_count ?? rowIds.length),
    totalCents: Number(row.total_cents ?? 0),
    status,
    acceptedAt: typeof row.accepted_at === "string" ? new Date(row.accepted_at).toISOString() : row.accepted_at instanceof Date ? row.accepted_at.toISOString() : "",
    mailedAt: typeof row.mailed_at === "string" ? new Date(row.mailed_at).toISOString() : row.mailed_at instanceof Date ? row.mailed_at.toISOString() : null,
  };
}

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const iso = (v: unknown): string | null => {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const t = new Date(v as string).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const latest = (...values: Array<string | null | undefined>): string | null =>
  values.reduce<string | null>((max, v) => (v && (!max || v > max) ? v : max), null);

function groupBy(rows: readonly Row[], key: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const k = text(row[key]);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

const byTime = (field: string) => (a: Row, b: Row) => text(iso(a[field])).localeCompare(text(iso(b[field])));

/** "María José García" → first "María", last "José García". A name without a space has no last name. */
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const clean = fullName.replace(/\s+/g, " ").trim();
  const at = clean.indexOf(" ");
  return at === -1 ? { firstName: clean, lastName: "" } : { firstName: clean.slice(0, at), lastName: clean.slice(at + 1) };
}

/** US phone numbers as the prospects table and the profiles agree on them. */
const phoneKey = (v: unknown): string => text(v).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

const DOCUMENT_KINDS: readonly DocumentKind[] = ["government_id", "proof_of_address", "ssn_card", "identity_theft_report"];
const MAIL_STATUSES: readonly MailStatus[] = ["not_sent", "in_transit", "delivered", "returned", "undeliverable"];
const MAIL_CLASSES: readonly MailClass[] = ["first_class", "certified", "certified_return_receipt"];
const PROVIDERS: readonly MailProvider[] = ["lob", "simulated", "print"];
const SOURCES: readonly ChatSource[] = ["journey", "coach", "human"];

/** The category a letter is about, for letters written before the category was kept: its items, else its template. */
export function letterCategory(templateKey: string, items: readonly ReportItem[]): ItemCategory {
  if (items[0]) return items[0].category;
  if (templateKey === "personal_info_cleanup") return "personal_info";
  if (templateKey === "dispute_611_inquiries") return "inquiry";
  if (templateKey === "dispute_611_public_records") return "public_record";
  return "tradeline";
}

function mailEventFromRow(row: Row): MailEventRecord {
  const status = MAIL_STATUSES.find((s) => s === row.mail_status) ?? null;
  return {
    id: text(row.provider_event_id) || text(row.id),
    at: iso(row.occurred_at) ?? "",
    kind: (text(row.kind) || "other") as MailEventKind,
    status,
    location: textOrNull(row.location),
    detail: textOrNull(row.detail),
  };
}

function letterMailFromRow(row: Row, events: Row[]): LetterMail | undefined {
  const mailedAt = iso(row.mailed_at);
  if (!mailedAt && !row.mail_provider) return undefined;
  return {
    mailClass: MAIL_CLASSES.find((c) => c === row.mail_class) ?? "first_class",
    provider: PROVIDERS.find((p) => p === row.mail_provider) ?? "simulated",
    externalId: textOrNull(row.lob_id),
    trackingNumber: textOrNull(row.tracking_number),
    mailedAt,
    deliveredAt: iso(row.delivered_at),
    returnedAt: iso(row.returned_at),
    returnReason: textOrNull(row.return_reason),
    toAddressLines: lines(row.target_address_lines),
    events: [...events].sort(byTime("occurred_at")).map(mailEventFromRow),
  };
}

function roundResults(v: unknown): RoundResult[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    const row = r as Row;
    return row && typeof row.fingerprint === "string" && row.outcome === "removed" && iso(row.reportDate)
      ? [{ fingerprint: row.fingerprint, outcome: "removed" as const, reportDate: iso(row.reportDate)! }]
      : [];
  });
}

function readReport(raw: unknown): NormalizedReport | null {
  if (raw == null) return null;
  try {
    return parseReport(raw);
  } catch {
    // A pull that no longer reads (stored before the format settled) is not shown as a report.
    return null;
  }
}

// ── The mapping ─────────────────────────────────────────────────────────

export interface MapContext {
  /** user id → handle, from staff_members. */
  handleOf: Map<string, string>;
}

function handle(context: MapContext, userId: unknown, fallback: string | null = null): string | null {
  const id = textOrNull(userId);
  return id ? (context.handleOf.get(id) ?? fallback) : fallback;
}

/** Every client the rows describe, newest activity first is NOT applied: callers sort as they need. */
const OUTBOUND_STATUSES: readonly OutboundMessage["status"][] = ["queued", "sending", "sent", "simulated", "failed", "cancelled"];

/** One outbound_messages row as the console reads it. */
export function outboundFromRow(row: Row): OutboundMessage {
  const channel = text(row.channel);
  return {
    id: text(row.id),
    dedupeKey: text(row.dedupe_key),
    kind: row.kind === "status" ? "status" : "followup",
    topic: text(row.topic) as OutboundMessage["topic"],
    step: row.step === null || row.step === undefined ? null : Number(row.step),
    channel: channel === "whatsapp" || channel === "email" ? channel : null,
    template: textOrNull(row.template),
    params: Array.isArray(row.params) ? row.params.map(text) : [],
    locale: row.locale === "es" ? "es" : "en",
    body: text(row.body),
    link: textOrNull(row.link),
    status: OUTBOUND_STATUSES.find((s) => s === row.status) ?? "queued",
    queuedAt: iso(row.queued_at) ?? "",
    sentAt: iso(row.sent_at),
    note: textOrNull(row.note),
  };
}

export function clientsFromRows(rows: StaffRows): StaffClient[] {
  const context: MapContext = {
    handleOf: new Map(rows.staffMembers.map((m) => [text(m.user_id), text(m.handle) || text(m.user_id).slice(0, 8)])),
  };
  const householdOf = householdsFromRows(rows);
  const staffIds = new Set(rows.staffMembers.map((m) => text(m.user_id)));

  const agreementsBy = groupBy(rows.agreements, "user_id");
  const documentsBy = groupBy(rows.documents, "user_id");
  const pullsBy = groupBy(rows.pulls, "user_id");
  const itemsBy = groupBy(rows.items, "user_id");
  const flagsBy = groupBy(rows.flags, "user_id");
  const roundsBy = groupBy(rows.rounds, "user_id");
  const lettersBy = groupBy(rows.letters, "user_id");
  const letterItemsBy = groupBy(rows.letterItems, "letter_id");
  const eventsByLetter = groupBy(rows.mailEvents, "letter_id");
  const methodsBy = groupBy(rows.paymentMethods, "user_id");
  const chargesBy = groupBy(rows.charges, "user_id");
  const refundsByCharge = new Map(rows.refunds.map((r) => [text(r.charge_id), r]));
  const chargebackByCharge = new Map((rows.chargebacks ?? []).map((r) => [text(r.charge_id), r]));
  const pausesBy = groupBy(rows.pauses, "user_id");
  const chatBy = groupBy(rows.chat, "user_id");
  const eventsBy = groupBy(rows.events, "user_id");
  const notesBy = groupBy(rows.notes.filter((n) => n.user_id), "user_id");
  const prospectNotesBy = groupBy(rows.notes.filter((n) => n.prospect_id), "prospect_id");
  const marksBy = groupBy(rows.marks, "user_id");
  const samplesBy = groupBy(rows.samples, "user_id");
  const intakeBy = groupBy(rows.intake ?? [], "user_id");
  const pulsesBy = groupBy(rows.pulses ?? [], "user_id");
  const aftercareMarksBy = groupBy(rows.aftercareMarks ?? [], "user_id");
  const completionBy = new Map((rows.completions ?? []).map((c) => [text(c.user_id), c]));
  const introBy = new Map((rows.loanOfficerRequests ?? []).filter((r) => !r.withdrawn_at).map((r) => [text(r.user_id), r]));
  const assignmentBy = new Map(rows.assignments.map((a) => [text(a.user_id), a]));
  const outboundBy = groupBy(rows.outbound ?? [], "user_id");
  const optOutsBy = groupBy(rows.optOuts ?? [], "user_id");
  const holdsBy = groupBy(rows.holds ?? [], "user_id");
  const readyBy = groupBy(rows.readyRounds ?? [], "user_id");
  const mailRequestsBy = groupBy(rows.mailRequests ?? [], "user_id");
  const chosenOptionBy = new Map((rows.serviceOptions ?? []).map((r) => [text(r.user_id), r.service_option === "diy" ? ("diy" as const) : ("full_service" as const)]));
  const inboundBy = groupBy(rows.inbound ?? [], "user_id");
  const confirmationsBy = groupBy(rows.addressConfirmations ?? [], "user_id");
  const resolutionsBy = groupBy((rows.resolutions ?? []).filter((r) => r.user_id), "user_id");
  const remailOf = new Map((rows.remails ?? []).map((r) => [text(r.id), text(r.remail_of)]));
  const selfHealingFields = (id: string): Partial<StaffClient> => {
    const requests = [...(confirmationsBy.get(id) ?? [])].sort(byTime("requested_at"));
    const newest = requests.at(-1);
    const resolutions = (resolutionsBy.get(id) ?? []).flatMap((r) => resolutionFromRow(r) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    return {
      ...(newest
        ? {
            addressCheck: {
              id: text(newest.id),
              reason: newest.reason === "returned_letter" ? ("returned_letter" as const) : ("verification" as const),
              finding: newest.finding === "undeliverable" ? ("undeliverable" as const) : ("ambiguous" as const),
              requestedAt: iso(newest.requested_at) ?? "",
              inputLines: lines(newest.input_lines),
              suggestionLines: lines(newest.suggestion_lines),
              letterId: textOrNull(newest.letter_id),
              roundNumber: newest.round_number == null ? null : Number(newest.round_number),
              confirmedAt: iso(newest.confirmed_at),
              confirmedLines: newest.confirmed_lines ? lines(newest.confirmed_lines) : null,
              closedAt: iso(newest.closed_at),
              requests: requests.length,
            },
          }
        : {}),
      ...(resolutions.length > 0 ? { resolutions } : {}),
    };
  };
  const auditByClient = groupBy(rows.audit.filter((a) => a.kind === "client_assigned" && a.client_id), "client_id");
  const auditByProspect = groupBy(rows.audit.filter((a) => a.kind === "client_assigned" && a.prospect_id), "prospect_id");

  const partnersById = new Map((rows.partners ?? []).map((p) => [text(p.id), p]));
  const sourceOf = (prospect: Row | undefined, profile: Row | null) => leadSourceFromRows(prospect, profile, partnersById);
  const profiles = rows.profiles.filter((p) => !staffIds.has(text(p.id)));
  const profilePhones = new Set(profiles.map((p) => phoneKey(p.phone_e164)).filter(Boolean));
  const prospectFor = (profile: Row): Row | undefined =>
    rows.prospects.find((p) => text(p.converted_user_id) === text(profile.id)) ??
    rows.prospects.find((p) => !p.converted_user_id && phoneKey(p.phone_e164) && phoneKey(p.phone_e164) === phoneKey(profile.phone_e164));

  const assignmentsFrom = (audit: Row[] | undefined): ClientAssignment[] | undefined => {
    if (!audit || audit.length === 0) return undefined;
    return [...audit].sort(byTime("at")).map((a) => {
      const detail = (a.detail as Row | null) ?? {};
      return {
        at: iso(a.at) ?? "",
        to: textOrNull(a.member_handle) ?? handle(context, a.member),
        by: a.actor ? (handle(context, a.actor) ?? "equipo") : "sistema",
        auto: detail.auto === true,
      };
    });
  };

  // What the autopilot recorded for one client (migration 0015).
  const autopilotFields = (id: string, profile: Row): Partial<StaffClient> => {
    const outbound = [...(outboundBy.get(id) ?? [])].sort(byTime("queued_at")).map(outboundFromRow);
    const optOut = currentOptOut((optOutsBy.get(id) ?? []).map((r) => ({ kind: r.kind === "opt_in" ? ("opt_in" as const) : ("opt_out" as const), at: iso(r.at) ?? "", row: r })));
    const holds = [...(holdsBy.get(id) ?? [])].sort(byTime("held_at")).map((h) => ({
      id: text(h.id),
      at: iso(h.held_at) ?? "",
      by: text(h.held_by_name) || "equipo",
      reason: text(h.reason),
      releasedAt: iso(h.released_at),
      releasedBy: textOrNull(h.released_by_name),
    }));
    const lastInbound = (inboundBy.get(id) ?? []).map((r) => iso(r.created_at)).reduce<string | null>((max, v) => (v && (!max || v > max) ? v : max), null);
    return {
      ...(profile.locale === "es" ? { locale: "es" as const } : {}),
      ...(outbound.length > 0 ? { outbound } : {}),
      ...(optOut ? { optOut: { at: optOut.at, keyword: text(optOut.row.keyword) || "BAJA", channel: (["whatsapp", "email", "staff", "app"].includes(text(optOut.row.channel)) ? text(optOut.row.channel) : "staff") as OptOutRecord["channel"] } } : {}),
      ...(holds.length > 0 ? { holds } : {}),
      ...(lastInbound ? { lastInboundAt: lastInbound } : {}),
    };
  };

  const clients: StaffClient[] = profiles.map((profile) => {
    const id = text(profile.id);
    const prospect = prospectFor(profile);
    const name = splitName(text(profile.full_name));
    const prospectName = prospect ? { firstName: text(prospect.first_name), lastName: text(prospect.last_name) } : null;

    // The agreement that governs: the one in force (signed, not cancelled, not superseded), else the newest
    // (public.governing_agreement, migration 0042). They differ only while a switch of option waits for its signature.
    const agreementRows = [...(agreementsBy.get(id) ?? [])].sort(byTime("created_at"));
    const agreement = [...agreementRows].reverse().find((a) => a.signed_at && !a.cancelled_at && !a.superseded_at) ?? agreementRows.at(-1) ?? null;
    const terms = (agreement?.terms as Row | null) ?? null;

    // The report: the newest pull, read again from its own JSON.
    const pulls = [...(pullsBy.get(id) ?? [])].sort((a, b) => text(iso(a.pulled_at)).localeCompare(text(iso(b.pulled_at))) || byTime("created_at")(a, b));
    const newest = pulls.at(-1) ?? null;
    const report = newest ? readReport(rows.newestRaw[text(newest.id)]) : null;

    // Answers, by fingerprint.
    const itemRows = itemsBy.get(id) ?? [];
    const fpOf = new Map(itemRows.map((r) => [text(r.id), text(r.fingerprint)]));
    const flagRows = flagsBy.get(id) ?? [];
    const answers: Record<string, ItemAnswer> = {};
    for (const flag of flagRows) {
      const fp = fpOf.get(text(flag.item_id));
      if (!fp) continue;
      if (flag.state === "attested" && flag.attested === true && iso(flag.attested_at)) {
        answers[fp] = {
          status: "inaccurate",
          reason: text(flag.reason),
          ...(isDisputeReasonCode(flag.reason_code) ? { reasonCode: flag.reason_code } : {}),
          confirmedAt: iso(flag.attested_at)!,
          ...(Array.isArray(flag.check_ids) && flag.check_ids.length > 0 ? { checkIds: (flag.check_ids as unknown[]).map(String) } : {}),
        };
      } else if (flag.state === "correct") {
        answers[fp] = { status: "correct", answeredAt: iso(flag.created_at) ?? "" };
      }
      // "flagged": the attestation is still missing, so the item is still pending.
    }
    const reasonsNow: Record<string, DisputeReasonCode> = Object.fromEntries(
      Object.entries(answers).flatMap(([fp, a]) => (a.status === "inaccurate" && a.reasonCode ? [[fp, a.reasonCode]] : [])),
    );

    // Rounds that were mailed.
    const roundRows = roundsBy.get(id) ?? [];
    const letterRows = lettersBy.get(id) ?? [];
    const itemById = new Map(itemRows.map((r) => [text(r.id), r]));
    const staffLetter = (row: Row): StaffLetter => {
      const covered = (letterItemsBy.get(text(row.id)) ?? []).flatMap((li) => {
        const item = itemById.get(text(li.item_id));
        return item ? [itemFromRow(item)] : [];
      });
      const recipient: LetterTarget = {
        type: (text(row.target_type) || "bureau") as LetterTarget["type"],
        key: text(row.target_key),
        name: text(row.target_name),
        addressLines: lines(row.target_address_lines),
      };
      const itemReasons = Object.fromEntries(covered.flatMap((i) => (reasonsNow[i.fingerprint] ? [[i.fingerprint, reasonsNow[i.fingerprint]!]] : [])));
      const mail = letterMailFromRow(row, eventsByLetter.get(text(row.id)) ?? []);
      return {
        id: text(row.id),
        recipient,
        templateKey: text(row.template_key),
        category: letterCategory(text(row.template_key), covered),
        stage: (text(row.escalation_stage) || "dispute") as StaffLetter["stage"],
        items: covered,
        ...(Object.keys(itemReasons).length > 0 ? { itemReasons } : {}),
        mailStatus: MAIL_STATUSES.find((s) => s === row.mail_status) ?? "not_sent",
        ...(MAIL_CLASSES.includes(row.mail_class as MailClass) ? { mailClass: row.mail_class as MailClass } : {}),
        ...(mail ? { mail } : {}),
        ...(remailOf.get(text(row.id)) ? { remailOf: remailOf.get(text(row.id))! } : {}),
      };
    };

    const rounds: StaffRound[] = roundRows
      .filter((r) => (r.status === "mailed" || r.status === "complete") && iso(r.mailed_at))
      .sort((a, b) => Number(a.round_number) - Number(b.round_number))
      .map((r) => {
        const mailedAt = iso(r.mailed_at)!;
        const answered = r.status === "complete";
        // A round the system closed before responded_at existed: the first report after it was mailed stands in.
        const respondedAt = answered
          ? (iso(r.responded_at) ?? pulls.map((p) => iso(p.created_at)).find((at) => at && at > mailedAt) ?? mailedAt)
          : null;
        const results = roundResults(r.results);
        const sentBy = handle(context, r.sent_by, textOrNull(r.sent_by_name));
        return {
          number: Number(r.round_number),
          status: answered ? ("responded" as const) : ("mailed" as const),
          mailedAt,
          respondedAt,
          letters: letterRows.filter((l) => text(l.round_id) === text(r.id) && l.status !== "draft").sort(byTime("created_at")).map(staffLetter),
          ...(results.length > 0 ? { results } : {}),
          ...(sentBy ? { sentBy } : {}),
        };
      });

    // The next round, as the engine would write it now. The first one only
    // once the review of the report on file is finished.
    const pending = report ? report.items.some((item) => !answers[item.fingerprint]) : true;
    const next = planNextRound({
      itemRows,
      flagRows,
      roundRows,
      letterRows,
      letterItemRows: rows.letterItems.filter((li) => letterRows.some((l) => text(l.id) === text(li.letter_id))),
      reportDate: report?.pulledAt ?? null,
    });
    if (next && next.plan.letters.length > 0 && (rounds.length > 0 || !pending)) {
      const prior = new Map(
        letterRows.filter((l) => next.roundId && text(l.round_id) === next.roundId).map((l) => [letterKey(text(l.target_type), text(l.target_key), text(l.template_key)), l]),
      );
      const itemByFp = new Map(next.items.map((i) => [i.fingerprint, i]));
      const draft = {
        number: next.roundNumber,
        status: "ready" as const,
        mailedAt: null,
        respondedAt: null,
        letters: next.plan.letters.map((planned) => {
          const key = letterKey(planned.target.type, planned.target.key, planned.templateKey);
          const already = prior.get(key);
          const covered = planned.itemFingerprints.flatMap((fp) => itemByFp.get(fp) ?? []);
          const itemReasons = Object.fromEntries(planned.itemFingerprints.flatMap((fp) => (next.itemReasons[fp] ? [[fp, next.itemReasons[fp]!]] : [])));
          const itemDetails = Object.fromEntries(planned.itemFingerprints.flatMap((fp) => (next.itemDetails[fp] ? [[fp, next.itemDetails[fp]!]] : [])));
          return {
            id: plannedLetterId(id, next.roundNumber, key),
            recipient: planned.target,
            templateKey: planned.templateKey,
            category: planned.category,
            stage: planned.stage,
            items: covered,
            ...(Object.keys(itemReasons).length > 0 ? { itemReasons } : {}),
            ...(Object.keys(itemDetails).length > 0 ? { itemDetails } : {}),
            mailStatus: already && already.status !== "draft" ? (MAIL_STATUSES.find((s) => s === already.mail_status) ?? "in_transit") : "not_sent",
          };
        }),
      };
      // When the system first saw these letters ready (the autopilot's review window counts from here).
      const planKey = roundPlanKey(draft);
      const seen = (readyBy.get(id) ?? []).find((r) => Number(r.round_number) === draft.number && text(r.plan_key) === planKey);
      // Credalti DIY: when Alti prepared these letters (the draft letter rows), and the open "Mail them for me"
      // request, with its letters as the console names them (the planned ids) and as the database does (row ids).
      const preparedAt = [...prior.values()].filter((l) => l.status === "draft").map((l) => iso(l.created_at)).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
      const plannedIdOfRow = new Map([...prior.entries()].map(([key, l]) => [text(l.id), plannedLetterId(id, next.roundNumber, key)]));
      const openRequest = (mailRequestsBy.get(id) ?? []).find((m) => m.status === "requested" && next.roundId && text(m.round_id) === next.roundId) ?? null;
      const mailRequest = openRequest ? mailRequestFromRow(openRequest, next.roundNumber, plannedIdOfRow) : null;
      const withDiy = { ...draft, ...(preparedAt ? { diyPreparedAt: preparedAt } : {}), ...(mailRequest ? { mailRequest } : {}) };
      rounds.push(seen ? { ...withDiy, readyAt: iso(seen.first_ready_at) } : withDiy);
    }

    // Billing.
    const method = (methodsBy.get(id) ?? []).find((m) => !m.removed_at) ?? null;
    const pauseRow = (pausesBy.get(id) ?? []).find((p) => !p.lifted_at) ?? null;
    const pause: BillingPause | null = pauseRow
      ? { at: iso(pauseRow.created_at) ?? "", by: text(pauseRow.paused_by_name) || "equipo", reason: text(pauseRow.reason) }
      : null;
    const billing: BillingAccount = {
      paymentMethod: method ? paymentMethodFromRow(method) : null,
      charges: [...(chargesBy.get(id) ?? [])].sort(byTime("work_date")).map((c) => chargeFromRow(c, refundsByCharge.get(text(c.id)) ?? null, chargebackByCharge.get(text(c.id)) ?? null)),
      pause,
    };

    // The team's records.
    const notes: StaffNote[] = [...(notesBy.get(id) ?? [])].sort(byTime("created_at")).map((n) => ({
      id: text(n.id),
      at: iso(n.created_at) ?? "",
      author: text(n.author_name) || "equipo",
      text: text(n.body),
    }));
    const handled: Record<string, string> = {};
    for (const mark of [...(marksBy.get(id) ?? [])].sort(byTime("handled_at"))) handled[text(mark.exception_key)] = iso(mark.handled_at) ?? "";
    const conversation: StaffChatMessage[] = [...(chatBy.get(id) ?? [])]
      .filter((m) => (m.channel ?? "app") === "app")
      .sort(byTime("created_at"))
      .map((m) => {
        const source = SOURCES.find((s) => s === m.source) ?? "journey";
        const authorName = source === "human" ? textOrNull(m.author_name) : null;
        return {
          id: text(m.id),
          at: iso(m.created_at) ?? "",
          role: (m.role === "user" ? "user" : "assistant") as ChatRole,
          source,
          ...(authorName ? { authorName } : {}),
          text: text(m.body),
        };
      });
    // A question the assistant passed to the team (events.kind "question_escalated"),
    // answered by a handled mark or by the team's next reply.
    const questions: EscalatedQuestion[] = (eventsBy.get(id) ?? [])
      .filter((e) => e.kind === "question_escalated")
      .sort(byTime("created_at"))
      .map((e) => {
        const askedAt = iso(e.created_at) ?? "";
        const reply = conversation.find((m) => m.source === "human" && m.at >= askedAt);
        return {
          id: text(e.id),
          askedAt,
          text: text((e.payload as Row | null)?.text),
          answeredAt: handled[`question:${text(e.id)}`] ?? reply?.at ?? null,
        };
      });
    const reportImports: ReportImport[] = pulls
      .filter((p) => textOrNull(p.imported_by_name))
      .map((p) => {
        const summary = (p.import_summary as Row | null) ?? {};
        return {
          at: iso(p.created_at) ?? "",
          by: text(p.imported_by_name),
          readerKey: text(p.reader_key),
          reportDate: iso(p.pulled_at) ?? "",
          itemCount: Number(summary.itemCount ?? 0),
          removed: Number(summary.removed ?? 0),
          added: Number(summary.added ?? 0),
          changed: Number(summary.changed ?? 0),
          closedRound: typeof summary.closedRound === "number" ? summary.closedRound : null,
          ...(textOrNull(p.source) ? { source: text(p.source) } : {}),
          ...(typeof summary.skippedPersonalInfo === "number" ? { skippedPersonalInfo: summary.skippedPersonalInfo } : {}),
          ...(typeof summary.reappeared === "number" ? { reappeared: summary.reappeared } : {}),
          ...(Array.isArray(summary.personalInfo) ? { personalInfo: readChangeRecords(summary.personalInfo) } : {}),
        };
      });
    // Every report in the file, staff-imported or not, for the Reports tab (reports/history.ts).
    const reportHistory = historyFromPullRows(pulls);
    const reportSamples: ReportSample[] = [...(samplesBy.get(id) ?? [])].sort(byTime("saved_at")).map((s) => ({
      id: text(s.id),
      provider: text(s.provider),
      savedAt: iso(s.saved_at) ?? "",
      savedBy: text(s.saved_by_name) || "equipo",
      fileName: textOrNull(s.file_name),
      text: text(s.body),
    }));

    const intake = [...(intakeBy.get(id) ?? [])]
      .sort(byTime("created_at"))
      .map(intakeRecordFromRow)
      .filter((r): r is IntakeRecord => r !== null);

    const documents = DOCUMENT_KINDS.filter((kind) => (documentsBy.get(id) ?? []).some((d) => d.kind === kind));
    const assignment = assignmentBy.get(id);
    const createdAt = iso(prospect?.created_at) ?? iso(profile.created_at) ?? "";

    const lastActivityAt =
      latest(
        iso(profile.created_at),
        iso(profile.onboarded_at),
        ...(documentsBy.get(id) ?? []).map((d) => iso(d.uploaded_at)),
        ...flagRows.map((f) => latest(iso(f.created_at), iso(f.attested_at))),
        ...pulls.map((p) => iso(p.created_at)),
        ...letterRows.map((l) => iso(l.mailed_at)),
        ...conversation.map((m) => m.at),
        iso(agreement?.signed_at),
        iso(agreement?.disclosure_acknowledged_at),
        iso(agreement?.cancelled_at),
        iso(agreement?.service_end_requested_at),
      ) ?? createdAt;

    const client: StaffClient = {
      id,
      firstName: name.firstName || prospectName?.firstName || "",
      lastName: name.firstName ? name.lastName : (prospectName?.lastName ?? ""),
      phone: text(profile.phone_e164) || text(prospect?.phone_e164),
      state: text(profile.state) || text(prospect?.state),
      addressLines: lines(profile.address_lines),
      salesperson: text(profile.referred_by) || text(prospect?.salesperson),
      createdAt,
      signedUpAt: iso(profile.created_at),
      agreementSignedAt: iso(agreement?.signed_at),
      disclosureAcknowledgedAt: agreement ? iso(agreement.disclosure_acknowledged_at) : null,
      agreementVersion: textOrNull(agreement?.document_version),
      cancellationDeadline: iso(agreement?.cancellation_deadline),
      agreementCancelledAt: iso(agreement?.cancelled_at),
      cancelledWithinWindow: typeof agreement?.cancelled_within_window === "boolean" ? agreement.cancelled_within_window : null,
      serviceEndRequestedAt: iso(agreement?.service_end_requested_at),
      serviceEndReason: textOrNull(agreement?.service_end_reason),
      documents,
      report,
      answers,
      rounds,
      // The option: the signed agreement in force decides, else what they chose (migration 0042).
      serviceOption: agreement?.signed_at && !agreement.cancelled_at ? optionOfTerms(terms) : (chosenOptionBy.get(id) ?? "full_service"),
      ...((mailRequestsBy.get(id) ?? []).length > 0
        ? {
            mailRequests: (mailRequestsBy.get(id) ?? [])
              .map((m) => mailRequestFromRow(m, Number(roundRows.find((r) => text(r.id) === text(m.round_id))?.round_number ?? 0), new Map()))
              .sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt)),
          }
        : {}),
      agreementMonthlyFee: agreement?.signed_at && terms ? textOrNull(terms.monthlyFee) : null,
      agreementPlan: agreement?.signed_at && terms ? readPlanSnapshot((terms as Row).plan) : null,
      agreementRecord: agreement?.signed_at
        ? {
            documentHash: textOrNull(agreement.document_hash),
            signerName: textOrNull(agreement.signer_name),
            signerIp: textOrNull(agreement.signer_ip),
            signerUserAgent: textOrNull(agreement.signer_user_agent),
            locale: agreement.locale === "es" ? "es" : "en",
          }
        : null,
      methodAuthorization: method
        ? {
            hash: text(method.authorization_hash),
            locale: method.authorization_locale === "es" ? "es" : "en",
            ip: textOrNull(method.authorized_ip),
            userAgent: textOrNull(method.authorized_user_agent),
            gateway: text(method.gateway),
          }
        : null,
      billing,
      lastActivityAt,
      notes,
      questions,
      handled,
      ...(conversation.length > 0 ? { conversation } : {}),
      ...(reportImports.length > 0 ? { reportImports } : {}),
      ...(reportHistory.length > 0 ? { reportHistory } : {}),
      ...(reportSamples.length > 0 ? { reportSamples } : {}),
      ...(intake.length > 0 ? { intake } : {}),
      ...pulseFields(pulsesBy.get(id)),
      assignedTo: assignment ? handle(context, assignment.staff_user_id) : null,
      ...(assignmentsFrom(auditByClient.get(id)) ? { assignments: assignmentsFrom(auditByClient.get(id)) } : {}),
      email: textOrNull(prospect?.email),
      goal: textOrNull(profile.goal) ?? textOrNull(prospect?.goal),
      ...(prospect ? { addedBy: handle(context, prospect.created_by) } : {}),
      ...autopilotFields(id, profile),
      ...selfHealingFields(id),
      ...(sourceOf(prospect, profile) ? { leadSource: sourceOf(prospect, profile) } : {}),
      ...(householdOf.get(id) ? { household: householdOf.get(id)! } : {}),
      idType: parseIdType(profile.id_type),
      aftercareMarks: marksFromRows(aftercareMarksBy.get(id) ?? []),
      graduation: graduationFromRow(completionBy.get(id)),
      loanOfficerRequest: introOf(introBy.get(id), createdAt),
      ...fulfillmentFields(id, {
        notificationSettings: rows.notificationSettings,
        monitoringChecks: rows.monitoringChecks,
        documentReviews: rows.documentReviews,
        clientFiles: rows.clientFiles,
        documents: documentsBy.get(id),
      }),
    };
    return client;
  });

  // People sales added by hand who have no account yet (and whose phone no account has).
  for (const prospect of rows.prospects) {
    // A prospect sales closed (lost_at, migration 0017) is kept on record but leaves the list.
    if (prospect.converted_user_id || prospect.lost_at || profilePhones.has(phoneKey(prospect.phone_e164))) continue;
    const id = text(prospect.id);
    const at = iso(prospect.created_at) ?? "";
    const assignments = assignmentsFrom(auditByProspect.get(id));
    clients.push({
      id,
      firstName: text(prospect.first_name),
      lastName: text(prospect.last_name),
      phone: text(prospect.phone_e164),
      state: text(prospect.state),
      addressLines: [],
      salesperson: text(prospect.salesperson),
      createdAt: at,
      signedUpAt: null,
      agreementSignedAt: null,
      documents: [],
      report: null,
      answers: {},
      rounds: [],
      billing: { paymentMethod: null, charges: [], pause: null },
      lastActivityAt: at,
      notes: [...(prospectNotesBy.get(id) ?? [])].sort(byTime("created_at")).map((n) => ({ id: text(n.id), at: iso(n.created_at) ?? "", author: text(n.author_name) || "equipo", text: text(n.body) })),
      questions: [],
      handled: {},
      assignedTo: handle(context, prospect.assigned_to),
      ...(assignments ? { assignments } : {}),
      email: textOrNull(prospect.email),
      goal: textOrNull(prospect.goal),
      addedBy: handle(context, prospect.created_by),
      ...(sourceOf(prospect, null) ? { leadSource: sourceOf(prospect, null) } : {}),
      ...(householdOf.get(id) ? { household: householdOf.get(id)! } : {}),
    });
  }

  return clients;
}

/**
 * Each client's household, by the console's client id (an account's id, or a
 * prospect's while they have none): the other person's id and name, how they
 * are related, and whether the discount link exists yet. Only the link: the
 * other person's case is theirs and stays out of this record.
 */
export function householdsFromRows(rows: Pick<StaffRows, "households" | "householdLinks" | "prospects" | "profiles">): Map<string, HouseholdLink> {
  const out = new Map<string, HouseholdLink>();
  const convertedOf = new Map(rows.prospects.filter((p) => p.converted_user_id).map((p) => [text(p.id), text(p.converted_user_id)]));
  const relationshipOf = (v: unknown): HouseholdLink["relationship"] => (v === "spouse" || v === "partner" || v === "family" ? v : "household");
  const linked = new Set<string>();
  for (const h of rows.households ?? []) {
    if (h.ended_at) continue;
    const primaryId = textOrNull(h.primary_user_id) ?? convertedOf.get(text(h.primary_prospect_id)) ?? text(h.primary_prospect_id);
    const memberId = convertedOf.get(text(h.member_prospect_id)) ?? text(h.member_prospect_id);
    const status: HouseholdLink["status"] = h.link_id ? "linked" : "invited";
    const relationship = relationshipOf(h.relationship);
    out.set(primaryId, { partnerId: memberId, partnerName: text(h.member_name), relationship, status });
    out.set(memberId, { partnerId: primaryId, partnerName: text(h.primary_name), relationship, status });
    if (h.link_id) linked.add(text(h.link_id));
  }
  // Two existing clients an administrator linked from Plans: their names from the profiles this member may read.
  const nameOf = new Map(rows.profiles.map((p) => [text(p.id), text(p.full_name)]));
  for (const l of rows.householdLinks ?? []) {
    if (l.ended_at || linked.has(text(l.id))) continue;
    const a = text(l.user_a);
    const b = text(l.user_b);
    if (!out.has(a) && nameOf.has(b)) out.set(a, { partnerId: b, partnerName: nameOf.get(b)!, relationship: "household", status: "linked" });
    if (!out.has(b) && nameOf.has(a)) out.set(b, { partnerId: a, partnerName: nameOf.get(a)!, relationship: "household", status: "linked" });
  }
  return out;
}

/** The id the console gives a letter of the next round before it exists: client, round and the letter's key. */
export function plannedLetterId(clientId: string, roundNumber: number, key: string): string {
  return `planned:${clientId}:${roundNumber}:${key}`;
}

/** The letter key of a planned letter id for this client and round, or null when the id is not one. */
export function plannedLetterKey(letterId: string, clientId: string, roundNumber: number): string | null {
  const prefix = `planned:${clientId}:${roundNumber}:`;
  return letterId.startsWith(prefix) ? letterId.slice(prefix.length) : null;
}

/** The client's pulse answers, oldest first; nothing when there are none. */
function pulseFields(rows: Row[] | undefined): { pulses?: PulseRow[] } {
  const pulses = (rows ?? []).flatMap((row) => pulseFromRow(row) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return pulses.length > 0 ? { pulses } : {};
}

/** The open introduction request, as the console shows it. */
function introOf(row: Row | undefined, fallback: string): StaffClient["loanOfficerRequest"] {
  if (!row) return null;
  const at = typeof row.created_at === "string" && !Number.isNaN(Date.parse(row.created_at)) ? new Date(row.created_at).toISOString() : fallback;
  return { partnerName: String(row.partner_name_shown ?? ""), how: row.how === "referred" ? "referred" : "accepting", at };
}
