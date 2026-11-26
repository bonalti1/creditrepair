import { MINUTES_BY_KIND, workQueue } from "../autopilot/queue";
import { DEFAULT_AUTOPILOT, NO_CHANNELS, type AutopilotEnv } from "../autopilot/types";
import { unpaidCharge } from "../billing/dunning";
import type { FurnisherEntry } from "../mail/furnishers";
import { exceptionKindOfKey } from "./guard";
import { collectedCents, feeEstimateCents } from "../billing/invoices";
import { planOption, type PlanType } from "../billing/plans";
import type { ServiceOption } from "../service/options";
import { feeToCents } from "../billing/rules";
import { upcomingCharges } from "../billing/schedule";
import { nextRoundDueForStaffRound } from "../rounds/timing";
import { actorHandle } from "./activity";
import { pulseSummary, type PulseSummary } from "../pulse/pulse";
import { clientBilling, clientBillingOutlook, clientExceptions, clientOption, clientStage, daysSince, roundItemCount, STAFF_TIME_ZONE } from "./stage";
import { memberName, type TeamMember } from "./team";
import type { StaffClient, StaffRole, StaffRound } from "./types";
import { dateLocale, type StaffLocale } from "./i18n/locale";

// The numbers an owner checks, from the same records the console shows.
//
// Every number has a written definition (METRIC_INFOS, in English and
// Spanish) that the dashboard shows beside it, so nobody has to guess what
// was counted. Two rules hold
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

export const PERIOD_LABELS: Record<StaffLocale, Record<Period, string>> = {
  en: { month: "This month", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" },
  es: { month: "Este mes", "30d": "Últimos 30 días", "90d": "Últimos 90 días", all: "Desde el inicio" },
};

/** The Spanish names, as they always read (the partners' screens use them). */
export const PERIOD_LABEL: Record<Period, string> = PERIOD_LABELS.es;

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
  | "revenueByPlan"
  | "achShare"
  | "feesEstimate"
  | "chargebackRate"
  | "humanMinutesPerActive"
  | "pulse"
  | "pulseAnswers"
  | "memberAssigned"
  | "memberRounds"
  | "memberReplies"
  | "memberExceptions"
  | "salesInvites"
  | "salesSigned"
  | "salesCancelled";

export type MetricInfo = { label: string; definition: string };

const METRIC_INFO_ES: Record<MetricKey, MetricInfo> = {
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
    label: "Atrasadas vs. su fecha de siguiente ronda",
    definition:
      "Hoy: clientes con trabajo en curso cuya última ronda ya pasó su fecha de siguiente ronda y no tienen otra enviada. La fecha sale de la regla de rounds/timing.ts: 30 días desde que el buró recibió las cartas (entrega certificada, o envío + 5 días), más 5 días para su respuesta; nunca más de 45 días desde el envío salvo que el plazo legal termine después.",
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
  revenueByPlan: { label: "Cobrado por tipo de plan", definition: "Lo cobrado en el periodo, por el tipo de plan del acuerdo firmado. «Por ronda (anterior)»: acuerdos firmados antes de los planes." },
  achShare: { label: "ACH frente a tarjeta", definition: "Parte de lo cobrado en el periodo que se pagó con cuenta bancaria (ACH). El resto, con tarjeta." },
  feesEstimate: { label: "Comisiones del procesador (estimado)", definition: "Lo que el procesador se queda de lo cobrado en el periodo, con las tarifas configuradas (NEXT_PUBLIC_BILLING_FEE_*). Es un estimado: la cifra real está en el estado de cuenta del procesador." },
  chargebackRate: { label: "Contracargos por cobro", definition: "Contracargos recibidos en el periodo entre cobros que tomaron dinero en el periodo, por número. Los procesadores suelen actuar cerca del 1%." },
  humanMinutesPerActive: {
    label: "Minutos de trabajo humano por cliente activo",
    definition:
      "Los avisos de «Necesita una persona» que el equipo marcó como atendidos en el periodo, más los que esperan hoy, cada uno con sus minutos estimados (Piloto automático), divididos entre los clientes activos de hoy. Lo que el sistema hace solo (recordatorios, avisos, envíos) no cuenta. Es un estimado, no un registro de horas.",
  },
  pulse: {
    label: "¿Cómo vamos? (promedio)",
    definition:
      "Promedio de las respuestas a «¿Cómo vamos?» dadas en el periodo: 1 = no muy bien, 2 = más o menos, 3 = bien. Una respuesta por cliente por momento (firmó su acuerdo, salieron sus primeras cartas, llegó la primera respuesta). Las preguntas que el cliente saltó no cuentan. Pregunta por el servicio, nunca por resultados.",
  },
  pulseAnswers: {
    label: "Respuestas a «¿Cómo vamos?»",
    definition: "Cuántas respuestas dieron los clientes en el periodo, y cuántas de cada cara. Solo de los clientes que tu rol puede ver.",
  },
  memberAssigned: { label: "Clientes", definition: "Hoy: clientes asignados a la persona, sin contar los que terminaron." },
  memberRounds: { label: "Rondas", definition: "Rondas que la persona envió en el periodo." },
  memberReplies: { label: "Respuestas", definition: "Mensajes que la persona escribió al cliente en la app en el periodo." },
  memberExceptions: { label: "Avisos abiertos", definition: "Hoy: avisos de «Necesita una persona» de sus clientes asignados." },
  salesInvites: { label: "Prospectos", definition: "Prospectos que la persona trajo, con primer contacto en el periodo." },
  salesSigned: { label: "Firmaron", definition: "Acuerdos firmados en el periodo por clientes que la persona trajo." },
  salesCancelled: { label: "Cancelaron", definition: "Cancelaciones en el periodo de clientes que la persona trajo." },
};

const METRIC_INFO_EN: Record<MetricKey, MetricInfo> = {
  newLeads: { label: "New leads", definition: "People whose first contact with sales was in the period, by invite or added by hand." },
  signed: { label: "Agreements signed", definition: "Service agreements signed in the period." },
  cancelled: { label: "Cancellations", definition: "Clients who cancelled their agreement in the period, inside or outside the 3-business-day window." },
  active: { label: "Active today", definition: "Today: agreement signed and in effect (not cancelled, no request to end) and the case isn't paused." },
  paused: { label: "Paused today", definition: "Today: cases paused for a charge that didn't go through, or because the client didn't mark anything as inaccurate." },
  ended: { label: "Ended", definition: "Today: clients who cancelled their agreement or asked to end the service. Their record is kept." },
  conversion: {
    label: "Lead → agreement",
    definition: "Of the leads with first contact in the period, the share that has signed their agreement as of today.",
  },
  churn: {
    label: "Churn",
    definition: "Clients who cancelled or asked to end in the period, out of everyone who had an agreement in effect at some point in the period.",
  },
  roundsMailed: { label: "Rounds mailed", definition: "Rounds marked as mailed in the period, by their mailing date." },
  lettersMailed: { label: "Letters mailed", definition: "Letters in those rounds: one per recipient (bureau or creditor)." },
  itemsDisputed: {
    label: "Items disputed",
    definition: "Distinct items covered by the letters in those rounds. Only items the client confirmed as inaccurate count.",
  },
  itemsNoLongerReported: {
    label: "Items no longer on the report",
    definition:
      "Disputed items that a report imported in the period no longer shows, per each round's record. It doesn't say why, or whether they'll show up again.",
  },
  daysToFirstRound: {
    label: "Days from signing to round 1",
    definition:
      "Average days between signing the agreement and mailing the first round, for first rounds mailed in the period. Includes the 3 business days when work can't start.",
  },
  roundsOverdue: {
    label: "Behind their next-round date",
    definition:
      "Today: clients with work in progress whose last round is past its next-round date and who have no newer one mailed. The date comes from rounds/timing.ts: 30 days from when the bureau received the letters (certified delivery, or mailing + 5 days), plus 5 days for its answer; never more than 45 days from mailing unless the legal window ends later.",
  },
  charged: { label: "Charged", definition: "Charges that went through in the period, by charge date. Includes ones refunded later." },
  refunded: { label: "Refunded", definition: "Refunds made in the period, by their date. Always the full charge." },
  net: { label: "Net", definition: "Charged minus refunded, in the period." },
  failedPayments: {
    label: "Failed charges",
    definition: "Charges still unpaid whose last attempt was declined in the period: the system retries them, or the case was paused.",
  },
  recoveredPayments: { label: "Recovered", definition: "Charges that went through in the period after at least one declined attempt." },
  scheduled30: {
    label: "Scheduled, next 30 days",
    definition:
      "Charges and retries the system already has dated in the next 30 days, only for rounds already mailed and the signed agreement's fee. Rounds that haven't gone out don't count.",
  },
  revenuePerActive: { label: "Net per active client", definition: "The period's net divided by today's active clients." },
  revenueByPlan: { label: "Charged by plan type", definition: "What was charged in the period, by the plan type of the signed agreement. “Per round (before plans)”: agreements signed before plans existed." },
  achShare: { label: "ACH vs card", definition: "Share of what was charged in the period that was paid from a bank account (ACH). The rest was paid by card." },
  feesEstimate: { label: "Processor fees (estimate)", definition: "What the processor keeps of what was charged in the period, at the configured rates (NEXT_PUBLIC_BILLING_FEE_*). An estimate: the real figure is on the processor's statement." },
  chargebackRate: { label: "Chargeback rate", definition: "Chargebacks received in the period divided by charges that took money in the period, by count. Processors commonly act around 1%." },
  humanMinutesPerActive: {
    label: "Minutes of human work per active client",
    definition:
      "“Needs a person” notices the team marked handled in the period, plus the ones waiting today, each with its estimated minutes (Autopilot), divided by today's active clients. What the system does on its own (reminders, notices, mailing) doesn't count. It's an estimate, not a time log.",
  },
  pulse: {
    label: "“How are we doing?” (average)",
    definition:
      "Average of the answers to “How are we doing?” given in the period: 1 = not great, 2 = so-so, 3 = good. One answer per client per moment (signed their agreement, first letters went out, first answer came in). Questions the client skipped don't count. It asks about the service, never about results.",
  },
  pulseAnswers: {
    label: "Answers to “How are we doing?”",
    definition: "How many answers clients gave in the period, and how many of each face. Only from the clients your role can see.",
  },
  memberAssigned: { label: "Clients", definition: "Today: clients assigned to the person, not counting those who ended." },
  memberRounds: { label: "Rounds", definition: "Rounds the person sent in the period." },
  memberReplies: { label: "Replies", definition: "Messages the person wrote to clients in the app in the period." },
  memberExceptions: { label: "Open notices", definition: "Today: “Needs a person” notices for their assigned clients." },
  salesInvites: { label: "Leads", definition: "Leads the person brought in, with first contact in the period." },
  salesSigned: { label: "Signed", definition: "Agreements signed in the period by clients the person brought in." },
  salesCancelled: { label: "Cancelled", definition: "Cancellations in the period by clients the person brought in." },
};

/** Every number's name and how it is counted, in each language. */
export const METRIC_INFOS: Record<StaffLocale, Record<MetricKey, MetricInfo>> = { en: METRIC_INFO_EN, es: METRIC_INFO_ES };

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

/** True when the client's last round is past its next-round date (rounds/timing.ts) and nothing has gone out since. */
export function behindCycle(client: StaffClient, now: Date): boolean {
  const last = lastMailed(client);
  if (!last?.mailedAt || !isActiveClient(client, now)) return false;
  const due = nextRoundDueForStaffRound(last);
  return due !== null && now.getTime() > Date.parse(due.dueAt);
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
    /** By service option (docs/SERVICE-OPTIONS.md): active today and signed in the period. */
    byOption: Record<ServiceOption, { active: number; signed: number }>;
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
    /** Estimated minutes of a person's work: notices handled in the period plus those open today. */
    humanMinutes: number;
    /** Null when there is no active client. */
    humanMinutesPerActive: number | null;
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
    /** What was charged in the period, by plan type ("legacy": signed before plans). */
    byPlanType: Array<{ type: PlanType | "legacy"; cents: number }>;
    /** What was charged in the period, by service option: Credalti Complete and Credalti DIY. */
    byOption: Record<ServiceOption, number>;
    achCents: number;
    cardCents: number;
    /** Null when nothing was charged. */
    achShare: number | null;
    feesEstimateCents: number;
    chargebacks: number;
    /** Null when nothing was charged in the period. */
    chargebackRate: number | null;
  };
  team: MemberMetrics[];
  sales: SalesMetrics[];
  /** "¿Cómo vamos?" over the answers given in the period (src/lib/pulse/pulse.ts: pulseSummary). */
  pulse: PulseSummary;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function businessMetrics(
  clients: StaffClient[],
  members: TeamMember[],
  period: Period,
  now: Date,
  /** The autopilot's switches: what it handles is not a person's work. Left out: everything off. */
  autopilot: AutopilotEnv = { settings: DEFAULT_AUTOPILOT, channels: NO_CHANNELS },
  /** The furnisher address book, so a round waiting for an address counts as it does on the home screen. */
  furnishers?: readonly FurnisherEntry[],
): BusinessMetrics {
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
  // A person's work, in estimated minutes: what was marked handled in the period, plus what waits today.
  const handledMinutes = sum(
    clients.flatMap((c) => Object.entries(c.handled).filter(([, at]) => within(at)).map(([key]) => MINUTES_BY_KIND[exceptionKindOfKey(key)] ?? 0)),
  );
  const openMinutes = sum(workQueue(clients, now, { autopilot, furnishers }).map((item) => item.minutes));
  const humanMinutes = handledMinutes + openMinutes;

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
    const cents =
      outlook.kind === "retry_scheduled"
        ? (unpaidCharge(client.billing)?.amountCents ?? 0)
        : client.agreementPlan
          ? (upcomingCharges(clientBilling(client), now, 1)[0]?.amountCents ?? 0)
          : (feeToCents(client.agreementMonthlyFee) ?? 0);
    return cents > 0 ? [cents] : [];
  });
  const chargedCents = sum(charged.map((ch) => ch.amountCents));
  // By service option: a charge's own plan type decides (a DIY plan is Credalti DIY), else the client's option.
  const chargedByOption: Record<ServiceOption, number> = { full_service: 0, diy: 0 };
  for (const client of clients) {
    for (const ch of client.billing.charges) {
      if (!ch.chargedAt || !within(ch.chargedAt)) continue;
      const type = ch.planType ?? client.agreementPlan?.terms.type ?? null;
      chargedByOption[type ? planOption({ type }) : clientOption(client)] += ch.amountCents;
    }
  }
  const clientsByOption = (option: ServiceOption) => ({
    active: active.filter((c) => clientOption(c) === option).length,
    signed: clients.filter((c) => clientOption(c) === option && within(c.agreementSignedAt)).length,
  });
  // By plan type, by method, the processor's estimated share and the chargebacks of the period.
  const planOf = new Map(clients.flatMap((c) => c.billing.charges.map((ch) => [ch.id, ch.planType ?? c.agreementPlan?.terms.type ?? "legacy"] as const)));
  const methodOf = new Map(clients.flatMap((c) => c.billing.charges.map((ch) => [ch.id, ch.methodKind ?? c.billing.paymentMethod?.kind ?? "card"] as const)));
  const byPlan = new Map<PlanType | "legacy", number>();
  for (const ch of charged) byPlan.set(planOf.get(ch.id) ?? "legacy", (byPlan.get(planOf.get(ch.id) ?? "legacy") ?? 0) + collectedCents(ch));
  const achCents = sum(charged.filter((ch) => methodOf.get(ch.id) === "ach").map(collectedCents));
  const cardCents = sum(charged.filter((ch) => methodOf.get(ch.id) !== "ach").map(collectedCents));
  const feesEstimateCents = sum(charged.map((ch) => feeEstimateCents({ ...ch, methodKind: methodOf.get(ch.id) ?? "card" })));
  const chargebacksInRange = charges.filter((ch) => ch.chargeback && within(ch.chargeback.receivedAt)).length;
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
      byOption: { full_service: clientsByOption("full_service"), diy: clientsByOption("diy") },
    },
    work: {
      roundsMailed: mailedInRange.length,
      lettersMailed: sum(mailedInRange.map(({ round }) => round.letters.length)),
      itemsDisputed: sum(mailedInRange.map(({ round }) => roundItemCount(round))),
      itemsNoLongerReported: new Set(removed).size,
      daysToFirstRound: firstRounds.length === 0 ? null : sum(firstRounds) / firstRounds.length,
      roundsOverdue: working.filter((c) => behindCycle(c, now)).length,
      inCycle: working.length,
      humanMinutes,
      humanMinutesPerActive: active.length === 0 ? null : humanMinutes / active.length,
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
      byPlanType: [...byPlan.entries()].map(([type, cents]) => ({ type, cents })).sort((a, b) => b.cents - a.cents),
      byOption: chargedByOption,
      achCents,
      cardCents,
      achShare: achCents + cardCents === 0 ? null : achCents / (achCents + cardCents),
      feesEstimateCents,
      chargebacks: chargebacksInRange,
      chargebackRate: charged.length === 0 ? null : chargebacksInRange / charged.length,
    },
    team,
    sales,
    pulse: pulseSummary(clients.flatMap((c) => (c.pulses ?? []).filter((p) => within(p.createdAt)))),
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
export function monthlySeries(clients: StaffClient[], now: Date, months = 6, locale: StaffLocale = "es"): MonthPoint[] {
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
      label: from.toLocaleDateString(dateLocale(locale), { month: "short", timeZone: STAFF_TIME_ZONE }).replace(".", ""),
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
