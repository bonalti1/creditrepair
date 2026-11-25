import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import { addDays, formatDay, latestRound, roundRepullAt } from "../staff/stage";
import type { StaffClient } from "../staff/types";

// Credit monitoring, per client: what the team checked (monitoring_checks,
// migration 0041) and what the reports themselves prove.
//
// The provider (IdentityIQ) gives us no status call (docs/IDENTITYIQ.md), so
// the status is evidence: the newest of (a person's check, a report that
// arrived). A report that came in after the last check proves the monitoring
// was working that day, whatever the check said.
//
// The reminder rule (docs/FULFILLMENT.md, "Monitoring"): when the client's
// next report is due within REMINDER_LEAD_DAYS and the newest evidence says
// the monitoring was CANCELLED, the autopilot's existing "monitoring" reminder
// starts early, with its own first message ("your next report is due on…"),
// through the same channels, quiet hours, daily cap, opt-out and settings.
// Unknown is not inactive: nobody is messaged on no evidence; the team sees
// "check it" instead.

export type MonitoringProvider = "identityiq" | "other";
export type MonitoringCheckStatus = "active" | "cancelled" | "unknown";
export type EnrolledViaLink = "yes" | "no" | "unknown";
export type CheckMethod = "client_said" | "provider_portal" | "partner_statement" | "report_arrived" | "other";

export const CHECK_METHODS: readonly CheckMethod[] = ["client_said", "provider_portal", "partner_statement", "report_arrived", "other"];

export interface MonitoringCheck {
  id: string;
  provider: MonitoringProvider;
  providerName: string | null;
  enrolledViaLink: EnrolledViaLink;
  status: MonitoringCheckStatus;
  /** The calendar day it was checked (YYYY-MM-DD). */
  checkedOn: string;
  method: CheckMethod;
  note: string;
  by: string;
  at: string;
}

/** Days before the report is due when a cancelled monitoring starts the reminder. */
export const REMINDER_LEAD_DAYS = 7;
/** An "active" check older than this is shown to the team as worth checking again. */
export const CHECK_FRESH_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MonitoringStanding = "active" | "cancelled" | "unknown" | "not_checked";

export interface MonitoringSummary {
  standing: MonitoringStanding;
  /** The newest person's check, if any. */
  check: MonitoringCheck | null;
  /** True when a report arrived after the newest check (or with no check): the reports prove it. */
  provenByReport: boolean;
  /** The day of the newest evidence (a check, or a report). */
  evidenceDay: string | null;
  enrolledViaLink: EnrolledViaLink;
  provider: string | null;
  /** True for an active check older than CHECK_FRESH_DAYS with no report since. */
  stale: boolean;
  /** When the next report is expected, if one is. */
  reportDueAt: string | null;
  /** True when the client should hear about it (cancelled, a report due). */
  looksInactive: boolean;
}

function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/** Newest first by the day checked, then by when it was recorded. */
export function sortChecks(checks: readonly MonitoringCheck[]): MonitoringCheck[] {
  return [...checks].sort((a, b) => b.checkedOn.localeCompare(a.checkedOn) || b.at.localeCompare(a.at));
}

/**
 * When the client's next report is expected, and the key the monitoring
 * follow-up uses for it (followups.ts uses the same keys): after a mailed
 * round, the round's re-pull date (rounds/timing.ts); otherwise the day the
 * newest report turns FRESH_REPORT_DAYS old. Null before the first report.
 */
export function reportDue(client: StaffClient): { dueAt: string; key: string } | null {
  if (!client.report) return null;
  const latest = latestRound(client);
  if (latest?.status === "mailed" && latest.mailedAt) {
    const repull = roundRepullAt(latest);
    return repull ? { dueAt: repull.toISOString(), key: `r${latest.number}` } : null;
  }
  return { dueAt: addDays(client.report.pulledAt, FRESH_REPORT_DAYS).toISOString(), key: dayOf(client.report.pulledAt) };
}

export function monitoringSummary(client: StaffClient, now: Date): MonitoringSummary {
  const check = sortChecks(client.monitoringChecks ?? [])[0] ?? null;
  const reportDay = client.report ? dayOf(client.report.pulledAt) : null;
  const provenByReport = Boolean(reportDay && (!check || reportDay > check.checkedOn));
  const due = reportDue(client);
  let standing: MonitoringStanding = check ? check.status : "not_checked";
  if (provenByReport) standing = "active";
  const evidenceDay = provenByReport ? reportDay : (check?.checkedOn ?? null);
  const stale = standing === "active" && !!evidenceDay && now.getTime() - new Date(`${evidenceDay}T12:00:00Z`).getTime() > CHECK_FRESH_DAYS * DAY_MS;
  return {
    standing,
    check,
    provenByReport,
    evidenceDay,
    enrolledViaLink: check?.enrolledViaLink ?? "unknown",
    provider: check ? (check.provider === "identityiq" ? "IdentityIQ" : check.providerName) : null,
    stale,
    reportDueAt: due?.dueAt ?? null,
    looksInactive: standing === "cancelled" && due !== null,
  };
}

/**
 * The early start of the monitoring reminder, or null: the monitoring looks
 * cancelled and the next report is due within REMINDER_LEAD_DAYS (or already
 * due). `startAt` is never before the check that found it cancelled.
 */
export function earlyMonitoringReminder(client: StaffClient, now: Date): { startAt: string; dueAt: string; key: string } | null {
  if (!client.signedUpAt || !client.agreementSignedAt) return null;
  const summary = monitoringSummary(client, now);
  if (!summary.looksInactive || !summary.check) return null;
  const due = reportDue(client);
  if (!due) return null;
  const lead = new Date(due.dueAt).getTime() - REMINDER_LEAD_DAYS * DAY_MS;
  const checkedAt = new Date(summary.check.at).getTime();
  const start = Math.max(lead, checkedAt);
  if (now.getTime() < start) return null;
  return { startAt: new Date(start).toISOString(), dueAt: due.dueAt, key: due.key };
}

/** "December 12" / "12 de diciembre", for the early message. */
export function dueText(dueAt: string): Record<"es" | "en", string> {
  return { es: formatDay(new Date(dueAt), "es"), en: formatDay(new Date(dueAt), "en") };
}

// ── The words (staff) ───────────────────────────────────────────────────

export const MONITORING_TEXT = {
  en: {
    title: "Credit monitoring",
    standing: { active: "Active", cancelled: "Cancelled", unknown: "Unknown", not_checked: "Not checked yet" } as Record<MonitoringStanding, string>,
    enrolled: { yes: "Through our link", no: "Not through our link", unknown: "Not known" } as Record<EnrolledViaLink, string>,
    method: {
      client_said: "The client told us",
      provider_portal: "Seen in the provider's partner portal",
      partner_statement: "On the provider's commission statement",
      report_arrived: "A new report arrived",
      other: "Other",
    } as Record<CheckMethod, string>,
    status: { active: "Active", cancelled: "Cancelled", unknown: "Unknown" } as Record<MonitoringCheckStatus, string>,
    provider: "Provider",
    enrolledLabel: "Enrolled",
    checkedLabel: "Checked",
    howLabel: "How",
    reportDue: "Next report due",
    reportOverdue: "Report expected since",
    provenByReport: (day: string) => `A report arrived on ${day}: the monitoring was working then.`,
    stale: "Checked a while ago. Worth confirming it is still active.",
    inactive: "Looks cancelled and a report is due: the system reminds the client (same channels and rules as every reminder).",
    unknownNote: "Not known: nobody is messaged on no evidence. Check it with the client or the provider.",
    record: "Record a check",
    save: "Save the check",
    saving: "Saving…",
    otherName: "Provider's name",
    note: "Note (optional, no numbers from the client's ID)",
    day: "Day checked",
    noAmounts: "Commissions are recorded under Payments & Accounting → Monitoring. Never shown to the client.",
    history: "Earlier checks",
    denied: "Only a teammate who works this client can record a check.",
  },
  es: {
    title: "Monitoreo de crédito",
    standing: { active: "Activo", cancelled: "Cancelado", unknown: "Se desconoce", not_checked: "Sin revisar todavía" } as Record<MonitoringStanding, string>,
    enrolled: { yes: "Con nuestro enlace", no: "Sin nuestro enlace", unknown: "No se sabe" } as Record<EnrolledViaLink, string>,
    method: {
      client_said: "El cliente nos dijo",
      provider_portal: "Visto en el portal de socios del proveedor",
      partner_statement: "En el estado de comisiones del proveedor",
      report_arrived: "Llegó un reporte nuevo",
      other: "Otro",
    } as Record<CheckMethod, string>,
    status: { active: "Activo", cancelled: "Cancelado", unknown: "Se desconoce" } as Record<MonitoringCheckStatus, string>,
    provider: "Proveedor",
    enrolledLabel: "Inscrito",
    checkedLabel: "Revisado",
    howLabel: "Cómo",
    reportDue: "Próximo reporte",
    reportOverdue: "Reporte esperado desde",
    provenByReport: (day: string) => `Llegó un reporte el ${day}: el monitoreo funcionaba ese día.`,
    stale: "Se revisó hace tiempo. Conviene confirmar que sigue activo.",
    inactive: "Parece cancelado y viene un reporte: el sistema se lo recuerda al cliente (los mismos canales y reglas de todo recordatorio).",
    unknownNote: "No se sabe: a nadie se le escribe sin pruebas. Revísalo con el cliente o con el proveedor.",
    record: "Registrar una revisión",
    save: "Guardar la revisión",
    saving: "Guardando…",
    otherName: "Nombre del proveedor",
    note: "Nota (opcional, sin números de la identificación del cliente)",
    day: "Día de la revisión",
    noAmounts: "Las comisiones se registran en Pagos y contabilidad → Monitoreo. El cliente nunca las ve.",
    history: "Revisiones anteriores",
    denied: "Solo alguien del equipo que trabaja a este cliente puede registrar una revisión.",
  },
};
