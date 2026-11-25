import type { SupabaseClient } from "@supabase/supabase-js";
import { handoffReason } from "../leads/autopilot";
import { can } from "../staff/permissions";
import type { StaffMember } from "../staff/access";
import { loadPieces, loadPublishSettings, loadSchedules } from "../content/server";
import { contentSummary, type ContentSummary } from "./content";
import { loadAdsSummary } from "../ads/server";
import type { ControlExtras, HealthSignal } from "./overview";

// What the Overview and the Today list need that the clients list does not
// carry, read on the server. Everything that is about clients goes through
// the member's OWN connection (`reader`), so the read policies decide; only
// the tech health times (an administrator's) are read with the service role,
// and they are times, nothing else. The content board is read the same way,
// with the content hub's own loaders (content/server.ts) on the member's
// connection: its policies let administrators and specialists read it and
// sales nothing (migration 0035).

type Row = Record<string, unknown>;
const DAY = 24 * 60 * 60 * 1000;

/** The newest value of one column, or null (no row, no table, any error). */
async function newest(db: SupabaseClient, table: string, column: string, eq: Array<[string, string]> = []): Promise<string | null> {
  try {
    let query = db.from(table).select(column);
    for (const [c, v] of eq) query = query.eq(c, v);
    const { data, error } = await query.gte(column, "1970-01-01T00:00:00Z").order(column, { ascending: false }).limit(1);
    if (error) return null;
    const value = ((data as unknown as Row[] | null) ?? [])[0]?.[column];
    return typeof value === "string" ? new Date(value).toISOString() : value instanceof Date ? value.toISOString() : null;
  } catch {
    return null;
  }
}

async function count(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[] | null> {
  try {
    const { data, error } = await query;
    return error ? null : ((data as Row[] | null) ?? []);
  } catch {
    return null;
  }
}

export interface PartnerNoteWaiting {
  id: string;
  clientId: string;
  clientName: string;
  partnerFirstName: string;
  at: string;
}

export async function loadControlExtras(reader: SupabaseClient, db: SupabaseClient, member: StaffMember, now: Date): Promise<ControlExtras & { partnerNotes: PartnerNoteWaiting[] }> {
  // Partner notes whose thread's newest note is the partner's (the team has not answered).
  const notes = can(member.role, "clients.followup")
    ? await count(reader.from("partner_team_notes").select("id, user_id, partner_id, author_kind, author_first_name, created_at").gte("created_at", new Date(now.getTime() - 30 * DAY).toISOString()).order("created_at", { ascending: true }))
    : null;
  let partnerNotes: PartnerNoteWaiting[] = [];
  if (notes) {
    const last = new Map<string, Row>();
    for (const n of notes) last.set(`${n.user_id}:${n.partner_id}`, n);
    const waiting = [...last.values()].filter((n) => n.author_kind === "partner");
    const ids = [...new Set(waiting.map((n) => String(n.user_id)))];
    const profiles = ids.length ? ((await count(reader.from("profiles").select("id, full_name").in("id", ids))) ?? []) : [];
    const nameOf = new Map(profiles.map((p) => [String(p.id), String(p.full_name ?? "")]));
    partnerNotes = waiting.map((n) => ({ id: String(n.id), clientId: String(n.user_id), clientName: nameOf.get(String(n.user_id)) || "—", partnerFirstName: String(n.author_first_name), at: String(n.created_at) }));
  }

  const reviews = can(member.role, "case.view") ? await count(reader.from("review_requests").select("user_id").gte("created_at", new Date(now.getTime() - 30 * DAY).toISOString())) : null;

  // Possible complaints in the last 7 days: the lead autopilot's hand-offs, and clients' own words.
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const [handoffs, words] = await Promise.all([
    count(reader.from("lead_auto_messages").select("id").eq("kind", "handoff").eq("reason", "complaint").gte("created_at", weekAgo)),
    can(member.role, "case.view") ? count(reader.from("chat_messages").select("id, user_id, body").eq("role", "user").gte("created_at", weekAgo).limit(2000)) : Promise.resolve([] as Row[]),
  ]);
  const complaints = handoffs === null || words === null ? null : handoffs.length + words.filter((m) => m.user_id && handoffReason(String(m.body)) === "complaint").length;

  const escalations =
    member.role === "admin"
      ? ((await count(reader.from("control_escalations").select("id, item_key, title, note, by_handle, created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(50))) ?? []).map((e) => ({
          id: String(e.id),
          key: String(e.item_key),
          title: String(e.title),
          note: (e.note as string | null) ?? null,
          by: String(e.by_handle ?? ""),
          at: String(e.created_at),
        }))
      : null;

  let health: HealthSignal[] | null = null;
  if (can(member.role, "business.view")) {
    const [whatsapp, highlevel, lob, autopilot, cron, digest] = await Promise.all([
      newest(db, "chat_messages", "created_at", [["channel", "whatsapp"], ["role", "user"]]),
      newest(db, "webhook_receipts", "received_at"),
      newest(db, "mail_events", "received_at"),
      newest(db, "outbound_messages", "sent_at"),
      newest(db, "cron_heartbeats", "last_run_at"),
      newest(db, "staff_digests", "sent_at"),
    ]);
    health = [
      { key: "whatsapp_inbound", lastAt: whatsapp, expectHours: null },
      { key: "highlevel_lead", lastAt: highlevel, expectHours: null },
      { key: "lob_event", lastAt: lob, expectHours: null },
      { key: "autopilot_message", lastAt: autopilot, expectHours: null },
      // The leads job should run every few minutes.
      { key: "cron_leads", lastAt: cron, expectHours: 1 },
      { key: "staff_digest", lastAt: digest, expectHours: 26 },
    ];
  }

  const content = can(member.role, "content.view") ? await loadContentSummary(reader, now) : null;
  // The Ads Manager's last 7 days, through the member's own connection (its tables are administrators' only, migration 0037).
  const ads = can(member.role, "ads.view") ? await loadAdsSummary(reader, now, process.env).catch(() => null) : null;

  return {
    content,
    ads,
    partnerNotesWaiting: notes ? partnerNotes.length : null,
    reviewRequests30d: reviews ? reviews.length : null,
    complaints7d: complaints,
    escalations,
    health,
    partnerNotes,
  };
}

/** The content board in numbers, through the member's own connection; null when it could not be read. */
export async function loadContentSummary(reader: SupabaseClient, now: Date): Promise<ContentSummary | null> {
  try {
    const [pieces, schedules, settings] = await Promise.all([loadPieces(reader), loadSchedules(reader), loadPublishSettings(reader)]);
    return contentSummary(pieces, schedules, settings, now);
  } catch {
    return null;
  }
}

/** The leads job's heartbeat, for the Tech health card. */
export async function beat(db: SupabaseClient, job: string, now: Date, outcome: { ok: boolean; error?: string; detail?: Record<string, unknown> }): Promise<void> {
  await db.from("cron_heartbeats").upsert({
    job,
    last_run_at: now.toISOString(),
    ...(outcome.ok ? { last_ok_at: now.toISOString(), last_error: null } : { last_error: (outcome.error ?? "error").slice(0, 300) }),
    detail: outcome.detail ?? {},
  });
}
