import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStaffMember } from "../staff/access";
import { getAdminClient } from "../supabase/admin";
import { getServerSupabase } from "../supabase/server";
import { COMMISSION_BASES, PARTNER_KINDS, PARTNER_STATUSES, type CommissionBasis, type CommissionRecord, type Partner, type PartnerKind, type PartnerStatus } from "./rules";

// Partners on the server: who is signed in as a partner, and rows → records.
//
// A partner signs in like everyone (phone code or email link). The first time,
// an APPROVED partner whose phone or email matches the verified sign-in becomes
// a partner_members row (like a staff invitation, staff/access.ts). A member
// of staff is never a partner. Everything a partner reads goes through their
// OWN connection, so the policies of migration 0017 decide: their own partner
// row, their own commission records, and partner_referrals().

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function partnerFromRow(row: Row): Partner {
  const kind = String(row.kind);
  const status = String(row.status);
  const basis = String(row.commission_basis ?? "none");
  return {
    id: String(row.id),
    name: String(row.name),
    company: str(row.company),
    kind: ((PARTNER_KINDS as readonly string[]).includes(kind) ? kind : "other") as PartnerKind,
    phone: String(row.phone_e164 ?? ""),
    email: str(row.email),
    state: str(row.state),
    status: ((PARTNER_STATUSES as readonly string[]).includes(status) ? status : "pending") as PartnerStatus,
    referralCode: str(row.referral_code),
    salesperson: str(row.salesperson),
    commissionBasis: ((COMMISSION_BASES as readonly string[]).includes(basis) ? basis : "none") as CommissionBasis,
    commissionCents: Number(row.commission_cents ?? 0),
    commissionNote: str(row.commission_note),
    appliedAt: String(row.applied_at ?? ""),
    decidedAt: str(row.decided_at),
    logoStatus: (["pending", "approved", "rejected"].includes(String(row.logo_status)) ? row.logo_status : "none") as Partner["logoStatus"],
    logo: str(row.logo_data),
    locale: row.locale === "es" ? "es" : "en",
  };
}

export function commissionFromRow(row: Row, handleOf: Map<string, string> = new Map()): CommissionRecord {
  return {
    id: String(row.id),
    partnerId: String(row.partner_id),
    kind: row.kind === "paid" ? "paid" : "owed",
    amountCents: Number(row.amount_cents),
    referralId: str(row.referral_id),
    note: str(row.note),
    recordedAt: String(row.recorded_at),
    recordedBy: str(row.recorded_by_name) ?? (row.recorded_by ? (handleOf.get(String(row.recorded_by)) ?? "equipo") : "equipo"),
  };
}

export interface PartnerMember {
  userId: string;
  partner: Partner;
}

/**
 * The signed-in, approved partner, or null (signed out, not a partner, not
 * approved yet, suspended, staff, demo). Claims the membership on first sign-in.
 */
export async function getPartnerMember(): Promise<PartnerMember | null> {
  const reader = await getServerSupabase();
  if (!reader) return null;
  try {
    const { data: auth } = await reader.auth.getUser();
    const user = auth.user;
    if (!user) return null;
    let { data: membership } = await reader.from("partner_members").select("partner_id").eq("user_id", user.id).maybeSingle();
    if (!membership) {
      if (await getStaffMember()) return null;
      if (!(await claimPartnership(user))) return null;
      ({ data: membership } = await reader.from("partner_members").select("partner_id").eq("user_id", user.id).maybeSingle());
      if (!membership) return null;
    }
    // Through the partner's own connection: the policy returns the row only while it is approved.
    const { data: row } = await reader.from("partners").select("*").eq("id", membership.partner_id).eq("status", "approved").maybeSingle();
    return row ? { userId: user.id, partner: partnerFromRow(row as Row) } : null;
  } catch {
    return null;
  }
}

/** Is there a partner application (any status) for this sign-in? For the portal's "not approved yet" message. */
export async function hasPartnerApplication(user: { email?: string | null; phone?: string | null }): Promise<boolean> {
  const db = getAdminClient();
  if (!db) return false;
  const filters = contactFilters(user);
  if (!filters) return false;
  const { data } = await db.from("partners").select("id").or(filters).limit(1);
  return ((data as Row[] | null) ?? []).length > 0;
}

function contactFilters(user: { email?: string | null; phone?: string | null }): string | null {
  const email = user.email?.toLowerCase() ?? null;
  // Supabase stores a phone without the "+".
  const phone = user.phone ? `+${user.phone.replace(/^\+/, "")}` : null;
  if (!email && !phone) return null;
  return [email ? `email.eq.${email}` : null, phone ? `phone_e164.eq.${phone}` : null].filter(Boolean).join(",");
}

/** An approved partner with this verified phone or email and no sign-in yet becomes this user's. Service role. */
async function claimPartnership(user: { id: string; email?: string | null; phone?: string | null }): Promise<boolean> {
  const db = getAdminClient();
  if (!db) return false;
  const filters = contactFilters(user);
  if (!filters) return false;
  const { data: candidates } = await db.from("partners").select("id").eq("status", "approved").or(filters).limit(5);
  for (const candidate of (candidates as Row[] | null) ?? []) {
    const { data: taken } = await db.from("partner_members").select("user_id").eq("partner_id", candidate.id).maybeSingle();
    if (taken) continue;
    const { error } = await db.from("partner_members").insert({ user_id: user.id, partner_id: candidate.id });
    if (!error) return true;
  }
  return false;
}

export type PartnerCheck =
  | { ok: true; member: PartnerMember; reader: SupabaseClient; db: SupabaseClient }
  | { ok: false; response: NextResponse };

/** For a partner API route: the signed-in approved partner, their own connection and the service role. */
export async function requirePartner(): Promise<PartnerCheck> {
  const db = getAdminClient();
  const reader = await getServerSupabase();
  if (!db || !reader) return { ok: false, response: NextResponse.json({ error: "Supabase not configured" }, { status: 503 }) };
  const member = await getPartnerMember();
  if (!member) return { ok: false, response: NextResponse.json({ error: "Partners only" }, { status: 403 }) };
  return { ok: true, member, reader, db };
}
