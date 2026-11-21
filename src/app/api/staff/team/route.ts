import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { teamBodySchema } from "@/lib/staff/api";
import { can } from "@/lib/staff/permissions";
import { loadTeam } from "@/lib/staff/server";
import { addMember, changeRole, findMember, setAutoAssign, setMemberActive } from "@/lib/staff/team";

// The team list. Reading it: any active member (names and roles, for
// assigning and for the activity log); an administrator also gets contact
// details, open invitations' details and the record of changes. Changing it:
// administrators only, checked here from the caller's own row.
//
// The rules are the pure ones in src/lib/staff/team.ts (the last active
// administrator stays, nobody deactivates themselves, one person is not added
// twice), applied to the team as the database has it. Nobody is deleted:
// a member is deactivated, an invitation revoked. Every change is written to
// team_audit, which cannot be edited.

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-team-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("clients.followup");
  // Every role has follow-up; this is the "any active member" check.
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  try {
    const admin = can(member.role, "team.manage");
    const { state } = await loadTeam(db, { events: admin });
    const members = admin ? state.members : state.members.map((m) => ({ ...m, email: null, phone: null }));
    return NextResponse.json({ team: { ...state, members }, viewer: { handle: member.handle, name: member.name, role: member.role } });
  } catch (error) {
    await reportError(error, { where: "api/staff/team", userId: member.userId });
    return NextResponse.json({ error: "Could not read the team." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-team", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("team.manage");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = teamBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const now = new Date();

  try {
    const { state, records } = await loadTeam(db);
    const refuse = (message: string) => NextResponse.json({ error: "Not allowed", message }, { status: 409 });
    const audit = (row: Record<string, unknown>) => db.from("team_audit").insert({ actor: member.userId, ...row });

    if (input.action === "add_member") {
      const result = addMember(state, input, member.handle, now);
      if (!result.ok || !result.member) return refuse(result.ok ? "No se pudo agregar." : result.message);
      const added = result.member;
      const { error } = await db.from("staff_invitations").insert({
        display_name: added.name,
        handle: added.handle,
        role: added.role,
        email: added.email,
        phone_e164: added.phone,
        invited_by: member.userId,
      });
      if (error) throw new Error(error.message);
      await audit({ kind: "member_invited", member_handle: added.handle, to_role: added.role });
      return NextResponse.json({ ok: true, member: added });
    }

    if (input.action === "change_role") {
      const before = findMember(state.members, input.handle);
      const result = changeRole(state, input.handle, input.role, member.handle, now);
      if (!result.ok) return refuse(result.message);
      const record = records.get(input.handle)!;
      const { error } = record.userId
        ? await db.from("staff_members").update({ role: input.role }).eq("user_id", record.userId)
        : await db.from("staff_invitations").update({ role: input.role }).eq("id", record.invitationId!);
      if (error) throw new Error(error.message);
      if (before && before.role !== input.role) {
        await audit({ kind: "role_changed", member: record.userId, member_handle: input.handle, from_role: before.role, to_role: input.role });
      }
      return NextResponse.json({ ok: true });
    }

    if (input.action === "set_active") {
      const before = findMember(state.members, input.handle);
      const result = setMemberActive(state, input.handle, input.active, member.handle, now);
      if (!result.ok) return refuse(result.message);
      if (before && before.active !== input.active) {
        const record = records.get(input.handle)!;
        // The database dates a deactivation itself (migration 0012); an invitation is revoked instead.
        const { error } = record.userId
          ? await db.from("staff_members").update({ active: input.active }).eq("user_id", record.userId)
          : await db.from("staff_invitations").update({ revoked_at: input.active ? null : now.toISOString() }).eq("id", record.invitationId!);
        if (error) throw new Error(error.message);
        await audit({ kind: input.active ? "member_reactivated" : "member_deactivated", member: record.userId, member_handle: input.handle });
      }
      return NextResponse.json({ ok: true });
    }

    const result = setAutoAssign(state, input.on, member.handle, now);
    if (!result.ok) return refuse(result.message);
    if (state.settings.autoAssign !== input.on) {
      const { error } = await db
        .from("team_settings")
        .update({ auto_assign: input.on, updated_at: now.toISOString(), updated_by: member.userId })
        .eq("id", true);
      if (error) throw new Error(error.message);
      await audit({ kind: "auto_assign_changed", detail: { on: input.on } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: "api/staff/team", userId: member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
