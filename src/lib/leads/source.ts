// Where a person came from, as the console shows it (migration 0017:
// prospects.source, source_detail, highlevel_contact_id, partner_id;
// profiles.referred_partner_id).
//
// Marketing tags only: a campaign name, UTM tags, the HighLevel contact id and
// the partner. Never anything from the credit file.

export type LeadChannel = "manual" | "highlevel" | "partner";

export interface LeadUtm {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

export interface LeadSource {
  channel: LeadChannel;
  /** The contact's id in HighLevel, when the lead came from there (or was matched to one). */
  highlevelContactId?: string | null;
  /** The campaign or form name HighLevel sent. */
  campaign?: string | null;
  utm?: LeadUtm | null;
  /** The referral partner (partners.id), when one referred the person. */
  partnerId?: string | null;
  /** The partner's name, for staff who may read the partner list (admin, sales). */
  partnerName?: string | null;
  /** The partner's referral code, carried into the invitation link. */
  partnerCode?: string | null;
  /** The consent the lead gave on the form, and when. */
  consentText?: string | null;
  consentAt?: string | null;
  /** When sales sent the invitation (prospects.invited_at). */
  invitedAt?: string | null;
}

export const CHANNEL_LABEL: Record<LeadChannel, string> = {
  manual: "Agregado a mano",
  highlevel: "HighLevel",
  partner: "Socio",
};

/** One short line for the console: "HighLevel · Anuncio casa nov", "Socio · Laura Benítez". */
export function sourceLine(source: LeadSource | null | undefined): string | null {
  if (!source) return null;
  const parts: string[] = [];
  if (source.channel === "highlevel") {
    parts.push("HighLevel");
    const campaign = source.campaign || source.utm?.campaign;
    if (campaign) parts.push(campaign);
  } else if (source.channel === "partner") {
    parts.push("Socio");
  } else if (!source.partnerId) {
    return null;
  }
  if (source.partnerId) {
    if (source.channel !== "partner") parts.push("socio");
    parts.push(source.partnerName || source.partnerCode || "referido");
  }
  return parts.join(" · ");
}

/** The partner code an invitation link carries (sales/invite.ts "p"), if any. */
export function partnerCodeOf(source: LeadSource | null | undefined): string | null {
  return source?.partnerCode && /^[a-z0-9-]{3,30}$/.test(source.partnerCode) ? source.partnerCode : null;
}
