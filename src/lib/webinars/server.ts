import type { SupabaseClient } from "@supabase/supabase-js";
// The live funnel registers its LiveFunnelSource (reports, videos sent and watched, «Get started»): docs/WEBINARS.md.
import "../live/webinarSource";
import { attributionIndex, attributeLead } from "../ads/attribution";
import { adLeadFromRow, loadAdsSnapshot, shortName as adShortName } from "../ads/server";
import { addDays, dayInZone } from "../ads/window";
import { availabilityFromEnv } from "../autopilot/channels";
import { currentOptOut } from "../autopilot/optout";
import { recordOptChange } from "../autopilot/store";
import type { ChannelAvailability } from "../autopilot/types";
import type { ChargeMeta } from "../accounting/types";
import { sha256Hex } from "../agreement/sha256";
import { commissionLineFromRow } from "../fulfillment/commissionData";
import { sendEmail } from "../integrations/email";
import { listUpgrades } from "../service/server";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../integrations/whatsapp";
import { reportError } from "../observability/errors";
import { siteUrl } from "../site/routes";
import { loadStaffClients } from "../staff/load";
import { leadFromWebinar, leadTags, liveFunnelSource, type FunnelLead, type VideoEvents } from "./live";
import { REMINDERS_CONSENT } from "./publicCopy";
import type { CleanRegistration } from "./register";
import { planReminder, type PlannedReminder } from "./reminders";
import { TEXAS_TZ } from "./time";
import { PLATFORMS, type Campaign, type CampaignCost, type ClientPurchase, type CostKind, type PurchaseKind, type Registration, type ReminderKind, type Webinar, type WebinarPlatform } from "./types";
import { webinarUnsubscribeUrl } from "./unsubscribe";
import { clientValueFacts } from "./value";
import { countersFor, liveLeadViews, registrantView, reminderStats, scorecardsFor, summarize, webinarLinks, webinarsSignal, type CampaignsView, type LiveView, type WebinarDetail, type WebinarSummary } from "./views";
import type { WebinarsSignalInput } from "../ideas/signals";

// Webinars on the server (migration 0044, docs/WEBINARS.md).
//
// Reads go through the member's OWN connection where the policies allow
// them (webinars: every member of staff; registrations and the leads:
// administrators and sales; campaigns and money: administrators). A
// specialist (webinars.view, no leads.work) gets the counts and first names
// only, read with the service role after the capability check, never a
// phone or an email. Writes use the service role after requireCapability.
// The reminders run from /api/cron/webinars (shared secret).

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const iso = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === "string" ? v : null;
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};
const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

export interface Actor {
  userId: string;
  name: string;
}

// ── Rows ────────────────────────────────────────────────────────────────

export function webinarFromRow(r: Row): Webinar {
  const links: Partial<Record<WebinarPlatform, string>> = {};
  for (const p of PLATFORMS) {
    const v = str(r[`${p}_url`]);
    if (v) links[p] = v;
  }
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: { en: String(r.title_en ?? ""), es: String(r.title_es ?? "") },
    host: String(r.host_name ?? ""),
    startsAt: iso(r.starts_at)!,
    durationMinutes: num(r.duration_minutes) || 45,
    language: r.language === "en" || r.language === "both" ? r.language : "es",
    topic: String(r.topic ?? ""),
    campaignTag: str(r.campaign_tag),
    keyword: String(r.keyword ?? "CREDIT"),
    links,
    replayUrl: str(r.replay_url),
    status: r.status === "published" || r.status === "cancelled" ? r.status : "draft",
    campaignId: str(r.campaign_id),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    createdBy: String(r.created_by_name ?? ""),
  };
}

export function registrationFromRow(r: Row): Registration {
  const attribution = r.attribution && typeof r.attribution === "object" && Object.keys(r.attribution as object).length > 0 ? (r.attribution as Record<string, unknown>) : null;
  return {
    id: String(r.id),
    webinarId: String(r.webinar_id),
    firstName: String(r.first_name ?? ""),
    lastName: str(r.last_name),
    phone: String(r.phone_e164 ?? ""),
    email: str(r.email),
    state: String(r.state ?? ""),
    served: r.served === "texas" ? "texas" : "out_of_state",
    locale: r.locale === "es" ? "es" : "en",
    goal: (["home", "car", "understand", "learning"] as const).find((g) => g === r.goal) ?? "learning",
    timeline: (["now", "months_3", "months_6", "months_12", "learning"] as const).find((t) => t === r.timeline) ?? "learning",
    question: str(r.question),
    remindersConsent: r.reminders_consent === true,
    optedOutAt: iso(r.reminders_opted_out_at),
    attended: r.attended === true,
    attendedMinutes: r.attended_minutes === null || r.attended_minutes === undefined ? null : num(r.attended_minutes),
    attendanceSource: r.attendance_source === "zoom_csv" || r.attendance_source === "manual" ? r.attendance_source : null,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    attribution,
  };
}

export function campaignFromRow(r: Row, webinarIds: string[]): Campaign {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    id: String(r.id),
    name: String(r.name),
    startDay: day(r.start_day),
    endDay: day(r.end_day),
    budgetCents: r.budget_cents === null || r.budget_cents === undefined ? null : num(r.budget_cents),
    metaCampaignIds: list(r.meta_campaign_ids),
    webinarIds,
    keywords: list(r.keywords),
    organicSources: list(r.organic_sources),
    note: str(r.note),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

const COST_KINDS: readonly CostKind[] = ["ads_other", "content", "tools", "people", "other"];
const PURCHASE_KINDS: readonly PurchaseKind[] = ["upgrade", "household_addon", "partner_offer", "loan_officer", "home_purchase", "other"];

function costFromRow(r: Row): CampaignCost {
  return { id: String(r.id), campaignId: String(r.campaign_id), label: String(r.label), kind: COST_KINDS.find((k) => k === r.kind) ?? "other", amountCents: num(r.amount_cents), day: day(r.day), by: String(r.created_by_name ?? ""), voidedAt: iso(r.voided_at) };
}

function purchaseFromRow(r: Row): ClientPurchase {
  return { id: String(r.id), clientId: String(r.client_id), kind: PURCHASE_KINDS.find((k) => k === r.kind) ?? "other", amountCents: r.amount_cents === null || r.amount_cents === undefined ? null : num(r.amount_cents), day: day(r.day), note: str(r.note), by: String(r.created_by_name ?? ""), voidedAt: iso(r.voided_at) };
}

// ── Webinars ────────────────────────────────────────────────────────────

export async function loadWebinars(reader: SupabaseClient): Promise<Webinar[]> {
  return (await rows(reader.from("webinars").select("*").order("starts_at", { ascending: false }).limit(200), "webinars")).map(webinarFromRow);
}

/** A webinar's public page: published, cancelled or ended ones (never a draft). Service role. */
export async function loadPublicWebinar(db: SupabaseClient, slug: string): Promise<Webinar | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const [row] = await rows(db.from("webinars").select("*").eq("slug", slug).neq("status", "draft").limit(1), "webinars");
  return row ? webinarFromRow(row) : null;
}

/** The registrations of these webinars, as the reader may see them (administrators and sales). */
export async function loadRegistrations(reader: SupabaseClient, webinarIds: readonly string[]): Promise<Registration[]> {
  if (webinarIds.length === 0) return [];
  return (await rows(reader.from("webinar_registrations").select("*").in("webinar_id", [...webinarIds]).order("created_at", { ascending: true }).limit(20_000), "webinar_registrations")).map(registrationFromRow);
}

/** For a member without leads.work: the registrations without phone, email, question or tags (service role, after webinars.view). */
export async function loadRegistrationsWithoutContact(db: SupabaseClient, webinarIds: readonly string[]): Promise<Registration[]> {
  if (webinarIds.length === 0) return [];
  const list = await rows(
    db.from("webinar_registrations").select("id, webinar_id, first_name, last_name, state, served, locale, goal, timeline, reminders_consent, reminders_opted_out_at, attended, attended_minutes, attendance_source, created_at").in("webinar_id", [...webinarIds]).limit(20_000),
    "webinar_registrations",
  );
  return list.map((r) => ({ ...registrationFromRow({ ...r, phone_e164: "", email: null, question: null, attribution: {} }), lastName: str(r.last_name) ? `${String(r.last_name).charAt(0)}` : null }));
}

export interface WebinarInput {
  slug: string;
  titleEn: string;
  titleEs: string;
  host: string;
  startsAt: string;
  durationMinutes: number;
  language: Webinar["language"];
  topic: string;
  campaignTag: string | null;
  keyword: string;
  links: Partial<Record<WebinarPlatform, string | null>>;
  replayUrl: string | null;
  campaignId: string | null;
}

function webinarRow(input: WebinarInput): Row {
  const row: Row = {
    slug: input.slug,
    title_en: input.titleEn.trim(),
    title_es: input.titleEs.trim(),
    host_name: input.host.trim(),
    starts_at: input.startsAt,
    duration_minutes: input.durationMinutes,
    language: input.language,
    topic: input.topic.trim(),
    campaign_tag: input.campaignTag,
    keyword: input.keyword.toUpperCase(),
    replay_url: input.replayUrl,
    campaign_id: input.campaignId,
  };
  for (const p of PLATFORMS) row[`${p}_url`] = input.links[p] ?? null;
  return row;
}

async function audit(db: SupabaseClient, entry: { webinarId?: string | null; campaignId?: string | null; kind: string; actor: Actor; detail?: Row }) {
  await db.from("webinar_audit").insert({ webinar_id: entry.webinarId ?? null, campaign_id: entry.campaignId ?? null, kind: entry.kind, actor: entry.actor.userId, actor_name: entry.actor.name.slice(0, 80) || "Equipo", detail: entry.detail ?? {} });
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

export async function saveWebinar(db: SupabaseClient, input: WebinarInput, actor: Actor, id: string | null): Promise<SaveResult<Webinar>> {
  const row = webinarRow(input);
  const query = id ? db.from("webinars").update(row).eq("id", id) : db.from("webinars").insert({ ...row, created_by: actor.userId, created_by_name: actor.name.slice(0, 80) });
  const { data, error } = await query.select("*").single();
  if (error) {
    if (error.code === "23505") return { ok: false, status: 409, code: "slug_taken" };
    if (/published webinar|does not change|cancelled/.test(error.message)) return { ok: false, status: 409, code: "locked" };
    throw new Error(`webinars: ${error.message}`);
  }
  const webinar = webinarFromRow(data as Row);
  await audit(db, { webinarId: webinar.id, kind: id ? "webinar_changed" : "webinar_created", actor });
  return { ok: true, value: webinar };
}

export async function setWebinarStatus(db: SupabaseClient, id: string, status: "published" | "cancelled", actor: Actor): Promise<SaveResult<Webinar>> {
  const { data, error } = await db.from("webinars").update({ status }).eq("id", id).select("*").maybeSingle();
  if (error) {
    if (/cancelled|draft/.test(error.message)) return { ok: false, status: 409, code: "locked" };
    throw new Error(`webinars: ${error.message}`);
  }
  if (!data) return { ok: false, status: 404, code: "not_found" };
  await audit(db, { webinarId: id, kind: status === "published" ? "webinar_published" : "webinar_cancelled", actor });
  return { ok: true, value: webinarFromRow(data as Row) };
}

// ── Registering (public) ────────────────────────────────────────────────

export function remindersConsentHash(locale: "en" | "es"): string {
  return sha256Hex(`${REMINDERS_CONSENT.version}\n${REMINDERS_CONSENT[locale]}`);
}

export type RegisterResult = { ok: true; already: boolean; registrationId: string } | { ok: false; code: "closed" };

/** One registration per phone per webinar: a second one with the same number answers "already registered". */
export async function registerForWebinar(db: SupabaseClient, webinar: Webinar, clean: CleanRegistration, meta: { ip: string | null; userAgent: string | null }, now: Date = new Date()): Promise<RegisterResult> {
  if (webinar.status !== "published" || Date.parse(webinar.startsAt) + webinar.durationMinutes * 60_000 <= now.getTime()) return { ok: false, code: "closed" };
  const { data, error } = await db
    .from("webinar_registrations")
    .insert({
      webinar_id: webinar.id,
      first_name: clean.firstName,
      last_name: clean.lastName,
      phone_e164: clean.phone,
      email: clean.email,
      state: clean.state,
      served: clean.served,
      locale: clean.locale,
      goal: clean.goal,
      timeline: clean.timeline,
      question: clean.question,
      reminders_consent: clean.remindersConsent,
      consent_version: clean.remindersConsent ? REMINDERS_CONSENT.version : null,
      consent_text_hash: clean.remindersConsent ? remindersConsentHash(clean.locale) : null,
      consent_ip: clean.remindersConsent ? (meta.ip?.slice(0, 64) ?? null) : null,
      consent_user_agent: clean.remindersConsent ? (meta.userAgent?.slice(0, 300) ?? null) : null,
      attribution: clean.attribution ?? {},
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const [prior] = await rows(db.from("webinar_registrations").select("id").eq("webinar_id", webinar.id).eq("phone_e164", clean.phone).limit(1), "webinar_registrations");
      return { ok: true, already: true, registrationId: String(prior?.id ?? "") };
    }
    throw new Error(`webinar_registrations: ${error.message}`);
  }
  return { ok: true, already: false, registrationId: String((data as Row).id) };
}

/** The email's one-tap unsubscribe: the registration and its number stop getting automatic messages. */
export async function unsubscribeRegistration(db: SupabaseClient, registrationId: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await rows(db.from("webinar_registrations").select("id, phone_e164, reminders_opted_out_at").eq("id", registrationId).limit(1), "webinar_registrations");
  if (!row) return false;
  if (!row.reminders_opted_out_at) {
    const { error } = await db.from("webinar_registrations").update({ reminders_opted_out_at: now.toISOString() }).eq("id", registrationId);
    if (error) throw new Error(`webinar_registrations: ${error.message}`);
  }
  await recordOptChange(db, { userId: null, phone: String(row.phone_e164), kind: "opt_out", channel: "email", keyword: "UNSUBSCRIBE" });
  return true;
}

// ── Attendance ──────────────────────────────────────────────────────────

export async function applyAttendance(db: SupabaseClient, webinarId: string, matches: ReadonlyArray<{ registrationId: string; minutes: number }>, actor: Actor, now: Date = new Date()): Promise<number> {
  let saved = 0;
  for (const m of matches) {
    const { data, error } = await db
      .from("webinar_registrations")
      .update({ attended: true, attended_minutes: Math.min(1440, Math.max(0, Math.round(m.minutes))), attendance_source: "zoom_csv", attendance_marked_by_name: actor.name.slice(0, 80), attendance_marked_at: now.toISOString() })
      .eq("id", m.registrationId)
      .eq("webinar_id", webinarId)
      .select("id");
    if (error) throw new Error(`webinar_registrations: ${error.message}`);
    saved += ((data as Row[] | null) ?? []).length;
  }
  await audit(db, { webinarId, kind: "attendance_imported", actor, detail: { matched: saved } });
  return saved;
}

export async function markAttended(db: SupabaseClient, webinarId: string, registrationId: string, attended: boolean, actor: Actor, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_registrations")
    .update({ attended, attended_minutes: null, attendance_source: attended ? "manual" : null, attendance_marked_by_name: actor.name.slice(0, 80), attendance_marked_at: now.toISOString() })
    .eq("id", registrationId)
    .eq("webinar_id", webinarId)
    .select("id");
  if (error) throw new Error(`webinar_registrations: ${error.message}`);
  return ((data as Row[] | null) ?? []).length > 0;
}

// ── Leads, the live funnel, reports ─────────────────────────────────────

const LEAD_COLUMNS = "id, display_name, phone_e164, created_at, signed_at, source, first_touch, client_user_id, signup_case_ref, last_message_at, last_message_excerpt, last_message_role";

export function funnelLeadFromRow(r: Row, adCampaignOf: (row: Row) => { campaignId: string | null; fromMeta: boolean }): FunnelLead {
  const tags = leadTags(String(r.source ?? ""), r.first_touch);
  const touch = r.first_touch && typeof r.first_touch === "object" ? (r.first_touch as Row) : {};
  const utm = touch.utm && typeof touch.utm === "object" ? (touch.utm as Row) : {};
  const ad = adCampaignOf(r);
  const lastAt = iso(r.last_message_at);
  return {
    id: String(r.id),
    name: adShortName(str(r.display_name)),
    phone: str(r.phone_e164),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    source: String(r.source ?? ""),
    fromWebinar: tags.fromWebinar,
    keyword: tags.keyword,
    campaign: tags.campaign,
    webinarId: tags.webinarId,
    utmSource: str(utm.source),
    utmCampaign: str(utm.campaign),
    adCampaignId: ad.campaignId,
    fromMeta: ad.fromMeta,
    clientUserId: str(r.client_user_id),
    signupStarted: Boolean(str(r.signup_case_ref) || str(r.client_user_id)),
    signedAt: iso(r.signed_at),
    lastMessage: lastAt ? { at: lastAt, excerpt: String(r.last_message_excerpt ?? "").slice(0, 160), fromLead: r.last_message_role === "user" } : null,
  };
}

/** The leads that arrived from `sinceIso` on, with the Meta campaign each is credited to (the Ads Manager's cache). */
export async function loadFunnelLeads(reader: SupabaseClient, sinceIso: string): Promise<FunnelLead[]> {
  const [list, snapshot] = await Promise.all([
    rows(reader.from("leads").select(LEAD_COLUMNS).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(20_000), "leads"),
    loadAdsSnapshot(reader, () => "2999-01-01").catch(() => null),
  ]);
  const index = snapshot ? attributionIndex(snapshot) : null;
  return list.map((r) =>
    funnelLeadFromRow(r, (row) => {
      const a = index ? attributeLead(adLeadFromRow(row), index) : null;
      const adLead = adLeadFromRow(row);
      return { campaignId: a?.campaignId ?? adLead.ad?.campaignId ?? null, fromMeta: Boolean(a && a.level !== "none") || Boolean(adLead.ad?.fbclid) };
    }),
  );
}

/** Of these clients, the ones with a report on file (report_pulls: only the user id is read, never the report). */
export async function loadReportClients(reader: SupabaseClient, clientIds: readonly string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const list = await rows(reader.from("report_pulls").select("user_id").in("user_id", [...new Set(clientIds)]).limit(20_000), "report_pulls").catch(() => [] as Row[]);
  return new Set(list.map((r) => String(r.user_id)));
}

async function videoEvents(leadIds: readonly string[]): Promise<VideoEvents | null> {
  const source = liveFunnelSource();
  if (!source) return null;
  try {
    return await source.videos(leadIds);
  } catch (error) {
    await reportError(error, { where: "webinars:live-funnel", extra: { source: source.id } });
    return null;
  }
}

// ── What the screens receive ────────────────────────────────────────────

export async function loadSummaries(reader: SupabaseClient, db: SupabaseClient, contact: boolean, now: Date): Promise<WebinarSummary[]> {
  const webinars = await loadWebinars(reader);
  const ids = webinars.map((w) => w.id);
  const regs = contact ? await loadRegistrations(reader, ids) : await loadRegistrationsWithoutContact(db, ids);
  return summarize(webinars, regs, now);
}

export async function loadDetail(reader: SupabaseClient, db: SupabaseClient, id: string, who: { contact: boolean; admin: boolean }, now: Date, origin: string = siteUrl()): Promise<WebinarDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await rows(reader.from("webinars").select("*").eq("id", id).limit(1), "webinars");
  if (!row) return null;
  const webinar = webinarFromRow(row);
  const regs = who.contact ? await loadRegistrations(reader, [id]) : await loadRegistrationsWithoutContact(db, [id]);
  const leads = who.contact ? await webinarLeads(reader, webinar, regs) : [];
  const reportClients = await loadReportClients(reader, leads.map((l) => l.clientUserId).filter((v): v is string => Boolean(v)));
  const messages = who.admin ? await rows(reader.from("webinar_messages").select("kind, status").eq("webinar_id", id).limit(50_000), "webinar_messages") : null;
  return {
    webinar,
    phase: summarize([webinar], regs, now)[0]!.phase,
    links: webinarLinks(webinar, origin),
    registrants: regs.map((r) => registrantView(r, who.contact)),
    contact: who.contact,
    reminders: messages ? reminderStats(messages.map((m) => ({ kind: m.kind as ReminderKind, status: String(m.status) }))) : null,
    counters: countersFor(webinar, regs, leads, reportClients, await videoEvents(leads.map((l) => l.id))),
    sample: false,
  };
}

async function webinarLeads(reader: SupabaseClient, webinar: Webinar, regs: readonly Registration[]): Promise<FunnelLead[]> {
  const since = new Date(Date.parse(webinar.startsAt) - 14 * 24 * 3_600_000).toISOString();
  const phones = new Set(regs.map((r) => r.phone).filter(Boolean));
  return (await loadFunnelLeads(reader, since)).filter((l) => leadFromWebinar(l, webinar, phones));
}

/** The live console: counters and the newest messages / leads (first name and initial only). */
export async function loadLive(reader: SupabaseClient, db: SupabaseClient, id: string, who: { contact: boolean }, now: Date, origin: string = siteUrl()): Promise<LiveView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await rows(reader.from("webinars").select("*").eq("id", id).limit(1), "webinars");
  if (!row) return null;
  const webinar = webinarFromRow(row);
  // The leads' phones are matched on the server either way; the screen gets first names only.
  const regs = who.contact ? await loadRegistrations(reader, [id]) : await loadRegistrations(db, [id]);
  const leads = await webinarLeads(who.contact ? reader : db, webinar, regs);
  const reportClients = await loadReportClients(who.contact ? reader : db, leads.map((l) => l.clientUserId).filter((v): v is string => Boolean(v)));
  return {
    webinar,
    phase: summarize([webinar], regs, now)[0]!.phase,
    links: webinarLinks(webinar, origin),
    counters: countersFor(webinar, regs, leads, reportClients, await videoEvents(leads.map((l) => l.id))),
    leads: liveLeadViews(leads),
    sample: false,
  };
}

// ── Campaigns and the scorecard (administrators) ────────────────────────

export async function loadCampaignsView(reader: SupabaseClient, now: Date): Promise<CampaignsView> {
  const [campaignRows, costRows, purchaseRows, webinars] = await Promise.all([
    rows(reader.from("campaigns").select("*").order("start_day", { ascending: false }).limit(100), "campaigns"),
    rows(reader.from("campaign_costs").select("*").order("day", { ascending: false }).limit(5000), "campaign_costs"),
    rows(reader.from("client_purchases").select("*").order("day", { ascending: false }).limit(5000), "client_purchases"),
    loadWebinars(reader),
  ]);
  const campaigns = campaignRows.map((r) => campaignFromRow(r, webinars.filter((w) => w.campaignId === String(r.id)).map((w) => w.id)));
  const costs = costRows.map(costFromRow);
  const purchases = purchaseRows.map(purchaseFromRow);
  const earliest = campaigns.reduce((min, c) => (c.startDay < min ? c.startDay : min), dayInZone(now, TEXAS_TZ));
  const since = `${addDays(earliest, -1)}T00:00:00.000Z`;
  const snapshot = await loadAdsSnapshot(reader, () => addDays(earliest, -1)).catch(() => null);
  const [registrations, leads] = await Promise.all([loadRegistrations(reader, webinars.map((w) => w.id)), loadFunnelLeads(reader, since)]);
  const clientIds = leads.map((l) => l.clientUserId).filter((v): v is string => Boolean(v));
  const signedIds = [...new Set(leads.filter((l) => l.signedAt && l.clientUserId).map((l) => l.clientUserId!))];
  const [reportClients, clients, charges, commissions, households, loanOfficer, upgrades] = await Promise.all([
    loadReportClients(reader, clientIds),
    signedIds.length ? loadStaffClients(reader).then((list) => list.filter((c) => signedIds.includes(c.id))) : Promise.resolve([]),
    signedIds.length ? rows(reader.from("charges").select("id, gateway, gateway_reference").in("user_id", signedIds), "charges").catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
    signedIds.length ? rows(reader.from("monitoring_commissions").select("*").in("user_id", signedIds), "monitoring_commissions").catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
    signedIds.length ? rows(reader.from("household_members").select("primary_user_id").in("primary_user_id", signedIds), "household_members").catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
    signedIds.length ? rows(reader.from("loan_officer_requests").select("user_id").in("user_id", signedIds), "loan_officer_requests").catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
    // DIY → Complete upgrades: the service options' own events (docs/SERVICE-OPTIONS.md, «Counting upgrades»).
    listUpgrades(reader, signedIds).catch(async (error) => {
      await reportError(error, { where: "webinars:upgrades" });
      return [];
    }),
  ]);
  const chargeMeta: Record<string, ChargeMeta> = {};
  for (const c of charges) chargeMeta[String(c.id)] = { gateway: str(c.gateway), reference: str(c.gateway_reference) };
  const countBy = (list: Row[], key: string) => {
    const m = new Map<string, number>();
    for (const r of list) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
    return m;
  };
  const values = clientValueFacts({ clients, chargeMeta, commissions: commissions.map(commissionLineFromRow), purchases, households: countBy(households, "primary_user_id"), loanOfficer: countBy(loanOfficer, "user_id"), upgrades });
  const adDays = (snapshot?.days ?? []).map((d) => ({ campaignId: d.campaignId, day: d.day, spendCents: d.spendCents }));
  const scorecards = scorecardsFor({ campaigns, costs, adDays, webinars, registrations, leads, reportClients, videos: await videoEvents(leads.map((l) => l.id)), values, dayOf: (at) => dayInZone(at, TEXAS_TZ) });
  return {
    campaigns,
    costs,
    purchases,
    scorecards,
    metaCampaigns: (snapshot?.campaigns ?? []).map((c) => ({ id: c.id, name: c.name })),
    webinars: webinars.map((w) => ({ id: w.id, title: w.title.en || w.title.es, startsAt: w.startsAt })),
    adsConnected: Boolean(snapshot?.account),
    sample: false,
  };
}

/** The Ideas center's webinar numbers (ideas/signals.ts), read as an administrator reads the scorecard. Null when nothing could be read. */
export async function loadWebinarsSignal(reader: SupabaseClient, now: Date): Promise<WebinarsSignalInput | null> {
  try {
    const view = await loadCampaignsView(reader, now);
    const webinars = await loadWebinars(reader);
    if (webinars.length === 0 && view.campaigns.length === 0) return null;
    const since = new Date(now.getTime() - 31 * 24 * 3_600_000).toISOString();
    const [registrations, leads] = await Promise.all([loadRegistrations(reader, webinars.map((w) => w.id)), loadFunnelLeads(reader, since)]);
    return webinarsSignal({ webinars, registrations, leads, scorecards: view.scorecards, now });
  } catch {
    return null;
  }
}

export interface CampaignInput {
  name: string;
  startDay: string;
  endDay: string;
  budgetCents: number | null;
  metaCampaignIds: string[];
  webinarIds: string[];
  keywords: string[];
  organicSources: string[];
  note: string | null;
}

export async function saveCampaign(db: SupabaseClient, input: CampaignInput, actor: Actor, id: string | null): Promise<SaveResult<{ id: string }>> {
  const row = {
    name: input.name.trim(),
    start_day: input.startDay,
    end_day: input.endDay,
    budget_cents: input.budgetCents,
    meta_campaign_ids: input.metaCampaignIds,
    keywords: input.keywords.map((k) => k.toUpperCase()),
    organic_sources: input.organicSources.map((s) => s.toLowerCase()),
    note: input.note,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = id
    ? await db.from("campaigns").update(row).eq("id", id).select("id").maybeSingle()
    : await db.from("campaigns").insert({ ...row, created_by: actor.userId, created_by_name: actor.name.slice(0, 80) }).select("id").single();
  if (error) throw new Error(`campaigns: ${error.message}`);
  if (!data) return { ok: false, status: 404, code: "not_found" };
  const campaignId = String((data as Row).id);
  // A webinar belongs to one campaign: the chosen ones point here; the ones no longer chosen let go of it.
  await db.from("webinars").update({ campaign_id: null }).eq("campaign_id", campaignId);
  if (input.webinarIds.length) await db.from("webinars").update({ campaign_id: campaignId }).in("id", input.webinarIds);
  await audit(db, { campaignId, kind: id ? "campaign_changed" : "campaign_created", actor });
  return { ok: true, value: { id: campaignId } };
}

export async function addCost(db: SupabaseClient, input: { campaignId: string; label: string; kind: CostKind; amountCents: number; day: string }, actor: Actor): Promise<void> {
  const { error } = await db.from("campaign_costs").insert({ campaign_id: input.campaignId, label: input.label.trim(), kind: input.kind, amount_cents: input.amountCents, day: input.day, created_by: actor.userId, created_by_name: actor.name.slice(0, 80) });
  if (error) throw new Error(`campaign_costs: ${error.message}`);
  await audit(db, { campaignId: input.campaignId, kind: "cost_added", actor, detail: { amountCents: input.amountCents } });
}

export async function voidCost(db: SupabaseClient, id: string, actor: Actor): Promise<boolean> {
  const { data, error } = await db.from("campaign_costs").update({ voided_at: new Date().toISOString(), voided_by_name: actor.name.slice(0, 80) }).eq("id", id).is("voided_at", null).select("campaign_id");
  if (error) throw new Error(`campaign_costs: ${error.message}`);
  const row = ((data as Row[] | null) ?? [])[0];
  if (row) await audit(db, { campaignId: String(row.campaign_id), kind: "cost_voided", actor });
  return Boolean(row);
}

export async function addPurchase(db: SupabaseClient, input: { clientId: string; kind: PurchaseKind; amountCents: number | null; day: string; note: string | null }, actor: Actor): Promise<void> {
  const { error } = await db.from("client_purchases").insert({ client_id: input.clientId, kind: input.kind, amount_cents: input.amountCents, day: input.day, note: input.note, created_by: actor.userId, created_by_name: actor.name.slice(0, 80) });
  if (error) throw new Error(`client_purchases: ${error.message}`);
}

export async function voidPurchase(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db.from("client_purchases").update({ voided_at: new Date().toISOString() }).eq("id", id).is("voided_at", null).select("id");
  if (error) throw new Error(`client_purchases: ${error.message}`);
  return ((data as Row[] | null) ?? []).length > 0;
}

// ── The reminders (the cron) ────────────────────────────────────────────

export interface ReminderDelivery {
  ok: boolean;
  providerRef: string | null;
  note?: string;
}

export type ReminderDeliver = (registration: Registration, message: PlannedReminder) => Promise<ReminderDelivery>;

/** WhatsApp (text inside the 24-hour window, else the approved template) or email with the legal footer and its unsubscribe link. Never SMS. */
export const deliverReminder: ReminderDeliver = async (registration, message) => {
  if (message.channel === "whatsapp") {
    const to = registration.phone.replace(/^\+/, "");
    if (message.mode === "text") {
      const r = await sendWhatsAppText(to, message.body, `webinars:${message.kind}`);
      return r.sent ? { ok: true, providerRef: null } : { ok: false, providerRef: null, note: "not_configured" };
    }
    const r = await sendWhatsAppTemplate(to, { name: message.template.name, locale: message.locale, params: message.params, rendered: message.body }, `webinars:${message.kind}`);
    return r.sent ? { ok: true, providerRef: r.id } : { ok: false, providerRef: null, note: "not_configured" };
  }
  const link = webinarUnsubscribeUrl(registration.id, process.env, message.locale);
  const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? "";
  if (!link || !address || !registration.email) return { ok: false, providerRef: null, note: "email_not_ready" };
  const r = await sendEmail({ to: registration.email, subject: message.subject, text: message.body, unsubscribeUrl: link, postalAddress: address, idempotencyKey: message.dedupeKey }, message.locale);
  return { ok: r.sent, providerRef: r.providerRef, ...(r.sent ? {} : { note: "not_configured" }) };
};

export interface RemindersSummary {
  webinars: number;
  registrations: number;
  sent: number;
  failed: number;
  duplicates: number;
}

/**
 * Sends what is due for every published webinar from a week ago to a week
 * ahead: for each registrant who consented, plan (reminders.ts), claim under
 * the dedupe key (a second run, or two at once, loses the claim and sends
 * nothing), send, record the result once.
 */
export async function runWebinarReminders(
  db: SupabaseClient,
  now: Date = new Date(),
  deps: { deliver?: ReminderDeliver; channels?: ChannelAvailability; env?: Record<string, string | undefined> } = {},
): Promise<RemindersSummary> {
  const env = deps.env ?? process.env;
  const channels = deps.channels ?? availabilityFromEnv(env);
  const deliver = deps.deliver ?? deliverReminder;
  const summary: RemindersSummary = { webinars: 0, registrations: 0, sent: 0, failed: 0, duplicates: 0 };
  const from = new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString();
  const until = new Date(now.getTime() + 8 * 24 * 3_600_000).toISOString();
  const webinars = (await rows(db.from("webinars").select("*").eq("status", "published").gte("starts_at", from).lte("starts_at", until), "webinars")).map(webinarFromRow);
  const origin = siteUrl(env);
  for (const webinar of webinars) {
    summary.webinars += 1;
    const regs = (await rows(db.from("webinar_registrations").select("*").eq("webinar_id", webinar.id).eq("reminders_consent", true).is("reminders_opted_out_at", null).limit(20_000), "webinar_registrations")).map(registrationFromRow);
    if (regs.length === 0) continue;
    const phones = [...new Set(regs.map((r) => r.phone))];
    const [written, opts, leadRows] = await Promise.all([
      rows(db.from("webinar_messages").select("registration_id, kind").eq("webinar_id", webinar.id), "webinar_messages"),
      rows(db.from("message_opt_outs").select("phone_e164, kind, at").in("phone_e164", phones), "message_opt_outs"),
      rows(db.from("leads").select("phone_e164, signed_at, last_inbound_at").in("phone_e164", phones), "leads"),
    ]);
    const writtenBy = new Map<string, Set<ReminderKind>>();
    for (const w of written) {
      const set = writtenBy.get(String(w.registration_id)) ?? new Set<ReminderKind>();
      set.add(w.kind as ReminderKind);
      writtenBy.set(String(w.registration_id), set);
    }
    const optsBy = new Map<string, Array<{ kind: "opt_out" | "opt_in"; at: string }>>();
    for (const o of opts) {
      const list = optsBy.get(String(o.phone_e164)) ?? [];
      list.push({ kind: o.kind === "opt_in" ? "opt_in" : "opt_out", at: iso(o.at) ?? "" });
      optsBy.set(String(o.phone_e164), list);
    }
    const leadBy = new Map(leadRows.map((l) => [String(l.phone_e164), l]));
    const links = webinarLinks(webinar, origin);
    for (const reg of regs) {
      summary.registrations += 1;
      const lead = leadBy.get(reg.phone);
      const plan = planReminder(webinar, reg, { page: `${links.page}?lang=${reg.locale}`, signup: links.signup }, {
        now,
        optedOut: currentOptOut(optsBy.get(reg.phone) ?? []) !== null,
        written: writtenBy.get(reg.id) ?? new Set(),
        signedUp: Boolean(lead?.signed_at),
        channels,
        lastInboundAt: iso(lead?.last_inbound_at),
        emailReady: Boolean(reg.email && webinarUnsubscribeUrl(reg.id, env) && env.NEXT_PUBLIC_COMPANY_ADDRESS),
      });
      if (!plan.ok) continue;
      const message = plan.reminder;
      const { data: claimed, error: claimError } = await db
        .from("webinar_messages")
        .insert({ registration_id: reg.id, webinar_id: webinar.id, kind: message.kind, channel: message.channel, template: message.mode === "template" ? message.template.name : null, locale: message.locale, body: message.body.slice(0, 2000), dedupe_key: message.dedupeKey, status: "sending", created_at: now.toISOString() })
        .select("id")
        .single();
      if (claimError) {
        if (claimError.code === "23505") {
          summary.duplicates += 1;
          continue;
        }
        throw new Error(`webinar_messages: ${claimError.message}`);
      }
      let result: ReminderDelivery;
      try {
        result = await deliver(reg, message);
      } catch (e) {
        await reportError(e, { where: "webinars:deliver", extra: { dedupeKey: message.dedupeKey } });
        result = { ok: false, providerRef: null, note: (e as Error).message.slice(0, 200) };
      }
      await db
        .from("webinar_messages")
        .update({ status: result.ok ? "sent" : "failed", sent_at: now.toISOString(), provider_ref: result.providerRef, note: result.note ?? null })
        .eq("id", String((claimed as Row).id))
        .eq("status", "sending");
      if (result.ok) summary.sent += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}
