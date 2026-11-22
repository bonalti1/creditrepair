import { toRefSlug } from "../sales/invite";
import { roundRobinNext, type TeamMember } from "../staff/team";

// Two decisions about a lead that arrives from HighLevel (or from a partner),
// pure so they are tested without a database:
//
//   matchLead         is this someone we already have? The same HighLevel
//                     contact, or the same phone, updates the record instead
//                     of making a second one.
//   chooseSalesperson who follows them up: the salesperson HighLevel assigned,
//                     else the partner's salesperson, else the next salesperson
//                     in turn (the team's round-robin, team.ts roundRobinNext,
//                     among active salespeople).

/** A lead with the same phone as an open prospect younger than this updates it; older, it replaces it. */
export const DEDUPE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface KnownProspect {
  id: string;
  phone: string;
  highlevelContactId: string | null;
  createdAt: string;
  /** Has an account now (prospects.converted_user_id). */
  convertedUserId: string | null;
  /** Sales closed them (prospects.lost_at). */
  lostAt: string | null;
}

export interface KnownClient {
  id: string;
  phone: string | null;
  highlevelContactId: string | null;
}

export type LeadMatch =
  | { action: "create" }
  | { action: "update"; prospectId: string; by: "contact_id" | "phone" }
  /** An open prospect with this phone is older than DEDUPE_DAYS: close it and start a new one. */
  | { action: "replace"; previousId: string }
  /** Already a client with an account: nothing new is created. */
  | { action: "existing_client"; clientId: string };

export function matchLead(
  lead: { phone: string; contactId: string | null },
  known: { prospects: KnownProspect[]; clients: KnownClient[] },
  now: Date,
  days = DEDUPE_DAYS,
): LeadMatch {
  const open = known.prospects.filter((p) => !p.convertedUserId && !p.lostAt);
  if (lead.contactId) {
    const byContact = open.find((p) => p.highlevelContactId === lead.contactId);
    if (byContact) return { action: "update", prospectId: byContact.id, by: "contact_id" };
    const converted = known.prospects.find((p) => p.convertedUserId && p.highlevelContactId === lead.contactId);
    if (converted?.convertedUserId) return { action: "existing_client", clientId: converted.convertedUserId };
    const client = known.clients.find((c) => c.highlevelContactId === lead.contactId);
    if (client) return { action: "existing_client", clientId: client.id };
  }
  const client = known.clients.find((c) => c.phone === lead.phone);
  if (client) return { action: "existing_client", clientId: client.id };
  const byPhone = open.find((p) => p.phone === lead.phone);
  if (byPhone) {
    const age = now.getTime() - new Date(byPhone.createdAt).getTime();
    return age <= days * DAY_MS ? { action: "update", prospectId: byPhone.id, by: "phone" } : { action: "replace", previousId: byPhone.id };
  }
  return { action: "create" };
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** The active member HighLevel named (by handle, email or full name), if they are sales or an administrator. */
export function memberFromHint(members: TeamMember[], hint: string | null | undefined): TeamMember | null {
  if (!hint) return null;
  const folded = fold(hint);
  const slug = toRefSlug(hint);
  const candidates = members.filter((m) => m.active && (m.role === "sales" || m.role === "admin"));
  return (
    candidates.find((m) => m.handle === slug) ??
    candidates.find((m) => m.email !== null && m.email === folded) ??
    candidates.find((m) => fold(m.name) === folded) ??
    null
  );
}

export type SalespersonChoice =
  | { handle: string; how: "highlevel" | "partner" | "round_robin" | "admin_fallback" }
  | { handle: null; how: "nobody" };

/**
 * Who follows up the lead. HighLevel's assigned user wins when they are on the
 * team; then the partner's salesperson (if still active); then the next
 * active salesperson in turn; with no salesperson at all, the first active
 * administrator, so the lead is never invisible.
 */
export function chooseSalesperson(
  members: TeamMember[],
  input: { hint?: string | null; partnerSalesperson?: string | null; lastSales: string | null },
): SalespersonChoice {
  const named = memberFromHint(members, input.hint);
  if (named) return { handle: named.handle, how: "highlevel" };
  const partner = input.partnerSalesperson ? members.find((m) => m.handle === input.partnerSalesperson && m.active && m.role !== "specialist") : null;
  if (partner) return { handle: partner.handle, how: "partner" };
  const next = roundRobinNext(members, input.lastSales, "sales");
  if (next) return { handle: next, how: "round_robin" };
  const admin = members
    .filter((m) => m.active && m.role === "admin")
    .sort((a, b) => a.invitedAt.localeCompare(b.invitedAt))[0];
  return admin ? { handle: admin.handle, how: "admin_fallback" } : { handle: null, how: "nobody" };
}
