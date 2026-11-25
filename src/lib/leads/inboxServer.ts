import type { SupabaseClient } from "@supabase/supabase-js";
import { clientTimeZone, isQuietHour } from "../autopilot/clock";
import { currentOptOut } from "../autopilot/optout";
import { storeMessage } from "../chat/history";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../integrations/whatsapp";
import { chooseSalesperson } from "../highlevel/match";
import { checkStaffReply, MAX_REPLY_CHARS, type ReplyProblem } from "../staff/conversation";
import type { StaffMember } from "../staff/access";
import type { StaffLocale } from "../staff/i18n/locale";
import { loadTeam } from "../staff/server";
import type { ConversationProvider } from "./conversations";
import { guessLanguage, isPersonStage, leadLanguage, whatsappWindow } from "./inbox";
import { renderLeadTemplate, type LeadTemplate } from "./templates";
import {
  DEFAULT_LEAD_AUTOPILOT,
  LEAD_SOURCES,
  type HandoffReason,
  type Lead,
  type LeadAutoMessage,
  type LeadAutopilotSettings,
  type LeadMessage,
  type LeadSourceKind,
  type LeadThread,
  type PersonStage,
} from "./types";

// The lead inbox on the server (migration 0034). Reads go through the
// signed-in member's OWN connection, so the read policies decide what they
// see (an administrator: every lead; sales: theirs and the ones nobody has
// yet). Writes go through the service role, after the route checked the
// member's capability AND that they may see this lead (mayWork).

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const iso = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : null;
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

export function leadFromRow(
  row: Row,
  extra: { optedOutAt?: string | null; prospect?: Row | null; partner?: Row | null; signup?: Row | null; handoff?: Lead["handoff"] } = {},
): Lead {
  const touch = (row.first_touch as Row | null) ?? {};
  const utm = touch.utm && typeof touch.utm === "object" ? (touch.utm as NonNullable<Lead["firstTouch"]["utm"]>) : null;
  const source = LEAD_SOURCES.includes(row.source as LeadSourceKind) ? (row.source as LeadSourceKind) : "whatsapp";
  const stage = isPersonStage(String(row.stage)) ? (row.stage as PersonStage) : "new";
  const excerpt = str(row.last_message_excerpt);
  const lastAt = iso(row.last_message_at);
  const locale = row.locale === "es" || row.locale === "en" ? row.locale : row.last_message_role === "user" ? guessLanguage(excerpt) : null;
  return {
    id: String(row.id),
    phone: String(row.phone_e164),
    name: str(row.display_name),
    locale,
    source,
    firstTouch: {
      channel: str(touch.channel) ?? undefined,
      campaign: str(touch.campaign),
      utm,
      partnerId: str(touch.partnerId) ?? str(row.partner_id),
      partnerName: extra.partner ? str(extra.partner.name) : null,
      partnerCode: extra.partner ? str(extra.partner.referral_code) : null,
      caseRef: str(touch.caseRef) ?? str(row.signup_case_ref),
    },
    prospectId: str(row.prospect_id),
    salesperson: str(row.salesperson),
    assignedAt: iso(row.assigned_at),
    stage,
    stageAt: iso(row.stage_at),
    invitedAt: iso(row.invited_at),
    signedAt: iso(row.signed_at),
    clientUserId: str(row.client_user_id),
    lastInboundAt: iso(row.last_inbound_at),
    lastReplyAt: iso(row.last_reply_at),
    lastHumanAt: iso(row.last_human_at),
    firstHumanReplyAt: iso(row.first_human_reply_at),
    lastMessage:
      lastAt && excerpt
        ? {
            at: lastAt,
            role: row.last_message_role === "user" ? "user" : "assistant",
            source: row.last_message_source === "coach" || row.last_message_source === "human" ? row.last_message_source : "journey",
            excerpt,
          }
        : null,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    optedOutAt: extra.optedOutAt ?? null,
    highlevelContactId: extra.prospect ? str(extra.prospect.highlevel_contact_id) : null,
    goal: extra.prospect ? str(extra.prospect.goal) : null,
    state: extra.prospect ? str(extra.prospect.state) : null,
    signup: extra.signup ? { caseRef: String(extra.signup.case_ref), step: String(extra.signup.step), wantsPerson: Boolean(extra.signup.wants_person) } : null,
    handoff: extra.handoff ?? null,
  };
}

/** The newest opt-out of each number with no account. */
function optOutsByPhone(list: Row[]): Map<string, string> {
  const byPhone = new Map<string, Array<{ kind: "opt_out" | "opt_in"; at: string }>>();
  for (const r of list) {
    const phone = str(r.phone_e164);
    if (!phone) continue;
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), { kind: r.kind === "opt_in" ? "opt_in" : "opt_out", at: String(r.at) }]);
  }
  const out = new Map<string, string>();
  for (const [phone, records] of byPhone) {
    const current = currentOptOut(records);
    if (current) out.set(phone, current.at);
  }
  return out;
}

const HANDOFF_REASONS: readonly HandoffReason[] = ["complaint", "billing", "legal", "wants_person", "results", "personal_data", "no_fact", "guardrails"];

/** Every lead this member may see, with what the list shows. */
export async function loadLeads(reader: SupabaseClient, options: { id?: string } = {}): Promise<Lead[]> {
  const base = reader.from("leads").select("*");
  const leadRows = await rows(options.id ? base.eq("id", options.id) : base.order("created_at", { ascending: false }).limit(2000), "leads");
  if (leadRows.length === 0) return [];
  const ids = leadRows.map((r) => String(r.id));
  const phones = leadRows.map((r) => String(r.phone_e164));
  const prospectIds = leadRows.map((r) => str(r.prospect_id)).filter((v): v is string => Boolean(v));
  const partnerIds = [...new Set(leadRows.map((r) => str(r.partner_id) ?? str((r.first_touch as Row | null)?.partnerId)).filter((v): v is string => Boolean(v)))];
  const caseRefs = leadRows.map((r) => str(r.signup_case_ref)).filter((v): v is string => Boolean(v));
  const [optOuts, prospects, partners, signups, handoffs] = await Promise.all([
    rows(reader.from("message_opt_outs").select("phone_e164, kind, at").is("user_id", null).in("phone_e164", phones), "message_opt_outs"),
    prospectIds.length ? rows(reader.from("prospects").select("id, goal, state, highlevel_contact_id").in("id", prospectIds), "prospects") : Promise.resolve([]),
    partnerIds.length ? rows(reader.from("partners").select("id, name, referral_code").in("id", partnerIds), "partners") : Promise.resolve([]),
    caseRefs.length ? rows(reader.from("signup_cases").select("case_ref, step, wants_person").in("case_ref", caseRefs), "signup_cases") : Promise.resolve([]),
    rows(reader.from("lead_auto_messages").select("lead_id, reason, created_at").eq("kind", "handoff").in("lead_id", ids).order("created_at", { ascending: false }), "lead_auto_messages"),
  ]);
  const opted = optOutsByPhone(optOuts);
  const prospectOf = new Map(prospects.map((p) => [String(p.id), p]));
  const partnerOf = new Map(partners.map((p) => [String(p.id), p]));
  const signupOf = new Map(signups.map((s) => [String(s.case_ref), s]));
  const handoffOf = new Map<string, Row>();
  for (const h of handoffs) if (!handoffOf.has(String(h.lead_id))) handoffOf.set(String(h.lead_id), h);
  return leadRows.map((row) => {
    const h = handoffOf.get(String(row.id));
    const lastHuman = iso(row.last_human_at);
    const at = h ? iso(h.created_at) : null;
    const reason = h && HANDOFF_REASONS.includes(h.reason as HandoffReason) ? (h.reason as HandoffReason) : null;
    return leadFromRow(row, {
      optedOutAt: opted.get(String(row.phone_e164)) ?? null,
      prospect: prospectOf.get(String(row.prospect_id)) ?? null,
      partner: partnerOf.get(String(row.partner_id ?? (row.first_touch as Row | null)?.partnerId)) ?? null,
      signup: signupOf.get(String(row.signup_case_ref)) ?? null,
      handoff: at && reason && !(lastHuman && lastHuman >= at) ? { at, reason } : null,
    });
  });
}

export function autoMessageFromRow(r: Row): LeadAutoMessage {
  return {
    id: String(r.id),
    at: iso(r.created_at) ?? new Date(0).toISOString(),
    kind: (["greeting", "faq", "signup_link", "handoff"] as const).find((k) => k === r.kind) ?? "handoff",
    status: (["claimed", "sent", "failed", "handed_off"] as const).find((k) => k === r.status) ?? "failed",
    reason: str(r.reason),
    body: str(r.body),
  };
}

/** One lead's conversation, notes, pipeline history and automatic messages, as this member may see them. */
export async function loadLeadThread(reader: SupabaseClient, id: string, provider: ConversationProvider | null = null): Promise<LeadThread | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [lead] = await loadLeads(reader, { id });
  if (!lead) return null;
  const [chat, notes, events, autos] = await Promise.all([
    rows(reader.from("chat_messages").select("id, role, source, body, created_at, author_name").eq("channel", "whatsapp").eq("phone_e164", lead.phone).order("created_at", { ascending: false }).limit(200), "chat_messages"),
    rows(reader.from("lead_notes").select("*").eq("lead_id", id).order("created_at", { ascending: true }), "lead_notes"),
    rows(reader.from("lead_stage_events").select("*").eq("lead_id", id).order("at", { ascending: true }), "lead_stage_events"),
    rows(reader.from("lead_auto_messages").select("*").eq("lead_id", id).order("created_at", { ascending: true }), "lead_auto_messages"),
  ]);
  const messages: LeadMessage[] = chat
    .reverse()
    .map((m) => ({
      id: String(m.id),
      at: iso(m.created_at) ?? "",
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      source: m.source === "coach" || m.source === "human" ? m.source : ("journey" as const),
      authorName: m.source === "human" ? str(m.author_name) : null,
      text: String(m.body),
    }));
  let external: LeadThread["external"] = null;
  if (provider && lead.highlevelContactId) {
    const read = await provider.messages(lead.highlevelContactId);
    external = { provider: "highlevel", ok: read.ok, note: read.ok ? undefined : read.reason };
    if (read.ok) messages.push(...read.messages);
    messages.sort((a, b) => a.at.localeCompare(b.at));
  }
  return {
    lead,
    messages,
    notes: notes.map((n) => ({ id: String(n.id), at: iso(n.created_at) ?? "", author: str(n.author_name) ?? str(n.author_handle) ?? "", text: String(n.body) })),
    stageEvents: events.map((e) => ({
      id: String(e.id),
      at: iso(e.at) ?? "",
      from: isPersonStage(String(e.from_stage)) ? (e.from_stage as PersonStage) : null,
      to: isPersonStage(String(e.to_stage)) ? (e.to_stage as PersonStage) : "new",
      by: str(e.actor_handle) ?? "",
    })),
    autoMessages: autos.map(autoMessageFromRow),
    external,
  };
}

// ── Acting on a lead ────────────────────────────────────────────────────

export type LeadActionResult =
  | { ok: true; detail?: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string; problems?: ReplyProblem[] };

const WORDS: Record<StaffLocale, Record<string, string>> = {
  en: {
    notFound: "We couldn't find this lead.",
    notYours: "This lead is another salesperson's. Ask an administrator to reassign it.",
    optedOut: "They asked us to stop writing (STOP). Nothing can be sent until they write START.",
    windowClosed: "More than 24 hours since their last message: WhatsApp only allows an approved template now.",
    windowOpen: "Their WhatsApp window is open: write a normal reply instead of the template.",
    notApproved: "This template isn't approved in Meta yet (WHATSAPP_APPROVED_TEMPLATES).",
    quiet: "It's quiet hours where they live (9 p.m. to 8 a.m.). Send the template in the morning.",
    noWhatsapp: "WhatsApp isn't connected on the server (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID). Nothing was sent.",
    sendFailed: "WhatsApp didn't accept the message. Nothing was saved; try again.",
    empty: "Write something first.",
    signed: "Signed is set by itself when they sign the agreement, and Invited when the invitation goes out.",
    sameStage: "The lead is already in that stage.",
    assignOthers: "Only an administrator assigns leads to someone else. You can take one that nobody has.",
    notSales: "That person isn't an active member of sales.",
  },
  es: {
    notFound: "No encontramos este prospecto.",
    notYours: "Este prospecto es de otra persona de ventas. Pide a un administrador que lo reasigne.",
    optedOut: "Pidió que no le escribamos (BAJA). No se puede enviar nada hasta que escriba ALTA.",
    windowClosed: "Pasaron más de 24 horas desde su último mensaje: WhatsApp solo permite una plantilla aprobada.",
    windowOpen: "Su ventana de WhatsApp está abierta: escribe una respuesta normal en vez de la plantilla.",
    notApproved: "Esta plantilla todavía no está aprobada en Meta (WHATSAPP_APPROVED_TEMPLATES).",
    quiet: "Es horario de silencio donde vive (9 p. m. a 8 a. m.). Envía la plantilla en la mañana.",
    noWhatsapp: "WhatsApp no está conectado en el servidor (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID). No se envió nada.",
    sendFailed: "WhatsApp no aceptó el mensaje. No se guardó nada; intenta de nuevo.",
    empty: "Escribe algo primero.",
    signed: "«Firmó» se pone solo cuando firma el acuerdo, e «Invitado» cuando sale la invitación.",
    sameStage: "El prospecto ya está en esa etapa.",
    assignOthers: "Solo un administrador asigna prospectos a otra persona. Puedes tomar uno que no tiene nadie.",
    notSales: "Esa persona no es parte activa de ventas.",
  },
};

export const leadActionText = (locale: StaffLocale) => WORDS[locale];

/** The lead, when this member may work it (an administrator any; sales theirs or nobody's). */
export async function leadForMember(db: SupabaseClient, id: string, member: StaffMember, locale: StaffLocale): Promise<{ ok: true; lead: Lead; row: Row } | Extract<LeadActionResult, { ok: false }>> {
  const w = WORDS[locale];
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, status: 404, code: "not_found", message: w.notFound };
  const [lead] = await loadLeads(db, { id });
  if (!lead) return { ok: false, status: 404, code: "not_found", message: w.notFound };
  if (!mayWork(member, lead)) return { ok: false, status: 403, code: "not_yours", message: w.notYours };
  return { ok: true, lead, row: { id } };
}

/** The same rule as the read policy (staff_can_see_lead): an administrator any lead; sales theirs or nobody's. */
export function mayWork(member: Pick<StaffMember, "role" | "handle">, lead: Pick<Lead, "salesperson">): boolean {
  if (member.role === "admin") return true;
  return member.role === "sales" && (lead.salesperson === null || lead.salesperson === member.handle);
}

export interface LeadSendDeps {
  sendText: (toDigits: string, text: string, context: string) => Promise<{ sent: boolean }>;
  sendTemplate: (toDigits: string, template: { name: string; locale: "es" | "en"; params: readonly string[]; rendered: string }, context: string) => Promise<{ sent: boolean }>;
}

export const LIVE_SEND: LeadSendDeps = { sendText: sendWhatsAppText, sendTemplate: sendWhatsAppTemplate };

/** A teammate's reply, inside the 24-hour window. Checked against the reply rules, sent on WhatsApp, then stored. */
export async function replyToLead(
  db: SupabaseClient,
  input: { lead: Lead; member: StaffMember; text: string; locale: StaffLocale; now: Date },
  deps: LeadSendDeps = LIVE_SEND,
): Promise<LeadActionResult> {
  const w = WORDS[input.locale];
  const text = input.text.trim().slice(0, MAX_REPLY_CHARS);
  if (!text) return { ok: false, status: 400, code: "empty", message: w.empty };
  if (input.lead.optedOutAt) return { ok: false, status: 409, code: "opted_out", message: w.optedOut };
  if (whatsappWindow(input.lead.lastInboundAt, input.now).state === "closed") return { ok: false, status: 409, code: "window_closed", message: w.windowClosed };
  const problems = checkStaffReply(text, input.locale);
  if (problems.length > 0) return { ok: false, status: 422, code: "rules", message: problems.map((p) => p.why).join(" "), problems };
  let sent: { sent: boolean };
  try {
    sent = await deps.sendText(input.lead.phone.replace(/^\+/, ""), text, "whatsapp:lead-reply");
  } catch {
    return { ok: false, status: 502, code: "send_failed", message: w.sendFailed };
  }
  if (!sent.sent) return { ok: false, status: 503, code: "no_whatsapp", message: w.noWhatsapp };
  await storeMessage(db, { phoneE164: input.lead.phone, channel: "whatsapp", role: "assistant", source: "human", text, authorName: input.member.name.split(" ")[0] ?? input.member.handle });
  return { ok: true };
}

/** The approved template, outside the 24-hour window, outside quiet hours. */
export async function sendLeadTemplate(
  db: SupabaseClient,
  input: { lead: Lead; member: StaffMember; template: LeadTemplate; approved: boolean; locale: StaffLocale; now: Date },
  deps: LeadSendDeps = LIVE_SEND,
): Promise<LeadActionResult> {
  const w = WORDS[input.locale];
  if (input.lead.optedOutAt) return { ok: false, status: 409, code: "opted_out", message: w.optedOut };
  if (whatsappWindow(input.lead.lastInboundAt, input.now).state === "open") return { ok: false, status: 409, code: "window_open", message: w.windowOpen };
  if (!input.approved) return { ok: false, status: 409, code: "not_approved", message: w.notApproved };
  if (isQuietHour(input.now, clientTimeZone(input.lead.state ?? null), DEFAULT_LEAD_AUTOPILOT)) return { ok: false, status: 409, code: "quiet_hours", message: w.quiet };
  const language = leadLanguage(input.lead);
  const params = [input.lead.name?.split(" ")[0] ?? "", input.member.name.split(" ")[0] ?? input.member.handle];
  const rendered = renderLeadTemplate(input.template, language, params);
  let sent: { sent: boolean };
  try {
    sent = await deps.sendTemplate(input.lead.phone.replace(/^\+/, ""), { name: input.template.name, locale: language, params, rendered }, "whatsapp:lead-template");
  } catch {
    return { ok: false, status: 502, code: "send_failed", message: w.sendFailed };
  }
  if (!sent.sent) return { ok: false, status: 503, code: "no_whatsapp", message: w.noWhatsapp };
  await storeMessage(db, { phoneE164: input.lead.phone, channel: "whatsapp", role: "assistant", source: "human", text: rendered, authorName: input.member.name.split(" ")[0] ?? input.member.handle });
  return { ok: true };
}

export async function noteOnLead(db: SupabaseClient, input: { lead: Lead; member: StaffMember; text: string }): Promise<LeadActionResult> {
  const body = input.text.trim().slice(0, 2000);
  if (body.length < 2) return { ok: false, status: 400, code: "empty", message: "Write the note first." };
  const { error } = await db.from("lead_notes").insert({ lead_id: input.lead.id, author: input.member.userId, author_handle: input.member.handle, author_name: input.member.name.slice(0, 80) || input.member.handle, body });
  if (error) throw new Error(`lead_notes: ${error.message}`);
  return { ok: true };
}

/** Only people move leads: the move is a stage event written with the member as the actor. */
export async function moveLead(db: SupabaseClient, input: { lead: Lead; member: StaffMember; to: string; locale: StaffLocale }): Promise<LeadActionResult> {
  const w = WORDS[input.locale];
  if (!isPersonStage(input.to)) return { ok: false, status: 400, code: "not_a_person_stage", message: w.signed };
  if (input.to === input.lead.stage) return { ok: false, status: 409, code: "same_stage", message: w.sameStage };
  const { error } = await db.from("lead_stage_events").insert({ lead_id: input.lead.id, to_stage: input.to, actor: input.member.userId, actor_handle: input.member.handle });
  if (error) throw new Error(`lead_stage_events: ${error.message}`);
  return { ok: true };
}

/** Who works the lead. An administrator assigns anyone in sales (or an administrator); sales may take a lead nobody has. */
export async function assignLead(
  db: SupabaseClient,
  input: { lead: Lead; member: StaffMember; to: string | null; canAssignOthers: boolean; locale: StaffLocale; now: Date },
): Promise<LeadActionResult> {
  const w = WORDS[input.locale];
  if (!input.canAssignOthers && !(input.lead.salesperson === null && input.to === input.member.handle)) return { ok: false, status: 403, code: "assign_others", message: w.assignOthers };
  if (input.to) {
    const { state } = await loadTeam(db);
    const target = state.members.find((m) => m.handle === input.to && m.active && !m.pending);
    if (!target || (target.role !== "sales" && target.role !== "admin")) return { ok: false, status: 400, code: "not_sales", message: w.notSales };
  }
  const { error } = await db.from("leads").update({ salesperson: input.to, assigned_at: input.to ? input.now.toISOString() : null }).eq("id", input.lead.id);
  if (error) throw new Error(`leads assign: ${error.message}`);
  await db.from("team_audit").insert({ actor: input.member.userId, kind: "client_assigned", prospect_id: input.lead.prospectId, member_handle: input.to, detail: { lead: input.lead.id } });
  return { ok: true };
}

/** "Invited" is set when the invitation goes out from the invite page (a lead with no prospect row). */
export async function markLeadInvited(db: SupabaseClient, lead: Lead, now: Date): Promise<LeadActionResult> {
  if (lead.invitedAt) return { ok: true, detail: { invitedAt: lead.invitedAt } };
  const { error } = await db.from("leads").update({ invited_at: now.toISOString() }).eq("id", lead.id).is("invited_at", null);
  if (error) throw new Error(`leads invited: ${error.message}`);
  return { ok: true, detail: { invitedAt: now.toISOString() } };
}

/**
 * Leads nobody has yet go to the next salesperson in turn (the same turn the
 * HighLevel webhook uses: team_settings.last_sales_assigned). Run by the cron.
 */
export async function assignWaitingLeads(db: SupabaseClient, now: Date): Promise<number> {
  const open = await rows(db.from("leads").select("id, prospect_id").is("salesperson", null).is("signed_at", null).neq("stage", "archived").limit(200), "leads");
  if (open.length === 0) return 0;
  const { state, records } = await loadTeam(db);
  const handleOf = new Map([...records.entries()].filter(([, r]) => r.userId).map(([h, r]) => [r.userId as string, h]));
  let assigned = 0;
  for (const row of open) {
    const { data: settings } = await db.from("team_settings").select("last_sales_assigned").eq("id", true).maybeSingle();
    const lastSales = settings?.last_sales_assigned ? (handleOf.get(settings.last_sales_assigned as string) ?? null) : null;
    const choice = chooseSalesperson(state.members, { hint: null, partnerSalesperson: null, lastSales });
    if (!choice.handle) break;
    const { error } = await db.from("leads").update({ salesperson: choice.handle, assigned_at: now.toISOString() }).eq("id", row.id).is("salesperson", null);
    if (error) continue;
    assigned += 1;
    const userId = records.get(choice.handle)?.userId;
    if (choice.how === "round_robin" && userId) await db.from("team_settings").update({ last_sales_assigned: userId }).eq("id", true);
    await db.from("team_audit").insert({ actor: null, kind: "client_assigned", prospect_id: str(row.prospect_id), member_handle: choice.handle, detail: { lead: row.id, auto: true, how: choice.how } });
  }
  return assigned;
}

// ── The lead autopilot's settings ───────────────────────────────────────

export function settingsFromRow(row: Row | null): LeadAutopilotSettings {
  if (!row) return DEFAULT_LEAD_AUTOPILOT;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    enabled: row.enabled === true,
    replyDelaySeconds: num(row.reply_delay_seconds, DEFAULT_LEAD_AUTOPILOT.replyDelaySeconds),
    perLeadDailyCap: num(row.per_lead_daily_cap, DEFAULT_LEAD_AUTOPILOT.perLeadDailyCap),
    dailyCap: num(row.daily_cap, DEFAULT_LEAD_AUTOPILOT.dailyCap),
    quietStartHour: num(row.quiet_start_hour, DEFAULT_LEAD_AUTOPILOT.quietStartHour),
    quietEndHour: num(row.quiet_end_hour, DEFAULT_LEAD_AUTOPILOT.quietEndHour),
    sendSignupLink: row.send_signup_link !== false,
    enabledAt: iso(row.enabled_at),
    updatedAt: iso(row.updated_at),
    updatedBy: str(row.updated_by_name),
  };
}

export async function loadAutopilotSettings(reader: SupabaseClient): Promise<LeadAutopilotSettings> {
  const { data, error } = await reader.from("lead_autopilot_settings").select("*").eq("id", true).maybeSingle();
  if (error) return DEFAULT_LEAD_AUTOPILOT;
  return settingsFromRow((data as Row | null) ?? null);
}

export type SettingsPatch = Partial<Pick<LeadAutopilotSettings, "enabled" | "replyDelaySeconds" | "perLeadDailyCap" | "dailyCap" | "quietStartHour" | "quietEndHour" | "sendSignupLink">>;

/** An administrator changes the switch or the numbers. Every change is recorded with who and what. */
export async function saveAutopilotSettings(db: SupabaseClient, member: StaffMember, patch: SettingsPatch, now: Date): Promise<LeadAutopilotSettings> {
  const current = await loadAutopilotSettings(db);
  const next = { ...current, ...patch };
  const turnedOn = !current.enabled && next.enabled;
  const update: Row = {
    enabled: next.enabled,
    reply_delay_seconds: next.replyDelaySeconds,
    per_lead_daily_cap: next.perLeadDailyCap,
    daily_cap: next.dailyCap,
    quiet_start_hour: next.quietStartHour,
    quiet_end_hour: next.quietEndHour,
    send_signup_link: next.sendSignupLink,
    updated_at: now.toISOString(),
    updated_by: member.userId,
    updated_by_name: member.name.slice(0, 80) || member.handle,
    ...(turnedOn ? { enabled_at: now.toISOString() } : {}),
  };
  const { error } = await db.from("lead_autopilot_settings").update(update).eq("id", true);
  if (error) throw new Error(`lead_autopilot_settings: ${error.message}`);
  const { error: logError } = await db.from("lead_autopilot_changes").insert({ actor: member.userId, actor_name: member.name.slice(0, 80) || member.handle, enabled: next.enabled, detail: patch });
  if (logError) throw new Error(`lead_autopilot_changes: ${logError.message}`);
  return { ...next, enabledAt: turnedOn ? now.toISOString() : current.enabledAt, updatedAt: now.toISOString(), updatedBy: member.name };
}

/** The last automatic messages, for the switch screen's record. */
export async function recentAutoMessages(reader: SupabaseClient, limit = 30): Promise<Array<LeadAutoMessage & { leadId: string }>> {
  const list = await rows(reader.from("lead_auto_messages").select("*").order("created_at", { ascending: false }).limit(limit), "lead_auto_messages");
  return list.map((r) => ({ ...autoMessageFromRow(r), leadId: String(r.lead_id) }));
}
