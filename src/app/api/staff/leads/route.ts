import { NextResponse } from "next/server";
import { z } from "zod";
import { availabilityFromEnv } from "@/lib/autopilot/channels";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { loadApprovedAnswers } from "@/lib/staff/answersServer";
import { DEMO_SAVED_ANSWERS } from "@/lib/staff/answers";
import { callDraftModel } from "@/lib/staff/draftModel";
import { STAFF_LOCALES, type StaffLocale } from "@/lib/staff/i18n/locale";
import { can } from "@/lib/staff/permissions";
import { conversationProvider } from "@/lib/leads/conversations";
import { buildDemoThread } from "@/lib/leads/demo";
import { demoLeadDraftCaller, draftLeadReply } from "@/lib/leads/drafts";
import {
  assignLead,
  leadForMember,
  loadLeads,
  loadLeadThread,
  markLeadInvited,
  moveLead,
  noteOnLead,
  replyToLead,
  sendLeadTemplate,
} from "@/lib/leads/inboxServer";
import { approvedLeadTemplates, LEAD_TEMPLATES } from "@/lib/leads/templates";
import { PERSON_STAGES } from "@/lib/leads/types";
import { isDemoMode } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";

// The lead inbox (Credalti Control, docs/CONTROL.md; migration 0034).
//
// GET: every lead this member may see (?id=… one lead's conversation). Read
// through the member's OWN connection: an administrator sees every lead,
// sales the ones they work and the ones nobody has yet.
// POST: reply (inside WhatsApp's 24 hours), the approved template (outside
// them), a note, a stage move (people only; never Invited or Signed, which
// are facts), assignment, "the invitation went out", and ✨ Suggest reply.
//
// Every action needs leads.work, checked on the server from the member's own
// row, and the lead must be one they may work. Reassigning a lead to someone
// else needs clients.assign. In the demo (no database) only "suggest"
// answers here, over the invented leads; the rest lives in the browser.

const id = z.string().min(1).max(64);
const locale = z.enum(STAFF_LOCALES).optional();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), id, text: z.string().min(1).max(4000), locale }).strict(),
  z.object({ action: z.literal("template"), id, template: z.string().regex(/^[a-z0-9_]{1,64}$/), locale }).strict(),
  z.object({ action: z.literal("note"), id, text: z.string().min(2).max(2000), locale }).strict(),
  z.object({ action: z.literal("stage"), id, to: z.enum(PERSON_STAGES), locale }).strict(),
  z.object({ action: z.literal("assign"), id, to: z.string().regex(/^[a-z0-9-]{2,30}$/).nullable(), locale }).strict(),
  z.object({ action: z.literal("invited"), id, locale }).strict(),
  z.object({ action: z.literal("suggest"), id, locale, viewAs: z.enum(["admin", "specialist", "sales"]).optional() }).strict(),
]);

export async function GET(req: Request) {
  const allowed = await requireCapability("leads.work");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const leadId = new URL(req.url).searchParams.get("id");
    const channels = availabilityFromEnv();
    const templates = approvedLeadTemplates(channels).map((t) => t.name);
    if (leadId) {
      const thread = await loadLeadThread(reader, leadId, conversationProvider());
      if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ thread, templates, whatsapp: channels.whatsapp });
    }
    // The approved saved answers are general words (no client's details): whoever works leads may use them.
    const [leads, answers] = await Promise.all([loadLeads(reader), loadApprovedAnswers(allowed.db)]);
    return NextResponse.json({ leads, templates, whatsapp: channels.whatsapp, answers });
  } catch (error) {
    await reportError(error, { where: "api/staff/leads:get", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the leads." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-leads", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const lang: StaffLocale = input.locale ?? "en";
  const now = new Date();
  const caller = process.env.ANTHROPIC_API_KEY ? callDraftModel : null;

  // The demo: ✨ Suggest reply over the invented lead, rebuilt here (nothing from the browser is trusted as the conversation).
  if (isDemoMode()) {
    if (input.action !== "suggest") return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
    if (input.viewAs && !can(input.viewAs, "leads.work")) return NextResponse.json({ error: "Not allowed for this role" }, { status: 403 });
    const thread = buildDemoThread(now, input.id);
    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const outcome = await draftLeadReply({ lead: thread.lead, messages: thread.messages, savedAnswers: DEMO_SAVED_ANSWERS, locale: lang }, caller ?? demoLeadDraftCaller);
    return NextResponse.json({ ...outcome, configured: Boolean(caller), demoDraft: !caller });
  }

  const allowed = await requireCapability("leads.work");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  try {
    const found = await leadForMember(db, input.id, member, lang);
    if (!found.ok) return NextResponse.json({ error: found.code, message: found.message }, { status: found.status });
    const { lead } = found;
    let result;
    switch (input.action) {
      case "reply":
        result = await replyToLead(db, { lead, member, text: input.text, locale: lang, now });
        break;
      case "template": {
        const template = LEAD_TEMPLATES.find((t) => t.name === input.template);
        if (!template) return NextResponse.json({ error: "Unknown template" }, { status: 400 });
        const approved = approvedLeadTemplates(availabilityFromEnv()).some((t) => t.name === template.name);
        result = await sendLeadTemplate(db, { lead, member, template, approved, locale: lang, now });
        break;
      }
      case "note":
        result = await noteOnLead(db, { lead, member, text: input.text });
        break;
      case "stage":
        result = await moveLead(db, { lead, member, to: input.to, locale: lang });
        break;
      case "assign":
        result = await assignLead(db, { lead, member, to: input.to, canAssignOthers: can(member.role, "clients.assign"), locale: lang, now });
        break;
      case "invited":
        result = await markLeadInvited(db, lead, now);
        break;
      case "suggest": {
        const reader = await getServerSupabase();
        const thread = reader ? await loadLeadThread(reader, lead.id) : null;
        if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const outcome = await draftLeadReply({ lead: thread.lead, messages: thread.messages, savedAnswers: await loadApprovedAnswers(db), locale: lang }, caller);
        return NextResponse.json({ ...outcome, configured: Boolean(caller) });
      }
    }
    if (!result.ok) return NextResponse.json({ error: result.code, message: result.message, problems: result.problems }, { status: result.status });
    return NextResponse.json({ ok: true, ...(result.detail ?? {}) });
  } catch (error) {
    await reportError(error, { where: `api/staff/leads:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
