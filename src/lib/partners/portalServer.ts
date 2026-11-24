import type { SupabaseClient } from "@supabase/supabase-js";
import { availabilityFromEnv, chooseChannel } from "../autopilot/channels";
import { clientTimeZone, isQuietHour } from "../autopilot/clock";
import { currentOptOut } from "../autopilot/optout";
import { loadAutopilotSettings } from "../autopilot/store";
import { FOOTER } from "../autopilot/templates";
import type { ChannelAvailability } from "../autopilot/types";
import { unsubscribeUrl } from "../autopilot/unsubscribe";
import { sendEmail } from "../integrations/email";
import { sendWhatsAppTemplate } from "../integrations/whatsapp";
import { reportError } from "../observability/errors";
import type { StaffMember } from "../staff/access";
import { memberCanSee } from "../staff/actions";
import type { ReplyProblem } from "../staff/conversation";
import {
  careFromRow,
  DIGEST_TEMPLATE,
  digestItems,
  digestParams,
  digestText,
  digestTime,
  digestWeekKey,
  referralFromRow,
  SHARE_REQUEST_TEMPLATE,
  shareAskState,
  shareRequestText,
  teamNoteFromRow,
  teamNoteProblems,
  type ClientShareRequest,
  type L,
  type TeamNote,
} from "./portal";
import type { CareTeamMember, Partner, PartnerReferral } from "./rules";
import { partnerDisplay, progressFromRow } from "./sharing";
import { loadPartnerClients } from "./sharingServer";

// The partner portal on the server (migration 0033).
//
//  - What a partner reads goes through the partner's OWN connection:
//    partner_referrals(), partner_client_care(), partner_team_thread(). The
//    database decides.
//  - Requests, notes and summaries are written with the service role, after
//    the route checked who is asking; the database's triggers hold the rules
//    (14 days, only the referring partner, only while the client shares).
//  - Messages to a client (the share request) and to a partner (the weekly
//    summary) follow the autopilot's rules: WhatsApp (approved template) or
//    email with an unsubscribe link and the postal address, never SMS, never
//    in quiet hours, never to someone who opted out, each once.

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");

export async function loadReferrals(reader: SupabaseClient): Promise<PartnerReferral[]> {
  const { data, error } = await reader.rpc("partner_referrals");
  if (error) throw new Error(`partner_referrals: ${error.message}`);
  return ((data as Row[] | null) ?? []).map(referralFromRow);
}

/** Who looks after one client who shares with the signed-in partner. */
export async function loadClientCare(reader: SupabaseClient, clientId: string): Promise<CareTeamMember | null> {
  const { data, error } = await reader.rpc("partner_client_care", { p_client: clientId });
  if (error) return null;
  const row = ((data as Row[] | null) ?? [])[0];
  return row ? careFromRow(row.care_first_name, row.care_role) : null;
}

/** The notes about one client between the signed-in partner and the team. */
export async function loadPartnerThread(reader: SupabaseClient, clientId: string): Promise<TeamNote[]> {
  const { data, error } = await reader.rpc("partner_team_thread", { p_client: clientId });
  if (error) throw new Error(`partner_team_thread: ${error.message}`);
  return ((data as Row[] | null) ?? []).map(teamNoteFromRow);
}

export type PortalResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; status: number; code: string; problems?: ReplyProblem[] };

// ── "Ask to follow progress" ────────────────────────────────────────────

/**
 * A partner asks a person they referred to share their progress. The
 * referral must be in the partner's own partner_referrals() (their connection
 * decides), with an account, not sharing, not asked in the last 14 days; the
 * database checks the same again. The message goes now when it may, else on
 * the next run of the partner cron.
 */
export async function requestShare(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: { userId: string; partner: Pick<Partner, "id" | "name" | "company"> },
  referralId: string,
  now: Date = new Date(),
  deps: { deliverNow?: boolean; channels?: ChannelAvailability; deliver?: ShareRequestDeliver } = {},
): Promise<PortalResult<{ requestedAt: string }>> {
  const referrals = await loadReferrals(reader);
  const referral = referrals.find((r) => r.id === referralId);
  if (!referral) return { ok: false, status: 404, code: "not_found" };
  const state = shareAskState(referral, now);
  if (state !== "can_ask") return { ok: false, status: 409, code: state };
  // The person's account: the prospect's, or the profile itself (a referral by link).
  const { data: prospect } = await db.from("prospects").select("converted_user_id").eq("id", referralId).eq("partner_id", member.partner.id).maybeSingle();
  const userId = text((prospect as Row | null)?.converted_user_id) || referralId;
  const { data, error } = await db
    .from("partner_share_requests")
    .insert({ partner_id: member.partner.id, user_id: userId, requested_by: member.userId, partner_name_shown: partnerDisplay(member.partner).slice(0, 210) })
    .select("id, created_at")
    .single();
  if (error || !data) {
    if (error && /14 days|already shares|referred this client/.test(error.message)) return { ok: false, status: 409, code: "requested" };
    throw new Error(`partner_share_requests: ${error?.message ?? "no row"}`);
  }
  if (deps.deliverNow !== false) {
    try {
      await runShareRequestMessages(db, now, { ids: [text((data as Row).id)], channels: deps.channels, deliver: deps.deliver });
    } catch (e) {
      // The request stands; the cron sends the message later.
      await reportError(e, { where: "partners:share-request-now" });
    }
  }
  return { ok: true, requestedAt: new Date(text((data as Row).created_at)).toISOString() };
}

export interface ShareRequestMessage {
  requestId: string;
  userId: string;
  phone: string | null;
  email: string | null;
  locale: L;
  channel: "whatsapp" | "email";
  params: [string, string];
  body: string;
}

export type ShareRequestDeliver = (message: ShareRequestMessage) => Promise<{ ok: boolean; note?: string }>;

export const deliverShareRequest: ShareRequestDeliver = async (m) => {
  if (m.channel === "whatsapp" && m.phone) {
    const r = await sendWhatsAppTemplate(m.phone.replace(/^\+/, ""), { name: SHARE_REQUEST_TEMPLATE, locale: m.locale, params: m.params, rendered: m.body }, "partners:share-request");
    return r.sent ? { ok: true } : { ok: false, note: "not_configured" };
  }
  const link = unsubscribeUrl(m.userId, process.env, m.locale);
  const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? "";
  if (m.channel === "email" && m.email && link && address) {
    const r = await sendEmail(
      {
        to: m.email,
        subject: m.locale === "es" ? "Alguien pidió seguir tu avance" : "Someone asked to follow your progress",
        text: m.body.split("\n\n")[0] ?? m.body,
        unsubscribeUrl: link,
        postalAddress: address,
        idempotencyKey: `share-request:${m.requestId}`,
      },
      m.locale,
    );
    return r.sent ? { ok: true } : { ok: false, note: "not_configured" };
  }
  return { ok: false, note: "email_not_ready" };
};

export interface ShareRequestRunSummary {
  requests: number;
  sent: number;
  failed: number;
  skipped: number;
  waitingQuietHours: number;
}

/**
 * The client's message for each queued request: WhatsApp (approved template)
 * or email, never SMS; skipped (the card in the app still shows) for a
 * client who opted out or who cannot be reached; held in quiet hours on the
 * client's clock. Claimed (queued → sending) before it is sent, so a second
 * run, or two at once, sends nothing twice.
 */
export async function runShareRequestMessages(
  db: SupabaseClient,
  now: Date = new Date(),
  deps: { ids?: string[]; channels?: ChannelAvailability; deliver?: ShareRequestDeliver } = {},
): Promise<ShareRequestRunSummary> {
  const summary: ShareRequestRunSummary = { requests: 0, sent: 0, failed: 0, skipped: 0, waitingQuietHours: 0 };
  const channels = deps.channels ?? availabilityFromEnv();
  const deliver = deps.deliver ?? deliverShareRequest;
  const settings = await loadAutopilotSettings(db);
  const quiet = { quietStartHour: settings.quietStartHour, quietEndHour: settings.quietEndHour };
  let query = db.from("partner_share_requests").select("id, user_id, partner_name_shown, created_at").eq("message_status", "queued");
  if (deps.ids) query = query.in("id", deps.ids);
  const { data, error } = await query;
  if (error) throw new Error(`partner_share_requests: ${error.message}`);
  for (const row of (data as Row[] | null) ?? []) {
    summary.requests += 1;
    const id = text(row.id);
    const userId = text(row.user_id);
    const skip = async (note: string) => {
      await db.from("partner_share_requests").update({ message_status: "skipped", message_note: note }).eq("id", id).eq("message_status", "queued");
      summary.skipped += 1;
    };
    // The email, when sales has one, is on the prospect the account came from (profiles hold none).
    const [{ data: profile }, { data: opts }, { data: prospect }] = await Promise.all([
      db.from("profiles").select("full_name, phone_e164, locale, state").eq("id", userId).maybeSingle(),
      db.from("message_opt_outs").select("kind, at").eq("user_id", userId),
      db.from("prospects").select("email").eq("converted_user_id", userId).limit(1).maybeSingle(),
    ]);
    const p = (profile as Row | null) ?? {};
    const optRecords = ((opts as Row[] | null) ?? []).map((o) => ({ kind: o.kind === "opt_in" ? ("opt_in" as const) : ("opt_out" as const), at: text(o.at) }));
    if (currentOptOut(optRecords)) {
      await skip("opted_out");
      continue;
    }
    if (isQuietHour(now, clientTimeZone(text(p.state) || null), quiet)) {
      summary.waitingQuietHours += 1;
      continue;
    }
    // Always the approved template on WhatsApp: the request is not a reply in a conversation.
    const phone = text(p.phone_e164) || null;
    const email = text((prospect as Row | null)?.email) || null;
    const choice = chooseChannel({ phone, email, lastInboundAt: null }, SHARE_REQUEST_TEMPLATE, channels, now);
    if (!choice.channel || (choice.channel === "email" && !email)) {
      await skip(choice.channel ? "no_channel" : choice.reason);
      continue;
    }
    const locale: L = p.locale === "es" ? "es" : "en";
    const firstName = text(p.full_name).trim().split(/\s+/)[0] ?? "";
    const partnerShown = text(row.partner_name_shown);
    const body = `${shareRequestText(locale, firstName, partnerShown)}\n\n${FOOTER[locale]}`;
    const { data: claimed } = await db
      .from("partner_share_requests")
      .update({ message_status: "sending", message_channel: choice.channel })
      .eq("id", id)
      .eq("message_status", "queued")
      .select("id");
    if (((claimed as Row[] | null) ?? []).length === 0) continue; // Someone else claimed it.
    let result: { ok: boolean; note?: string };
    try {
      result = await deliver({ requestId: id, userId, phone, email, locale, channel: choice.channel, params: [firstName || (locale === "es" ? "hola" : "there"), partnerShown], body });
    } catch (e) {
      await reportError(e, { where: "partners:share-request", extra: { id } });
      result = { ok: false, note: (e as Error).message.slice(0, 200) };
    }
    await db
      .from("partner_share_requests")
      .update({ message_status: result.ok ? "sent" : "failed", message_sent_at: now.toISOString(), message_note: result.note ?? null })
      .eq("id", id)
      .eq("message_status", "sending");
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;
  }
  return summary;
}

/** The signed-in client's own requests (their own rows, by the "own share requests read" policy). */
export async function loadClientShareRequests(reader: SupabaseClient, userId: string): Promise<ClientShareRequest[]> {
  const { data, error } = await reader.from("partner_share_requests").select("id, partner_id, partner_name_shown, created_at, dismissed_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
  if (error) throw new Error(`partner_share_requests: ${error.message}`);
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: text(r.id),
    partnerId: text(r.partner_id),
    partnerName: text(r.partner_name_shown),
    at: new Date(text(r.created_at)).toISOString(),
    dismissedAt: r.dismissed_at ? new Date(text(r.dismissed_at)).toISOString() : null,
  }));
}

// ── Notes between a partner and the team ────────────────────────────────

/** A partner's note about a client who shares with them, after the checks. */
export async function addPartnerNote(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: { userId: string; partner: Pick<Partner, "id" | "name"> },
  clientId: string,
  body: string,
  locale: L,
): Promise<PortalResult<{ note: TeamNote }>> {
  const clients = await loadPartnerClients(reader);
  if (!clients.some((c) => c.clientId === clientId)) return { ok: false, status: 404, code: "not_found" };
  const clean = body.replace(/\s+$/g, "").trim().slice(0, 1500);
  const problems = teamNoteProblems(clean, locale);
  if (problems.length > 0) return { ok: false, status: 422, code: "guardrails", problems };
  const { data, error } = await db
    .from("partner_team_notes")
    .insert({ partner_id: member.partner.id, user_id: clientId, author_kind: "partner", author: member.userId, author_first_name: firstOf(member.partner.name), body: clean })
    .select("id, author_kind, author_first_name, author_role, body, created_at")
    .single();
  if (error || !data) {
    if (error && /does not share/.test(error.message)) return { ok: false, status: 404, code: "not_found" };
    throw new Error(`partner_team_notes: ${error?.message ?? "no row"}`);
  }
  return { ok: true, note: teamNoteFromRow(data as Row) };
}

const firstOf = (name: string) => (name.trim().split(/\s+/)[0] ?? name).slice(0, 40);

/** The partners a client shares with now, and the thread with each, as a member of staff reads them (their own connection). */
export interface StaffPartnerThread {
  partnerId: string;
  partnerName: string;
  notes: TeamNote[];
  /** The client shares with this partner now: a reply can go. */
  sharing: boolean;
}

export async function loadStaffPartnerThreads(reader: SupabaseClient, db: SupabaseClient, clientId: string): Promise<StaffPartnerThread[]> {
  // The notes through the member's own connection: the "staff read partner team notes" policy decides.
  const { data: notes, error } = await reader.from("partner_team_notes").select("id, partner_id, author_kind, author_first_name, author_role, body, created_at").eq("user_id", clientId).order("created_at", { ascending: true });
  if (error) throw new Error(`partner_team_notes: ${error.message}`);
  const rows = (notes as Row[] | null) ?? [];
  // Who the client shares with now (the newest record of each pair), with the service role after the visibility check.
  const { data: consents } = await db.from("partner_share_consents").select("seq, partner_id, level").eq("user_id", clientId).order("seq", { ascending: true });
  const level = new Map<string, string>();
  for (const c of (consents as Row[] | null) ?? []) level.set(text(c.partner_id), text(c.level));
  const ids = [...new Set([...rows.map((r) => text(r.partner_id)), ...[...level.entries()].filter(([, l]) => l !== "none").map(([id]) => id)])];
  if (ids.length === 0) return [];
  const { data: partners } = await db.from("partners").select("id, name, company").in("id", ids);
  const nameOf = new Map(((partners as Row[] | null) ?? []).map((p) => [text(p.id), partnerDisplay({ name: text(p.name), company: text(p.company) || null })]));
  return ids.map((id) => ({
    partnerId: id,
    partnerName: nameOf.get(id) ?? "",
    notes: rows.filter((r) => text(r.partner_id) === id).map(teamNoteFromRow),
    sharing: (level.get(id) ?? "none") !== "none",
  }));
}

/** A teammate's reply to a partner about a client, after the checks. The client never sees it. */
export async function addStaffPartnerReply(
  db: SupabaseClient,
  reader: SupabaseClient,
  member: StaffMember,
  clientId: string,
  partnerId: string,
  body: string,
  locale: L,
): Promise<PortalResult<{ note: TeamNote }>> {
  if ((await memberCanSee(reader, clientId, "client")) !== "client") return { ok: false, status: 404, code: "not_visible" };
  const clean = body.replace(/\s+$/g, "").trim().slice(0, 1500);
  const problems = teamNoteProblems(clean, locale);
  if (problems.length > 0) return { ok: false, status: 422, code: "guardrails", problems };
  const { data: staffRow } = await db.from("staff_members").select("display_name").eq("user_id", member.userId).maybeSingle();
  const name = firstOf(text((staffRow as Row | null)?.display_name) || member.name);
  const { data, error } = await db
    .from("partner_team_notes")
    .insert({ partner_id: partnerId, user_id: clientId, author_kind: "staff", author: member.userId, author_first_name: name, author_role: member.role, body: clean })
    .select("id, author_kind, author_first_name, author_role, body, created_at")
    .single();
  if (error || !data) {
    if (error && /does not share|not approved/.test(error.message)) return { ok: false, status: 409, code: "not_sharing" };
    throw new Error(`partner_team_notes: ${error?.message ?? "no row"}`);
  }
  return { ok: true, note: teamNoteFromRow(data as Row) };
}

// ── The weekly summary ──────────────────────────────────────────────────

export interface DigestPartner {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  channel: "whatsapp" | "email";
  locale: L;
}

export type DigestDeliver = (partner: DigestPartner, body: string, params: [string, string], key: string) => Promise<{ ok: boolean; note?: string }>;

export const deliverDigest: DigestDeliver = async (partner, body, params, key) => {
  if (partner.channel === "whatsapp" && partner.phone) {
    const r = await sendWhatsAppTemplate(partner.phone.replace(/^\+/, ""), { name: DIGEST_TEMPLATE, locale: partner.locale, params, rendered: body }, "partners:digest");
    return r.sent ? { ok: true } : { ok: false, note: "not_configured" };
  }
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
  const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? "";
  if (partner.channel === "email" && partner.email && base && address) {
    const r = await sendEmail(
      {
        to: partner.email,
        subject: partner.locale === "es" ? "Tu resumen semanal de Credalti" : "Your weekly Credalti summary",
        text: body,
        // The partner turns the summary off in their portal: that page is the unsubscribe link.
        unsubscribeUrl: `${base}/socios/portal#avisos`,
        postalAddress: address,
        idempotencyKey: key,
      },
      partner.locale,
    );
    return r.sent ? { ok: true } : { ok: false, note: "not_configured" };
  }
  return { ok: false, note: "no_channel" };
};

export interface DigestRunSummary {
  partners: number;
  sent: number;
  failed: number;
  nothingNew: number;
  notTime: number;
}

/**
 * The weekly summary to each partner who chose it: Mondays from 9:00 and
 * outside quiet hours on the partner's clock; once per partner and week (the
 * week's row is claimed before sending); only weeks with news; the same words
 * as the milestone notices, which are only what the partner may see anyway.
 */
export async function runPartnerDigests(
  db: SupabaseClient,
  now: Date = new Date(),
  deps: { channels?: ChannelAvailability; deliver?: DigestDeliver; quiet?: { quietStartHour: number; quietEndHour: number } } = {},
): Promise<DigestRunSummary> {
  const channels = deps.channels ?? availabilityFromEnv();
  const deliver = deps.deliver ?? deliverDigest;
  const quiet = deps.quiet ?? { quietStartHour: 21, quietEndHour: 8 };
  const summary: DigestRunSummary = { partners: 0, sent: 0, failed: 0, nothingNew: 0, notTime: 0 };
  const { data, error } = await db.from("partners").select("id, name, phone_e164, email, state, digest_channel, locale").eq("status", "approved");
  if (error) throw new Error(`partners: ${error.message}`);
  for (const r of (data as Row[] | null) ?? []) {
    const channel = r.digest_channel === "whatsapp" || r.digest_channel === "email" ? r.digest_channel : null;
    if (!channel) continue;
    const partner: DigestPartner = { id: text(r.id), name: text(r.name), phone: text(r.phone_e164) || null, email: text(r.email) || null, state: text(r.state) || null, channel, locale: r.locale === "es" ? "es" : "en" };
    summary.partners += 1;
    const zone = clientTimeZone(partner.state);
    if (!digestTime(now, zone) || isQuietHour(now, zone, quiet)) {
      summary.notTime += 1;
      continue;
    }
    // The channel the partner chose, if the server can carry it (WhatsApp only as the approved template).
    const ok =
      channel === "whatsapp"
        ? chooseChannel({ phone: partner.phone, email: null, lastInboundAt: null }, DIGEST_TEMPLATE, channels, now).channel === "whatsapp"
        : chooseChannel({ phone: null, email: partner.email, lastInboundAt: null }, DIGEST_TEMPLATE, channels, now).channel === "email";
    if (!ok) {
      summary.failed += 1;
      continue;
    }
    const weekKey = digestWeekKey(now, zone);
    const { data: done } = await db.from("partner_digests").select("id").eq("partner_id", partner.id).eq("week_key", weekKey).limit(1);
    if (((done as Row[] | null) ?? []).length > 0) continue;
    const { data: rows, error: rowsError } = await db.rpc("partner_progress_rows", { p_partner: partner.id, p_client: null });
    if (rowsError) throw new Error(`partner_progress_rows: ${rowsError.message}`);
    const items = digestItems(((rows as Row[] | null) ?? []).map(progressFromRow), now);
    if (items.length === 0) {
      summary.nothingNew += 1;
      continue;
    }
    const { data: claimed, error: claimError } = await db.from("partner_digests").insert({ partner_id: partner.id, week_key: weekKey, channel, items: items.length, status: "sending" }).select("id").single();
    if (claimError || !claimed) continue; // Claimed by another run: sent at most once.
    const body = digestText(partner, items);
    let result: { ok: boolean; note?: string };
    try {
      result = await deliver(partner, body, digestParams(partner, items), `partner-digest:${partner.id}:${weekKey}`);
    } catch (e) {
      await reportError(e, { where: "partners:digest", extra: { partner: partner.id } });
      result = { ok: false, note: (e as Error).message.slice(0, 200) };
    }
    await db.from("partner_digests").update({ status: result.ok ? "sent" : "failed", sent_at: now.toISOString(), note: result.note ?? null }).eq("id", text((claimed as Row).id)).eq("status", "sending");
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;
  }
  return summary;
}
