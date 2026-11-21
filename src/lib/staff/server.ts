import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaffRole } from "./permissions";
import type { TeamEvent, TeamMember, TeamState } from "./team";

// Reading the team from the database, for the staff routes (service role).
// The rows become the same TeamState the pure rules in team.ts work on, so a
// rule is checked the same way in the demo and on the server.

type Row = Record<string, unknown>;

export interface LoadedTeam {
  state: TeamState;
  /** handle → where the person is recorded: a member's user id, or an open invitation's id. */
  records: Map<string, { userId: string | null; invitationId: string | null }>;
  /** user id → handle, for reading assignments and the audit. */
  handleOf: Map<string, string>;
}

const TEAM_EVENT_KINDS = new Set(["role_changed", "member_deactivated", "member_reactivated", "auto_assign_changed"]);

export async function loadTeam(db: SupabaseClient, options: { events?: boolean } = {}): Promise<LoadedTeam> {
  const [members, invitations, settings] = await Promise.all([
    db.from("staff_members").select("user_id, role, handle, display_name, email, phone_e164, active, invited_at, invited_by, deactivated_at"),
    db.from("staff_invitations").select("id, handle, display_name, role, email, phone_e164, invited_at, invited_by, revoked_at").is("accepted_at", null),
    db.from("team_settings").select("auto_assign, last_auto_assigned").eq("id", true).maybeSingle(),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (invitations.error) throw new Error(invitations.error.message);

  const handleOf = new Map<string, string>();
  const records: LoadedTeam["records"] = new Map();
  const list: TeamMember[] = [];
  for (const row of (members.data ?? []) as Row[]) {
    if (!isStaffRole(row.role)) continue;
    const userId = row.user_id as string;
    const handle = (row.handle as string | null) ?? userId.slice(0, 8);
    handleOf.set(userId, handle);
    records.set(handle, { userId, invitationId: null });
    list.push({
      handle,
      name: (row.display_name as string) || handle,
      role: row.role,
      email: (row.email as string | null) ?? null,
      phone: (row.phone_e164 as string | null) ?? null,
      active: Boolean(row.active),
      invitedAt: row.invited_at as string,
      invitedBy: null,
      deactivatedAt: (row.deactivated_at as string | null) ?? null,
    });
  }
  for (const member of list) {
    const row = ((members.data ?? []) as Row[]).find((r) => handleOf.get(r.user_id as string) === member.handle);
    member.invitedBy = row?.invited_by ? (handleOf.get(row.invited_by as string) ?? null) : null;
  }
  for (const row of (invitations.data ?? []) as Row[]) {
    if (!isStaffRole(row.role)) continue;
    const handle = row.handle as string;
    records.set(handle, { userId: null, invitationId: row.id as string });
    list.push({
      handle,
      name: row.display_name as string,
      role: row.role,
      email: (row.email as string | null) ?? null,
      phone: (row.phone_e164 as string | null) ?? null,
      active: !row.revoked_at,
      invitedAt: row.invited_at as string,
      invitedBy: row.invited_by ? (handleOf.get(row.invited_by as string) ?? null) : null,
      deactivatedAt: (row.revoked_at as string | null) ?? null,
      pending: true,
    });
  }

  let events: TeamEvent[] = [];
  if (options.events) {
    const { data } = await db.from("team_audit").select("id, at, actor, kind, member_handle, from_role, to_role, detail").order("at", { ascending: false }).limit(200);
    events = ((data ?? []) as Row[])
      .filter((row) => TEAM_EVENT_KINDS.has(row.kind as string) || row.kind === "member_invited")
      .map((row) => ({
        id: row.id as string,
        at: row.at as string,
        by: row.actor ? (handleOf.get(row.actor as string) ?? "equipo") : "sistema",
        kind: row.kind === "member_invited" ? "member_added" : (row.kind as TeamEvent["kind"]),
        member: (row.member_handle as string | null) ?? undefined,
        from: isStaffRole(row.from_role) ? row.from_role : undefined,
        to: isStaffRole(row.to_role) ? row.to_role : undefined,
        on: typeof (row.detail as Row | null)?.on === "boolean" ? ((row.detail as Row).on as boolean) : undefined,
      }))
      .reverse();
  }

  const last = settings.data?.last_auto_assigned as string | null | undefined;
  return {
    state: {
      members: list,
      settings: { autoAssign: Boolean(settings.data?.auto_assign), lastAutoAssigned: last ? (handleOf.get(last) ?? null) : null },
      events,
    },
    records,
    handleOf,
  };
}
