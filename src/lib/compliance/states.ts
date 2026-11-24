import { STATE_LAW, type StateRule } from "./stateRules";

// Where Credalti sells. Expansion is a LEGAL decision carried out as a
// switch: the law per state is researched in stateRules.ts (the checklist),
// counsel clears a state, and an administrator opens it in /equipo/estados
// (state_openings, migration 0030), recording the attorney and the date.
// Every lead, invitation and signup asks this file, with the opened list:
// a state not opened is told politely that we are not there yet and offered
// the waitlist (the onboarding state step, the invite page, the HighLevel
// webhook, /api/profile/onboarding, the agreement routes).
//
// Without a database (the demo) and until the table is read, Texas is the
// one open state: the launch state (Phase 0).

export type StateStatus = "open" | "waitlist" | "blocked";

/** The launch state(s), open until the database says otherwise. */
export const DEFAULT_OPEN_STATES: readonly string[] = ["TX"];

export const ALL_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY",
] as const;

export type StateCode = (typeof ALL_STATES)[number];

export function isStateCode(code: unknown): code is StateCode {
  return typeof code === "string" && (ALL_STATES as readonly string[]).includes(code.toUpperCase());
}

/** A state's research entry (stateRules.ts). */
export function stateLaw(code: string): StateRule | null {
  return STATE_LAW[code.toUpperCase()] ?? null;
}

/**
 * Whether Credalti takes people from this state now. "blocked": the law
 * restricts it (stateRules.ts: restricted), whatever was switched; "open":
 * opened; "waitlist": everything else.
 */
export function stateStatus(code: string, opened: Iterable<string> = DEFAULT_OPEN_STATES): StateStatus {
  const c = code.toUpperCase();
  if (STATE_LAW[c]?.status === "restricted") return "blocked";
  return new Set(opened).has(c) && isStateCode(c) ? "open" : "waitlist";
}

export function isStateOpen(code: string | null | undefined, opened: Iterable<string> = DEFAULT_OPEN_STATES): boolean {
  return Boolean(code) && stateStatus(code!, opened) === "open";
}

export function openStates(opened: Iterable<string> = DEFAULT_OPEN_STATES): string[] {
  const set = new Set(opened);
  return ALL_STATES.filter((s) => stateStatus(s, set) === "open");
}

export interface OpeningRequest {
  state: string;
  opened: boolean;
  attorneyName?: string | null;
  /** ISO date (YYYY-MM-DD). */
  attorneyReviewedOn?: string | null;
  /** The state's registration or license number, when the law asks for one. */
  registrationRef?: string | null;
  /** The person confirms the bond (when the law asks for one) is in force. */
  bondConfirmed?: boolean;
}

/**
 * Why a state cannot be opened as asked, or [] when it can. Closing is always
 * allowed. Opening needs: a known state that the law does not restrict, the
 * attorney's name and review date, the registration reference when the law
 * asks for one, and the bond confirmed when it asks for one. (The agreement
 * still cannot be signed there until its state documents exist and are
 * approved: agreement/stateDocuments.ts.)
 */
export function openingProblems(req: OpeningRequest, today: Date = new Date()): string[] {
  if (!req.opened) return [];
  const code = req.state.toUpperCase();
  if (!isStateCode(code)) return ["unknown_state"];
  const law = STATE_LAW[code];
  const problems: string[] = [];
  if (!law || law.status === "not_reviewed") problems.push("not_reviewed");
  if (law?.status === "restricted") problems.push("restricted");
  if (!req.attorneyName || req.attorneyName.trim().length < 3) problems.push("attorney_name");
  const reviewed = req.attorneyReviewedOn ? Date.parse(`${req.attorneyReviewedOn}T12:00:00Z`) : Number.NaN;
  if (!Number.isFinite(reviewed) || reviewed > today.getTime() + 24 * 60 * 60 * 1000) problems.push("attorney_date");
  if (law?.registration.required && !(req.registrationRef && req.registrationRef.trim().length >= 2)) problems.push("registration_ref");
  if (law?.bond && !req.bondConfirmed) problems.push("bond");
  return problems;
}

/** The checklist's status label. */
export const LAW_STATUS_LABEL = {
  en: { open: "No state registration found", registration: "Registration / bond needed", restricted: "Restricted", not_reviewed: "Not reviewed" },
  es: { open: "Sin registro estatal encontrado", registration: "Requiere registro / fianza", restricted: "Restringido", not_reviewed: "Sin revisar" },
} as const;

/** What a person from a state we have not opened reads. Polite, no pressure, no promise of a date. */
export const NOT_OPEN_COPY = {
  en: {
    title: (state: string) => `We are not in ${state} yet`,
    body: "Each state has its own rules for credit services, and we open a state only once we meet them. Leave your email and we will write to you when we open there. Nothing else is done with it.",
    blocked: "The law in this state restricts credit services companies like ours, so we cannot offer the service there.",
  },
  es: {
    title: (state: string) => `Todavía no estamos en ${state}`,
    body: "Cada estado tiene sus propias reglas para los servicios de crédito, y abrimos un estado solo cuando las cumplimos. Déjanos tu correo y te escribimos cuando abramos ahí. No se usa para nada más.",
    blocked: "La ley de este estado restringe a las empresas de servicios de crédito como la nuestra, así que no podemos ofrecer el servicio ahí.",
  },
} as const;
