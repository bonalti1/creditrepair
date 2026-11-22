import { ALL_STATES } from "../compliance/states";
import { toRefSlug } from "../sales/invite";
import { cleanPersonName, normalizeEmail, normalizePhone } from "../staff/team";
import type { StaffClient } from "../staff/types";

// Referral partners: realtors, loan officers and tax preparers who send people
// to Credalti. Pure rules here; the database is migration 0017 and the
// compliance text is copy.ts and docs/PARTNERS.md.
//
// A partner refers. They never see a referral's credit file, letters, score or
// payments: only a first name, a date and a coarse status (referralStatus).
// Commission terms are stored, and what is owed or paid is recorded by an
// administrator by hand. The app never pays anyone.

export const PARTNER_KINDS = ["realtor", "loan_officer", "tax_preparer", "other"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_KIND_LABEL: Record<"es" | "en", Record<PartnerKind, string>> = {
  es: { realtor: "Agente de bienes raíces", loan_officer: "Oficial de préstamos", tax_preparer: "Preparador de impuestos", other: "Otro" },
  en: { realtor: "Real estate agent", loan_officer: "Loan officer", tax_preparer: "Tax preparer", other: "Other" },
};

export const PARTNER_STATUSES = ["pending", "approved", "declined", "suspended"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  pending: "Por revisar",
  approved: "Aprobado",
  declined: "No aprobado",
  suspended: "Suspendido",
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

export const REFERRAL_STATUSES = ["contacted", "signed", "active", "not_continued"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_STATUS_LABEL: Record<"es" | "en", Record<ReferralStatus, string>> = {
  es: { contacted: "Contactado", signed: "Firmó", active: "Activo", not_continued: "No siguió" },
  en: { contacted: "Contacted", signed: "Signed", active: "Active", not_continued: "Did not continue" },
};

/**
 * The coarse status, from the console's record. The same rules as the
 * database function partner_referrals() (migration 0017): change both together.
 */
export function referralStatus(client: Pick<StaffClient, "agreementSignedAt" | "agreementCancelledAt" | "serviceEndRequestedAt" | "rounds"> & { lostAt?: string | null }): ReferralStatus {
  if (client.lostAt) return "not_continued";
  if (client.agreementCancelledAt || client.serviceEndRequestedAt) return "not_continued";
  if (client.agreementSignedAt && client.rounds.some((r) => Boolean(r.mailedAt))) return "active";
  if (client.agreementSignedAt) return "signed";
  return "contacted";
}

/** What the portal lists for one referral. Nothing else leaves the server. */
export interface PartnerReferral {
  id: string;
  firstName: string;
  lastInitial: string;
  referredAt: string;
  status: ReferralStatus;
}

/** A client as their partner may see them: first name, last initial, date, coarse status. */
export function referralView(client: StaffClient): PartnerReferral {
  return {
    id: client.id,
    firstName: client.firstName,
    lastInitial: client.lastName.slice(0, 1),
    referredAt: client.createdAt,
    status: referralStatus(client),
  };
}
