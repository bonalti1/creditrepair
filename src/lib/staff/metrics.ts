import { unpaidCharge } from "../billing/dunning";
import { feeToCents } from "../billing/rules";
import { ROUND_CYCLE_DAYS } from "../domain/attack";
import { actorHandle } from "./activity";
import { clientBillingOutlook, clientExceptions, clientStage, daysSince, roundItemCount, STAFF_TIME_ZONE } from "./stage";
import { memberName, type TeamMember } from "./team";
import type { StaffClient, StaffRole, StaffRound } from "./types";

// The numbers an owner checks, from the same records the console shows.
//
// Every number has a written definition (METRIC_INFO) that the dashboard
// shows beside it, so nobody has to guess what was counted. Two rules hold
// throughout:
//   - Only what is on record is counted. Money comes from the billing
//     records themselves (charges, refunds, the system's own schedule), never
//     from a price times a head count.
//   - Nothing claims an outcome the records cannot prove. The one number about
//     what happened on a report is "Puntos que ya no aparecen en el reporte":
//     items a mailed round disputed that a later imported report no longer
//     lists (RoundResult, "removed"). It does not say why, or that they will
//     stay gone. There is no success rate and no score here.

export const PERIODS = ["month", "30d", "90d", "all"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  month: "Este mes",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  all: "Desde el inicio",
};

export interface PeriodRange {
  /** Inclusive. Null for "since the beginning". */
  from: Date | null;
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function texasParts(date: Date): { year: number; month: number; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: STAFF_TIME_ZONE, year: "numeric", month: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** Midnight in Texas on the first day of a month (month 1–12). */
export function startOfTexasMonth(year: number, month: number): Date {
  // 06:00 UTC is midnight in Central Standard Time; in daylight time it reads 01:00, so step back.
  const guess = new Date(Date.UTC(year, month - 1, 1, 6, 0, 0));
  const local = texasParts(guess);
  return new Date(guess.getTime() - (local.hour * 60 + local.minute) * 60 * 1000);
}

export function periodRange(period: Period, now: Date): PeriodRange {
  switch (period) {
    case "month": {
      const { year, month } = texasParts(now);
      return { from: startOfTexasMonth(year, month), to: now };
    }
    case "30d":
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
    case "90d":
      return { from: new Date(now.getTime() - 90 * DAY_MS), to: now };
    case "all":
      return { from: null, to: now };
  }
}

export function inRange(iso: string | null | undefined, range: PeriodRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return (range.from === null || t >= range.from.getTime()) && t <= range.to.getTime();
}

// ── Definitions ─────────────────────────────────────────────────────────

export type MetricKey =
  | "newLeads"
  | "signed"
  | "cancelled"
  | "active"
  | "paused"
  | "ended"
  | "conversion"
  | "churn"
  | "roundsMailed"
  | "lettersMailed"
  | "itemsDisputed"
  | "itemsNoLongerReported"
  | "daysToFirstRound"
  | "roundsOverdue"
  | "charged"
  | "refunded"
  | "net"
  | "failedPayments"
  | "recoveredPayments"
  | "scheduled30"
  | "revenuePerActive"
  | "memberAssigned"
  | "memberRounds"
  | "memberReplies"
  | "memberExceptions"
  | "salesInvites"
  | "salesSigned"
  | "salesCancelled";

export const METRIC_INFO: Record<MetricKey, { label: string; definition: string }> = {
  newLeads: { label: "Prospectos nuevos", definition: "Personas cuyo primer contacto con ventas fue en el periodo, por invitación o agregadas a mano." },
  signed: { label: "Acuerdos firmados", definition: "Acuerdos de servicio firmados en el periodo." },
  cancelled: { label: "Cancelaciones", definition: "Clientes que cancelaron su acuerdo en el periodo, dentro o fuera del plazo de 3 días hábiles." },
  active: { label: "Activos hoy", definition: "Hoy: acuerdo firmado y vigente (sin cancelar y sin pedir terminar) y el caso no está en pausa." },
  paused: { label: "En pausa hoy", definition: "Hoy: casos en pausa por un cobro que no pasó, o porque el cliente no marcó nada como inexacto." },
  ended: { label: "Terminados", definition: "Hoy: clientes que cancelaron su acuerdo o pidieron terminar el servicio. Su registro se conserva." },
  conversion: {
    label: "Prospecto → acuerdo",
    definition: "De los prospectos con primer contacto en el periodo, qué parte ya firmó su acuerdo a la fecha de hoy.",
  },
  churn: {
    label: "Bajas",
    definition: "Clientes que cancelaron o pidieron terminar en el periodo, entre todos los que tuvieron un acuerdo vigente en algún momento del periodo.",
  },
  roundsMailed: { label: "Rondas enviadas", definition: "Rondas marcadas como enviadas en el periodo, por su fecha de envío." },
  lettersMailed: { label: "Cartas enviadas", definition: "Cartas de esas rondas: una por destinatario (buró o acreedor)." },
  itemsDisputed: {
    label: "Puntos disputados",
    definition: "Puntos distintos que cubren las cartas de esas rondas. Solo entran puntos que el cliente confirmó como inexactos.",
  },
  itemsNoLongerReported: {
    label: "Puntos que ya no aparecen en el reporte",
    definition:
      "Puntos disputados que un reporte importado en el periodo ya no muestra, según el registro de cada ronda. No dice por qué ni si volverán a aparecer.",
  },
  daysToFirstRound: {
    label: "Días de la firma a la 1.ª ronda",
    definition: "Promedio de días entre la firma del acuerdo y el envío de la primera ronda, para las primeras rondas enviadas en el periodo. Incluye los 3 días hábiles en que no se puede empezar.",
  },
  roundsOverdue: {
    label: `Atrasadas vs. ciclo de ${ROUND_CYCLE_DAYS} días`,
    definition: `Hoy: clientes con trabajo en curso cuya última ronda salió hace más de ${ROUND_CYCLE_DAYS} días y no tienen otra enviada.`,
  },
  charged: { label: "Cobrado", definition: "Cobros que pasaron en el periodo, por su fecha de cobro. Incluye los que después se devolvieron." },
  refunded: { label: "Reembolsado", definition: "Reembolsos hechos en el periodo, por su fecha. Siempre el cobro completo." },
  net: { label: "Neto", definition: "Cobrado menos reembolsado, en el periodo." },
  failedPayments: {
    label: "Cobros que no pasaron",
    definition: "Cobros todavía sin pagar cuyo último intento fue rechazado en el periodo: el sistema los reintenta, o el caso quedó en pausa.",
  },
  recoveredPayments: { label: "Recuperados", definition: "Cobros que pasaron en el periodo después de al menos un intento rechazado." },
  scheduled30: {
    label: "Programado, próximos 30 días",
    definition:
      "Cobros y reintentos que el sistema ya tiene con fecha en los próximos 30 días, solo por rondas ya enviadas y por la cuota del acuerdo firmado. No cuenta rondas que todavía no salen.",
  },
  revenuePerActive: { label: "Neto por cliente activo", definition: "El neto del periodo dividido entre los clientes activos de hoy." },
  memberAssigned: { label: "Clientes", definition: "Hoy: clientes asignados a la persona, sin contar los que terminaron." },
  memberRounds: { label: "Rondas", definition: "Rondas que la persona envió en el periodo." },
  memberReplies: { label: "Respuestas", definition: "Mensajes que la persona escribió al cliente en la app en el periodo." },
  memberExceptions: { label: "Avisos abiertos", definition: "Hoy: avisos de «Necesita una persona» de sus clientes asignados." },
  salesInvites: { label: "Prospectos", definition: "Prospectos que la persona trajo, con primer contacto en el periodo." },
  salesSigned: { label: "Firmaron", definition: "Acuerdos firmados en el periodo por clientes que la persona trajo." },
  salesCancelled: { label: "Cancelaron", definition: "Cancelaciones en el periodo de clientes que la persona trajo." },
};

// ── Small facts about a client ──────────────────────────────────────────

function isMailed(round: StaffRound): boolean {
  return Boolean(round.mailedAt) && (round.status === "mailed" || round.status === "responded");
}

/** When the client stopped: the cancellation or the request to end, whichever came first. */
export function endedAt(client: StaffClient): string | null {
  const dates = [client.agreementCancelledAt, client.serviceEndRequestedAt].filter((d): d is string => Boolean(d)).sort();
  return dates[0] ?? null;
}

/** Signed, not cancelled, not asked to end, not paused. */
export function isActiveClient(client: StaffClient, now: Date): boolean {
  return Boolean(client.agreementSignedAt) && !endedAt(client) && clientStage(client, now) !== "paused";
}

/** The newest mailed round, or null. */
function lastMailed(client: StaffClient): StaffRound | null {
  return client.rounds.filter(isMailed).reduce<StaffRound | null>((latest, r) => (!latest || r.number > latest.number ? r : latest), null);
}

/** True when the client's last round went out more than one cycle ago and nothing has gone out since. */
export function behindCycle(client: StaffClient, now: Date): boolean {
  const last = lastMailed(client);
  return Boolean(last?.mailedAt) && isActiveClient(client, now) && daysSince(last!.mailedAt!, now) > ROUND_CYCLE_DAYS;
}

// ── The dashboard ───────────────────────────────────────────────────────

export interface MemberMetrics {
  handle: string;
  name: string;
  role: StaffRole;
  active: boolean;
  assigned: number;
  roundsSent: number;
  replies: number;
  openExceptions: number;
}

export interface SalesMetrics {
  handle: string;
  name: string;
  invites: number;
  signed: number;
  cancelled: number;
}

export interface BusinessMetrics {
  period: Period;
  range: PeriodRange;
  clients: {
    newLeads: number;
    signed: number;
    cancelled: number;
    active: number;
    paused: number;
    ended: number;
    /** 0–1; null when no lead arrived in the period. */
    conversion: number | null;
    /** 0–1; null when nobody had an agreement in force. */
    churn: number | null;
  };
  work: {
    roundsMailed: number;
    lettersMailed: number;
    itemsDisputed: number;
    itemsNoLongerReported: number;
    /** Null when no first round went out in the period. */
    daysToFirstRound: number | null;
    roundsOverdue: number;
    /** Clients with work in progress who have a mailed round: the base for "overdue". */
    inCycle: number;
  };
  money: {
    chargedCents: number;
    refundedCents: number;
    netCents: number;
    failedCount: number;
    failedCents: number;
    recoveredCount: number;
    recoveredCents: number;
    scheduledCount: number;
    scheduledCents: number;
    /** Null when there is no active client. */
    revenuePerActiveCents: number | null;
  };
  team: MemberMetrics[];
  sales: SalesMetrics[];
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function businessMetrics(clients: StaffClient[], members: TeamMember[], period: Period, now: Date): BusinessMetrics {
  const range = periodRange(period, now);
  const within = (iso: string | null | undefined) => inRange(iso, range);
  const mailedInRange = clients.flatMap((client) => client.rounds.filter((r) => isMailed(r) && within(r.mailedAt)).map((round) => ({ client, round })));

  // Clients.
  const leads = clients.filter((c) => within(c.createdAt));
  const active = clients.filter((c) => isActiveClient(c, now));
  const ended = clients.filter((c) => endedAt(c));
  const stoppedInRange = clients.filter((c) => within(endedAt(c)));
  const inForceDuringRange = clients.filter((c) => {
    if (!c.agreementSignedAt || new Date(c.agreementSignedAt).getTime() > range.to.getTime()) return false;
    const end = endedAt(c);
    return !end || range.from === null || new Date(end).getTime() >= range.from.getTime();
  });

  // Work.
  const firstRounds = clients.flatMap((client) => {
    const first = client.rounds.filter(isMailed).sort((a, b) => a.number - b.number)[0];
    return first && within(first.mailedAt) && client.agreementSignedAt ? [(new Date(first.mailedAt!).getTime() - new Date(client.agreementSignedAt).getTime()) / DAY_MS] : [];
  });
  const removed = clients.flatMap((client) =>
    client.rounds.flatMap((round) => (round.results ?? []).filter((r) => r.outcome === "removed" && within(r.reportDate)).map((r) => `${client.id}:${r.fingerprint}`)),
  );
  const working = active.filter((c) => lastMailed(c));

  // Money: the billing records as they are.
  const charges = clients.flatMap((c) => c.billing.charges);
  const charged = charges.filter((ch) => ch.chargedAt && within(ch.chargedAt));
  const refunds = charges.flatMap((ch) => (ch.refund && within(ch.refund.completedAt ?? ch.refund.at) ? [ch.refund] : []));
  const failed = charges.filter((ch) => ch.status === "failed" && within(ch.lastAttemptAt));
  const recovered = charged.filter((ch) => ch.attempts > 1);
  const horizon = now.getTime() + 30 * DAY_MS;
  const scheduled = clients.flatMap((client) => {
    if (client.agreementCancelledAt) return [];
    const outlook = clientBillingOutlook(client, now);
    if ((outlook.kind !== "charge_scheduled" && outlook.kind !== "retry_scheduled") || !outlook.at) return [];
    if (new Date(outlook.at).getTime() > horizon) return [];
    const cents = outlook.kind === "retry_scheduled" ? (unpaidCharge(client.billing)?.amountCents ?? 0) : (feeToCents(client.agreementMonthlyFee) ?? 0);
    return cents > 0 ? [cents] : [];
  });
  const chargedCents = sum(charged.map((ch) => ch.amountCents));
  const refundedCents = sum(refunds.map((r) => r.amountCents));
  const netCents = chargedCents - refundedCents;

  // Team: everyone who is on it, and anyone no longer active who did something in the period.
  const team: MemberMetrics[] = members
    .map((member) => {
      const mine = clients.filter((c) => c.assignedTo === member.handle && !endedAt(c));
      return {
        handle: member.handle,
        name: member.name,
        role: member.role,
        active: member.active,
        assigned: mine.length,
        roundsSent: mailedInRange.filter(({ round }) => round.sentBy && actorHandle(members, round.sentBy) === member.handle).length,
        replies: clients.flatMap((c) => c.conversation ?? []).filter((m) => m.source === "human" && within(m.at) && actorHandle(members, m.authorName) === member.handle).length,
        openExceptions: sum(mine.map((c) => clientExceptions(c, now).length)),
      };
    })
    .filter((m) => m.active || m.roundsSent > 0 || m.replies > 0);

  // Salespeople: whoever a client is credited to, and every member in sales.
  const sellers = [...new Set([...clients.map((c) => c.salesperson), ...members.filter((m) => m.role === "sales").map((m) => m.handle)])];
  const sales: SalesMetrics[] = sellers
    .map((handle) => {
      const theirs = clients.filter((c) => c.salesperson === handle);
      return {
        handle,
        name: memberName(members, handle),
        invites: theirs.filter((c) => within(c.createdAt)).length,
        signed: theirs.filter((c) => within(c.agreementSignedAt)).length,
        cancelled: theirs.filter((c) => within(c.agreementCancelledAt)).length,
      };
    })
    .sort((a, b) => b.invites - a.invites || b.signed - a.signed || a.name.localeCompare(b.name, "es"));

  return {
    period,
    range,
    clients: {
      newLeads: leads.length,
      signed: clients.filter((c) => within(c.agreementSignedAt)).length,
      cancelled: clients.filter((c) => within(c.agreementCancelledAt)).length,
      active: active.length,
      paused: clients.filter((c) => clientStage(c, now) === "paused").length,
      ended: ended.length,
      conversion: leads.length === 0 ? null : leads.filter((c) => c.agreementSignedAt).length / leads.length,
      churn: inForceDuringRange.length === 0 ? null : stoppedInRange.filter((c) => inForceDuringRange.includes(c)).length / inForceDuringRange.length,
    },
    work: {
      roundsMailed: mailedInRange.length,
      lettersMailed: sum(mailedInRange.map(({ round }) => round.letters.length)),
      itemsDisputed: sum(mailedInRange.map(({ round }) => roundItemCount(round))),
      itemsNoLongerReported: new Set(removed).size,
      daysToFirstRound: firstRounds.length === 0 ? null : sum(firstRounds) / firstRounds.length,
      roundsOverdue: working.filter((c) => behindCycle(c, now)).length,
      inCycle: working.length,
    },
    money: {
      chargedCents,
      refundedCents,
      netCents,
      failedCount: failed.length,
      failedCents: sum(failed.map((ch) => ch.amountCents)),
      recoveredCount: recovered.length,
      recoveredCents: sum(recovered.map((ch) => ch.amountCents)),
      scheduledCount: scheduled.length,
      scheduledCents: sum(scheduled),
      revenuePerActiveCents: active.length === 0 ? null : Math.round(netCents / active.length),
    },
    team,
    sales,
  };
}

// ── By month, for the charts ────────────────────────────────────────────

export interface MonthPoint {
  /** "2026-11". */
  key: string;
  /** "nov". */
  label: string;
  leads: number;
  signed: number;
  roundsMailed: number;
  netCents: number;
}

/** The last `months` calendar months in Texas, oldest first, the current one last (partial). */
export function monthlySeries(clients: StaffClient[], now: Date, months = 6): MonthPoint[] {
  const { year, month } = texasParts(now);
  const points: MonthPoint[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const index = year * 12 + (month - 1) - back;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const from = startOfTexasMonth(y, m);
    const next = startOfTexasMonth(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
    const range: PeriodRange = { from, to: new Date(Math.min(next.getTime() - 1, now.getTime())) };
    const within = (iso: string | null | undefined) => inRange(iso, range);
    const charges = clients.flatMap((c) => c.billing.charges);
    const charged = sum(charges.filter((ch) => within(ch.chargedAt)).map((ch) => ch.amountCents));
    const refunded = sum(charges.flatMap((ch) => (ch.refund && within(ch.refund.completedAt ?? ch.refund.at) ? [ch.refund.amountCents] : [])));
    points.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: from.toLocaleDateString("es-MX", { month: "short", timeZone: STAFF_TIME_ZONE }).replace(".", ""),
      leads: clients.filter((c) => within(c.createdAt)).length,
      signed: clients.filter((c) => within(c.agreementSignedAt)).length,
      roundsMailed: clients.flatMap((c) => c.rounds).filter((r) => isMailed(r) && within(r.mailedAt)).length,
      netCents: charged - refunded,
    });
  }
  return points;
}

/** "62%", or "—" when there is nothing to divide. */
export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
