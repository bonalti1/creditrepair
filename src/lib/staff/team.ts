import { ALL_STATES } from "../compliance/states";
import { NO_BILLING } from "../billing/types";
import { GOALS, toRefSlug } from "../sales/invite";
import { isStaffRole, ROLE_LABELS } from "./permissions";
import { type StaffLocale, staffLocaleFallback } from "./i18n/locale";
import type { ClientAssignment, StaffClient, StaffRole } from "./types";

// The team: who is on it, with which role, and the rules for changing that.
// Also the two things the team does to a client's record that are not about
// the client's case: adding a person by hand, and assigning them to a teammate.
//
// Everything here is pure: it takes the state and returns the next state, or a
// plain reason why not. The demo store (teamData.ts) and the server route
// (/api/staff/team) both call these, so a rule is written once.
//
// Nobody is ever deleted. A member who leaves is deactivated: they lose access
// at once (is_staff() counts active members only) and their name stays on
// everything they did.

export interface TeamMember {
  /** Lowercase, unique, never reused: the handle sales links carry (profiles.referred_by). */
  handle: string;
  name: string;
  role: StaffRole;
  email: string | null;
  /** E.164. */
  phone: string | null;
  active: boolean;
  invitedAt: string;
  /** Handle of the admin who added them; null for the first member. */
  invitedBy: string | null;
  deactivatedAt: string | null;
  /** True while they have not signed in for the first time (an open invitation). */
  pending?: boolean;
}

export interface TeamSettings {
  /** Give each new client to the next active specialist, in turn. */
  autoAssign: boolean;
  /** The specialist the round-robin gave the last client to. */
  lastAutoAssigned: string | null;
}

export type TeamEventKind = "member_added" | "role_changed" | "member_deactivated" | "member_reactivated" | "auto_assign_changed";

/** One change to the team, kept for the activity log (team_audit in the database). */
export interface TeamEvent {
  id: string;
  at: string;
  /** Handle of the admin who made the change. */
  by: string;
  kind: TeamEventKind;
  /** The member it was about. */
  member?: string;
  from?: StaffRole;
  to?: StaffRole;
  /** For auto_assign_changed: the new setting. */
  on?: boolean;
}

export interface TeamState {
  members: TeamMember[];
  settings: TeamSettings;
  /** Oldest first. */
  events: TeamEvent[];
}

export type TeamResult = { ok: true; state: TeamState } | { ok: false; message: string };

/** The actor recorded when the system itself assigns a client. */
export const SYSTEM_ACTOR = "sistema";

// ── Reading the team ────────────────────────────────────────────────────

export function findMember(members: TeamMember[], handle: string | null | undefined): TeamMember | null {
  return handle ? (members.find((m) => m.handle === handle) ?? null) : null;
}

/** A member's name, or the handle as recorded when nobody on the team has it (an old record). */
export function memberName(members: TeamMember[], handle: string | null | undefined, locale: StaffLocale = staffLocaleFallback()): string {
  if (!handle) return "";
  if (handle === SYSTEM_ACTOR) return locale === "es" ? "El sistema" : "The system";
  return findMember(members, handle)?.name ?? handle;
}

export function activeMembers(members: TeamMember[]): TeamMember[] {
  return members.filter((m) => m.active);
}

/** Who a client can be given to: active administrators and specialists. */
export function assignableMembers(members: TeamMember[]): TeamMember[] {
  return members.filter((m) => m.active && (m.role === "admin" || m.role === "specialist"));
}

function activeAdmins(members: TeamMember[]): TeamMember[] {
  return members.filter((m) => m.active && m.role === "admin");
}

// ── Contact details ─────────────────────────────────────────────────────

/** "Ana@Example.com " → "ana@example.com"; null when it is not an email address. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(email) ? email : null;
}

/** "(713) 555-0142" → "+17135550142"; null unless it is a 10-digit US number (with or without the 1). */
export function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(local) ? `+1${local}` : null;
}

/** Letters (any alphabet), spaces, apostrophes and hyphens; 2 to 80 characters once tidied. */
export function cleanPersonName(value: string | null | undefined, max = 80): string | null {
  const name = (value ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > max) return null;
  return /^[\p{L}][\p{L}\s'.-]*$/u.test(name) ? name : null;
}

/** A handle from a name that no one has used: "Ana Prieto" → "ana", then "ana-prieto", then "ana-2". */
export function newHandle(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const first = toRefSlug(name.split(" ")[0]) ?? "miembro";
  const full = toRefSlug(name) ?? first;
  for (const candidate of [first, full]) if (!used.has(candidate)) return candidate;
  for (let n = 2; ; n += 1) {
    const candidate = `${first}-${n}`.slice(0, 30);
    if (!used.has(candidate)) return candidate;
  }
}

// ── Changing the team ───────────────────────────────────────────────────

export interface NewMemberInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
}

const eventId = (state: TeamState, at: string) => `te-${state.events.length + 1}-${at}`;

function withEvent(state: TeamState, event: Omit<TeamEvent, "id">, change: Partial<TeamState>): TeamState {
  return { ...state, ...change, events: [...state.events, { id: eventId(state, event.at), ...event }] };
}

/**
 * Add someone to the team. They sign in with the email or phone given here;
 * until they do, the database keeps an invitation (staff_invitations).
 */
export function addMember(state: TeamState, input: NewMemberInput, by: string, now: Date): TeamResult & { member?: TeamMember } {
  const name = cleanPersonName(input.name);
  if (!name) return { ok: false, message: "Escribe el nombre de la persona (solo letras)." };
  if (!isStaffRole(input.role)) return { ok: false, message: "Elige un rol." };
  const rawEmail = (input.email ?? "").trim();
  const rawPhone = (input.phone ?? "").trim();
  if (!rawEmail && !rawPhone) return { ok: false, message: "Escribe su correo o su teléfono: con eso entra a la consola." };
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) return { ok: false, message: "Ese correo no parece válido." };
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, message: "Ese teléfono no parece válido. Usa 10 dígitos de EE. UU." };
  // Deactivated members count too: a person is reactivated, not added twice.
  const same = state.members.find((m) => (email && m.email === email) || (phone && m.phone === phone));
  if (same) {
    return {
      ok: false,
      message: same.active
        ? `${same.name} ya está en el equipo con ese ${email && same.email === email ? "correo" : "teléfono"}.`
        : `${same.name} ya estuvo en el equipo con ese ${email && same.email === email ? "correo" : "teléfono"}. Reactívala en lugar de agregarla de nuevo.`,
    };
  }
  const at = now.toISOString();
  const member: TeamMember = {
    handle: newHandle(name, state.members.map((m) => m.handle)),
    name,
    role: input.role,
    email,
    phone,
    active: true,
    invitedAt: at,
    invitedBy: by,
    deactivatedAt: null,
    pending: true,
  };
  const next = withEvent(state, { at, by, kind: "member_added", member: member.handle, to: member.role }, { members: [...state.members, member] });
  return { ok: true, state: next, member };
}

/** Give a member another role. The team always keeps at least one active administrator. */
export function changeRole(state: TeamState, handle: string, role: string, by: string, now: Date): TeamResult {
  const member = findMember(state.members, handle);
  if (!member) return { ok: false, message: "No encontramos a esa persona en el equipo." };
  if (!isStaffRole(role)) return { ok: false, message: "Elige un rol." };
  if (member.role === role) return { ok: true, state };
  if (member.active && member.role === "admin" && activeAdmins(state.members).length === 1) {
    return { ok: false, message: `${member.name} es la única persona administradora. Nombra a otra antes de cambiar su rol.` };
  }
  const members = state.members.map((m) => (m.handle === handle ? { ...m, role } : m));
  return { ok: true, state: withEvent(state, { at: now.toISOString(), by, kind: "role_changed", member: handle, from: member.role, to: role }, { members }) };
}

/**
 * Deactivate a member (they lose access at once, their name stays on their
 * work) or bring them back. Nobody deactivates themselves, and the last
 * active administrator cannot be deactivated.
 */
export function setMemberActive(state: TeamState, handle: string, active: boolean, by: string, now: Date): TeamResult {
  const member = findMember(state.members, handle);
  if (!member) return { ok: false, message: "No encontramos a esa persona en el equipo." };
  if (member.active === active) return { ok: true, state };
  if (!active && handle === by) return { ok: false, message: "No puedes desactivar tu propia cuenta. Pídeselo a otra persona administradora." };
  if (!active && member.role === "admin" && activeAdmins(state.members).length === 1) {
    return { ok: false, message: `${member.name} es la única persona administradora. Nombra a otra antes de desactivarla.` };
  }
  const at = now.toISOString();
  const members = state.members.map((m) => (m.handle === handle ? { ...m, active, deactivatedAt: active ? null : at } : m));
  return {
    ok: true,
    state: withEvent(state, { at, by, kind: active ? "member_reactivated" : "member_deactivated", member: handle }, { members }),
  };
}

export function setAutoAssign(state: TeamState, on: boolean, by: string, now: Date): TeamResult {
  if (state.settings.autoAssign === on) return { ok: true, state };
  return {
    ok: true,
    state: withEvent(state, { at: now.toISOString(), by, kind: "auto_assign_changed", on }, { settings: { ...state.settings, autoAssign: on } }),
  };
}

/** "Carmen changed Luis's role: Sales → Specialist" / "Carmen cambió el rol de Luis: Ventas → Especialista." */
export function teamEventText(event: TeamEvent, members: TeamMember[], locale: StaffLocale = staffLocaleFallback()): string {
  const who = memberName(members, event.by, locale);
  const whom = memberName(members, event.member, locale);
  const ROLE_LABEL = ROLE_LABELS[locale];
  if (locale === "en") {
    switch (event.kind) {
      case "member_added":
        return `${who} added ${whom} to the team as ${event.to ? ROLE_LABEL[event.to].toLowerCase() : "a member"}`;
      case "role_changed":
        return `${who} changed ${whom}'s role: ${event.from ? ROLE_LABEL[event.from] : "?"} → ${event.to ? ROLE_LABEL[event.to] : "?"}`;
      case "member_deactivated":
        return `${who} deactivated ${whom}. They can't sign in to the console anymore; their name stays on their work`;
      case "member_reactivated":
        return `${who} reactivated ${whom}`;
      case "auto_assign_changed":
        return `${who} turned ${event.on ? "on" : "off"} automatic assignment of new clients`;
    }
  }
  switch (event.kind) {
    case "member_added":
      return `${who} agregó a ${whom} al equipo como ${event.to ? ROLE_LABEL[event.to].toLowerCase() : "miembro"}`;
    case "role_changed":
      return `${who} cambió el rol de ${whom}: ${event.from ? ROLE_LABEL[event.from] : "?"} → ${event.to ? ROLE_LABEL[event.to] : "?"}`;
    case "member_deactivated":
      return `${who} desactivó a ${whom}. Ya no entra a la consola; su nombre queda en su trabajo`;
    case "member_reactivated":
      return `${who} reactivó a ${whom}`;
    case "auto_assign_changed":
      return `${who} ${event.on ? "activó" : "apagó"} la asignación automática de clientes nuevos`;
  }
}

// ── Assignment ──────────────────────────────────────────────────────────

/**
 * The next specialist in turn: active specialists in the order they joined,
 * starting after the one who got the last client. Null when there is none.
 * With `role: "sales"`, the same turn among active salespeople (a lead from
 * HighLevel or a partner that names nobody: src/lib/highlevel/assign.ts).
 */
export function roundRobinNext(members: TeamMember[], last: string | null, role: StaffRole = "specialist"): string | null {
  const specialists = members
    .filter((m) => m.active && m.role === role)
    .sort((a, b) => a.invitedAt.localeCompare(b.invitedAt) || a.handle.localeCompare(b.handle));
  if (specialists.length === 0) return null;
  const index = specialists.findIndex((m) => m.handle === last);
  return specialists[(index + 1) % specialists.length]!.handle;
}

/** Why a client cannot be given to `to`, or null when they can. `to` null means "nobody". */
export function assignmentProblem(members: TeamMember[], to: string | null): string | null {
  if (to === null) return null;
  const member = findMember(members, to);
  if (!member) return "Esa persona no está en el equipo.";
  if (!member.active) return `${member.name} está desactivada.`;
  if (member.role === "sales") return "Ventas no trabaja los casos. Asigna a un especialista o a un administrador.";
  return null;
}

/** The client given to `to` (or to nobody). Unchanged when they already are. Pure. */
export function withAssignment<T extends StaffClient>(client: T, to: string | null, by: string, at: string, auto = false): T {
  if ((client.assignedTo ?? null) === to) return client;
  const entry: ClientAssignment = { at, to, by, auto };
  return { ...client, assignedTo: to, assignments: [...(client.assignments ?? []), entry] };
}

// ── Adding a person by hand ─────────────────────────────────────────────

export interface NewClientInput {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  state: string;
  goal: string;
  /** Handle of the salesperson the person is credited to. */
  salesperson: string;
}

export type NewClientField = "firstName" | "lastName" | "phone" | "email" | "state" | "goal" | "salesperson";

export type NewClientCheck =
  | { ok: true; value: Required<Omit<NewClientInput, "email">> & { email: string | null } }
  | { ok: false; problems: Partial<Record<NewClientField, string>> };

/**
 * Check what a teammate typed to add a person. Only what sales needs to start
 * the conversation: name, phone, an optional email, state and goal.
 *
 * Staff never type a Social Security number or a date of birth, here or
 * anywhere in the console. The client gives their identity data themselves,
 * in their own app, when they sign up and connect their monitoring.
 */
export function checkNewClient(input: NewClientInput, existing: Pick<StaffClient, "phone" | "firstName" | "lastName">[]): NewClientCheck {
  const problems: Partial<Record<NewClientField, string>> = {};
  const firstName = cleanPersonName(input.firstName, 40);
  const lastName = cleanPersonName(input.lastName, 40);
  const phone = normalizePhone(input.phone);
  const rawEmail = (input.email ?? "").trim();
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  const state = input.state.trim().toUpperCase();
  const salesperson = toRefSlug(input.salesperson);
  if (!firstName) problems.firstName = "Escribe su nombre.";
  if (!lastName) problems.lastName = "Escribe su apellido.";
  if (!phone) problems.phone = "Escribe un teléfono de 10 dígitos de EE. UU.";
  if (rawEmail && !email) problems.email = "Ese correo no parece válido. Puedes dejarlo vacío.";
  if (!(ALL_STATES as readonly string[]).includes(state)) problems.state = "Elige el estado donde vive.";
  if (!GOALS.some((g) => g.key === input.goal)) problems.goal = "Elige su meta.";
  if (!salesperson) problems.salesperson = "Elige quién de ventas lo trae.";
  if (phone) {
    const same = existing.find((c) => c.phone === phone);
    if (same) problems.phone = `Ya hay un cliente con este teléfono: ${same.firstName} ${same.lastName}.`;
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, value: { firstName: firstName!, lastName: lastName!, phone: phone!, email, state, goal: input.goal, salesperson: salesperson! } };
}

/** The new person as the console sees them: a prospect with nothing else on record. */
export function prospectRecord(
  id: string,
  value: Extract<NewClientCheck, { ok: true }>["value"],
  by: string,
  now: Date,
): StaffClient {
  const at = now.toISOString();
  return {
    id,
    firstName: value.firstName,
    lastName: value.lastName,
    phone: value.phone,
    state: value.state,
    addressLines: [],
    salesperson: value.salesperson,
    createdAt: at,
    signedUpAt: null,
    agreementSignedAt: null,
    documents: [],
    report: null,
    answers: {},
    rounds: [],
    billing: NO_BILLING,
    lastActivityAt: at,
    notes: [],
    questions: [],
    handled: {},
    email: value.email,
    goal: value.goal,
    addedBy: by,
  };
}

// ── The demo team ───────────────────────────────────────────────────────

/**
 * DEMO DATA. Nobody here exists. Four invented teammates: the owner, who
 * administers and works cases; a specialist; and the two salespeople the demo
 * clients already name (ana, luis). Two people run fulfillment.
 */
export function buildDemoTeam(now: Date): TeamState {
  const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const members: TeamMember[] = [
    { handle: "carmen", name: "Carmen Ruiz", role: "admin", email: "carmen@ejemplo.com", phone: "+17135550190", active: true, invitedAt: ago(320), invitedBy: null, deactivatedAt: null },
    { handle: "marta", name: "Marta Leal", role: "specialist", email: "marta@ejemplo.com", phone: "+17135550191", active: true, invitedAt: ago(210), invitedBy: "carmen", deactivatedAt: null },
    { handle: "ana", name: "Ana Prieto", role: "sales", email: "ana@ejemplo.com", phone: "+17135550192", active: true, invitedAt: ago(260), invitedBy: "carmen", deactivatedAt: null },
    { handle: "luis", name: "Luis Ortega", role: "sales", email: null, phone: "+12105550193", active: true, invitedAt: ago(150), invitedBy: "carmen", deactivatedAt: null },
  ];
  const events: TeamEvent[] = [
    { id: "te-1", at: ago(260), by: "carmen", kind: "member_added", member: "ana", to: "sales" },
    { id: "te-2", at: ago(210), by: "carmen", kind: "member_added", member: "marta", to: "sales" },
    { id: "te-3", at: ago(180), by: "carmen", kind: "role_changed", member: "marta", from: "sales", to: "specialist" },
    { id: "te-4", at: ago(150), by: "carmen", kind: "member_added", member: "luis", to: "sales" },
    { id: "te-5", at: ago(120), by: "carmen", kind: "auto_assign_changed", on: true },
  ];
  return { members, settings: { autoAssign: true, lastAutoAssigned: "marta" }, events };
}
