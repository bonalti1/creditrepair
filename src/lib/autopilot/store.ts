import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsAppEvent } from "../integrations/whatsapp";
import { reportError } from "../observability/errors";
import { currentOptOut } from "./optout";
import { statusMessage, type StatusEvent } from "./status";
import { normalizeSettings, type AutopilotSettings, type FollowupKind } from "./types";

// The autopilot's records on the database: the team's switches, holds,
// opt-outs and the queue of status messages. Server only, service role; the
// callers (staff routes, webhooks, the billing and mail code, the autopilot
// run) have already checked who is asking. Kept apart from the run itself
// (server.ts) so that the billing and mail code can queue a message without
// importing the console.

type Row = Record<string, unknown>;

// ── Settings ────────────────────────────────────────────────────────────

export function settingsFromRow(row: Row | null | undefined): AutopilotSettings {
  if (!row) return normalizeSettings(null);
  return normalizeSettings({
    roundsEnabled: row.rounds_enabled === true,
    reviewWindowHours: Number(row.review_window_hours),
    followupsEnabled: row.followups_enabled === true,
    followups: (row.followups as Record<FollowupKind, boolean> | null) ?? undefined,
    statusEnabled: row.status_enabled !== false,
    quietStartHour: Number(row.quiet_start_hour),
    quietEndHour: Number(row.quiet_end_hour),
    dailyCap: Number(row.daily_cap),
    updatedAt: typeof row.updated_at === "string" ? new Date(row.updated_at).toISOString() : null,
    updatedBy: typeof row.updated_by_name === "string" ? row.updated_by_name : null,
  });
}

/** The team's switches. A database without migration 0015 reads as the defaults (everything new off). */
export async function loadAutopilotSettings(db: SupabaseClient): Promise<AutopilotSettings> {
  const { data, error } = await db.from("autopilot_settings").select("*").limit(1);
  if (error) return normalizeSettings(null);
  return settingsFromRow(((data as Row[] | null) ?? [])[0]);
}

export type SettingsPatch = Omit<Partial<AutopilotSettings>, "followups" | "updatedAt" | "updatedBy"> & { followups?: Partial<Record<FollowupKind, boolean>> };

/** Save a change an administrator made (the route checked the role), and record it in the team's audit. */
export async function saveAutopilotSettings(
  db: SupabaseClient,
  patch: SettingsPatch,
  by: { userId: string; handle: string },
): Promise<AutopilotSettings> {
  const before = await loadAutopilotSettings(db);
  const next = normalizeSettings({ ...before, ...patch, followups: { ...before.followups, ...(patch.followups ?? {}) } as Record<FollowupKind, boolean> });
  const { error } = await db
    .from("autopilot_settings")
    .update({
      rounds_enabled: next.roundsEnabled,
      review_window_hours: next.reviewWindowHours,
      followups_enabled: next.followupsEnabled,
      followups: next.followups,
      status_enabled: next.statusEnabled,
      quiet_start_hour: next.quietStartHour,
      quiet_end_hour: next.quietEndHour,
      daily_cap: next.dailyCap,
      updated_at: new Date().toISOString(),
      updated_by: by.userId,
      updated_by_name: by.handle,
    })
    .eq("id", true);
  if (error) throw new Error(`autopilot_settings: ${error.message}`);
  const changed = Object.fromEntries(
    (Object.keys(next) as Array<keyof AutopilotSettings>)
      .filter((k) => k !== "updatedAt" && k !== "updatedBy" && JSON.stringify(next[k]) !== JSON.stringify(before[k]))
      .map((k) => [k, { from: before[k], to: next[k] }]),
  );
  await db.from("team_audit").insert({ actor: by.userId, kind: "autopilot_changed", detail: changed });
  return { ...next, updatedAt: new Date().toISOString(), updatedBy: by.handle };
}

// ── Holds and opt-outs ──────────────────────────────────────────────────

export const HOLD_REASON_MIN_CHARS = 3;

export async function placeHold(db: SupabaseClient, userId: string, reason: string, by: { userId: string | null; handle: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const why = reason.replace(/\s+/g, " ").trim().slice(0, 500);
  if (why.length < HOLD_REASON_MIN_CHARS) return { ok: false, message: "Escribe por qué se detiene. Queda en el registro." };
  const { error } = await db.from("autopilot_holds").insert({ user_id: userId, reason: why, held_by: by.userId, held_by_name: by.handle });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Este cliente ya está detenido." };
    throw new Error(`autopilot_holds: ${error.message}`);
  }
  return { ok: true };
}

export async function releaseHold(db: SupabaseClient, userId: string, by: { userId: string | null; handle: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await db
    .from("autopilot_holds")
    .update({ released_at: new Date().toISOString(), released_by: by.userId, released_by_name: by.handle })
    .eq("user_id", userId)
    .is("released_at", null)
    .select("id");
  if (error) throw new Error(`autopilot_holds: ${error.message}`);
  return ((data as Row[] | null) ?? []).length > 0 ? { ok: true } : { ok: false, message: "Este cliente no estaba detenido." };
}

export interface OptChange {
  userId: string | null;
  phone?: string | null;
  kind: "opt_out" | "opt_in";
  channel: "whatsapp" | "email" | "staff";
  keyword?: string | null;
  by?: { userId: string | null; handle: string } | null;
}

export async function recordOptChange(db: SupabaseClient, change: OptChange): Promise<void> {
  const { error } = await db.from("message_opt_outs").insert({
    user_id: change.userId,
    phone_e164: change.userId ? null : (change.phone ?? null),
    kind: change.kind,
    channel: change.channel,
    keyword: change.keyword?.slice(0, 40) ?? null,
    recorded_by: change.by?.userId ?? null,
    recorded_by_name: change.by?.handle ?? null,
  });
  if (error) throw new Error(`message_opt_outs: ${error.message}`);
  if (change.kind === "opt_out" && change.userId) {
    // Nothing already queued goes out.
    await db.from("outbound_messages").update({ status: "cancelled", note: "opted_out" }).eq("user_id", change.userId).eq("status", "queued");
  }
}

/** True while the client's newest opt-out record says no. A database without 0015: false. */
export async function isOptedOut(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.from("message_opt_outs").select("kind, at").eq("user_id", userId);
  if (error) return false;
  return currentOptOut(((data as Row[] | null) ?? []).map((r) => ({ kind: r.kind === "opt_in" ? ("opt_in" as const) : ("opt_out" as const), at: String(r.at) }))) !== null;
}

// ── Status messages ─────────────────────────────────────────────────────

export type QueueOutcome = "queued" | "duplicate" | "skipped";

/**
 * Queue a status message for the next run. Skipped when status messages are
 * off or the client opted out; once only per fact (the dedupe key). Never
 * throws: a message that could not be queued must not undo what happened.
 */
export async function queueStatus(db: SupabaseClient, userId: string, event: StatusEvent, now: Date = new Date()): Promise<QueueOutcome> {
  try {
    const settings = await loadAutopilotSettings(db);
    if (!settings.statusEnabled || (await isOptedOut(db, userId))) return "skipped";
    const { data: profile } = await db.from("profiles").select("full_name, locale").eq("id", userId).maybeSingle();
    const firstName = String((profile as Row | null)?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
    const locale = (profile as Row | null)?.locale === "en" ? "en" : "es";
    const m = statusMessage(userId, firstName, locale, event);
    const { error } = await db.from("outbound_messages").insert({
      user_id: userId,
      dedupe_key: m.dedupeKey,
      kind: "status",
      topic: m.topic,
      template: m.template.name,
      params: m.params,
      locale,
      body: m.body,
      link: m.link,
      status: "queued",
      queued_at: now.toISOString(),
    });
    if (!error) return "queued";
    if (error.code === "23505") return "duplicate";
    // A database without migration 0015: nothing to queue into.
    if (error.code === "42P01") return "skipped";
    throw new Error(`outbound_messages: ${error.message}`);
  } catch (error) {
    await reportError(error, { where: "autopilot:queueStatus", userId });
    return "skipped";
  }
}

/**
 * Stands in for the WhatsApp sender of rounds/send.ts (its `deps.sendWhatsApp`),
 * so "letters mailed" goes through the outbound log and its rules instead of
 * straight out. The send module itself is unchanged.
 */
export function queueingWhatsApp(db: SupabaseClient, userId: string, now?: Date) {
  return async (_phone: string, event: WhatsAppEvent): Promise<{ sent: boolean }> => {
    if (event.kind === "letters_mailed") await queueStatus(db, userId, { kind: "letters_mailed", roundNumber: event.roundNumber, letterCount: event.letterCount }, now ?? new Date());
    return { sent: false };
  };
}
