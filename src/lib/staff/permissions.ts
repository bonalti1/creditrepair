import type { ExceptionKind } from "./stage";
import type { StaffClient, StaffRole } from "./types";

// What each member of the team may see and do.
//
// One matrix, read by the console (to hide or disable a control, with a short
// reason) and by every staff API route (to refuse the request on the server,
// whatever the screen showed). The database applies the same scopes again in
// its read policies (supabase/migrations/0012_team.sql): change both together.
//
// The defaults follow how Credit Repair Cloud sets up a small team, with two
// rules of our own: refunds and the team list are for an administrator only,
// and nobody on the team can mark an item as disputed (that is the client's
// answer; no capability here touches it).

export const STAFF_ROLES: readonly StaffRole[] = ["admin", "specialist", "sales"];

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Administrador",
  specialist: "Especialista",
  sales: "Ventas",
};

/** One line on the team screen: what the role is for. */
export const ROLE_SUMMARY: Record<StaffRole, string> = {
  admin: "Todo: clientes, cartas, cobros, números del negocio, el equipo y el piloto automático.",
  specialist: "Trabaja los clientes que tiene asignados: reportes, cartas y respuestas. Sin cobros ni equipo.",
  sales: "Agrega prospectos e invita. Ve solo a los clientes que trajo. Sin cartas ni cobros.",
};

export const CAPABILITIES = [
  "clients.add",
  "clients.invite",
  "clients.assign",
  "clients.export",
  "clients.followup",
  "case.view",
  "reports.import",
  "rounds.send",
  "clients.reply",
  "billing.view",
  "billing.pause",
  "billing.refund",
  "business.view",
  "team.manage",
  "autopilot.manage",
  // Referral partners (src/lib/partners, migration 0017): see the list, and approve them and set commissions.
  "partners.view",
  "partners.manage",
  // The letter templates (/equipo/cartas): editing what every letter says is the owner's.
  "letters.edit",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Which clients a role sees: every one, the ones assigned to them, or the ones they brought in. */
export type ClientScope = "all" | "assigned" | "brought";

export const SCOPE_LABEL: Record<ClientScope, string> = {
  all: "Todos los clientes",
  assigned: "Solo los asignados a esa persona",
  brought: "Solo los que esa persona trajo",
};

export const CAPABILITY_LABEL: Record<Capability, string> = {
  "clients.add": "Agregar clientes a mano",
  "clients.invite": "Preparar invitaciones",
  "clients.assign": "Asignar clientes",
  "clients.export": "Exportar la lista (CSV)",
  "clients.followup": "Notas y marcar avisos como atendidos",
  "case.view": "Ver reporte, respuestas, cartas y conversación",
  "reports.import": "Importar reportes",
  "rounds.send": "Enviar e imprimir rondas",
  "clients.reply": "Responder al cliente en la app",
  "billing.view": "Ver cobros",
  "billing.pause": "Pausar y reanudar cobros",
  "billing.refund": "Devolver cobros",
  "business.view": "Ver los números del negocio",
  "team.manage": "Administrar el equipo",
  "autopilot.manage": "Configurar el piloto automático",
  "partners.view": "Ver los socios que refieren clientes",
  "partners.manage": "Aprobar socios y fijar sus comisiones",
  "letters.edit": "Editar las plantillas de las cartas",
};

export interface RolePermissions {
  scope: ClientScope;
  can: Record<Capability, boolean>;
}

const ALL_CAPABILITIES = Object.fromEntries(CAPABILITIES.map((c) => [c, true])) as Record<Capability, boolean>;

/** The matrix. Typed so that a capability added above must be decided for every role. */
export const ROLE_PERMISSIONS: Record<StaffRole, RolePermissions> = {
  admin: { scope: "all", can: ALL_CAPABILITIES },
  specialist: {
    scope: "assigned",
    can: {
      "clients.add": false,
      "clients.invite": false,
      "clients.assign": false,
      "clients.export": true,
      "clients.followup": true,
      "case.view": true,
      "reports.import": true,
      "rounds.send": true,
      "clients.reply": true,
      // Read-only: a case paused for a payment is part of the work. No refunds, no pauses.
      "billing.view": true,
      "billing.pause": false,
      "billing.refund": false,
      "business.view": false,
      "team.manage": false,
      // Specialists hold a client (with rounds.send); turning the autopilot on or off is the owner's.
      "autopilot.manage": false,
      "partners.view": false,
      "partners.manage": false,
      "letters.edit": false,
    },
  },
  sales: {
    scope: "brought",
    can: {
      "clients.add": true,
      "clients.invite": true,
      "clients.assign": false,
      "clients.export": false,
      "clients.followup": true,
      "case.view": false,
      "reports.import": false,
      "rounds.send": false,
      "clients.reply": false,
      "billing.view": false,
      "billing.pause": false,
      "billing.refund": false,
      "business.view": false,
      "team.manage": false,
      "autopilot.manage": false,
      // Sales follows up the people partners refer, so they see who the partners are. Only an administrator approves.
      "partners.view": true,
      "partners.manage": false,
      "letters.edit": false,
    },
  },
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** True when the role may do it. No role (signed out, unknown) may do nothing. */
export function can(role: StaffRole | null | undefined, capability: Capability): boolean {
  return isStaffRole(role) ? ROLE_PERMISSIONS[role].can[capability] : false;
}

export function scopeOf(role: StaffRole | null | undefined): ClientScope | null {
  return isStaffRole(role) ? ROLE_PERMISSIONS[role].scope : null;
}

/** The roles that may do it, in the matrix's order. */
export function rolesThatCan(capability: Capability): StaffRole[] {
  return STAFF_ROLES.filter((role) => ROLE_PERMISSIONS[role].can[capability]);
}

function listEs(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} o ${parts[parts.length - 1]}`;
}

const ROLE_NOUN: Record<StaffRole, string> = { admin: "un administrador", specialist: "un especialista", sales: "ventas" };

/** The short reason shown beside a control the viewer may not use: "Solo un administrador puede devolver cobros." */
export function deniedReason(capability: Capability): string {
  const who = rolesThatCan(capability).map((role) => ROLE_NOUN[role]);
  const what = CAPABILITY_LABEL[capability].charAt(0).toLowerCase() + CAPABILITY_LABEL[capability].slice(1);
  return who.length === 0 ? `Nadie del equipo puede ${what}.` : `Solo ${listEs(who)} puede ${what}.`;
}

// ── Who is looking ──────────────────────────────────────────────────────

/** The member of the team using the console. */
export interface Viewer {
  /** staff_members.handle: lowercase, the same handle sales links carry. */
  handle: string;
  name: string;
  role: StaffRole;
}

/** True when the viewer may see this client at all. */
export function canSeeClient(viewer: Viewer | null, client: Pick<StaffClient, "assignedTo" | "salesperson">): boolean {
  if (!viewer) return false;
  switch (scopeOf(viewer.role)) {
    case "all":
      return true;
    case "assigned":
      return Boolean(client.assignedTo) && client.assignedTo === viewer.handle;
    case "brought":
      return client.salesperson === viewer.handle;
    default:
      return false;
  }
}

export function visibleClients<T extends Pick<StaffClient, "assignedTo" | "salesperson">>(viewer: Viewer | null, clients: T[]): T[] {
  return clients.filter((client) => canSeeClient(viewer, client));
}

/**
 * "Mis clientes": the ones assigned to the viewer or that the viewer brought
 * in. For a specialist or a salesperson this is everything they can see.
 */
export function isMine(viewer: Viewer | null, client: Pick<StaffClient, "assignedTo" | "salesperson">): boolean {
  if (!viewer) return false;
  return client.assignedTo === viewer.handle || client.salesperson === viewer.handle;
}

/** Whether the clients list opens on "Mis clientes": for anyone who cannot see everyone. */
export function defaultsToMine(role: StaffRole | null | undefined): boolean {
  return scopeOf(role) !== "all";
}

/**
 * The "needs a person" notices a role is shown. Sales follows a person until
 * the work starts (an unsigned agreement, missing documents); everything after
 * that is fulfillment's, and money is not theirs to discuss.
 */
const SALES_EXCEPTIONS: readonly ExceptionKind[] = ["agreement_unsigned", "documents_missing"];

export function exceptionVisibleTo(role: StaffRole | null | undefined, kind: ExceptionKind): boolean {
  if (!isStaffRole(role)) return false;
  if (role === "sales") return SALES_EXCEPTIONS.includes(kind);
  return true;
}
