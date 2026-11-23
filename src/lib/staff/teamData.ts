import { getStaffData } from "./data";
import { can, deniedReason, isStaffRole, type Capability, type Viewer } from "./permissions";
import {
  addMember,
  assignmentProblem,
  changeRole,
  checkNewClient,
  findMember,
  prospectRecord,
  roundRobinNext,
  setAutoAssign,
  setMemberActive,
  SYSTEM_ACTOR,
  withAssignment,
  type NewClientField,
  type NewClientInput,
  type NewMemberInput,
  type TeamResult,
  type TeamState,
} from "./team";
import { demoTeamState, loadTeamActions, saveTeamActions } from "./teamStore";
import { canSeeClient } from "./permissions";
import { checkHouseholdMember, type HouseholdMember, type HouseholdMemberInput } from "../household/household";
import type { StaffClient, StaffRole } from "./types";

// What the team does about the team: the list of members and their roles,
// the round-robin setting, people added by hand and who works each client.
//
// Like StaffData, the pages know only this interface. The demo keeps it in the
// browser (teamStore.ts). The database version calls the staff routes
// (/api/staff/team, /api/staff/clients), which check the caller's role on the
// server. Every method checks the role here too, with the same matrix.

export type TeamActionResult = { ok: true } | { ok: false; message: string };

export type AddClientResult =
  | { ok: true; client: StaffClient }
  | { ok: false; message: string; problems?: Partial<Record<NewClientField, string>> };

export type AddHouseholdResult =
  | { ok: true; memberId: string; member: HouseholdMember }
  | { ok: false; message: string; problems?: Partial<Record<string, { en: string; es: string }>> };

export interface TeamData {
  readonly demo: boolean;
  load(): Promise<TeamState>;
  addMember(input: NewMemberInput, by: Viewer | null): Promise<TeamActionResult>;
  changeRole(handle: string, role: StaffRole, by: Viewer | null): Promise<TeamActionResult>;
  setActive(handle: string, active: boolean, by: Viewer | null): Promise<TeamActionResult>;
  setAutoAssign(on: boolean, by: Viewer | null): Promise<TeamActionResult>;
  /**
   * Add a person by hand, as a prospect. Sales can credit only themselves.
   * With the round-robin on, the next specialist gets them.
   */
  addClient(input: NewClientInput, by: Viewer | null): Promise<AddClientResult>;
  /**
   * Add a household member for a client or lead this member may see: a
   * person of their own (a lead with their own invitation), linked to the
   * first person as a household. Nothing of either case is shared.
   */
  addHouseholdMember(primary: StaffClient, input: HouseholdMemberInput, by: Viewer | null): Promise<AddHouseholdResult>;
  /** Give clients to a teammate, or to nobody (`to` null). */
  assignClients(clientIds: string[], to: string | null, by: Viewer | null): Promise<TeamActionResult & { count?: number }>;
}

const refused = (capability: Capability): TeamActionResult => ({ ok: false, message: deniedReason(capability) });

/** A new prospect's id in the demo: short, unique, never a real database id. */
const newId = (now: Date) => `n${now.getTime().toString(36)}`;

/** The demo's member for "Ver como": the one chosen, else the first active administrator. */
export function demoViewer(state: TeamState, viewAs: string): Viewer | null {
  const chosen = findMember(state.members, viewAs);
  const member = chosen?.active ? chosen : state.members.find((m) => m.active && m.role === "admin");
  return member ? { handle: member.handle, name: member.name, role: member.role } : null;
}

/** Demo only: show the console as the first active member with this role. */
export function demoViewAs(role: StaffRole): boolean {
  const state = demoTeamState();
  const member = state.members.find((m) => m.active && m.role === role);
  if (!member) return false;
  saveTeamActions({ ...loadTeamActions(), viewAs: member.handle });
  return true;
}

function createDemoTeamData(): TeamData {
  const commit = (result: TeamResult): TeamActionResult => {
    if (!result.ok) return result;
    saveTeamActions({ ...loadTeamActions(), team: result.state });
    return { ok: true };
  };
  const admin = (by: Viewer | null) => can(by?.role, "team.manage");

  return {
    demo: true,
    async load() {
      return demoTeamState();
    },
    async addMember(input, by) {
      if (!admin(by)) return refused("team.manage");
      return commit(addMember(demoTeamState(), input, by!.handle, new Date()));
    },
    async changeRole(handle, role, by) {
      if (!admin(by)) return refused("team.manage");
      return commit(changeRole(demoTeamState(), handle, role, by!.handle, new Date()));
    },
    async setActive(handle, active, by) {
      if (!admin(by)) return refused("team.manage");
      return commit(setMemberActive(demoTeamState(), handle, active, by!.handle, new Date()));
    },
    async setAutoAssign(on, by) {
      if (!admin(by)) return refused("team.manage");
      return commit(setAutoAssign(demoTeamState(), on, by!.handle, new Date()));
    },
    async addClient(input, by) {
      if (!can(by?.role, "clients.add")) return { ok: false, message: deniedReason("clients.add") };
      // Sales adds people for themselves; an administrator may credit any salesperson.
      const credited = by!.role === "sales" ? { ...input, salesperson: by!.handle } : input;
      const existing = await getStaffData().listClients();
      const check = checkNewClient(credited, existing);
      if (!check.ok) return { ok: false, message: "Revisa los datos marcados.", problems: check.problems };
      const now = new Date();
      const state = demoTeamState();
      let client = prospectRecord(newId(now), check.value, by!.handle, now);
      const actions = loadTeamActions();
      let team = actions.team;
      if (state.settings.autoAssign) {
        const next = roundRobinNext(state.members, state.settings.lastAutoAssigned);
        if (next) {
          client = withAssignment(client, next, SYSTEM_ACTOR, now.toISOString(), true);
          team = { ...state, settings: { ...state.settings, lastAutoAssigned: next } };
        }
      }
      saveTeamActions({ ...actions, team, added: [...actions.added, client] });
      return { ok: true, client };
    },
    async addHouseholdMember(primary, input, by) {
      if (!can(by?.role, "clients.add")) return { ok: false, message: deniedReason("clients.add") };
      if (!canSeeClient(by, primary)) return { ok: false, message: "Este cliente no está entre los tuyos." };
      if (primary.household) return { ok: false, message: "Esta persona ya tiene a alguien de su hogar. Un hogar son dos personas." };
      const existing = await getStaffData().listClients();
      const check = checkHouseholdMember(input, primary.phone, existing.map((c) => c.phone));
      if (!check.ok) return { ok: false, message: "Revisa los datos marcados.", problems: check.problems };
      const now = new Date();
      const m = check.value;
      const goal = primary.goal && ["mortgage", "auto", "card", "general"].includes(primary.goal) ? primary.goal : "general";
      const record = {
        ...prospectRecord(newId(now), { firstName: m.firstName, lastName: m.lastName, phone: m.phone, email: m.email, state: primary.state || "TX", goal, salesperson: primary.salesperson }, by!.handle, now),
        locale: m.locale,
        assignedTo: primary.assignedTo ?? null,
      };
      const actions = loadTeamActions();
      saveTeamActions({
        ...actions,
        added: [...actions.added, record],
        households: {
          ...(actions.households ?? {}),
          [primary.id]: { memberId: record.id, memberName: `${m.firstName} ${m.lastName}`, primaryName: primary.firstName, relationship: m.relationship },
        },
      });
      return { ok: true, memberId: record.id, member: m };
    },
    async assignClients(clientIds, to, by) {
      if (!can(by?.role, "clients.assign")) return refused("clients.assign");
      const problem = assignmentProblem(demoTeamState().members, to);
      if (problem) return { ok: false, message: problem };
      const clients = await getStaffData().listClients();
      const at = new Date().toISOString();
      const actions = loadTeamActions();
      const assignments = { ...actions.assignments };
      let count = 0;
      for (const id of new Set(clientIds)) {
        const client = clients.find((c) => c.id === id);
        if (!client || (client.assignedTo ?? null) === to) continue;
        assignments[id] = [...(assignments[id] ?? []), { at, to, by: by!.handle, auto: false }];
        count += 1;
      }
      saveTeamActions({ ...actions, assignments });
      return { ok: true, count };
    },
  };
}

// ── Database implementation ─────────────────────────────────────────────
//
// The routes check the caller's role on the server from staff_members; the
// `by` passed here is only for the demo and is ignored by them.

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "No pudimos conectar. Intenta de nuevo." } };
  }
}

const asResult = ({ ok, data }: { ok: boolean; data: Record<string, unknown> }): TeamActionResult =>
  ok ? { ok: true } : { ok: false, message: typeof data.message === "string" ? data.message : "No se pudo guardar. Intenta de nuevo." };

function createDatabaseTeamData(): TeamData {
  return {
    demo: false,
    async load() {
      const res = await fetch("/api/staff/team");
      if (!res.ok) throw new Error("No pudimos leer el equipo.");
      const body = (await res.json()) as { team: TeamState };
      return { ...body.team, members: body.team.members.filter((m) => isStaffRole(m.role)) };
    },
    addMember: async (input) => asResult(await post("/api/staff/team", { action: "add_member", ...input })),
    changeRole: async (handle, role) => asResult(await post("/api/staff/team", { action: "change_role", handle, role })),
    setActive: async (handle, active) => asResult(await post("/api/staff/team", { action: "set_active", handle, active })),
    setAutoAssign: async (on) => asResult(await post("/api/staff/team", { action: "set_auto_assign", on })),
    async addClient(input) {
      const res = await post("/api/staff/clients", { action: "add_prospect", ...input });
      if (res.ok) return { ok: true, client: res.data.client as StaffClient };
      return {
        ok: false,
        message: typeof res.data.message === "string" ? res.data.message : "No se pudo guardar. Intenta de nuevo.",
        problems: res.data.problems as Partial<Record<NewClientField, string>> | undefined,
      };
    },
    async addHouseholdMember(primary, input) {
      const res = await post("/api/staff/household", { primaryId: primary.id, ...input, email: input.email || null });
      if (res.ok) return { ok: true, memberId: String(res.data.prospectId), member: res.data.member as HouseholdMember };
      const message = res.data.message as { en?: string; es?: string } | string | undefined;
      return {
        ok: false,
        message: typeof message === "string" ? message : (message?.es ?? "No se pudo guardar. Intenta de nuevo."),
        problems: res.data.problems as Partial<Record<string, { en: string; es: string }>> | undefined,
      };
    },
    async assignClients(clientIds, to) {
      const res = await post("/api/staff/clients", { action: "assign", clientIds, to });
      return res.ok ? { ok: true, count: Number(res.data.count ?? 0) } : asResult(res);
    },
  };
}

const demoTeamData = createDemoTeamData();
let databaseTeamData: TeamData | null = null;

/** The team's data: the demo while the console's clients are invented, the database otherwise. */
export function getTeamData(): TeamData {
  if (getStaffData().demo) return demoTeamData;
  databaseTeamData ??= createDatabaseTeamData();
  return databaseTeamData;
}
