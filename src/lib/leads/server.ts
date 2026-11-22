import type { SupabaseClient } from "@supabase/supabase-js";
import { chooseSalesperson, matchLead, type KnownClient, type KnownProspect, type LeadMatch } from "../highlevel/match";
import type { GoalKey } from "../sales/invite";
import { loadTeam } from "../staff/server";
import { roundRobinNext } from "../staff/team";
import type { LeadUtm } from "./source";

// A lead that arrives without a teammate typing it: from a HighLevel workflow
// (/api/webhooks/highlevel) or from a referral partner's portal
// (/api/partners/referrals). Both become a prospect (migration 0012/0017) the
// same way. Service role only; the caller has authenticated the sender.
//
//   - Someone we already have is updated, never duplicated (highlevel/match.ts).
//     Attribution is first-touch: the original source and partner stay; a
//     later touch is kept under source_detail.lastTouch.
//   - A salesperson is credited (prospects.salesperson): the one HighLevel
//     named, else the partner's, else the next salesperson in turn.
//   - With the team's round-robin on, a specialist is assigned too, as for a
//     person added by hand (/api/staff/clients).
//   - Every new or updated prospect leaves a line in team_audit.

export interface IncomingLead {
  source: "highlevel" | "partner";
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  state: string;
  goal: GoalKey;
  contactId: string | null;
  campaign: string | null;
  utm: LeadUtm | null;
  consentText: string;
  consentAt: string;
  /** What HighLevel says about the assigned user (handle, email or name). */
  salespersonHint: string | null;
  partner: { id: string; salesperson: string | null } | null;
}

export type LeadOutcome =
  | { outcome: "created" | "updated"; prospectId: string; salesperson: string; match: LeadMatch["action"] }
  | { outcome: "existing_client"; clientId: string };

type Row = Record<string, unknown>;

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

export async function receiveLead(db: SupabaseClient, lead: IncomingLead, now: Date = new Date()): Promise<LeadOutcome> {
  const filters = [`phone_e164.eq.${lead.phone}`, ...(lead.contactId ? [`highlevel_contact_id.eq.${lead.contactId}`] : [])].join(",");
  const [prospectRows, profileRows] = await Promise.all([
    db.from("prospects").select("id, phone_e164, highlevel_contact_id, created_at, converted_user_id, lost_at, partner_id, email, consent_text, source_detail").or(filters),
    db.from("profiles").select("id, phone_e164, highlevel_contact_id").or(filters),
  ]);
  const prospects = check<Row[]>(prospectRows as never, "prospects") ?? [];
  const profiles = check<Row[]>(profileRows as never, "profiles") ?? [];
  const known = {
    prospects: prospects.map(
      (p): KnownProspect => ({
        id: String(p.id),
        phone: String(p.phone_e164),
        highlevelContactId: (p.highlevel_contact_id as string | null) ?? null,
        createdAt: String(p.created_at),
        convertedUserId: (p.converted_user_id as string | null) ?? null,
        lostAt: (p.lost_at as string | null) ?? null,
      }),
    ),
    clients: profiles.map((c): KnownClient => ({ id: String(c.id), phone: (c.phone_e164 as string | null) ?? null, highlevelContactId: (c.highlevel_contact_id as string | null) ?? null })),
  };
  const match = matchLead({ phone: lead.phone, contactId: lead.contactId }, known, now);
  const at = now.toISOString();
  const touch = { at, source: lead.source, ...(lead.campaign ? { campaign: lead.campaign } : {}), ...(lead.utm ? { utm: lead.utm } : {}) };

  if (match.action === "existing_client") {
    // A client already: link the HighLevel contact if none is on file. Never re-attribute to a partner.
    const profile = profiles.find((p) => p.id === match.clientId);
    if (lead.contactId && profile && !profile.highlevel_contact_id) {
      await db.from("profiles").update({ highlevel_contact_id: lead.contactId }).eq("id", match.clientId);
    }
    return { outcome: "existing_client", clientId: match.clientId };
  }

  if (match.action === "update") {
    const row = prospects.find((p) => p.id === match.prospectId)!;
    const detail = (row.source_detail as Row | null) ?? {};
    const update: Row = { last_touch_at: at, source_detail: { ...detail, lastTouch: touch } };
    if (!row.email && lead.email) update.email = lead.email;
    if (!row.highlevel_contact_id && lead.contactId) update.highlevel_contact_id = lead.contactId;
    if (!row.consent_text) {
      update.consent_text = lead.consentText;
      update.consent_at = lead.consentAt;
    }
    // First touch: someone already in touch is never credited to a partner afterwards.
    const { data: updated, error } = await db.from("prospects").update(update).eq("id", match.prospectId).select("id, salesperson").single();
    if (error || !updated) throw new Error(`prospects update: ${error?.message ?? "no row"}`);
    await db.from("team_audit").insert({ actor: null, kind: "prospect_updated", prospect_id: match.prospectId, detail: { source: lead.source, by: match.by } });
    return { outcome: "updated", prospectId: match.prospectId, salesperson: String((updated as Row).salesperson), match: "update" };
  }

  if (match.action === "replace") {
    const { error } = await db.from("prospects").update({ lost_at: at }).eq("id", match.previousId);
    if (error) throw new Error(`prospects close: ${error.message}`);
    await db.from("team_audit").insert({ actor: null, kind: "prospect_updated", prospect_id: match.previousId, detail: { closed: true, reason: "stale_returned" } });
  }

  // A new prospect.
  const { state: team, records } = await loadTeam(db);
  const { data: settings } = await db.from("team_settings").select("last_sales_assigned").eq("id", true).maybeSingle();
  const handleOf = new Map([...records.entries()].filter(([, r]) => r.userId).map(([h, r]) => [r.userId as string, h]));
  const lastSales = settings?.last_sales_assigned ? (handleOf.get(settings.last_sales_assigned as string) ?? null) : null;
  const choice = chooseSalesperson(team.members, { hint: lead.salespersonHint, partnerSalesperson: lead.partner?.salesperson ?? null, lastSales });
  // With nobody on the team yet, the lead is still kept, under a placeholder an administrator sees.
  const salesperson = choice.handle ?? "equipo";
  const specialist = team.settings.autoAssign ? roundRobinNext(team.members, team.settings.lastAutoAssigned) : null;
  const specialistId = specialist ? (records.get(specialist)?.userId ?? null) : null;

  const { data: inserted, error } = await db
    .from("prospects")
    .insert({
      first_name: lead.firstName,
      last_name: lead.lastName,
      phone_e164: lead.phone,
      email: lead.email,
      state: lead.state,
      goal: lead.goal,
      salesperson,
      created_by: null,
      assigned_to: specialistId,
      source: lead.source,
      source_detail: { firstTouch: touch },
      highlevel_contact_id: lead.contactId,
      partner_id: lead.partner?.id ?? null,
      consent_text: lead.consentText,
      consent_at: lead.consentAt,
      last_touch_at: at,
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(`prospects insert: ${error?.message ?? "no row"}`);
  const prospectId = String((inserted as Row).id);

  await db.from("team_audit").insert({ actor: null, kind: "prospect_added", prospect_id: prospectId, member_handle: choice.handle, detail: { source: lead.source, salesperson, how: choice.how } });
  if (choice.how === "round_robin" && choice.handle) {
    const userId = records.get(choice.handle)?.userId;
    if (userId) await db.from("team_settings").update({ last_sales_assigned: userId }).eq("id", true);
  }
  if (specialist && specialistId) {
    await db.from("team_settings").update({ last_auto_assigned: specialistId }).eq("id", true);
    await db.from("team_audit").insert({ actor: null, kind: "client_assigned", prospect_id: prospectId, member: specialistId, member_handle: specialist, detail: { auto: true } });
  }
  return { outcome: "created", prospectId, salesperson, match: match.action };
}
