import type { QueueItem } from "../autopilot/queue";
import { effectiveStage, isClosed, waitingSince } from "../leads/inbox";
import type { Lead } from "../leads/types";
import { clientStage, type Stage } from "../staff/stage";
import type { StaffClient } from "../staff/types";
import type { Capability } from "../staff/permissions";
import { localDay } from "../autopilot/clock";
import { STAFF_TIME_ZONE } from "../staff/stage";
import type { StaffLocale } from "../staff/i18n/locale";
import { businessMetrics, inRange, periodRange } from "../staff/metrics";
import { formatCents } from "../accounting/money";
import type { BooksSnapshot } from "./books";
import { contentNeeds, type ContentSummary } from "./content";
import type { AdsSummary } from "../ads/report";

// The Overview (docs/CONTROL.md): one card per department, each with real
// numbers from the records and a "Needs you" count that opens the right
// screen. Pure. ALTO Control's "real numbers" rule: a number we could not
// read, or that has nothing behind it, is "No data yet" with the reason,
// never a 0 that looks like a result. A count that IS zero (we read the
// records and nothing is there) is a real 0.
//
// Each card shows only for a role that may see it: Money needs billing.view
// (never sales), and adds this month's books for `accounting` (the owner);
// Leads needs leads.work, Content content.view, Partners partners.view, Tech
// health business.view.

export type CardKey = "leads" | "clients" | "money" | "content" | "ads" | "support" | "partners" | "health";

export interface CardMetric {
  key: string;
  label: string;
  /** Null: no data, and `why` says why. */
  value: string | null;
  why?: string;
  /** A short note under the value ("of 12 leads"). */
  hint?: string;
}

export interface DeptCard {
  key: CardKey;
  title: string;
  metrics: CardMetric[];
  /** What needs a person here; null count: we could not tell. */
  needsYou: { count: number | null; href: string; label: string };
  /** The department's own screen, under the numbers ("Open Accounting"). */
  link?: { href: string; label: string };
}

/** What the server adds that the clients list does not carry (or the demo's stand-in). Null fields: not readable. */
export interface ControlExtras {
  partnerNotesWaiting: number | null;
  reviewRequests30d: number | null;
  complaints7d: number | null;
  escalations: Array<{ id: string; key: string; title: string; note: string | null; by: string; at: string }> | null;
  health: HealthSignal[] | null;
  /** Why the server-side numbers are missing, when they all are (the demo, a read error). */
  unavailable?: string | null;
  /** The content board in numbers (control/content.ts), for content.view; null: not for this role, or it could not be read. */
  content?: ContentSummary | null;
  /** The Ads Manager's last 7 days (src/lib/ads/report.ts adsSummary), for ads.view; null: not for this role, or it could not be read. */
  ads?: AdsSummary | null;
}

export type HealthKey = "whatsapp_inbound" | "highlevel_lead" | "lob_event" | "autopilot_message" | "cron_leads" | "staff_digest";

export interface HealthSignal {
  key: HealthKey;
  /** When it last happened; null: never seen. */
  lastAt: string | null;
  /** How often it should happen at least, in hours (null: no expectation, e.g. no leads yet). */
  expectHours: number | null;
}

export interface OverviewInput {
  clients: readonly StaffClient[];
  queue: readonly QueueItem[];
  /** Null: the role does not work leads, or they could not be read (then `leadsError`). */
  leads: readonly Lead[] | null;
  leadsError?: string | null;
  extras: ControlExtras | null;
  money: { collectedCents: number; collectedCount: number; failedCount: number; failedCents: number; scheduledCount: number; scheduledCents: number; anyCharge: boolean } | null;
  /** This month in the books (control/books.ts, the accounting module's money rule). Only for `accounting`; null otherwise or until the books are read. */
  books?: BooksSnapshot | null;
  /** The member's handle: whose «Changes requested» are theirs on the Content card. */
  handle?: string | null;
  can: (capability: Capability) => boolean;
  now: Date;
  locale: StaffLocale;
}

const DAY = 24 * 60 * 60 * 1000;

const T = {
  en: {
    noData: "No data yet",
    cards: { leads: "Leads & sales", clients: "Clients in progress", money: "Money", content: "Content", ads: "Ads", support: "Support", partners: "Partners", health: "Tech health" },
    needsYou: "Needs you",
    leads: {
      open: "Open leads",
      today: "New today",
      waiting: "Waiting on a person",
      handoff: "Handed over by the autopilot",
      none: "No lead has arrived yet. They show up here as soon as one writes on WhatsApp, fills a HighLevel form, is referred by a partner or starts the chat signup.",
      readError: "The leads could not be read right now.",
    },
    clients: {
      signed: "Signed, in the 3-day window",
      documents: "Waiting on documents",
      review: "Report and review",
      ready: "Rounds ready to mail",
      bureaus: "Mailed, waiting on the bureaus",
      results: "New report in",
      aftercare: "Finished, in after-care",
      paused: "Paused",
      none: "No client has signed yet.",
    },
    money: {
      collected: "Charged this month (before refunds)",
      failed: "Charges that failed",
      pending: "Scheduled, next 30 days",
      none: "No charge has been made yet. A charge only happens after a round is mailed.",
      count: (n: number) => `${n} ${n === 1 ? "charge" : "charges"}`,
      netRevenue: "Net revenue this month (books)",
      expenses: "Expenses this month",
      profit: "Net profit this month",
      otherCosts: (amount: string) => `plus ${amount} in fees`,
      estimate: "estimate",
      profitHint: "Cash basis; test charges left out",
      booksNone: "Nothing in the books this month yet: no payment taken and no expense recorded.",
      openBooks: "Open Accounting",
    },
    content: {
      review: "Waiting for review",
      scheduled: "Scheduled to post this week",
      approvedNotScheduled: (n: number) => `${n} approved, not scheduled`,
      posted: "Posted this week",
      failed: "Failed posts",
      publishing: "Automatic publishing",
      on: (n: number) => `On · ${n} ${n === 1 ? "channel" : "channels"}`,
      off: "Off",
      none: "No piece on the board yet. Pieces show up here as soon as someone starts one in Content.",
      readError: "The content board could not be read right now.",
      open: "Open Content",
    },
    ads: {
      spend: "Ad spend, 7 days (Meta)",
      leads: "Leads from ads, 7 days",
      costPerLead: "Cost per lead (Credalti)",
      turnOff: "Ads to turn off, still spending",
      signed: (n: number) => `${n} signed`,
      sample: "Sample numbers: the demo has no Meta account.",
      notConnected: "Meta is not connected yet: no spend is read. See Ads, Platforms.",
      readError: "The ads could not be read right now.",
      open: "Open Ads",
    },
    support: {
      questions: "Client questions waiting",
      leadsWaiting: "Lead conversations waiting",
      complaints: "Possible complaints, 7 days",
      reviews: "Review requests sent, 30 days",
    },
    partners: { referrals: "New referrals, 7 days", notes: "Partner notes waiting for the team" },
    health: {
      whatsapp_inbound: "Last WhatsApp message received",
      highlevel_lead: "Last lead from HighLevel",
      lob_event: "Last mail update from Lob",
      autopilot_message: "Last automatic message to a client",
      cron_leads: "Leads job (autopilot and alerts) last ran",
      staff_digest: "Last morning summary sent",
      never: "Never yet",
      late: (h: number) => `Expected at least every ${h} h`,
    },
    unavailableDemo: "The demo has no database, so there is nothing to read.",
    healthLink: "Full check-up: System health",
  },
  es: {
    noData: "Todavía sin datos",
    cards: { leads: "Prospectos y ventas", clients: "Clientes en proceso", money: "Dinero", content: "Contenido", ads: "Anuncios", support: "Atención", partners: "Socios", health: "Estado técnico" },
    needsYou: "Te necesita",
    leads: {
      open: "Prospectos abiertos",
      today: "Nuevos hoy",
      waiting: "Esperan a una persona",
      handoff: "Pasados por el piloto automático",
      none: "Todavía no llega ningún prospecto. Aparecen aquí en cuanto alguien escribe por WhatsApp, llena un formulario de HighLevel, lo refiere un socio o empieza el registro con Alti.",
      readError: "No se pudieron leer los prospectos ahora.",
    },
    clients: {
      signed: "Firmaron, en los 3 días",
      documents: "Faltan documentos",
      review: "Reporte y revisión",
      ready: "Rondas listas para enviar",
      bureaus: "Enviadas, esperan a los burós",
      results: "Llegó un reporte nuevo",
      aftercare: "Terminaron, en seguimiento",
      paused: "En pausa",
      none: "Todavía no firma ningún cliente.",
    },
    money: {
      collected: "Cobrado este mes (antes de reembolsos)",
      failed: "Cobros que no pasaron",
      pending: "Programado, próximos 30 días",
      none: "Todavía no se ha hecho ningún cobro. Solo se cobra después de enviar una ronda.",
      count: (n: number) => `${n} ${n === 1 ? "cobro" : "cobros"}`,
      netRevenue: "Ingreso neto del mes (libros)",
      expenses: "Gastos del mes",
      profit: "Ganancia neta del mes",
      otherCosts: (amount: string) => `más ${amount} en comisiones`,
      estimate: "estimado",
      profitHint: "Base de caja; sin cobros de prueba",
      booksNone: "Todavía no hay nada en los libros este mes: ni pagos cobrados ni gastos registrados.",
      openBooks: "Abrir Contabilidad",
    },
    content: {
      review: "Esperan revisión",
      scheduled: "Programadas para esta semana",
      approvedNotScheduled: (n: number) => `${n} ${n === 1 ? "aprobada" : "aprobadas"} sin programar`,
      posted: "Publicadas esta semana",
      failed: "Publicaciones fallidas",
      publishing: "Publicación automática",
      on: (n: number) => `Encendida · ${n} ${n === 1 ? "canal" : "canales"}`,
      off: "Apagada",
      none: "Todavía no hay piezas en el tablero. Aparecen aquí en cuanto alguien empieza una en Contenido.",
      readError: "No se pudo leer el tablero de contenido ahora.",
      open: "Abrir Contenido",
    },
    ads: {
      spend: "Gasto en anuncios, 7 días (Meta)",
      leads: "Prospectos de anuncios, 7 días",
      costPerLead: "Costo por prospecto (Credalti)",
      turnOff: "Anuncios por apagar que siguen gastando",
      signed: (n: number) => `${n} ${n === 1 ? "firmado" : "firmados"}`,
      sample: "Números de muestra: la demo no tiene cuenta de Meta.",
      notConnected: "Meta todavía no está conectada: no se lee ningún gasto. Ve a Anuncios, Plataformas.",
      readError: "No se pudieron leer los anuncios ahora.",
      open: "Abrir Anuncios",
    },
    support: {
      questions: "Preguntas de clientes esperando",
      leadsWaiting: "Conversaciones de prospectos esperando",
      complaints: "Posibles quejas, 7 días",
      reviews: "Pedidos de reseña enviados, 30 días",
    },
    partners: { referrals: "Referidos nuevos, 7 días", notes: "Notas de socios esperando al equipo" },
    health: {
      whatsapp_inbound: "Último mensaje de WhatsApp recibido",
      highlevel_lead: "Último prospecto de HighLevel",
      lob_event: "Última noticia del correo (Lob)",
      autopilot_message: "Último mensaje automático a un cliente",
      cron_leads: "Última vez que corrió el trabajo de prospectos",
      staff_digest: "Último resumen de la mañana enviado",
      never: "Nunca todavía",
      late: (h: number) => `Debería pasar al menos cada ${h} h`,
    },
    unavailableDemo: "La demo no tiene base de datos, así que no hay nada que leer.",
    healthLink: "Revisión completa: Salud del sistema",
  },
} as const;

export const OVERVIEW_TEXT = T;

export function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "3 h ago", "2 d ago", "hace 3 h". */
export function ago(iso: string, now: Date, locale: StaffLocale): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  const span = minutes < 60 ? `${minutes} min` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / (24 * 60))} d`;
  return locale === "es" ? `hace ${span}` : `${span} ago`;
}

const CLIENT_GROUPS: Array<[keyof (typeof T)["en"]["clients"], readonly Stage[]]> = [
  ["signed", ["cancellation_window"]],
  ["documents", ["documents_pending"]],
  ["review", ["report_pending", "client_review_pending"]],
  ["ready", ["ready_to_send", "next_round_ready"]],
  ["bureaus", ["waiting_on_bureaus"]],
  ["results", ["results_in"]],
  ["paused", ["paused"]],
];

export function overviewCards(input: OverviewInput): DeptCard[] {
  const t = T[input.locale];
  const { now } = input;
  const cards: DeptCard[] = [];
  const num = (n: number) => String(n);
  const noData = (key: string, label: string, why: string): CardMetric => ({ key, label, value: null, why });

  // Leads & sales.
  if (input.can("leads.work")) {
    const leads = input.leads;
    if (!leads) {
      const why = input.leadsError ?? t.leads.readError;
      cards.push({
        key: "leads",
        title: t.cards.leads,
        metrics: [noData("open", t.leads.open, why)],
        needsYou: { count: null, href: "/equipo/leads", label: t.needsYou },
      });
    } else {
      const today = localDay(now, STAFF_TIME_ZONE);
      const open = leads.filter((l) => !isClosed(effectiveStage(l)));
      const waiting = leads.filter((l) => waitingSince(l));
      const handoffs = leads.filter((l) => l.handoff);
      const fresh = leads.filter((l) => effectiveStage(l) !== "archived" && localDay(new Date(l.createdAt), STAFF_TIME_ZONE) === today);
      const metrics: CardMetric[] =
        leads.length === 0
          ? [noData("open", t.leads.open, t.leads.none)]
          : [
              { key: "open", label: t.leads.open, value: num(open.length) },
              { key: "today", label: t.leads.today, value: num(fresh.length) },
              { key: "waiting", label: t.leads.waiting, value: num(waiting.length) },
              { key: "handoff", label: t.leads.handoff, value: num(handoffs.length) },
            ];
      const needs = new Set([...waiting, ...handoffs].map((l) => l.id)).size;
      cards.push({ key: "leads", title: t.cards.leads, metrics, needsYou: { count: needs, href: "/equipo/leads?filtro=waiting", label: t.needsYou } });
    }
  }

  // Clients in progress.
  const working = input.clients.filter((c) => c.agreementSignedAt && !c.agreementCancelledAt);
  const byStage = new Map<Stage, number>();
  for (const client of working) byStage.set(clientStage(client, now), (byStage.get(clientStage(client, now)) ?? 0) + 1);
  const aftercare = working.filter((c) => c.graduation).length;
  const fulfilment = input.queue.filter((q) => q.exception.kind !== "agreement_unsigned");
  cards.push({
    key: "clients",
    title: t.cards.clients,
    metrics:
      working.length === 0
        ? [noData("signed", t.clients.signed, t.clients.none)]
        : [
            ...CLIENT_GROUPS.map(([key, stages]) => ({ key, label: t.clients[key], value: num(stages.reduce((n, s) => n + (byStage.get(s) ?? 0), 0)) })),
            { key: "aftercare", label: t.clients.aftercare, value: num(aftercare) },
          ],
    needsYou: { count: fulfilment.length, href: "/equipo", label: t.needsYou },
  });

  // Money: never for sales. The owner (accounting) also sees this month in the books.
  if (input.can("billing.view")) {
    const m = input.money;
    const moneyNeeds = input.queue.filter((q) => q.exception.kind === "payment_past_due" || q.exception.kind === "payment_method_missing").length;
    const books = input.can("accounting") ? (input.books ?? null) : null;
    cards.push({
      key: "money",
      title: t.cards.money,
      metrics: [
        ...(!m || !m.anyCharge
          ? [noData("collected", t.money.collected, t.money.none)]
          : [
              { key: "collected", label: t.money.collected, value: dollars(m.collectedCents), hint: t.money.count(m.collectedCount) },
              { key: "failed", label: t.money.failed, value: num(m.failedCount), hint: m.failedCount > 0 ? dollars(m.failedCents) : undefined },
              { key: "pending", label: t.money.pending, value: dollars(m.scheduledCents), hint: t.money.count(m.scheduledCount) },
            ]),
        ...(!books
          ? []
          : !books.hasData
            ? [noData("net_revenue", t.money.netRevenue, t.money.booksNone)]
            : [
                { key: "net_revenue", label: t.money.netRevenue, value: formatCents(books.netRevenueCents) },
                {
                  key: "expenses",
                  label: t.money.expenses,
                  value: formatCents(books.expensesCents),
                  hint: books.otherCostsCents > 0 ? `${t.money.otherCosts(formatCents(books.otherCostsCents))}${books.feesEstimated ? ` (${t.money.estimate})` : ""}` : undefined,
                },
                { key: "profit", label: t.money.profit, value: formatCents(books.netProfitCents), hint: t.money.profitHint },
              ]),
      ],
      needsYou: { count: moneyNeeds, href: "/equipo/clientes?aviso=payment_past_due", label: t.needsYou },
      ...(input.can("accounting") ? { link: { href: "/equipo/contabilidad", label: t.money.openBooks } } : {}),
    });
  }

  // Content: for the content team (content.view: administrators and specialists; never sales).
  if (input.can("content.view")) {
    const summary = input.extras?.content ?? null;
    const viewer = { approve: input.can("content.approve"), edit: input.can("content.edit"), handle: input.handle ?? null };
    const link = { href: "/equipo/contenido", label: t.content.open };
    if (!summary) {
      cards.push({
        key: "content",
        title: t.cards.content,
        metrics: [noData("review", t.content.review, t.content.readError)],
        needsYou: { count: null, href: "/equipo/contenido", label: t.needsYou },
        link,
      });
    } else {
      const publishing: CardMetric = { key: "publishing", label: t.content.publishing, value: summary.publishing.enabled ? t.content.on(summary.publishing.channelsOn) : t.content.off };
      const needs = contentNeeds(summary, viewer);
      cards.push({
        key: "content",
        title: t.cards.content,
        metrics:
          summary.pieces === 0
            ? [noData("review", t.content.review, t.content.none), publishing]
            : [
                { key: "review", label: t.content.review, value: num(summary.review.length) },
                {
                  key: "scheduled",
                  label: t.content.scheduled,
                  value: num(summary.scheduledThisWeek),
                  hint: summary.approvedNotScheduled > 0 ? t.content.approvedNotScheduled(summary.approvedNotScheduled) : undefined,
                },
                { key: "posted", label: t.content.posted, value: num(summary.postedThisWeek) },
                { key: "failed", label: t.content.failed, value: num(summary.failed.length) },
                publishing,
              ],
        needsYou: { count: needs.count, href: needs.href, label: t.needsYou },
        link,
      });
    }
  }

  // Ads: for the owner (ads.view: spend is money; never sales).
  if (input.can("ads.view")) {
    const ads = input.extras?.ads ?? null;
    const link = { href: "/equipo/anuncios", label: t.ads.open };
    const needsHref = "/equipo/anuncios?vista=resultados&filtro=turn_off";
    if (!ads || ads.spend7dCents === null) {
      const why = !ads ? t.ads.readError : t.ads.notConnected;
      cards.push({ key: "ads", title: t.cards.ads, metrics: [noData("spend", t.ads.spend, why)], needsYou: { count: ads ? 0 : null, href: needsHref, label: t.needsYou }, link });
    } else {
      cards.push({
        key: "ads",
        title: t.cards.ads,
        metrics: [
          { key: "spend", label: t.ads.spend, value: dollars(ads.spend7dCents), hint: ads.sample ? t.ads.sample : undefined },
          { key: "leads", label: t.ads.leads, value: num(ads.leads7d ?? 0), hint: ads.signed7d ? t.ads.signed(ads.signed7d) : undefined },
          ads.costPerLead7dCents === null ? noData("cpl", t.ads.costPerLead, t.ads.notConnected) : { key: "cpl", label: t.ads.costPerLead, value: dollars(ads.costPerLead7dCents) },
          { key: "turnoff", label: t.ads.turnOff, value: num(ads.turnOff ?? 0) },
        ],
        needsYou: { count: ads.turnOff, href: needsHref, label: t.needsYou },
        link,
      });
    }
  }

  // Support.
  const questions = input.queue.filter((q) => q.exception.kind === "question_waiting").length;
  const extras = input.extras;
  const unavailable = extras?.unavailable ?? null;
  const leadsWaiting = input.leads ? input.leads.filter((l) => waitingSince(l)).length : null;
  const extra = (key: string, label: string, value: number | null | undefined): CardMetric =>
    value === null || value === undefined ? noData(key, label, unavailable ?? t.unavailableDemo) : { key, label, value: num(value) };
  cards.push({
    key: "support",
    title: t.cards.support,
    metrics: [
      { key: "questions", label: t.support.questions, value: num(questions) },
      ...(input.can("leads.work") && leadsWaiting !== null ? [{ key: "leads", label: t.support.leadsWaiting, value: num(leadsWaiting) }] : []),
      extra("complaints", t.support.complaints, extras?.complaints7d),
      ...(input.can("case.view") ? [extra("reviews", t.support.reviews, extras?.reviewRequests30d)] : []),
    ],
    needsYou: { count: questions, href: "/equipo/clientes?aviso=question_waiting", label: t.needsYou },
  });

  // Partners.
  if (input.can("partners.view")) {
    const weekAgo = now.getTime() - 7 * DAY;
    const referrals = input.leads
      ? input.leads.filter((l) => (l.source === "partner" || l.firstTouch.partnerId) && Date.parse(l.createdAt) >= weekAgo).length
      : input.clients.filter((c) => c.leadSource?.partnerId && Date.parse(c.createdAt) >= weekAgo).length;
    const notes = extras?.partnerNotesWaiting ?? null;
    cards.push({
      key: "partners",
      title: t.cards.partners,
      metrics: [{ key: "referrals", label: t.partners.referrals, value: num(referrals) }, extra("notes", t.partners.notes, notes)],
      needsYou: { count: notes, href: "/equipo/socios", label: t.needsYou },
    });
  }

  // Tech health: what is checkable now.
  if (input.can("business.view")) {
    const signals = extras?.health ?? null;
    const late = (s: HealthSignal) => s.lastAt !== null && s.expectHours !== null && now.getTime() - Date.parse(s.lastAt) > s.expectHours * 60 * 60 * 1000;
    cards.push({
      key: "health",
      title: t.cards.health,
      metrics: signals
        ? signals.map((s) =>
            s.lastAt
              ? { key: s.key, label: t.health[s.key], value: ago(s.lastAt, now, input.locale), hint: late(s) ? t.health.late(s.expectHours!) : undefined }
              : noData(s.key, t.health[s.key], t.health.never),
          )
        : [noData("health", t.cards.health, unavailable ?? t.unavailableDemo)],
      needsYou: { count: signals ? signals.filter(late).length : null, href: "/equipo/control#health", label: t.needsYou },
      // Launch readiness has the full check-up (src/lib/launch/health.ts): every service and every job.
      ...(input.can("launch") ? { link: { href: "/equipo/lanzamiento?vista=salud", label: t.healthLink } } : {}),
    });
  }
  return cards;
}

/**
 * The Money card's numbers, from the billing records the member may see:
 * charged this month (Texas month, before refunds; Accounting has the net,
 * by its money rule), charges whose
 * last attempt failed, and what the system has scheduled in the next 30 days
 * (the dashboard's own rule, businessMetrics).
 */
export function moneySummary(clients: readonly StaffClient[], now: Date): NonNullable<OverviewInput["money"]> {
  const range = periodRange("month", now);
  const charges = clients.flatMap((c) => c.billing.charges);
  const collected = charges.filter((ch) => ch.chargedAt && inRange(ch.chargedAt, range));
  const failed = charges.filter((ch) => ch.status === "failed");
  const scheduled = businessMetrics([...clients], [], "month", now).money;
  return {
    anyCharge: charges.length > 0,
    collectedCount: collected.length,
    collectedCents: collected.reduce((n, ch) => n + ch.amountCents - (ch.creditCents ?? 0), 0),
    failedCount: failed.length,
    failedCents: failed.reduce((n, ch) => n + ch.amountCents, 0),
    scheduledCount: scheduled.scheduledCount,
    scheduledCents: scheduled.scheduledCents,
  };
}
