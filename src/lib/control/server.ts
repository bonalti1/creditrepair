import type { SupabaseClient } from "@supabase/supabase-js";
import { handoffReason } from "../leads/autopilot";
import { can } from "../staff/permissions";
import type { StaffMember } from "../staff/access";
import { loadPieces, loadPublishSettings, loadSchedules } from "../content/server";
import { contentSummary, type ContentSummary } from "./content";
import { loadAdsSummary } from "../ads/server";
import type { ControlExtras, HealthSignal } from "./overview";
import { ideasSummary, seoSummary, videoSummary, type IdeasSummary, type SeoSummary, type VideoSummary } from "./marketing";
import { loadGuides, loadSettings } from "../seo/server";
import { ideaFromRow } from "../ideas/server";
import type { VideoProject } from "../video/types";

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
      newest(db, "cron_heartbeats", "last_run_at", [["job", "leads"]]),
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

  // The Video Studio, SEO and Ideas in numbers (control/marketing.ts), each for the role that may open it and
  // read the way its own screen reads it (the service role after the same capability, as their routes do;
  // the ideas board through the member's own connection). Titles, statuses and dates only.
  const [video, seo, ideas] = await Promise.all([
    can(member.role, "content.view") ? loadVideoSummary(db) : Promise.resolve(null),
    can(member.role, "seo.view") ? loadSeoSummary(db) : Promise.resolve(null),
    can(member.role, "ideas.add") ? loadIdeasSummary(reader, now) : Promise.resolve(null),
  ]);

  return {
    content,
    ads,
    video,
    seo,
    ideas,
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

/** The leads job's heartbeat, for the Tech health card (now in heartbeat.ts, shared by every cron route). */
export { beat } from "./heartbeat";

/** The Video Studio's board in numbers; null when it could not be read. */
export async function loadVideoSummary(db: SupabaseClient): Promise<VideoSummary | null> {
  try {
    const { data, error } = await db.from("video_projects").select("id, title, status, owner, changes_note, created_at, updated_at").neq("status", "archived").limit(1000);
    if (error) return null;
    return videoSummary(
      ((data as Row[] | null) ?? []).map((r) => ({
        id: String(r.id),
        title: String(r.title ?? ""),
        status: String(r.status) as VideoProject["status"],
        owner: (r.owner as string | null) ?? null,
        changesNote: (r.changes_note as string | null) ?? null,
        createdAt: new Date(String(r.created_at)).toISOString(),
        updatedAt: new Date(String(r.updated_at ?? r.created_at)).toISOString(),
      })),
    );
  } catch {
    return null;
  }
}

/** SEO's guides and last site check in numbers; null when they could not be read. */
export async function loadSeoSummary(db: SupabaseClient): Promise<SeoSummary | null> {
  try {
    const [guides, settings] = await Promise.all([loadGuides(db), loadSettings(db)]);
    return seoSummary(guides, settings.health);
  } catch {
    return null;
  }
}

/** The ideas board in numbers, through the member's own connection; null when it could not be read. */
export async function loadIdeasSummary(reader: SupabaseClient, now: Date): Promise<IdeasSummary | null> {
  try {
    const { data, error } = await reader.from("ideas").select("*").limit(1000);
    if (error) return null;
    return ideasSummary(((data as Row[] | null) ?? []).map(ideaFromRow), now);
  } catch {
    return null;
  }
}
