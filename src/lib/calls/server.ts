import type { SupabaseClient } from "@supabase/supabase-js";
import { availabilityFromEnv } from "../autopilot/channels";
import { currentOptOut } from "../autopilot/optout";
import { loadAutopilotSettings } from "../autopilot/store";
import { emailSubject } from "../autopilot/templates";
import type { ChannelAvailability } from "../autopilot/types";
import { unsubscribeUrl } from "../autopilot/unsubscribe";
import { sendEmail } from "../integrations/email";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../integrations/whatsapp";
import { reportError } from "../observability/errors";
import { CALL_CONSENT, callConsentHash, CALL_TIME_ZONE, QUESTIONS_ONLY } from "./config";
import { planCallMessages, type BookingForMessages, type PlannedCallMessage } from "./messages";
import type { CallBooking, CallMessageRecord, CallStatus } from "./queue";
import { openSlots, slotEnd, slotProblem, windowFromRequest, type CallSlot, type CallWindow, type SlotProblem, type WindowProblem, type WindowRequest } from "./slots";

// Calls on the database (migration 0032). Service role only: the routes check
// who is asking (POST /api/calls for a person booking, /api/staff/calls with
// "calls.manage" for the team) and the flag (calls are off by default).

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const iso = (v: unknown) => (v ? new Date(text(v)).toISOString() : null);

export function windowFromRow(row: Row): CallWindow {
  return {
    id: text(row.id),
    startsAt: iso(row.starts_at)!,
    endsAt: iso(row.ends_at)!,
    slotMinutes: Number(row.slot_minutes),
    timeZone: text(row.time_zone) || CALL_TIME_ZONE,
    createdByName: text(row.created_by_name),
    removedAt: iso(row.removed_at),
  };
}

export function bookingFromRow(row: Row, messages: CallMessageRecord[] = []): CallBooking {
  return {
    id: text(row.id),
    windowId: text(row.window_id),
    slotStart: iso(row.slot_start)!,
    slotEnd: iso(row.slot_end)!,
    caseRef: text(row.case_ref) || null,
    userId: text(row.user_id) || null,
    firstName: text(row.first_name),
    phone: text(row.phone_e164),
    email: text(row.email) || null,
    confirmChannel: row.confirm_channel === "email" ? "email" : "whatsapp",
    locale: row.locale === "es" ? "es" : "en",
    timeZone: text(row.time_zone) || CALL_TIME_ZONE,
    state: text(row.state) || null,
    question: text(row.question) || null,
    status: (["booked", "cancelled", "completed", "no_answer"].includes(text(row.status)) ? text(row.status) : "booked") as CallStatus,
    createdAt: iso(row.created_at)!,
    closedAt: iso(row.closed_at),
    closedByName: text(row.closed_by_name) || null,
    staffNote: text(row.staff_note) || null,
    messages,
  };
}

/** Windows that end after `from` (default: now), open ones only unless asked. */
export async function loadWindows(db: SupabaseClient, options: { from?: Date; includeRemoved?: boolean } = {}): Promise<CallWindow[]> {
  let query = db.from("call_windows").select("*").gte("ends_at", (options.from ?? new Date()).toISOString());
  if (!options.includeRemoved) query = query.is("removed_at", null);
  const { data, error } = await query.order("starts_at", { ascending: true });
  if (error) throw new Error(`call_windows: ${error.message}`);
  return ((data as Row[] | null) ?? []).map(windowFromRow);
}

async function bookedStarts(db: SupabaseClient, from: Date): Promise<string[]> {
  const { data, error } = await db.from("call_bookings").select("slot_start").eq("status", "booked").gte("slot_start", from.toISOString());
  if (error) throw new Error(`call_bookings: ${error.message}`);
  return ((data as Row[] | null) ?? []).map((r) => iso(r.slot_start)!);
}

/** The free slots, for the booking page. Only times: nothing about who booked the others. */
export async function availableSlots(db: SupabaseClient, now: Date = new Date()): Promise<CallSlot[]> {
  const [windows, taken] = await Promise.all([loadWindows(db, { from: now }), bookedStarts(db, now)]);
  return openSlots(windows, taken, now);
}

export async function addWindow(
  db: SupabaseClient,
  req: WindowRequest,
  by: { userId: string; name: string },
  now: Date = new Date(),
): Promise<{ ok: true; window: CallWindow } | { ok: false; problems: WindowProblem[] }> {
  const parsed = windowFromRequest(req, now);
  if (!parsed.ok) return parsed;
  const { data, error } = await db
    .from("call_windows")
    .insert({ starts_at: parsed.startsAt, ends_at: parsed.endsAt, slot_minutes: req.slotMinutes, time_zone: req.timeZone, created_by: by.userId, created_by_name: by.name.slice(0, 80) || "Equipo" })
    .select("*")
    .single();
  if (error) throw new Error(`call_windows: ${error.message}`);
  return { ok: true, window: windowFromRow(data as Row) };
}

export async function removeWindow(db: SupabaseClient, id: string, by: { userId: string; name: string }): Promise<boolean> {
  const { data, error } = await db
    .from("call_windows")
    .update({ removed_at: new Date().toISOString(), removed_by: by.userId, removed_by_name: by.name.slice(0, 80) || "Equipo" })
    .eq("id", id)
    .is("removed_at", null)
    .select("id");
  if (error) throw new Error(`call_windows: ${error.message}`);
  return ((data as Row[] | null) ?? []).length > 0;
}

/** Bookings from `from` on (default: a day ago), with their messages. Read through the given connection (RLS decides). */
export async function loadBookings(db: SupabaseClient, options: { from?: Date } = {}): Promise<CallBooking[]> {
  const from = options.from ?? new Date(Date.now() - 24 * 3_600_000);
  const { data, error } = await db.from("call_bookings").select("*").gte("slot_start", from.toISOString()).order("slot_start", { ascending: true });
  if (error) throw new Error(`call_bookings: ${error.message}`);
  const rows = (data as Row[] | null) ?? [];
  if (rows.length === 0) return [];
  const { data: msgs } = await db.from("call_messages").select("booking_id, kind, channel, status, sent_at").in("booking_id", rows.map((r) => text(r.id)));
  const byBooking = new Map<string, CallMessageRecord[]>();
  for (const m of (msgs as Row[] | null) ?? []) {
    const list = byBooking.get(text(m.booking_id)) ?? [];
    list.push({ kind: m.kind === "reminder" ? "reminder" : "confirmation", channel: m.channel === "email" ? "email" : "whatsapp", status: (["sending", "sent", "failed"].includes(text(m.status)) ? text(m.status) : "sending") as CallMessageRecord["status"], sentAt: iso(m.sent_at) });
    byBooking.set(text(m.booking_id), list);
  }
  return rows.map((r) => bookingFromRow(r, byBooking.get(text(r.id)) ?? []));
}

export interface BookingInput {
  windowId: string;
  start: string;
  firstName: string;
  phone: string;
  email: string | null;
  confirmChannel: "whatsapp" | "email";
  locale: "es" | "en";
  timeZone: string;
  state: string | null;
  question: string | null;
  caseRef: string | null;
  /** The person ticked the consent box (the route refuses otherwise). */
  consent: true;
  consentTextHash: string;
}

export type BookingResult =
  | { ok: true; booking: CallBooking }
  | { ok: false; code: SlotProblem | "consent_changed" | "email_needs_account" };

/**
 * Books a slot for a person. The slot is checked here and again by the
 * database (one booking per slot, an open window, the future). The consent's
 * words must be the ones this build shows.
 */
export async function createBooking(
  db: SupabaseClient,
  input: BookingInput,
  meta: { userId: string | null; ip: string | null; userAgent: string | null },
  now: Date = new Date(),
): Promise<BookingResult> {
  if (input.consentTextHash !== callConsentHash(input.locale)) return { ok: false, code: "consent_changed" };
  if (input.confirmChannel === "email" && !meta.userId) return { ok: false, code: "email_needs_account" };
  const [windows, taken] = await Promise.all([loadWindows(db, { from: now }), bookedStarts(db, now)]);
  const problem = slotProblem({ windowId: input.windowId, start: input.start }, windows, taken, now);
  if (problem) return { ok: false, code: problem };
  const w = windows.find((x) => x.id === input.windowId)!;
  // A case reference is kept only when it is a real signup.
  let caseRef: string | null = null;
  if (input.caseRef) {
    const { data } = await db.from("signup_cases").select("case_ref").eq("case_ref", input.caseRef).maybeSingle();
    caseRef = data ? input.caseRef : null;
  }
  const start = new Date(input.start).toISOString();
  const { data, error } = await db
    .from("call_bookings")
    .insert({
      window_id: w.id,
      slot_start: start,
      slot_end: slotEnd(start, w.slotMinutes),
      case_ref: caseRef,
      user_id: meta.userId,
      first_name: input.firstName.trim().slice(0, 60),
      phone_e164: input.phone,
      email: input.email,
      confirm_channel: input.confirmChannel,
      locale: input.locale,
      time_zone: input.timeZone,
      state: input.state,
      question: input.question?.trim().slice(0, 500) || null,
      call_consent: true,
      consent_version: CALL_CONSENT.version,
      consent_text_hash: input.consentTextHash,
      consent_ip: meta.ip?.slice(0, 64) ?? null,
      consent_user_agent: meta.userAgent?.slice(0, 300) ?? null,
      notice_version: QUESTIONS_ONLY.version,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, code: "taken" };
    throw new Error(`call_bookings: ${error.message}`);
  }
  if (caseRef) await db.from("signup_cases").update({ wants_person: true }).eq("case_ref", caseRef);
  return { ok: true, booking: bookingFromRow(data as Row) };
}

/** The team closes a booking once: completed, not answered, or cancelled. */
export async function closeBooking(
  db: SupabaseClient,
  id: string,
  outcome: Exclude<CallStatus, "booked">,
  by: { userId: string; name: string },
  note: string | null,
): Promise<boolean> {
  const { data, error } = await db
    .from("call_bookings")
    .update({ status: outcome, closed_at: new Date().toISOString(), closed_by: by.userId, closed_by_name: by.name.slice(0, 80) || "Equipo", staff_note: note?.trim().slice(0, 500) || null })
    .eq("id", id)
    .eq("status", "booked")
    .select("id");
  if (error) throw new Error(`call_bookings: ${error.message}`);
  return ((data as Row[] | null) ?? []).length > 0;
}

// ── Confirmations and reminders ─────────────────────────────────────────

export interface CallDeliveryResult {
  ok: boolean;
  providerRef: string | null;
  note?: string;
}

export type CallDeliver = (booking: BookingForMessages, message: PlannedCallMessage) => Promise<CallDeliveryResult>;

/** The real channels: WhatsApp (text in the 24-hour window, else the approved template) or email with the legal footer. Never SMS. */
export const deliverCallMessage: CallDeliver = async (booking, message) => {
  if (message.channel === "whatsapp") {
    const to = booking.phone.replace(/^\+/, "");
    if (message.mode === "text") {
      const r = await sendWhatsAppText(to, message.body, `calls:${message.kind}`);
      return r.sent ? { ok: true, providerRef: null } : { ok: false, providerRef: null, note: "not_configured" };
    }
    const r = await sendWhatsAppTemplate(to, { name: message.template.name, locale: message.locale, params: message.params, rendered: message.body }, `calls:${message.kind}`);
    return r.sent ? { ok: true, providerRef: r.id } : { ok: false, providerRef: null, note: "not_configured" };
  }
  const link = booking.userId ? unsubscribeUrl(booking.userId, process.env, message.locale) : null;
  const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? "";
  if (!link || !address || !booking.email) return { ok: false, providerRef: null, note: "email_not_ready" };
  const r = await sendEmail(
    {
      to: booking.email,
      subject: emailSubject("call_booked", message.locale),
      text: message.body.split("\n\n")[0] ?? message.body,
      unsubscribeUrl: link,
      postalAddress: address,
      idempotencyKey: message.dedupeKey,
    },
    message.locale,
  );
  return { ok: r.sent, providerRef: r.providerRef, ...(r.sent ? {} : { note: "not_configured" }) };
};

function forMessages(b: CallBooking, lastInboundAt: string | null): BookingForMessages {
  return {
    id: b.id,
    firstName: b.firstName,
    phone: b.phone,
    email: b.email,
    userId: b.userId,
    confirmChannel: b.confirmChannel,
    locale: b.locale,
    timeZone: b.timeZone,
    slotStart: b.slotStart,
    createdAt: b.createdAt,
    caseRef: b.caseRef,
    status: b.status,
    lastInboundAt,
  };
}

export interface CallMessagesSummary {
  bookings: number;
  sent: number;
  failed: number;
  duplicates: number;
}

/**
 * Sends what is due for every upcoming booking: claim under the dedupe key
 * first (a second run, or two at once, loses the claim and sends nothing),
 * then send, then record the result once. Opt-outs are read by the number
 * and by the account; quiet hours are the autopilot's.
 */
export async function runCallMessages(
  db: SupabaseClient,
  now: Date = new Date(),
  deps: { deliver?: CallDeliver; channels?: ChannelAvailability; bookingIds?: string[] } = {},
): Promise<CallMessagesSummary> {
  const summary: CallMessagesSummary = { bookings: 0, sent: 0, failed: 0, duplicates: 0 };
  const settings = await loadAutopilotSettings(db);
  const channels = deps.channels ?? availabilityFromEnv();
  const deliver = deps.deliver ?? deliverCallMessage;
  let query = db.from("call_bookings").select("*").eq("status", "booked").gt("slot_start", now.toISOString());
  if (deps.bookingIds) query = query.in("id", deps.bookingIds);
  const { data, error } = await query;
  if (error) throw new Error(`call_bookings: ${error.message}`);
  for (const row of (data as Row[] | null) ?? []) {
    const booking = bookingFromRow(row);
    summary.bookings += 1;
    const [{ data: written }, { data: opts }] = await Promise.all([
      db.from("call_messages").select("dedupe_key").eq("booking_id", booking.id),
      booking.userId
        ? db.from("message_opt_outs").select("kind, at, user_id, phone_e164").or(`user_id.eq.${booking.userId},phone_e164.eq.${booking.phone}`)
        : db.from("message_opt_outs").select("kind, at, user_id, phone_e164").eq("phone_e164", booking.phone),
    ]);
    const optRecords = ((opts as Row[] | null) ?? []).map((o) => ({ kind: o.kind === "opt_in" ? ("opt_in" as const) : ("opt_out" as const), at: iso(o.at) ?? "" }));
    const planned = planCallMessages(forMessages(booking, null), now, {
      quiet: { quietStartHour: settings.quietStartHour, quietEndHour: settings.quietEndHour },
      optedOut: currentOptOut(optRecords) !== null,
      written: new Set(((written as Row[] | null) ?? []).map((w) => text(w.dedupe_key))),
      channels,
    });
    for (const message of planned) {
      const { data: claimed, error: claimError } = await db
        .from("call_messages")
        .insert({ booking_id: booking.id, dedupe_key: message.dedupeKey, kind: message.kind, channel: message.channel, template: message.template.name, locale: message.locale, body: message.body, status: "sending", created_at: now.toISOString() })
        .select("id")
        .single();
      if (claimError) {
        if (claimError.code === "23505") {
          summary.duplicates += 1;
          continue;
        }
        throw new Error(`call_messages: ${claimError.message}`);
      }
      let result: CallDeliveryResult;
      try {
        result = await deliver(forMessages(booking, null), message);
      } catch (e) {
        await reportError(e, { where: "calls:deliver", extra: { dedupeKey: message.dedupeKey } });
        result = { ok: false, providerRef: null, note: (e as Error).message.slice(0, 200) };
      }
      await db
        .from("call_messages")
        .update({ status: result.ok ? "sent" : "failed", sent_at: now.toISOString(), provider_ref: result.providerRef, note: result.note ?? null })
        .eq("id", text((claimed as Row).id))
        .eq("status", "sending");
      if (result.ok) summary.sent += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}
