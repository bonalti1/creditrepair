import { buildDemoTeam, withAssignment, type TeamState } from "./team";
import type { ClientAssignment, StaffClient } from "./types";

// The demo's record of what the team did that is not about a client's case:
// changes to the team, people added by hand, assignments, who sent which
// round, and whose view the demo is showing. Kept in the browser under its own
// key, beside the demo's other actions (data.ts), and replayed over the
// invented clients the same way.

export interface DemoTeamActions {
  /** The team after changes made in the demo; null means the invented team as built. */
  team: TeamState | null;
  /** People added by hand, oldest first (whole records: they are not in the invented list). */
  added: StaffClient[];
  /** clientId → assignments made in the demo, oldest first. */
  assignments: Record<string, ClientAssignment[]>;
  /** clientId → round number → handle of the teammate who sent it. */
  sentBy: Record<string, Record<string, string>>;
  /** Handle of the teammate whose view the demo shows ("Ver como"). Empty: the first administrator. */
  viewAs: string;
}

export const EMPTY_TEAM_ACTIONS: DemoTeamActions = { team: null, added: [], assignments: {}, sentBy: {}, viewAs: "" };

/**
 * The clients with the demo's assignments and senders applied. People added by
 * hand are not added here: they join the invented list before the other
 * actions are replayed (data.ts). Pure: returns new objects.
 */
export function applyTeamActions(clients: StaffClient[], actions: DemoTeamActions): StaffClient[] {
  return clients.map((client) => {
    const assigned = (actions.assignments[client.id] ?? []).reduce(
      (current, entry) => withAssignment(current, entry.to, entry.by, entry.at, entry.auto),
      client,
    );
    const senders = actions.sentBy[client.id];
    if (!senders) return assigned;
    return {
      ...assigned,
      rounds: assigned.rounds.map((round) => {
        const by = senders[String(round.number)];
        return by && round.mailedAt ? { ...round, sentBy: by } : round;
      }),
    };
  });
}

const TEAM_KEY = "bonalti.staffDemo.team.v1";

let memory: DemoTeamActions | null = null;
let builtAt: Date | null = null;

export function loadTeamActions(): DemoTeamActions {
  if (memory) return memory;
  if (typeof window === "undefined") return structuredClone(EMPTY_TEAM_ACTIONS);
  try {
    const raw = window.localStorage.getItem(TEAM_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<DemoTeamActions>) : {};
    memory = {
      team: parsed.team ?? null,
      added: parsed.added ?? [],
      assignments: parsed.assignments ?? {},
      sentBy: parsed.sentBy ?? {},
      viewAs: parsed.viewAs ?? "",
    };
  } catch {
    memory = structuredClone(EMPTY_TEAM_ACTIONS);
  }
  return memory;
}

/** Keep the actions for this visit and, when the browser allows it, for the next. */
export function saveTeamActions(actions: DemoTeamActions): void {
  memory = actions;
  try {
    window.localStorage.setItem(TEAM_KEY, JSON.stringify(actions));
  } catch {
    // Storage unavailable: the actions last for this visit only.
  }
}

/** The team as the demo stands: the invented one, or the one after changes. */
export function demoTeamState(): TeamState {
  const actions = loadTeamActions();
  if (actions.team) return actions.team;
  builtAt ??= new Date();
  return buildDemoTeam(builtAt);
}

export function resetTeamActions(): void {
  memory = structuredClone(EMPTY_TEAM_ACTIONS);
  builtAt = null;
  try {
    window.localStorage.removeItem(TEAM_KEY);
  } catch {
    // ignore
  }
}
