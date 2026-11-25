import type { SupabaseClient } from "@supabase/supabase-js";
import { handoffReason } from "../leads/autopilot";
import { firstTouchLine, waitingMinutes, waitingSince } from "../leads/inbox";
import { loadLeads } from "../leads/inboxServer";
import { pushConfig, sendTickle, type PushConfig } from "../push/webPush";
import { isStaffRole } from "../staff/permissions";
import { normalizeStaffLocale, type StaffLocale } from "../staff/i18n/locale";
import type { StaffMember } from "../staff/access";
import {
  ALERT_TOPICS,
  alertKey,
  alertRecipients,
  complaintText,
  escalationText,
  newLeadText,
  partnerNoteText,
  prefsFromRows,
  topicsFor,
  waitingText,
  type AlertMember,
  type AlertPrefs,
  type AlertText,
  type AlertTopic,
  type TopicPref,
} from "./alerts";

// Staff alerts on the server: finding them (the sweep, run by
// /api/cron/leads), recording each once per member (staff_alerts, unique per
// member and key), and waking the member's phone (web push, when the VAPID
// keys are set and the member turned alerts on in a browser).

type Row = Record<string, unknown>;
const MIN = 60_000;
const HOUR = 60 * MIN;

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

export async function loadAlertPrefs(reader: SupabaseClient, userId: string): Promise<AlertPrefs> {
  return prefsFromRows(await rows(reader.from("staff_alert_topics").select("*").eq("user_id", userId), "staff_alert_topics"));
}

/** A member turns one topic on or off (their own row only: the route passes their id). */
export async function saveAlertPref(db: SupabaseClient, userId: string, topic: AlertTopic, pref: TopicPref, now: Date): Promise<void> {
  const { error } = await db
    .from("staff_alert_topics")
    .upsert({ user_id: userId, topic, enabled: pref.enabled, waiting_minutes: pref.waitingMinutes, updated_at: now.toISOString() });
  if (error) throw new Error(`staff_alert_topics: ${error.message}`);
}

export interface AlertTarget {
  member: AlertMember & { locale: StaffLocale };
  /** "test": the member's own test, from the alerts screen. */
  topic: AlertTopic | "test";
  key: string;
  text: AlertText;
  url: string;
}

/** Every active member, with their topics and their console language. */
export async function loadAlertMembers(db: SupabaseClient): Promise<Array<AlertMember & { locale: StaffLocale }>> {
  const [members, topics, prefs] = await Promise.all([
    rows(db.from("staff_members").select("user_id, handle, role, active").eq("active", true), "staff_members"),
    rows(db.from("staff_alert_topics").select("*"), "staff_alert_topics"),
    rows(db.from("staff_preferences").select("user_id, locale"), "staff_preferences"),
  ]);
  const localeOf = new Map(prefs.map((p) => [String(p.user_id), normalizeStaffLocale(p.locale) ?? "en"]));
  return members
    .filter((m) => isStaffRole(m.role) && m.handle)
    .map((m) => ({
      userId: String(m.user_id),
      handle: String(m.handle),
      role: m.role as AlertMember["role"],
      prefs: prefsFromRows(topics.filter((t) => t.user_id === m.user_id)),
      locale: (localeOf.get(String(m.user_id)) ?? "en") as StaffLocale,
    }));
}

export interface DeliveryResult {
  created: number;
  pushed: number;
}

/** Records each alert once per member, then wakes each member's subscribed browsers once. */
export async function deliverAlerts(db: SupabaseClient, targets: readonly AlertTarget[], now: Date, push: { config: PushConfig | null; fetcher?: typeof fetch } = { config: pushConfig() }): Promise<DeliveryResult> {
  const fresh = new Map<string, string[]>();
  let created = 0;
  for (const t of targets) {
    const { data, error } = await db
      .from("staff_alerts")
      .insert({ user_id: t.member.userId, topic: t.topic, dedupe_key: t.key, title: t.text.title.slice(0, 140), body: t.text.body.slice(0, 300), url: t.url, created_at: now.toISOString() })
      .select("id")
      .single();
    if (error || !data) continue; // Already told (the unique key), or the row could not be written.
    created += 1;
    fresh.set(t.member.userId, [...(fresh.get(t.member.userId) ?? []), String((data as Row).id)]);
  }
  let pushed = 0;
  if (!push.config || fresh.size === 0) return { created, pushed };
  for (const [userId, ids] of fresh) {
    const subs = await rows(db.from("staff_push_subscriptions").select("id, endpoint").eq("user_id", userId).is("revoked_at", null), "staff_push_subscriptions");
    let any = false;
    for (const sub of subs) {
      const outcome = await sendTickle(String(sub.endpoint), push.config, push.fetcher, now);
      if (outcome.ok) any = true;
      if (outcome.gone) await db.from("staff_push_subscriptions").update({ revoked_at: now.toISOString() }).eq("id", sub.id);
    }
    if (any) {
      pushed += 1;
      await db.from("staff_alerts").update({ pushed_at: now.toISOString() }).in("id", ids);
    }
  }
  return { created, pushed };
}

export interface SweepResult extends DeliveryResult {
  candidates: number;
}

/**
 * Everything worth an alert right now: new leads (last 2 hours), leads waiting
 * past each member's minutes, complaints (the lead autopilot's hand-offs, and
 * a client's message that reads as one), partners' notes (last day). Each
 * member gets each one once, and only for topics they turned on.
 */
export async function sweepAlerts(db: SupabaseClient, now: Date, push?: { config: PushConfig | null; fetcher?: typeof fetch }): Promise<SweepResult> {
  const members = await loadAlertMembers(db);
  const listening = members.filter((m) => ALERT_TOPICS.some((t) => m.prefs[t].enabled && topicsFor(m.role).includes(t)));
  if (listening.length === 0) return { candidates: 0, created: 0, pushed: 0 };
  const targets: AlertTarget[] = [];
  const add = (topic: AlertTopic, subject: Parameters<typeof alertRecipients>[0], key: string, url: string, words: (locale: StaffLocale) => AlertText) => {
    for (const member of alertRecipients({ ...subject, topic }, listening)) {
      targets.push({ member: member as AlertMember & { locale: StaffLocale }, topic, key, url, text: words((member as AlertMember & { locale: StaffLocale }).locale) });
    }
  };

  const leads = await loadLeads(db);
  for (const lead of leads) {
    const url = `/equipo/leads?lead=${lead.id}`;
    if (now.getTime() - Date.parse(lead.createdAt) <= 2 * HOUR && !lead.signedAt) {
      add("new_lead", { topic: "new_lead", salesperson: lead.salesperson }, alertKey.newLead(lead.id), url, (locale) => newLeadText({ name: lead.name, source: firstTouchLine(lead, locale) }, locale));
    }
    const since = waitingSince(lead);
    const minutes = waitingMinutes(lead, now);
    if (since && minutes !== null) {
      add("lead_waiting", { topic: "lead_waiting", salesperson: lead.salesperson, waitedMinutes: minutes }, alertKey.waiting(lead.id, since), url, (locale) => waitingText({ name: lead.name, minutes }, locale));
    }
  }

  // Complaints the lead autopilot handed to a person.
  const handoffs = await rows(db.from("lead_auto_messages").select("id, lead_id, reason, created_at").eq("kind", "handoff").eq("reason", "complaint").gte("created_at", new Date(now.getTime() - 24 * HOUR).toISOString()), "lead_auto_messages");
  const leadById = new Map(leads.map((l) => [l.id, l]));
  for (const h of handoffs) {
    const lead = leadById.get(String(h.lead_id));
    if (!lead) continue;
    add("complaint", { topic: "complaint", salesperson: lead.salesperson }, alertKey.complaint(String(h.id)), `/equipo/leads?lead=${lead.id}`, (locale) => complaintText({ name: lead.name, lead: true }, locale));
  }

  // A client's own words that read as a complaint (the app's chat and WhatsApp), last 2 hours.
  const clientMessages = await rows(
    db.from("chat_messages").select("id, user_id, body, created_at").eq("role", "user").gte("created_at", new Date(now.getTime() - 2 * HOUR).toISOString()).limit(500),
    "chat_messages",
  );
  const complaints = clientMessages.filter((m) => m.user_id && handoffReason(String(m.body)) === "complaint");
  const partnerNotes = await rows(db.from("partner_team_notes").select("id, user_id, author_first_name, created_at").eq("author_kind", "partner").gte("created_at", new Date(now.getTime() - 24 * HOUR).toISOString()), "partner_team_notes");
  const clientIds = [...new Set([...complaints.map((m) => String(m.user_id)), ...partnerNotes.map((n) => String(n.user_id))])];
  if (clientIds.length > 0) {
    const [assignments, profiles, staff] = await Promise.all([
      rows(db.from("client_assignments").select("user_id, staff_user_id").in("user_id", clientIds), "client_assignments"),
      rows(db.from("profiles").select("id, full_name").in("id", clientIds), "profiles"),
      rows(db.from("staff_members").select("user_id, handle"), "staff_members"),
    ]);
    const handleOf = new Map(staff.map((s) => [String(s.user_id), String(s.handle)]));
    const specialistOf = new Map(assignments.map((a) => [String(a.user_id), a.staff_user_id ? (handleOf.get(String(a.staff_user_id)) ?? null) : null]));
    const nameOf = new Map(profiles.map((p) => [String(p.id), (p.full_name as string | null) ?? null]));
    for (const m of complaints) {
      const id = String(m.user_id);
      add("complaint", { topic: "complaint", specialist: specialistOf.get(id) ?? null }, alertKey.complaint(String(m.id)), `/equipo/clientes/${id}`, (locale) => complaintText({ name: nameOf.get(id) ?? null, lead: false }, locale));
    }
    for (const n of partnerNotes) {
      const id = String(n.user_id);
      add("partner_note", { topic: "partner_note", specialist: specialistOf.get(id) ?? null }, alertKey.partnerNote(String(n.id)), `/equipo/clientes/${id}`, (locale) =>
        partnerNoteText({ partnerFirstName: String(n.author_first_name), clientName: nameOf.get(id) ?? null }, locale),
      );
    }
  }

  const delivered = await deliverAlerts(db, targets, now, push);
  return { candidates: targets.length, ...delivered };
}

/** "Escalate to the owner": recorded, and every administrator who turned the topic on is alerted at once. */
export async function escalateToOwner(
  db: SupabaseClient,
  member: StaffMember,
  input: { key: string; title: string; note: string | null },
  now: Date,
  push?: { config: PushConfig | null; fetcher?: typeof fetch },
): Promise<{ id: string; alerted: number }> {
  const { data, error } = await db
    .from("control_escalations")
    .insert({ item_key: input.key, title: input.title.slice(0, 160), note: input.note?.slice(0, 500) || null, by_user: member.userId, by_handle: member.handle })
    .select("id")
    .single();
  if (error || !data) throw new Error(`control_escalations: ${error?.message ?? "no row"}`);
  const id = String((data as Row).id);
  const admins = (await loadAlertMembers(db)).filter((m) => m.role === "admin" && m.userId !== member.userId);
  const targets = alertRecipients({ topic: "escalation" }, admins).map((m) => ({
    member: m as AlertMember & { locale: StaffLocale },
    topic: "escalation" as const,
    key: alertKey.escalation(id),
    url: "/equipo/control?vista=hoy",
    text: escalationText({ by: member.name.split(" ")[0] ?? member.handle, title: `${input.title}${input.note ? ` — ${input.note}` : ""}` }, (m as AlertMember & { locale: StaffLocale }).locale),
  }));
  const delivered = await deliverAlerts(db, targets, now, push);
  return { id, alerted: delivered.created };
}

/** For the service worker: the member's alerts pushed in the last half hour and not shown yet. Marks them shown. */
export async function takePendingAlerts(db: SupabaseClient, userId: string, now: Date): Promise<Array<{ id: string; title: string; body: string | null; url: string }>> {
  const list = await rows(
    db.from("staff_alerts").select("id, title, body, url").eq("user_id", userId).is("seen_at", null).gte("created_at", new Date(now.getTime() - 30 * MIN).toISOString()).order("created_at", { ascending: false }).limit(3),
    "staff_alerts",
  );
  if (list.length > 0) await db.from("staff_alerts").update({ seen_at: now.toISOString() }).in("id", list.map((a) => a.id));
  return list.map((a) => ({ id: String(a.id), title: String(a.title), body: (a.body as string | null) ?? null, url: String(a.url) }));
}
