import { personExceptions } from "../autopilot/queue";
import type { AutopilotEnv } from "../autopilot/types";
import { accountStanding } from "../billing/dunning";
import { stateName } from "./format";
import { NO_BILLING } from "../billing/types";
import { can, exceptionVisibleTo, isMine, type Viewer } from "./permissions";
import {
  clientBillingOutlook,
  clientExceptions,
  clientStage,
  nextBillingStep,
  nextStep,
  pausedForPayment,
  ACTOR_LABELS,
  STAGE_TEXT,
  type NextStep,
  type Stage,
  type StaffException,
} from "./stage";
import type { TimelineEntry } from "./timeline";
import { memberName, type TeamMember } from "./team";
import { fullName, type StaffClient } from "./types";
import { type StaffLocale, staffLocaleFallback } from "./i18n/locale";

// The clients list: what each row says, how the filters read it, and the CSV
// a teammate can take away. Pure, so the rules are tested without a browser.

// ── Billing, as one filterable state ────────────────────────────────────

export const BILLING_STATES = ["none", "current", "retrying", "past_due", "method_missing", "paused_by_team"] as const;
export type BillingState = (typeof BILLING_STATES)[number];

export const BILLING_STATE_LABELS: Record<StaffLocale, Record<BillingState, string>> = {
  en: {
    none: "No charges yet",
    current: "Up to date",
    retrying: "Charge being retried",
    past_due: "Unpaid charge",
    method_missing: "No payment method",
    paused_by_team: "Billing paused",
  },
  es: {
    none: "Sin cobros todavía",
    current: "Al día",
    retrying: "Cobro en reintento",
    past_due: "Cobro sin resolver",
    method_missing: "Falta método de pago",
    paused_by_team: "Cobros en pausa",
  },
};

/** One word about the client's money, from the billing records and the system's own outlook. */
export function billingState(client: StaffClient, now: Date): BillingState {
  if (client.billing.pause) return "paused_by_team";
  if (clientBillingOutlook(client, now).kind === "payment_method_missing") return "method_missing";
  const standing = accountStanding(client.billing);
  if (standing === "past_due") return "past_due";
  if (standing === "retrying") return "retrying";
  return standing === "current" ? "current" : "none";
}

// ── What a role without billing is told ─────────────────────────────────
// Sales does not see money (permissions.ts). Where the console would say what
// billing does next, or tell a charge in the history, they get the work's own
// next step and a history without the money lines.

/** The next step as this viewer may read it. */
export function nextStepFor(client: StaffClient, now: Date, viewer: Viewer | null, locale: StaffLocale = staffLocaleFallback()): NextStep {
  const step = nextStep(client, now, locale);
  if (can(viewer?.role, "billing.view")) return step;
  if (pausedForPayment(client)) return { actor: "staff", text: locale === "es" ? "El equipo lo está atendiendo" : "The team is handling it", at: null };
  const money = nextBillingStep(client, now, locale);
  if (!money || money.text !== step.text) return step;
  // The work's own next step: the same record without its billing.
  return nextStep({ ...client, billing: NO_BILLING }, now, locale);
}

const MONEY_LINE = /cobr|reembols|devolvi[óo] el cobro|m[ée]todo de pago|autorizaci[óo]n de pagos|\$\d|charge|refund|payment method|payment authorization|billing/i;

/** The client's history without the money lines, for a role without billing. */
export function historyFor(entries: TimelineEntry[], viewer: Viewer | null): TimelineEntry[] {
  return can(viewer?.role, "billing.view") ? entries : entries.filter((entry) => !entry.money && !MONEY_LINE.test(entry.text));
}

// ── Rows and filters ────────────────────────────────────────────────────

export interface ClientRow {
  client: StaffClient;
  stage: Stage;
  /** Only the notices the viewer's role is shown. */
  exceptions: StaffException[];
  step: NextStep;
  billing: BillingState;
}

/**
 * With `autopilot`, a notice the automatic follow-ups are still working on is
 * not listed (autopilot/queue.ts: personExceptions); without it, every notice.
 */
export function clientRows(clients: StaffClient[], viewer: Viewer | null, now: Date, autopilot?: AutopilotEnv, locale: StaffLocale = staffLocaleFallback()): ClientRow[] {
  return clients.map((client) => ({
    client,
    stage: clientStage(client, now),
    exceptions: (autopilot ? personExceptions(client, now, { autopilot, locale }).map((p) => p.exception) : clientExceptions(client, now, { locale })).filter((e) =>
      exceptionVisibleTo(viewer?.role, e.kind),
    ),
    step: nextStepFor(client, now, viewer, locale),
    billing: billingState(client, now),
  }));
}

/** "" = any. `assigned` takes a handle or "none" (nobody yet). `notice` takes a kind or "any". */
export interface ClientFilters {
  mine?: boolean;
  query?: string;
  stage?: string;
  notice?: string;
  assigned?: string;
  seller?: string;
  billing?: string;
  state?: string;
}

/** Lowercase, no accents: "Solís" is found by "solis". */
export const plain = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function filterRows(rows: ClientRow[], filters: ClientFilters, viewer: Viewer | null): ClientRow[] {
  const needle = plain((filters.query ?? "").trim());
  const digits = (filters.query ?? "").replace(/\D/g, "");
  return rows.filter(({ client, stage, exceptions, billing }) => {
    if (filters.mine && !isMine(viewer, client)) return false;
    if (filters.stage && stage !== filters.stage) return false;
    if (filters.notice === "any" && exceptions.length === 0) return false;
    if (filters.notice && filters.notice !== "any" && !exceptions.some((e) => e.kind === filters.notice)) return false;
    if (filters.assigned === "none" && client.assignedTo) return false;
    if (filters.assigned && filters.assigned !== "none" && client.assignedTo !== filters.assigned) return false;
    if (filters.seller && client.salesperson !== filters.seller) return false;
    if (filters.billing && billing !== filters.billing) return false;
    if (filters.state && client.state !== filters.state) return false;
    if (!needle) return true;
    return plain(fullName(client)).includes(needle) || (digits.length >= 3 && client.phone.includes(digits));
  });
}

// ── CSV ─────────────────────────────────────────────────────────────────

/**
 * The columns a CSV carries: what the list shows, minus anything sensitive.
 * No phone, email or address, nothing from the report or the client's answers,
 * no money, no identity data. Enough to plan the week from a spreadsheet.
 */
export const CSV_COLUMN_NAMES: Record<StaffLocale, readonly string[]> = {
  en: ["Client", "State", "Stage", "What's next", "Who does it", "Notices", "Working the case", "Sales", "Last activity"],
  es: ["Cliente", "Estado", "Etapa", "Qué sigue", "Quién lo hace", "Avisos", "Trabaja el caso", "Ventas", "Última actividad"],
};

/** The Spanish columns, as the CSV has always had them. */
export const CSV_COLUMNS = CSV_COLUMN_NAMES.es;

/** One CSV cell: quoted, and never read as a formula by a spreadsheet. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The CSV in the member's language (Spanish when left out, as it always was). */
export function clientsCsv(rows: ClientRow[], members: TeamMember[], locale: StaffLocale = "es"): string {
  const ACTOR: Record<string, string> = ACTOR_LABELS[locale];
  const lines = rows.map(({ client, stage, exceptions, step }) =>
    [
      fullName(client),
      stateName(client.state),
      STAGE_TEXT[locale][stage].label,
      step.text,
      ACTOR[step.actor] ?? "",
      exceptions.map((e) => e.kind).length > 0 ? String(exceptions.length) : "0",
      client.assignedTo ? memberName(members, client.assignedTo, locale) : locale === "es" ? "Sin asignar" : "Unassigned",
      memberName(members, client.salesperson, locale),
      client.lastActivityAt.slice(0, 10),
    ]
      .map(csvCell)
      .join(","),
  );
  // A byte-order mark so a spreadsheet opens the accents correctly.
  return `﻿${[CSV_COLUMN_NAMES[locale].map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}
