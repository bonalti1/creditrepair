import type { SupabaseClient } from "@supabase/supabase-js";
import { chooseChannel, availabilityFromEnv } from "../autopilot/channels";
import { clientTimeZone, isQuietHour } from "../autopilot/clock";
import type { ChannelAvailability } from "../autopilot/types";
import { sendEmail } from "../integrations/email";
import { sendWhatsAppTemplate } from "../integrations/whatsapp";
import { reportError } from "../observability/errors";
import { programFromRow, type PartnerProgram } from "./program";
import { partnerKindOf, type PartnerKind } from "./rules";
import { noticesDue, partnerNoticeKey, progressFromRow, type PartnerMilestone, type PartnerProgress, type ShareHow, type ShareLevel } from "./sharing";

// Partner sharing on the server (migration 0023).
//
//  - What a partner reads goes through the partner's OWN connection, to
//    partner_clients() and partner_client_view(): the database decides.
//  - Consent records are written with the service role, after the route
//    checked who is asking and that the text they saw is the current one.
//  - Milestone notices run with the service role from the cron route.

type Row = Record<string, unknown>;

export async function loadProgram(db: SupabaseClient): Promise<PartnerProgram> {
  const { data, error } = await db.from("partner_program_changes").select("*").order("seq", { ascending: false }).limit(1);
  if (error) throw new Error(`partner_program_changes: ${error.message}`);
  return programFromRow(((data as Row[] | null) ?? [])[0] ?? null);
}

/** Whether commissions are on, through any connection (the function is public). */
export async function commissionsEnabled(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc("partner_commissions_enabled");
  if (error) return false;
  return data === true;
}

export interface PublicPartner {
  id: string;
  name: string;
  company: string | null;
  kind: PartnerKind;
  logo: string | null;
}

export function publicPartnerFromRow(row: Row): PublicPartner {
  const kind = String(row.kind);
  return {
    id: String(row.partner_id),
    name: String(row.name),
    company: typeof row.company === "string" && row.company ? row.company : null,
    kind: partnerKindOf(kind),
    logo: typeof row.logo_data === "string" && row.logo_data ? row.logo_data : null,
  };
}

export async function partnerByCode(db: SupabaseClient, code: string): Promise<PublicPartner | null> {
  if (!/^[a-z0-9-]{3,30}$/.test(code)) return null;
  const { data, error } = await db.rpc("partner_public", { p_code: code });
  if (error) return null;
  const row = ((data as Row[] | null) ?? [])[0];
  return row ? publicPartnerFromRow(row) : null;
}

/** One partner connected to the client, as client_sharing() returns it. */
export interface ClientSharingPartner extends PublicPartner {
  status: string;
  referred: boolean;
  level: ShareLevel;
  how: ShareHow | null;
  changedAt: string | null;
}

export async function loadClientSharing(reader: SupabaseClient): Promise<ClientSharingPartner[]> {
  const { data, error } = await reader.rpc("client_sharing");
  if (error) throw new Error(`client_sharing: ${error.message}`);
  return ((data as Row[] | null) ?? []).map((row) => ({
    ...publicPartnerFromRow(row),
    status: String(row.status),
    referred: row.referred === true,
    level: (["progress", "summary"].includes(String(row.level)) ? row.level : "none") as ShareLevel,
    how: row.how === "referred" || row.how === "added_by_code" ? row.how : null,
    changedAt: row.changed_at ? new Date(String(row.changed_at)).toISOString() : null,
  }));
}

export interface ClientView {
  partnerId: string;
  at: string;
}

/** The client's own view log (their own rows, by the "own partner views read" policy). */
export async function loadClientViews(reader: SupabaseClient, userId: string): Promise<ClientView[]> {
  const { data, error } = await reader.from("partner_view_log").select("partner_id, viewed_at").eq("user_id", userId).order("viewed_at", { ascending: false }).limit(50);
  if (error) throw new Error(`partner_view_log: ${error.message}`);
  return ((data as Row[] | null) ?? []).map((r) => ({ partnerId: String(r.partner_id), at: new Date(String(r.viewed_at)).toISOString() }));
}

/** The client's own consent history (append-only), newest first. */
export async function loadClientConsents(reader: SupabaseClient, userId: string) {
  const { data, error } = await reader
    .from("partner_share_consents")
    .select("partner_id, level, previous_level, action, home_ready, created_at")
    .eq("user_id", userId)
    .order("seq", { ascending: false })
    .limit(50);
  if (error) throw new Error(`partner_share_consents: ${error.message}`);
  return ((data as Row[] | null) ?? []).map((r) => ({
    partnerId: String(r.partner_id),
    level: String(r.level) as ShareLevel,
    previousLevel: String(r.previous_level) as ShareLevel,
    action: String(r.action) as "grant" | "change" | "revoke",
    homeReady: r.home_ready === true,
    at: new Date(String(r.created_at)).toISOString(),
  }));
}

/**
 * The two counts of the "summary" level, from the client's own rows, for the
 * preview next to the choice: the client sees exactly the numbers the partner
 * would.
 */
export async function loadPreviewCounts(reader: SupabaseClient, userId: string): Promise<{ disputing: number; noLongerReported: number }> {
  const { data: rounds } = await reader.from("attack_rounds").select("id, round_number, status, mailed_at").eq("user_id", userId);
  const mailed = ((rounds as Row[] | null) ?? []).filter((r) => (r.status === "mailed" || r.status === "complete") && r.mailed_at);
  if (mailed.length === 0) return { disputing: 0, noLongerReported: 0 };
  const latest = [...mailed].sort((a, b) => Number(b.round_number) - Number(a.round_number))[0]!;
  const { data: letters } = await reader.from("letters").select("id, round_id").in("round_id", mailed.map((r) => String(r.id)));
  const letterRows = (letters as Row[] | null) ?? [];
  if (letterRows.length === 0) return { disputing: 0, noLongerReported: 0 };
  const { data: links } = await reader.from("letter_items").select("letter_id, item_id").in("letter_id", letterRows.map((l) => String(l.id)));
  const roundOf = new Map(letterRows.map((l) => [String(l.id), String(l.round_id)]));
  const linkRows = (links as Row[] | null) ?? [];
  const disputing = new Set(linkRows.filter((l) => roundOf.get(String(l.letter_id)) === String(latest.id)).map((l) => String(l.item_id)));
  const all = [...new Set(linkRows.map((l) => String(l.item_id)))];
  if (all.length === 0) return { disputing: 0, noLongerReported: 0 };
  const { data: items } = await reader.from("report_items").select("id, status").in("id", all);
  const gone = ((items as Row[] | null) ?? []).filter((i) => i.status === "deleted").length;
  return { disputing: disputing.size, noLongerReported: gone };
}

export async function loadPartnerClients(reader: SupabaseClient): Promise<PartnerProgress[]> {
  const { data, error } = await reader.rpc("partner_clients");
  if (error) throw new Error(`partner_clients: ${error.message}`);
  return ((data as Row[] | null) ?? []).map(progressFromRow);
}

/** One client's page. Logged by the database in the same call. */
export async function viewPartnerClient(reader: SupabaseClient, clientId: string): Promise<PartnerProgress | null> {
  const { data, error } = await reader.rpc("partner_client_view", { p_client: clientId });
  if (error) throw new Error(`partner_client_view: ${error.message}`);
  const row = ((data as Row[] | null) ?? [])[0];
  return row ? progressFromRow(row) : null;
}

// ── Milestone notices ───────────────────────────────────────────────────

/** The WhatsApp template a partner notice goes in (to be approved in Meta, in en_US and es_MX). */
export const PARTNER_NOTICE_TEMPLATE = "credalti_socio_avance";
/** Its body in each language: {{1}} the partner's first name, {{2}} the milestone sentence. */
export const PARTNER_NOTICE_TEMPLATE_BODIES: Record<"es" | "en", string> = {
  en: "Hi, {{1}}. {{2}} More details in your Credalti partner portal.",
  es: "Hola, {{1}}. {{2}} Más detalles en tu portal de socios de Credalti.",
};
/** The Spanish body (kept under its first name). */
export const PARTNER_NOTICE_TEMPLATE_BODY = PARTNER_NOTICE_TEMPLATE_BODIES.es;

export interface NoticePartner {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
  /** The partner's language (partners.locale, migration 0024): the portal's, English unless they chose Spanish. */
  locale?: "es" | "en";
}

export type NoticeDeliver = (partner: NoticePartner, text: string, channel: "email" | "whatsapp", key: string) => Promise<{ ok: boolean; note?: string }>;

/** The template's two parameters for a notice: the partner's first name and the milestone sentence, in their language. */
export function noticeParams(partner: Pick<NoticePartner, "name" | "locale">, milestone: PartnerMilestone): [string, string] {
  const first = partner.name.trim().split(/\s+/)[0] ?? partner.name;
  return [first, milestone.text[partner.locale === "es" ? "es" : "en"]];
}

export function noticeText(partner: Pick<NoticePartner, "name" | "locale">, milestone: PartnerMilestone): string {
  const [first, sentence] = noticeParams(partner, milestone);
  return PARTNER_NOTICE_TEMPLATE_BODIES[partner.locale === "es" ? "es" : "en"].replace("{{1}}", first).replace("{{2}}", sentence);
}

/** The two parameters back from a notice's words (the template's fixed text taken off). */
function paramsFromText(text: string, locale: "es" | "en"): [string, string] | null {
  const [before, after] = PARTNER_NOTICE_TEMPLATE_BODIES[locale].split("{{2}}") as [string, string];
  const [lead, rest] = before.split("{{1}}") as [string, string];
  if (!text.startsWith(lead) || !text.endsWith(after)) return null;
  const middle = text.slice(lead.length, text.length - after.length);
  const cut = middle.indexOf(rest);
  return cut < 0 ? null : [middle.slice(0, cut), middle.slice(cut + rest.length)];
}

export const deliverNotice: NoticeDeliver = async (partner, text, channel, key) => {
  if (channel === "whatsapp" && partner.phone) {
    const locale = partner.locale === "es" ? "es" : "en";
    const params = paramsFromText(text, locale);
    if (!params) return { ok: false, note: "not_template" };
    const result = await sendWhatsAppTemplate(partner.phone.replace(/^\+/, ""), { name: PARTNER_NOTICE_TEMPLATE, locale, params, rendered: text }, "partners:notice");
    return result.sent ? { ok: true } : { ok: false, note: "not_configured" };
  }
  if (channel === "email" && partner.email) {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
    const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? "";
    if (!base || !address) return { ok: false, note: "email_not_ready" };
    const result = await sendEmail({
      to: partner.email,
      subject: partner.locale === "es" ? "Avance de tu cliente" : "Your client's progress",
      text,
      // The partner turns notices off in their portal: that page is the unsubscribe link.
      unsubscribeUrl: `${base}/socios/portal#avisos`,
      postalAddress: address,
      idempotencyKey: key,
    }, partner.locale === "es" ? "es" : "en");
    return result.sent ? { ok: true } : { ok: false, note: "not_configured" };
  }
  return { ok: false, note: "no_channel" };
};

export interface NoticeRunSummary {
  partners: number;
  sent: number;
  failed: number;
  waitingQuietHours: number;
  noChannel: number;
}

/**
 * Tells each partner who opted in about their consenting clients' recent
 * milestones. Once per partner, client and milestone (claimed by a unique
 * dedupe key before sending); never in the partner's quiet hours (21:00 to
 * 8:00 where they work); WhatsApp (approved template) or email; never SMS.
 * The words carry only what the partner may see anyway.
 */
export async function runPartnerNotices(
  db: SupabaseClient,
  now: Date = new Date(),
  deps: { channels?: ChannelAvailability; deliver?: NoticeDeliver; quiet?: { quietStartHour: number; quietEndHour: number } } = {},
): Promise<NoticeRunSummary> {
  const channels = deps.channels ?? availabilityFromEnv();
  const deliver = deps.deliver ?? deliverNotice;
  const quiet = deps.quiet ?? { quietStartHour: 21, quietEndHour: 8 };
  const summary: NoticeRunSummary = { partners: 0, sent: 0, failed: 0, waitingQuietHours: 0, noChannel: 0 };
  const { data, error } = await db.from("partners").select("id, name, phone_e164, email, state, notify_email, notify_whatsapp, locale").eq("status", "approved");
  if (error) throw new Error(`partners: ${error.message}`);
  const partners: NoticePartner[] = ((data as Row[] | null) ?? [])
    .map((r) => ({
      id: String(r.id),
      name: String(r.name),
      phone: typeof r.phone_e164 === "string" ? r.phone_e164 : null,
      email: typeof r.email === "string" ? r.email : null,
      state: typeof r.state === "string" ? r.state : null,
      notifyEmail: r.notify_email === true,
      notifyWhatsapp: r.notify_whatsapp === true,
      locale: r.locale === "es" ? ("es" as const) : ("en" as const),
    }))
    .filter((p) => p.notifyEmail || p.notifyWhatsapp);

  for (const partner of partners) {
    summary.partners += 1;
    if (isQuietHour(now, clientTimeZone(partner.state), quiet)) {
      summary.waitingQuietHours += 1;
      continue;
    }
    const { data: rows, error: rowsError } = await db.rpc("partner_progress_rows", { p_partner: partner.id, p_client: null });
    if (rowsError) throw new Error(`partner_progress_rows: ${rowsError.message}`);
    const clients = ((rows as Row[] | null) ?? []).map(progressFromRow);
    if (clients.length === 0) continue;
    const { data: sentRows } = await db.from("partner_notices").select("dedupe_key").eq("partner_id", partner.id);
    const already = new Set(((sentRows as Row[] | null) ?? []).map((r) => String(r.dedupe_key)));

    // The partner's own choice, then what the server can carry. WhatsApp only as an approved template.
    const viaWhatsApp = partner.notifyWhatsapp ? chooseChannel({ phone: partner.phone, email: null, lastInboundAt: null }, PARTNER_NOTICE_TEMPLATE, channels, now) : null;
    const viaEmail = partner.notifyEmail ? chooseChannel({ phone: null, email: partner.email, lastInboundAt: null }, PARTNER_NOTICE_TEMPLATE, channels, now) : null;
    const channel = viaWhatsApp?.channel === "whatsapp" ? "whatsapp" : viaEmail?.channel === "email" ? "email" : null;

    for (const client of clients) {
      for (const milestone of noticesDue(client, partner.id, already, now)) {
        if (!channel) {
          summary.noChannel += 1;
          continue;
        }
        const key = partnerNoticeKey(partner.id, client.clientId, milestone.key);
        const { data: claimed, error: claimError } = await db
          .from("partner_notices")
          .insert({ partner_id: partner.id, user_id: client.clientId, dedupe_key: key, milestone: milestone.key, channel, status: "sending" })
          .select("id")
          .single();
        if (claimError || !claimed) continue; // Someone else claimed it: sent at most once.
        let result: { ok: boolean; note?: string };
        try {
          result = await deliver(partner, noticeText(partner, milestone), channel, key);
        } catch (e) {
          await reportError(e, { where: "partners:notice", extra: { key } });
          result = { ok: false, note: (e as Error).message.slice(0, 200) };
        }
        await db
          .from("partner_notices")
          .update({ status: result.ok ? "sent" : "failed", sent_at: now.toISOString(), note: result.note ?? null })
          .eq("id", String((claimed as Row).id))
          .eq("status", "sending");
        if (result.ok) summary.sent += 1;
        else summary.failed += 1;
        already.add(key);
      }
    }
  }
  return summary;
}
