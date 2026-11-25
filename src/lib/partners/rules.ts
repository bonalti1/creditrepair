import { ALL_STATES } from "../compliance/states";
import { toRefSlug } from "../sales/invite";
import { cleanPersonName, normalizeEmail, normalizePhone } from "../staff/team";
import type { StaffClient } from "../staff/types";

// Referral partners: realtors, loan officers, tax preparers, car dealers,
// attorneys and anyone else who sends people to Credalti. Pure rules here; the database is migration 0017 and the
// compliance text is copy.ts and docs/PARTNERS.md.
//
// A partner refers. They never see a referral's credit file, letters, score or
// payments: only a first name, a date and a coarse status (referralStatus).
// Commission terms are stored, and what is owed or paid is recorded by an
// administrator by hand. The app never pays anyone.

/** What a partner does. The same list as the partners.kind check (migration 0033). */
export const PARTNER_KINDS = ["realtor", "loan_officer", "tax_preparer", "car_dealer", "attorney", "other"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_KIND_LABEL: Record<"es" | "en", Record<PartnerKind, string>> = {
  en: { realtor: "Real estate agent", loan_officer: "Loan officer", tax_preparer: "Tax preparer", car_dealer: "Car dealer", attorney: "Attorney", other: "Other" },
  es: { realtor: "Agente de bienes raíces", loan_officer: "Oficial de préstamos", tax_preparer: "Preparador de impuestos", car_dealer: "Concesionario de autos", attorney: "Abogado", other: "Otro" },
};

/** A kind from the database or a request; anything unknown is "other". */
export function partnerKindOf(value: unknown): PartnerKind {
  return (PARTNER_KINDS as readonly string[]).includes(String(value)) ? (value as PartnerKind) : "other";
}

export const PARTNER_STATUSES = ["pending", "approved", "declined", "suspended"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  pending: "Por revisar",
  approved: "Aprobado",
  declined: "No aprobado",
  suspended: "Suspendido",
};

/** The same, for a staff member whose console is in English. */
export const PARTNER_STATUS_LABEL_EN: Record<PartnerStatus, string> = {
  pending: "To review",
  approved: "Approved",
  declined: "Not approved",
  suspended: "Suspended",
};

/**
 * How a commission is earned. Per person who signs, or per client who is
 * active (at least one round mailed). Never per result on a credit report:
 * there is no such option, here or in the database.
 */
export const COMMISSION_BASES = ["none", "signed_client", "active_client"] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const COMMISSION_BASIS_LABEL: Record<CommissionBasis, string> = {
  none: "Sin comisión",
  signed_client: "Por cliente que firma su acuerdo",
  active_client: "Por cliente activo (primera ronda enviada)",
};

/** The same, for a staff member whose console is in English. */
export const COMMISSION_BASIS_LABEL_EN: Record<CommissionBasis, string> = {
  none: "No commission",
  signed_client: "Per client who signs their agreement",
  active_client: "Per active client (first round mailed)",
};

export interface Partner {
  id: string;
  name: string;
  company: string | null;
  kind: PartnerKind;
  /** E.164. */
  phone: string;
  email: string | null;
  state: string | null;
  status: PartnerStatus;
  /** The code in their link, /r/<code>. Null until approved. */
  referralCode: string | null;
  /** Handle of the salesperson who follows up their referrals. */
  salesperson: string | null;
  commissionBasis: CommissionBasis;
  commissionCents: number;
  commissionNote: string | null;
  appliedAt: string;
  decidedAt: string | null;
  /** Co-branding logo (migration 0023): its review status, and the image for an administrator to look at. */
  logoStatus?: "none" | "pending" | "approved" | "rejected";
  logo?: string | null;
  /** The language of their portal and their notices (partners.locale): English unless they chose Spanish. */
  locale?: "es" | "en";
}

export interface CommissionRecord {
  id: string;
  partnerId: string;
  kind: "owed" | "paid";
  amountCents: number;
  /** A prospect id, when the record is for one referral. */
  referralId: string | null;
  note: string | null;
  recordedAt: string;
  recordedBy: string;
}

// ── Applying ────────────────────────────────────────────────────────────

export interface PartnerApplicationInput {
  name: string;
  company?: string | null;
  kind: string;
  phone: string;
  email?: string | null;
  state?: string | null;
  /** The applicant ticked "I accept the partner rules". */
  acceptsTerms: boolean;
}

export type PartnerApplicationField = "name" | "company" | "kind" | "phone" | "email" | "state" | "acceptsTerms";

export type PartnerApplicationCheck =
  | { ok: true; value: { name: string; company: string | null; kind: PartnerKind; phone: string; email: string | null; state: string | null } }
  | { ok: false; problems: Partial<Record<PartnerApplicationField, "required" | "invalid">> };

/** Problems come back as codes; the page words them in the reader's language. */
export function checkPartnerApplication(input: PartnerApplicationInput): PartnerApplicationCheck {
  const problems: Partial<Record<PartnerApplicationField, "required" | "invalid">> = {};
  const name = cleanPersonName(input.name, 80);
  if (!name) problems.name = input.name?.trim() ? "invalid" : "required";
  const rawCompany = (input.company ?? "").replace(/\s+/g, " ").trim();
  const company = rawCompany ? rawCompany.replace(/[<>]/g, "").slice(0, 120) : null;
  if (company !== null && company.length < 2) problems.company = "invalid";
  if (!(PARTNER_KINDS as readonly string[]).includes(input.kind)) problems.kind = "required";
  const phone = normalizePhone(input.phone);
  if (!phone) problems.phone = input.phone?.trim() ? "invalid" : "required";
  const rawEmail = (input.email ?? "").trim();
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) problems.email = "invalid";
  const rawState = (input.state ?? "").trim().toUpperCase();
  const state = rawState ? rawState : null;
  if (state && !(ALL_STATES as readonly string[]).includes(state)) problems.state = "invalid";
  if (!input.acceptsTerms) problems.acceptsTerms = "required";
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, value: { name: name!, company, kind: input.kind as PartnerKind, phone: phone!, email, state } };
}

/** A referral code no one has: "laura-benitez", then "laura-benitez-2". At least 3 characters. */
export function newReferralCode(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = (toRefSlug(name) ?? "socio").slice(0, 24).replace(/-+$/, "");
  const first = base.length >= 3 ? base : `socio-${base}`.slice(0, 24);
  if (!used.has(first)) return first;
  for (let n = 2; ; n += 1) {
    const candidate = `${first}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export const REFERRAL_CODE = /^[a-z0-9-]{3,30}$/;

/** The partner's public link. */
export function partnerLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/r/${code}`;
}

// ── Deciding ────────────────────────────────────────────────────────────

/** Which status changes an administrator may make, from each status. */
const NEXT_STATUS: Record<PartnerStatus, readonly PartnerStatus[]> = {
  pending: ["approved", "declined"],
  approved: ["suspended"],
  suspended: ["approved"],
  declined: ["approved"],
};

export type PartnerChange = { ok: true; partner: Partner } | { ok: false; message: string };

/**
 * The partner after an administrator's decision. Approving gives them a
 * referral code (kept if they already had one); suspending keeps the code but
 * the link stops attributing and the portal closes.
 */
export function decidePartner(partner: Partner, status: string, takenCodes: Iterable<string>, now: Date): PartnerChange {
  if (!(PARTNER_STATUSES as readonly string[]).includes(status)) return { ok: false, message: "Elige una decisión." };
  const next = status as PartnerStatus;
  if (partner.status === next) return { ok: true, partner };
  if (!NEXT_STATUS[partner.status].includes(next)) {
    return { ok: false, message: `Un socio ${PARTNER_STATUS_LABEL[partner.status].toLowerCase()} no puede pasar a ${PARTNER_STATUS_LABEL[next].toLowerCase()}.` };
  }
  const referralCode = next === "approved" ? (partner.referralCode ?? newReferralCode(partner.name, takenCodes)) : partner.referralCode;
  return { ok: true, partner: { ...partner, status: next, referralCode, decidedAt: now.toISOString() } };
}

// ── Commission terms ────────────────────────────────────────────────────

export type CommissionCheck = { ok: true; basis: CommissionBasis; cents: number } | { ok: false; message: string };

/** "150" or "150.00" dollars, between $1 and $1,000, unless there is no commission. */
export function checkCommissionTerms(basis: string, dollars: string | number | null | undefined): CommissionCheck {
  if (!(COMMISSION_BASES as readonly string[]).includes(basis)) return { ok: false, message: "Elige cómo se gana la comisión." };
  if (basis === "none") return { ok: true, basis: "none", cents: 0 };
  const cents = dollarsToCents(dollars);
  if (cents === null || cents < 100 || cents > 100_000) return { ok: false, message: "Escribe un monto entre $1 y $1,000." };
  return { ok: true, basis: basis as CommissionBasis, cents };
}

export function dollarsToCents(value: string | number | null | undefined): number | null {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export function commissionTotals(records: CommissionRecord[], partnerId?: string): { owedCents: number; paidCents: number; balanceCents: number } {
  const mine = partnerId ? records.filter((r) => r.partnerId === partnerId) : records;
  const owedCents = mine.filter((r) => r.kind === "owed").reduce((a, r) => a + r.amountCents, 0);
  const paidCents = mine.filter((r) => r.kind === "paid").reduce((a, r) => a + r.amountCents, 0);
  return { owedCents, paidCents, balanceCents: owedCents - paidCents };
}

// ── What a partner sees about a referral ────────────────────────────────

/**
 * The partner's pipeline: Referred → Contacted → Signed → Active → Finished
 * (after-care), and "did not continue" beside it. The same rules as the
 * database function partner_referrals() (migration 0033): change both together.
 */
export const REFERRAL_STATUSES = ["referred", "contacted", "signed", "active", "finished", "not_continued"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
/** The five stages of the pipeline, in order ("not_continued" is beside it). */
export const PIPELINE_STAGES = ["referred", "contacted", "signed", "active", "finished"] as const satisfies readonly ReferralStatus[];

export const REFERRAL_STATUS_LABEL: Record<"es" | "en", Record<ReferralStatus, string>> = {
  en: { referred: "Referred", contacted: "Contacted", signed: "Signed", active: "Active", finished: "Finished", not_continued: "Did not continue" },
  es: { referred: "Referido", contacted: "Contactado", signed: "Firmó", active: "Activo", finished: "Terminó", not_continued: "No siguió" },
};

/**
 * The coarse status, from the console's record:
 *   referred       a lead the team has not reached yet (no invitation sent, no account);
 *   contacted      sales sent the invitation, or they have an account without a signed agreement;
 *   signed         signed the service agreement; no round mailed yet;
 *   active         at least one round mailed and the service goes on;
 *   finished       finished the program (graduation: after-care goes on);
 *   not_continued  cancelled, asked to end the service, or sales closed them.
 */
export function referralStatus(
  client: Pick<StaffClient, "agreementSignedAt" | "agreementCancelledAt" | "serviceEndRequestedAt" | "rounds"> & {
    lostAt?: string | null;
    signedUpAt?: string | null;
    invitedAt?: string | null;
    finishedAt?: string | null;
  },
): ReferralStatus {
  if (client.lostAt) return "not_continued";
  if (client.finishedAt) return "finished";
  if (client.agreementCancelledAt || client.serviceEndRequestedAt) return "not_continued";
  if (client.agreementSignedAt && client.rounds.some((r) => Boolean(r.mailedAt))) return "active";
  if (client.agreementSignedAt) return "signed";
  if (client.signedUpAt === null && !client.invitedAt) return "referred";
  return "contacted";
}

/** How many of a partner's people are at each stage. */
export function pipelineCounts(referrals: ReadonlyArray<{ status: ReferralStatus }>): Record<ReferralStatus, number> {
  const out = Object.fromEntries(REFERRAL_STATUSES.map((s) => [s, 0])) as Record<ReferralStatus, number>;
  for (const r of referrals) out[r.status] += 1;
  return out;
}

/** Who on the team is taking care of a person: first name and role only. */
export interface CareTeamMember {
  firstName: string;
  role: "admin" | "specialist" | "sales";
}

/** What the portal lists for one referral. Nothing else leaves the server. */
export interface PartnerReferral {
  id: string;
  firstName: string;
  lastInitial: string;
  referredAt: string;
  status: ReferralStatus;
  /** When sales first reached out (the invitation went out: prospects.invited_at). */
  contactedAt?: string | null;
  /** The teammate who looks after them now. */
  care?: CareTeamMember | null;
  /** They have an account, so they can be asked to share their progress. */
  hasAccount?: boolean;
  /** The client id, only while this person shares their progress with the partner. */
  sharedClientId?: string | null;
  /** When the partner last asked them to share (partner_share_requests). */
  shareRequestedAt?: string | null;
}

/** A client as their partner may see them: first name, last initial, date, coarse status. */
export function referralView(client: StaffClient): PartnerReferral {
  return {
    id: client.id,
    firstName: client.firstName,
    lastInitial: client.lastName.slice(0, 1),
    referredAt: client.createdAt,
    status: referralStatus({ ...client, invitedAt: client.leadSource?.invitedAt ?? null, finishedAt: client.graduation?.completedAt ?? null }),
  };
}
