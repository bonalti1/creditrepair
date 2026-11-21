import type { SupabaseClient } from "@supabase/supabase-js";
import type { FurnisherEntry } from "./furnishers";
import { eventRecord, mailState, type LobWebhookEvent } from "./tracking";
import type { MailClass, MailEventKind, MailEventRecord, MailStatus } from "./types";

// Mail on the server: reading the address book from the database, and
// recording what Lob reports about a letter (POST /api/webhooks/lob).
//
// Recording an event is written against a small store interface, so the rules
// (each event once, a status computed from all of them, a returned letter
// announced once) are tested without a database; supabaseMailStore is the
// real store, over the tables of migration 0013.

type Row = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

/** A furnishers row as an address book entry. The history is loaded separately (furnisher_changes). */
export function furnisherFromRow(row: Row): FurnisherEntry {
  return {
    id: text(row.id),
    name: text(row.name),
    aliases: lines(row.aliases),
    addressLines: lines(row.address_lines),
    phone: textOrNull(row.phone),
    notes: textOrNull(row.notes),
    source: textOrNull(row.source),
    verifiedOn: textOrNull(row.verified_on)?.slice(0, 10) ?? null,
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by_name) || "equipo",
    history: [],
  };
}

// ── Recording events ────────────────────────────────────────────────────

export interface TrackedLetter {
  id: string;
  userId: string;
  mailClass: MailClass;
  mailStatus: MailStatus;
  mailedAt: string | null;
}

export interface MailEventRow {
  provider: "lob";
  providerEventId: string;
  letterId: string;
  userId: string;
  eventType: string;
  kind: MailEventKind;
  mailStatus: MailStatus | null;
  occurredAt: string;
  trackingNumber: string | null;
  location: string | null;
  detail: string | null;
}

export interface LetterMailUpdate {
  mailStatus: MailStatus;
  trackingNumber: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  returnReason: string | null;
}

export interface MailStore {
  /** The letter Lob calls `lobId`, or null when it is not one of ours. */
  findLetter(lobId: string): Promise<TrackedLetter | null>;
  /** Inserts the event; "duplicate" when that provider event id is already on record. */
  insertEvent(row: MailEventRow): Promise<"inserted" | "duplicate">;
  /** Every event on record for the letter. */
  listEvents(letterId: string): Promise<MailEventRecord[]>;
  updateLetter(letterId: string, update: LetterMailUpdate): Promise<void>;
  /** Writes the "letter returned" record staff are alerted from. Called once per letter. */
  recordReturned(letter: TrackedLetter, update: LetterMailUpdate): Promise<void>;
}

export type RecordOutcome =
  | { outcome: "not_a_letter_event" }
  | { outcome: "unknown_letter" }
  | { outcome: "recorded" | "duplicate"; status: MailStatus; returnedNow: boolean };

/**
 * Records one Lob event. Safe to repeat: the event is stored once (the
 * database's unique provider event id), and the letter's status is always
 * recomputed from every stored event, so a retried delivery that failed half
 * way finishes the job, and events arriving out of order end in the right
 * status.
 */
export async function recordLobEvent(store: MailStore, event: LobWebhookEvent): Promise<RecordOutcome> {
  const record = eventRecord(event);
  if (!record) return { outcome: "not_a_letter_event" };
  const letter = await store.findLetter(event.letterId);
  if (!letter) return { outcome: "unknown_letter" };

  const inserted = await store.insertEvent({
    provider: "lob",
    providerEventId: event.eventId,
    letterId: letter.id,
    userId: letter.userId,
    eventType: event.eventType,
    kind: record.kind,
    mailStatus: record.status,
    occurredAt: record.at,
    trackingNumber: event.trackingNumber,
    location: record.location ?? null,
    detail: record.detail ?? null,
  });

  const events = await store.listEvents(letter.id);
  const state = mailState(events, true);
  const update: LetterMailUpdate = {
    mailStatus: state.status,
    trackingNumber: event.trackingNumber,
    deliveredAt: state.deliveredAt,
    returnedAt: state.returnedAt,
    returnReason: state.returnReason,
  };
  await store.updateLetter(letter.id, update);

  const back = (s: MailStatus) => s === "returned" || s === "undeliverable";
  const returnedNow = back(state.status) && !back(letter.mailStatus);
  if (returnedNow) await store.recordReturned(letter, update);
  return { outcome: inserted === "inserted" ? "recorded" : "duplicate", status: state.status, returnedNow };
}

// ── The database store ──────────────────────────────────────────────────

const STATUSES: readonly MailStatus[] = ["not_sent", "in_transit", "delivered", "returned", "undeliverable"];
const asStatus = (v: unknown): MailStatus | null => STATUSES.find((s) => s === v) ?? null;

/** The store over letters, mail_events and events (service role). Throws on any database error. */
export function supabaseMailStore(db: SupabaseClient): MailStore {
  return {
    async findLetter(lobId) {
      const { data, error } = await db
        .from("letters")
        .select("id, user_id, mail_class, mail_status, mailed_at")
        .eq("lob_id", lobId)
        .maybeSingle();
      if (error) throw new Error(`letters: ${error.message}`);
      if (!data) return null;
      const row = data as Row;
      return {
        id: text(row.id),
        userId: text(row.user_id),
        mailClass: (textOrNull(row.mail_class) as MailClass | null) ?? "first_class",
        mailStatus: asStatus(row.mail_status) ?? "not_sent",
        mailedAt: textOrNull(row.mailed_at),
      };
    },
    async insertEvent(row) {
      const { error } = await db.from("mail_events").insert({
        provider: row.provider,
        provider_event_id: row.providerEventId,
        letter_id: row.letterId,
        user_id: row.userId,
        event_type: row.eventType,
        kind: row.kind,
        mail_status: row.mailStatus,
        occurred_at: row.occurredAt,
        tracking_number: row.trackingNumber,
        location: row.location,
        detail: row.detail,
      });
      if (!error) return "inserted";
      // unique_violation: this event is already on record.
      if (error.code === "23505") return "duplicate";
      throw new Error(`mail_events: ${error.message}`);
    },
    async listEvents(letterId) {
      const { data, error } = await db
        .from("mail_events")
        .select("provider_event_id, occurred_at, kind, mail_status, location, detail")
        .eq("letter_id", letterId);
      if (error) throw new Error(`mail_events: ${error.message}`);
      return ((data as Row[] | null) ?? []).map((row) => ({
        id: text(row.provider_event_id),
        at: new Date(text(row.occurred_at)).toISOString(),
        kind: text(row.kind) as MailEventKind,
        status: asStatus(row.mail_status),
        location: textOrNull(row.location),
        detail: textOrNull(row.detail),
      }));
    },
    async updateLetter(letterId, update) {
      const { error } = await db
        .from("letters")
        .update({
          mail_status: update.mailStatus,
          ...(update.trackingNumber ? { tracking_number: update.trackingNumber } : {}),
          delivered_at: update.deliveredAt,
          returned_at: update.returnedAt,
          return_reason: update.returnReason,
          mail_updated_at: new Date().toISOString(),
          // The older status column follows a delivery, for what still reads it.
          ...(update.mailStatus === "delivered" ? { status: "delivered" } : {}),
        })
        .eq("id", letterId);
      if (error) throw new Error(`letters: ${error.message}`);
    },
    async recordReturned(letter, update) {
      const { error } = await db.from("events").insert({
        user_id: letter.userId,
        kind: "letter_returned",
        payload: { letterId: letter.id, status: update.mailStatus, reason: update.returnReason, at: update.returnedAt },
      });
      if (error) throw new Error(`events: ${error.message}`);
    },
  };
}
