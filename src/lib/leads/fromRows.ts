import type { LeadSource, LeadUtm } from "./source";

// A person's lead source from database rows (migration 0017): their prospect
// row (source, source_detail, HighLevel contact, partner, consent, invited)
// and their profile (the partner a client came through, their HighLevel
// contact). Pure. Null when nothing is on record beyond "added by hand".

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const when = (v: unknown): string | null => {
  const s = str(v) ?? (v instanceof Date ? v.toISOString() : null);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

function utmOf(value: unknown): LeadUtm | null {
  if (!value || typeof value !== "object") return null;
  const out: LeadUtm = {};
  for (const key of ["source", "medium", "campaign", "content", "term"] as const) {
    const v = str((value as Row)[key]);
    if (v) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function leadSourceFromRows(prospect: Row | undefined, profile: Row | null, partnersById: Map<string, Row>): LeadSource | null {
  const channel = str(prospect?.source);
  const partnerId = str(prospect?.partner_id) ?? str(profile?.referred_partner_id);
  const contactId = str(prospect?.highlevel_contact_id) ?? str(profile?.highlevel_contact_id);
  const invitedAt = when(prospect?.invited_at);
  if ((!channel || channel === "manual") && !partnerId && !contactId && !invitedAt) return null;
  const detail = (prospect?.source_detail as Row | null) ?? {};
  const first = (detail.firstTouch as Row | null) ?? {};
  const partner = partnerId ? partnersById.get(partnerId) : undefined;
  return {
    channel: channel === "highlevel" || channel === "partner" ? channel : partnerId && !prospect ? "partner" : "manual",
    highlevelContactId: contactId,
    campaign: str(first.campaign),
    utm: utmOf(first.utm),
    partnerId,
    partnerName: partner ? str(partner.name) : null,
    partnerCode: partner ? str(partner.referral_code) : null,
    consentText: str(prospect?.consent_text),
    consentAt: when(prospect?.consent_at),
    invitedAt,
  };
}
