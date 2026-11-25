import type { ExceptionKind } from "./stage";
import { listJoin, type StaffLocale, staffLocaleFallback } from "./i18n/locale";
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

export const ROLE_LABELS: Record<StaffLocale, Record<StaffRole, string>> = {
  en: { admin: "Administrator", specialist: "Specialist", sales: "Sales" },
  es: { admin: "Administrador", specialist: "Especialista", sales: "Ventas" },
};

/** One line on the team screen: what the role is for. */
export const ROLE_SUMMARIES: Record<StaffLocale, Record<StaffRole, string>> = {
  en: {
    admin: "Everything: clients, letters, billing, business numbers, the team and the autopilot.",
    specialist: "Works the clients assigned to them: reports, letters and replies. No billing or team.",
    sales: "Adds leads and sends invites. Sees only the clients they brought in. No letters or billing.",
  },
  es: {
    admin: "Todo: clientes, cartas, cobros, números del negocio, el equipo y el piloto automático.",
    specialist: "Trabaja los clientes que tiene asignados: reportes, cartas y respuestas. Sin cobros ni equipo.",
    sales: "Agrega prospectos e invita. Ve solo a los clientes que trajo. Sin cartas ni cobros.",
  },
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
  // The letter editor (src/lib/letters/versions, migration 0019): change a letter and record the attorney's approval.
  "letters.edit",
  // The plan catalogue, invoices, exports and chargebacks (src/lib/billing, migration 0026).
  "billing.plans",
  // Review sites, the review requests and the ratings typed in (src/lib/reviews, migration 0029).
  "reviews.manage",
  // Which states Credalti sells in (src/lib/compliance/stateRules.ts, migration 0030).
  "states.manage",
  // Calls with a person (src/lib/calls, migration 0032; off by default): set when the team takes calls, see and close bookings.
  "calls.manage",
  // Credalti Control's lead inbox (src/lib/leads, migration 0034): read and answer leads, notes, move their stage.
  "leads.work",
  // Content (src/lib/content, migration 0035): the board, approving, publishing, and the brand kit with the partner material.
  "content.view",
  "content.edit",
  "content.approve",
  "content.publish",
  "content.share",
  // The accounting department (src/lib/accounting, migration 0036): the books, expenses, reconciliation, month close.
  "accounting",
  // The Ads Manager (src/lib/ads, migration 0037): the ad spend, results and leads per ad (money: administrators);
  // and Alti's ad copy drafts, sent to Content or Video Studio (the content team).
  "ads.view",
  "ads.draft",
  // SEO (src/lib/seo, migration 0039): site health, guides, Search Console, keywords and the local checklist; publishing guides.
  "seo.view",
  "seo.edit",
  "seo.publish",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Which clients a role sees: every one, the ones assigned to them, or the ones they brought in. */
export type ClientScope = "all" | "assigned" | "brought";

export const SCOPE_LABELS: Record<StaffLocale, Record<ClientScope, string>> = {
  en: {
    all: "All clients",
    assigned: "Only those assigned to them",
    brought: "Only those they brought in",
  },
  es: {
    all: "Todos los clientes",
    assigned: "Solo los asignados a esa persona",
    brought: "Solo los que esa persona trajo",
  },
};

const CAPABILITY_LABEL_ES: Record<Capability, string> = {
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
  "letters.edit": "Editar las cartas y registrar la aprobación del abogado",
  "billing.plans": "Planes de cobro, facturas, exportaciones y contracargos",
  "reviews.manage": "Sitios de reseñas, pedidos de reseña y calificaciones",
  "states.manage": "Abrir y cerrar estados",
  "calls.manage": "Fijar los horarios de llamadas y atender las reservas",
  "leads.work": "Atender a los prospectos: conversaciones, notas y etapas",
  "content.view": "Ver el tablero, el calendario y los resultados del contenido",
  "content.edit": "Crear y editar contenido, y mandarlo a revisión",
  "content.approve": "Aprobar contenido o pedir cambios",
  "content.publish": "Conectar las redes sociales y activar la publicación",
  "content.share": "Ver el kit de marca y el material aprobado para socios",
  accounting: "Contabilidad: libros, gastos, conciliación y cierre de mes",
  "ads.view": "Ver los anuncios: gasto, resultados y prospectos por anuncio",
  "ads.draft": "Escribir textos de anuncios con Alti y mandarlos a Contenido o a Video Studio",
  "seo.view": "Ver el SEO: salud del sitio, guías, búsquedas y palabras clave",
  "seo.edit": "Escribir guías, seguir frases y marcar la lista local",
  "seo.publish": "Publicar guías en el sitio y conectar Search Console",
};

const CAPABILITY_LABEL_EN: Record<Capability, string> = {
  "clients.add": "Add clients by hand",
  "clients.invite": "Prepare invites",
  "clients.assign": "Assign clients",
  "clients.export": "Export the list (CSV)",
  "clients.followup": "Notes and marking notices handled",
  "case.view": "See the report, answers, letters and conversation",
  "reports.import": "Import reports",
  "rounds.send": "Send and print rounds",
  "clients.reply": "Reply to the client in the app",
  "billing.view": "See billing",
  "billing.pause": "Pause and resume billing",
  "billing.refund": "Refund charges",
  "business.view": "See the business numbers",
  "team.manage": "Manage the team",
  "autopilot.manage": "Set up the autopilot",
  "partners.view": "See the partners who refer clients",
  "partners.manage": "Approve partners and set their commissions",
  "letters.edit": "Edit the letters and record the attorney's approval",
  "billing.plans": "Billing plans, invoices, exports and chargebacks",
  "reviews.manage": "Review sites, review requests and ratings",
  "states.manage": "Open and close states",
  "calls.manage": "Set call hours and handle booked calls",
  "leads.work": "Work the lead inbox: conversations, notes and stages",
  "content.view": "See the content board, calendar and results",
  "content.edit": "Create and edit content, and submit it for review",
  "content.approve": "Approve content or ask for changes",
  "content.publish": "Connect social accounts and turn publishing on",
  "content.share": "See the brand kit and the approved partner material",
  accounting: "Accounting: the books, expenses, reconciliation and month close",
  "ads.view": "See the ads: spend, results and leads per ad",
  "ads.draft": "Write ad copy with Alti and send it to Content or Video Studio",
  "seo.view": "See SEO: site health, guides, search numbers and keywords",
  "seo.edit": "Write guides, track phrases and tick the local checklist",
  "seo.publish": "Publish guides on the website and connect Search Console",
};

export const CAPABILITY_LABELS: Record<StaffLocale, Record<Capability, string>> = { en: CAPABILITY_LABEL_EN, es: CAPABILITY_LABEL_ES };

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
      "billing.plans": false,
      "reviews.manage": false,
      "states.manage": false,
      "calls.manage": false,
      // Leads are sales' (and the owner's): a specialist works signed clients.
      "leads.work": false,
      // Content (migration 0035): a specialist (or a designer invited as one, with no clients) makes content; only an administrator approves and publishes.
      "content.view": true,
      "content.edit": true,
      "content.approve": false,
      "content.publish": false,
      "content.share": true,
      accounting: false,
      // Ads (migration 0037): spend is money, the owner's; a specialist on the content team drafts ad copy with Alti.
      "ads.view": false,
      "ads.draft": true,
      // SEO (migration 0039): a specialist writes guides and tracks phrases; only an administrator publishes.
      "seo.view": true,
      "seo.edit": true,
      "seo.publish": false,
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
      "billing.plans": false,
      "reviews.manage": false,
      "states.manage": false,
      // Sales talks with leads before they sign up: the calls are theirs (questions only).
      "calls.manage": true,
      // The lead inbox is sales' work: the leads they were given, and the ones nobody has yet.
      "leads.work": true,
      // Content (migration 0035): sales sees and copies the approved partner material, and the brand kit. Nothing else.
      "content.view": false,
      "content.edit": false,
      "content.approve": false,
      "content.publish": false,
      "content.share": true,
      accounting: false,
      // Ads (migration 0037): no spend (sales never sees money) and no ad copy (that is the content team's).
      "ads.view": false,
      "ads.draft": false,
      // SEO: not sales' work (the website's words are the content team's).
      "seo.view": false,
      "seo.edit": false,
      "seo.publish": false,
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

const ROLE_NOUN: Record<StaffLocale, Record<StaffRole, string>> = {
  en: { admin: "an administrator", specialist: "a specialist", sales: "sales" },
  es: { admin: "un administrador", specialist: "un especialista", sales: "ventas" },
};

/**
 * The short reason shown beside a control the viewer may not use:
 * "Only an administrator can refund charges." / "Solo un administrador puede devolver cobros."
 */
export function deniedReason(capability: Capability, locale: StaffLocale = staffLocaleFallback()): string {
  const who = rolesThatCan(capability).map((role) => ROLE_NOUN[locale][role]);
  const label = CAPABILITY_LABELS[locale][capability];
  const what = label.charAt(0).toLowerCase() + label.slice(1);
  if (locale === "es") return who.length === 0 ? `Nadie del equipo puede ${what}.` : `Solo ${listJoin(who, "es", "o")} puede ${what}.`;
  return who.length === 0 ? `Nobody on the team can ${what}.` : `Only ${listJoin(who, "en", "or")} can ${what}.`;
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
