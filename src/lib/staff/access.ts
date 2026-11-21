import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "../supabase/admin";
import { getServerSupabase } from "../supabase/server";
import { can, deniedReason, isStaffRole, type Capability } from "./permissions";
import type { StaffRole } from "./types";

// Who may open the staff console.
//
// Demo (Supabase not configured): open to anyone, like the rest of the demo.
// Configured: only a signed-in, active member of staff (staff_members, checked
// by the is_staff() database function from migration 0007). The proxy already
// sends signed-out visitors to the login page; this is the second check, for
// signed-in customers who type the address.
//
// Anything unexpected (function missing, network error) counts as "denied":
// the console fails closed.

export type StaffAccess = "demo" | "allowed" | "denied";

export async function getStaffAccess(): Promise<StaffAccess> {
  const supabase = await getServerSupabase();
  if (!supabase) return "demo";
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return "denied";
    const { data, error } = await supabase.rpc("is_staff");
    return !error && data === true ? "allowed" : "denied";
  } catch {
    return "denied";
  }
}

// ── Who is signed in, and what their role allows ────────────────────────
//
// Every staff API route asks requireCapability before doing anything: the
// screen may hide a button, but the route decides. The role comes from the
// member's own row (the "own staff row" policy), never from the request.

/** The signed-in member of staff, as the routes and the console's shell need them. */
export interface StaffMember {
  userId: string;
  handle: string;
  name: string;
  role: StaffRole;
}

/**
 * The signed-in, active member of staff, or null (signed out, not staff,
 * deactivated, demo). Someone the team invited who signs in for the first time
 * with that email or phone becomes a member here.
 */
export async function getStaffMember(): Promise<StaffMember | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    const { data } = await supabase
      .from("staff_members")
      .select("user_id, role, handle, display_name, active")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const row = data ?? (await claimInvitation(auth.user));
    if (!row || !row.active || !isStaffRole(row.role)) return null;
    return { userId: row.user_id, handle: row.handle ?? row.user_id.slice(0, 8), name: row.display_name || row.handle || "Equipo", role: row.role };
  } catch {
    return null;
  }
}

interface MemberRow {
  user_id: string;
  role: string;
  handle: string | null;
  display_name: string;
  active: boolean;
}

/** An open invitation for this person's email or phone becomes their staff_members row. Server only. */
async function claimInvitation(user: { id: string; email?: string | null; phone?: string | null }): Promise<MemberRow | null> {
  const db = getAdminClient();
  if (!db) return null;
  const email = user.email?.toLowerCase() ?? null;
  // Supabase stores a phone without the "+".
  const phone = user.phone ? `+${user.phone.replace(/^\+/, "")}` : null;
  if (!email && !phone) return null;
  const filters = [email ? `email.eq.${email}` : null, phone ? `phone_e164.eq.${phone}` : null].filter(Boolean).join(",");
  const { data: invitation } = await db
    .from("staff_invitations")
    .select("*")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .or(filters)
    .order("invited_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invitation) return null;
  const row = {
    user_id: user.id,
    role: invitation.role as string,
    handle: invitation.handle as string,
    display_name: invitation.display_name as string,
    email: invitation.email as string | null,
    phone_e164: invitation.phone_e164 as string | null,
    invited_at: invitation.invited_at as string,
    invited_by: invitation.invited_by as string | null,
    active: true,
  };
  const { error } = await db.from("staff_members").insert(row);
  if (error) return null;
  await db.from("staff_invitations").update({ accepted_by: user.id, accepted_at: new Date().toISOString() }).eq("id", invitation.id);
  await db.from("team_audit").insert({ actor: user.id, kind: "member_joined", member: user.id, member_handle: row.handle, to_role: row.role });
  return row;
}

export type CapabilityCheck =
  | { ok: true; member: StaffMember; db: SupabaseClient }
  | { ok: false; response: NextResponse };

/**
 * For a staff API route: the signed-in member and the service-role client,
 * when their role may do this. Otherwise the response to send: 503 in the demo
 * (no database), 403 for anyone who is not active staff or whose role may not.
 */
export async function requireCapability(capability: Capability): Promise<CapabilityCheck> {
  const db = getAdminClient();
  if (!db || !(await getServerSupabase())) {
    return { ok: false, response: NextResponse.json({ error: "Supabase not configured" }, { status: 503 }) };
  }
  const member = await getStaffMember();
  if (!member) return { ok: false, response: NextResponse.json({ error: "Staff only" }, { status: 403 }) };
  if (!can(member.role, capability)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not allowed for this role", code: "forbidden_for_role", message: deniedReason(capability) }, { status: 403 }),
    };
  }
  return { ok: true, member, db };
}
