import type { ContentSummary } from "../control/content";
import { leadQuality } from "../leads/metrics";
import type { Lead } from "../leads/types";
import type { StaffLocale } from "../staff/i18n/locale";
import { businessMetrics } from "../staff/metrics";
import type { StaffClient } from "../staff/types";
import type { BasedOn } from "./types";

// The numbers an idea is about, and the numbers Alti reads before proposing
// experiments. Every one is computed by code the console already has (the
// business dashboard's businessMetrics, the lead inbox's leadQuality, the
// Overview's content summary), from the same records; nothing here is a
// number of its own, and nothing carries a client's or a teammate's name: only
// aggregates leave this file.
//
// EXTENSION POINT. Departments built later (Ads, SEO, …) add one entry to
// SIGNAL_SOURCES with their metrics, their labels in both languages and a
// `collect` that reads their own summary from `input.extra[<their id>]`. The
// metric picker, the proposals and the checks pick them up from there; no
// other file changes. A source whose data is missing returns its metrics with
// value null ("No data yet"), never a 0.

export type SignalUnit = "count" | "percent" | "cents" | "minutes" | "days";
export type SignalWindow = "30d" | "7d" | "now";
export type Better = "up" | "down";

export interface MetricDef {
  unit: SignalUnit;
  window: SignalWindow;
  /** Which way is better, so a proposal names the direction it expects. */
  better: Better;
}

export interface Signal {
  key: string;
  source: string;
  value: number | null;
  unit: SignalUnit;
  window: SignalWindow;
  /** The value in plain, language-neutral form ("12%", "$1,234", "35 min"), or "no data". */
  display: string;
}

export interface SignalInput {
  /** The clients the reader may see (an administrator: all). Null when they could not be read. */
  clients: readonly StaffClient[] | null;
  leads: readonly Lead[] | null;
  content: ContentSummary | null;
  now: Date;
  /** What later departments put here for their own source, under its id. */
  extra?: Record<string, unknown>;
}

export interface SignalSource {
  id: string;
  metrics: Record<string, MetricDef>;
  labels: Record<StaffLocale, Record<string, string>>;
  collect(input: SignalInput): Partial<Record<string, number | null>>;
}

const DAY = 24 * 60 * 60 * 1000;

const BUSINESS: SignalSource = {
  id: "business",
  metrics: {
    leads_new: { unit: "count", window: "30d", better: "up" },
    signed: { unit: "count", window: "30d", better: "up" },
    conversion: { unit: "percent", window: "30d", better: "up" },
    cancelled: { unit: "count", window: "30d", better: "down" },
    churn: { unit: "percent", window: "30d", better: "down" },
    active_clients: { unit: "count", window: "now", better: "up" },
    days_to_first_round: { unit: "days", window: "30d", better: "down" },
    rounds_mailed: { unit: "count", window: "30d", better: "up" },
    rounds_overdue: { unit: "count", window: "now", better: "down" },
    human_minutes_per_active: { unit: "minutes", window: "30d", better: "down" },
    net_charged: { unit: "cents", window: "30d", better: "up" },
    failed_payments: { unit: "count", window: "30d", better: "down" },
    recovered_payments: { unit: "count", window: "30d", better: "up" },
    chargeback_rate: { unit: "percent", window: "30d", better: "down" },
    ach_share: { unit: "percent", window: "30d", better: "up" },
  },
  labels: {
    en: {
      leads_new: "New leads",
      signed: "Clients who signed",
      conversion: "Leads who signed",
      cancelled: "Cancellations",
      churn: "Churn",
      active_clients: "Active clients",
      days_to_first_round: "Days from signing to the first round",
      rounds_mailed: "Rounds mailed",
      rounds_overdue: "Rounds behind schedule",
      human_minutes_per_active: "A person's minutes per active client",
      net_charged: "Net charged",
      failed_payments: "Failed payments",
      recovered_payments: "Payments recovered",
      chargeback_rate: "Chargeback rate",
      ach_share: "Share paid by bank debit (ACH)",
    },
    es: {
      leads_new: "Prospectos nuevos",
      signed: "Clientes que firmaron",
      conversion: "Prospectos que firmaron",
      cancelled: "Cancelaciones",
      churn: "Bajas",
      active_clients: "Clientes activos",
      days_to_first_round: "Días de la firma a la primera ronda",
      rounds_mailed: "Rondas enviadas",
      rounds_overdue: "Rondas atrasadas",
      human_minutes_per_active: "Minutos de una persona por cliente activo",
      net_charged: "Neto cobrado",
      failed_payments: "Pagos fallidos",
      recovered_payments: "Pagos recuperados",
      chargeback_rate: "Tasa de contracargos",
      ach_share: "Parte pagada por débito bancario (ACH)",
    },
  },
  collect({ clients, now }) {
    if (!clients) return {};
    const m = businessMetrics([...clients], [], "30d", now);
    return {
      leads_new: m.clients.newLeads,
      signed: m.clients.signed,
      conversion: m.clients.conversion,
      cancelled: m.clients.cancelled,
      churn: m.clients.churn,
      active_clients: m.clients.active,
      days_to_first_round: m.work.daysToFirstRound,
      rounds_mailed: m.work.roundsMailed,
      rounds_overdue: m.work.roundsOverdue,
      human_minutes_per_active: m.work.humanMinutesPerActive,
      net_charged: m.money.netCents,
      failed_payments: m.money.failedCount,
      recovered_payments: m.money.recoveredCount,
      chargeback_rate: m.money.chargebackRate,
      ach_share: m.money.achShare,
    };
  },
};

const LEADS: SignalSource = {
  id: "leads",
  metrics: {
    leads_week: { unit: "count", window: "7d", better: "up" },
    lead_first_reply: { unit: "minutes", window: "30d", better: "down" },
    lead_contacted_rate: { unit: "percent", window: "30d", better: "up" },
    lead_invited_rate: { unit: "percent", window: "30d", better: "up" },
    lead_signed_rate: { unit: "percent", window: "30d", better: "up" },
    partner_referrals_week: { unit: "count", window: "7d", better: "up" },
  },
  labels: {
    en: {
      leads_week: "Leads this week",
      lead_first_reply: "Time to a person's first reply (median)",
      lead_contacted_rate: "Leads contacted",
      lead_invited_rate: "Leads invited",
      lead_signed_rate: "Leads signed (lead inbox)",
      partner_referrals_week: "Partner referrals this week",
    },
    es: {
      leads_week: "Prospectos esta semana",
      lead_first_reply: "Tiempo a la primera respuesta de una persona (mediana)",
      lead_contacted_rate: "Prospectos contactados",
      lead_invited_rate: "Prospectos invitados",
      lead_signed_rate: "Prospectos que firmaron (bandeja)",
      partner_referrals_week: "Referidos de socios esta semana",
    },
  },
  collect({ leads, now }) {
    if (!leads) return {};
    const q = leadQuality(leads, now);
    const weekAgo = now.getTime() - 7 * DAY;
    return {
      leads_week: q.week.total,
      lead_first_reply: q.medianFirstReplyMinutes,
      lead_contacted_rate: q.contacted.value,
      lead_invited_rate: q.invited.value,
      lead_signed_rate: q.signed.value,
      partner_referrals_week: leads.filter((l) => (l.source === "partner" || l.firstTouch?.partnerId) && Date.parse(l.createdAt) >= weekAgo).length,
    };
  },
};

const CONTENT: SignalSource = {
  id: "content",
  metrics: {
    content_posted_week: { unit: "count", window: "7d", better: "up" },
    content_scheduled_week: { unit: "count", window: "7d", better: "up" },
    content_waiting_review: { unit: "count", window: "now", better: "down" },
    content_failed: { unit: "count", window: "now", better: "down" },
  },
  labels: {
    en: {
      content_posted_week: "Posts made this week",
      content_scheduled_week: "Posts scheduled this week",
      content_waiting_review: "Pieces waiting for review",
      content_failed: "Posts that failed",
    },
    es: {
      content_posted_week: "Publicaciones hechas esta semana",
      content_scheduled_week: "Publicaciones programadas esta semana",
      content_waiting_review: "Piezas esperando revisión",
      content_failed: "Publicaciones que fallaron",
    },
  },
  collect({ content }) {
    if (!content) return {};
    return {
      content_posted_week: content.postedThisWeek,
      content_scheduled_week: content.scheduledThisWeek,
      content_waiting_review: content.review.length,
      content_failed: content.failed.length,
    };
  },
};

/** Every source of numbers, in the order the screen lists them. Later departments add theirs here. */
export const SIGNAL_SOURCES: readonly SignalSource[] = [BUSINESS, LEADS, CONTENT];

/** "Other": an idea about something the console does not count yet. */
export const OTHER_METRIC = "other";

/** Every metric an idea may name, with its unit and direction. */
export const IDEA_METRICS: Record<string, MetricDef & { source: string }> = Object.fromEntries(
  SIGNAL_SOURCES.flatMap((s) => Object.entries(s.metrics).map(([key, def]) => [key, { ...def, source: s.id }])),
);

/** The metrics' names, in both languages (the staff language test walks this table). */
export const IDEA_METRIC_LABELS: Record<StaffLocale, Record<string, string>> = {
  en: { ...Object.assign({}, ...SIGNAL_SOURCES.map((s) => s.labels.en)), [OTHER_METRIC]: "Something not counted yet" },
  es: { ...Object.assign({}, ...SIGNAL_SOURCES.map((s) => s.labels.es)), [OTHER_METRIC]: "Algo que todavía no se cuenta" },
};

export function isIdeaMetric(key: string): boolean {
  return key === OTHER_METRIC || Object.hasOwn(IDEA_METRICS, key);
}

export function metricLabel(key: string, locale: StaffLocale): string {
  return IDEA_METRIC_LABELS[locale][key] ?? key;
}

/** A value in plain form: "12%", "$1,234", "35 min", "4.5 days"; "no data" when there is none. */
export function formatSignal(value: number | null, unit: SignalUnit, locale: StaffLocale = "en"): string {
  if (value === null || !Number.isFinite(value)) return locale === "es" ? "sin datos" : "no data";
  switch (unit) {
    case "percent":
      return `${Math.round(value * 100)}%`;
    case "cents":
      return `$${Math.round(value / 100).toLocaleString("en-US")}`;
    case "minutes":
      return `${Math.round(value)} min`;
    case "days":
      return locale === "es" ? `${value.toFixed(1)} días` : `${value.toFixed(1)} days`;
    default:
      return String(Math.round(value));
  }
}

/** Every signal every source can read now. A source that throws gives its metrics as "no data". */
export function collectSignals(input: SignalInput, sources: readonly SignalSource[] = SIGNAL_SOURCES): Signal[] {
  const out: Signal[] = [];
  for (const source of sources) {
    let values: Partial<Record<string, number | null>> = {};
    try {
      values = source.collect(input);
    } catch {
      values = {};
    }
    for (const [key, def] of Object.entries(source.metrics)) {
      const raw = values[key];
      const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
      out.push({ key, source: source.id, value, unit: def.unit, window: def.window, display: formatSignal(value, def.unit) });
    }
  }
  return out;
}

/** The numbers a proposal cites, filled in from the snapshot (never from what the model wrote). */
export function basedOnFrom(keys: readonly string[], signals: readonly Signal[]): BasedOn[] {
  const byKey = new Map(signals.map((s) => [s.key, s]));
  return [...new Set(keys)].flatMap((key) => {
    const s = byKey.get(key);
    return s && s.value !== null ? [{ key, value: s.value, unit: s.unit, display: s.display }] : [];
  });
}
