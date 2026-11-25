import type { QueueItem } from "../autopilot/queue";
import { firstTouchLine, HANDOFF_LABELS, leadName, waitingMinutes } from "../leads/inbox";
import type { HandoffReason, Lead } from "../leads/types";
import { playbookFor } from "../staff/playbook";
import { EXCEPTION_LABELS } from "../staff/stage";
import type { StaffLocale } from "../staff/i18n/locale";
import { fullName } from "../staff/types";

// The Today list (docs/CONTROL.md): ALTO Control's "one list a single
// assistant works top to bottom", for credit repair. It is the console's own
// work queue (autopilot/queue.ts, the notices that truly need a person) plus
// the lead inbox's waiting conversations and hand-offs, the partners' notes
// and, for the owner, what the team escalated, ranked in one order. Every
// item carries its short step-by-step procedure (the queue's «How to handle
// it» card, or a lead procedure below) and two ends besides doing it:
// «Handled» where the queue has one, and «Escalate to the owner».
// Nothing is sent from here.

export type TodayKind = "lead_handoff" | "lead_waiting" | "signup_person" | "lead_new" | "queue" | "partner_note" | "escalation";

export interface TodayItem {
  key: string;
  kind: TodayKind;
  /** Higher first. */
  priority: number;
  title: string;
  detail: string;
  /** Since when it waits (ISO). */
  since: string;
  href: string;
  steps: readonly string[];
  doneWhen: string | null;
  overdue: boolean;
  minutes: number | null;
  queueItem?: QueueItem;
  leadId?: string;
}

const MIN = 60_000;

const LEAD_STEPS: Record<StaffLocale, Record<"waiting" | "handoff" | "money" | "signup" | "new" | "partner" | "escalation", { steps: string[]; doneWhen: string }>> = {
  en: {
    waiting: {
      steps: [
        "Open the conversation.",
        "Tap ✨ Suggest reply, or pick a saved answer.",
        "Read it and fix anything wrong: no price outside the plan, no results, no pressure.",
        "Send it. If they're ready to start, tap “Prepare invitation”.",
        "Move the lead to the right stage (only a person moves leads).",
      ],
      doneWhen: "They have an answer from a person: the item leaves the list by itself.",
    },
    handoff: {
      steps: [
        "Open the conversation and read everything they wrote.",
        "Answer as yourself: thank them and say what you will do. No promises.",
        "If it is about a charge, cancelling or anything legal, don't answer it yourself: tap “Escalate to the owner”.",
        "Leave a note with what you did.",
      ],
      doneWhen: "A person answered them, or the owner has it.",
    },
    money: {
      steps: [
        "Open the conversation.",
        "Don't quote a price: the plan is explained in writing, in the agreement, before signing.",
        "Tell them how the service works and that nothing is charged before the work.",
        "If they ask for a discount, a refund or a special deal, tap “Escalate to the owner”.",
      ],
      doneWhen: "A person answered them.",
    },
    signup: {
      steps: [
        "Open the lead: the case reference (CR-…) is on top.",
        "Write to them on WhatsApp: they asked for a person during the chat signup.",
        "Answer their questions in writing. The signup and any payment happen in the app, never on a call.",
        "Leave a note.",
      ],
      doneWhen: "A person answered them.",
    },
    new: {
      steps: [
        "Open the lead and see where they came from.",
        "Write the first message on WhatsApp (an approved template if they haven't written in the last 24 hours).",
        "Never by text message, never a sales call.",
        "When you've talked, move it to Contacted.",
      ],
      doneWhen: "A person wrote to them, or moved the lead.",
    },
    partner: {
      steps: [
        "Open the client's page: the note is under “Notes with the partner”.",
        "Answer the partner there: progress in words, no credit details.",
        "If the client needs something, write to the client in their own conversation.",
      ],
      doneWhen: "The partner has an answer on the thread.",
    },
    escalation: {
      steps: ["Read what the teammate wrote and open the item.", "Decide, and tell the teammate.", "Tap “Resolved”."],
      doneWhen: "You marked it resolved.",
    },
  },
  es: {
    waiting: {
      steps: [
        "Abre la conversación.",
        "Toca ✨ Sugerir respuesta, o elige una respuesta guardada.",
        "Léela y corrige lo que esté mal: ningún precio fuera del plan, ningún resultado, nada de presión.",
        "Envíala. Si quiere empezar, toca «Preparar su invitación».",
        "Pasa el prospecto a la etapa que corresponde (solo una persona mueve prospectos).",
      ],
      doneWhen: "Tiene la respuesta de una persona: sale de la lista solo.",
    },
    handoff: {
      steps: [
        "Abre la conversación y lee todo lo que escribió.",
        "Respóndele tú: agradécele y dile qué vas a hacer. Sin promesas.",
        "Si es sobre un cobro, cancelar o algo legal, no lo respondas tú: toca «Pasar al dueño».",
        "Deja una nota con lo que hiciste.",
      ],
      doneWhen: "Una persona le respondió, o lo tiene el dueño.",
    },
    money: {
      steps: [
        "Abre la conversación.",
        "No des un precio: el plan se explica por escrito, en el acuerdo, antes de firmar.",
        "Explícale cómo funciona el servicio y que nada se cobra antes del trabajo.",
        "Si pide descuento, reembolso o un trato especial, toca «Pasar al dueño».",
      ],
      doneWhen: "Una persona le respondió.",
    },
    signup: {
      steps: [
        "Abre el prospecto: la referencia del caso (CR-…) está arriba.",
        "Escríbele por WhatsApp: pidió una persona durante el registro con Alti.",
        "Responde sus preguntas por escrito. El registro y cualquier pago son en la app, nunca en una llamada.",
        "Deja una nota.",
      ],
      doneWhen: "Una persona le respondió.",
    },
    new: {
      steps: [
        "Abre el prospecto y mira de dónde llegó.",
        "Escribe el primer mensaje por WhatsApp (una plantilla aprobada si no ha escrito en las últimas 24 horas).",
        "Nunca por mensaje de texto, nunca una llamada de venta.",
        "Cuando hayan hablado, pásalo a Contactado.",
      ],
      doneWhen: "Una persona le escribió, o movió el prospecto.",
    },
    partner: {
      steps: [
        "Abre la página del cliente: la nota está en «Notas con el socio».",
        "Respóndele al socio ahí: el avance en palabras, sin datos de crédito.",
        "Si el cliente necesita algo, escríbele al cliente en su propia conversación.",
      ],
      doneWhen: "El socio tiene respuesta en la conversación.",
    },
    escalation: {
      steps: ["Lee lo que escribió la persona del equipo y abre el asunto.", "Decide y avísale.", "Toca «Resuelto»."],
      doneWhen: "Lo marcaste como resuelto.",
    },
  },
};

export const TODAY_PROCEDURES = LEAD_STEPS;

const WORDS = {
  en: {
    waiting: (name: string, m: number) => `${name} is waiting for an answer · ${m < 60 ? `${m} min` : `${Math.round(m / 60)} h`}`,
    handoff: (name: string, why: string) => `${name}: the autopilot handed this to a person (${why.toLowerCase()})`,
    signup: (name: string, ref: string) => `${name} asked for a person during the chat signup (${ref})`,
    fresh: (name: string) => `${name} arrived and nobody has written yet`,
    partner: (partner: string, client: string) => `${partner} wrote to the team about ${client}`,
    escalation: (by: string) => `Escalated by ${by}`,
  },
  es: {
    waiting: (name: string, m: number) => `${name} espera respuesta · ${m < 60 ? `${m} min` : `${Math.round(m / 60)} h`}`,
    handoff: (name: string, why: string) => `${name}: el piloto automático se lo pasó a una persona (${why.toLowerCase()})`,
    signup: (name: string, ref: string) => `${name} pidió una persona durante el registro con Alti (${ref})`,
    fresh: (name: string) => `${name} llegó y nadie le ha escrito`,
    partner: (partner: string, client: string) => `${partner} le escribió al equipo sobre ${client}`,
    escalation: (by: string) => `Lo pasó ${by}`,
  },
};

export interface TodayInput {
  queue: readonly QueueItem[];
  /** Null when the member does not work leads. */
  leads: readonly Lead[] | null;
  partnerNotes?: ReadonlyArray<{ id: string; clientId: string; clientName: string; partnerFirstName: string; at: string }>;
  /** Only for an administrator. */
  escalations?: ReadonlyArray<{ id: string; key: string; title: string; note: string | null; by: string; at: string }>;
  now: Date;
  locale: StaffLocale;
}

const MONEY_REASONS: readonly HandoffReason[] = ["billing", "legal"];

export function todayList(input: TodayInput): TodayItem[] {
  const { now, locale } = input;
  const w = WORDS[locale];
  const steps = LEAD_STEPS[locale];
  const items: TodayItem[] = [];

  for (const esc of input.escalations ?? []) {
    items.push({ key: `escalation:${esc.id}`, kind: "escalation", priority: 110, title: esc.title, detail: `${w.escalation(esc.by)}${esc.note ? ` — ${esc.note}` : ""}`, since: esc.at, href: "/equipo/control?vista=hoy", ...steps.escalation, overdue: false, minutes: null });
  }

  for (const lead of input.leads ?? []) {
    const name = leadName(lead);
    const href = `/equipo/leads?lead=${lead.id}`;
    const waited = waitingMinutes(lead, now);
    if (lead.handoff) {
      const why = HANDOFF_LABELS[locale][lead.handoff.reason];
      const procedure = MONEY_REASONS.includes(lead.handoff.reason) ? steps.money : steps.handoff;
      items.push({ key: `lead-handoff:${lead.id}:${lead.handoff.at}`, kind: "lead_handoff", priority: lead.handoff.reason === "complaint" ? 100 : 95, title: w.handoff(name, why), detail: firstTouchLine(lead, locale), since: lead.handoff.at, href, ...procedure, overdue: (waited ?? 0) >= 60, minutes: 5, leadId: lead.id });
      continue;
    }
    if (lead.signup?.wantsPerson && !lead.lastHumanAt && !lead.signedAt) {
      items.push({ key: `signup-person:${lead.id}`, kind: "signup_person", priority: 86, title: w.signup(name, lead.signup.caseRef), detail: firstTouchLine(lead, locale), since: lead.lastInboundAt ?? lead.createdAt, href, ...steps.signup, overdue: false, minutes: 5, leadId: lead.id });
      continue;
    }
    if (waited !== null) {
      items.push({ key: `lead-waiting:${lead.id}:${lead.lastInboundAt}`, kind: "lead_waiting", priority: waited >= 60 ? 88 : 80, title: w.waiting(name, waited), detail: firstTouchLine(lead, locale), since: lead.lastInboundAt!, href, ...steps.waiting, overdue: waited >= 60, minutes: 4, leadId: lead.id });
      continue;
    }
    // Arrived (a form, a partner) and nobody has written: the first message is a person's.
    if (!lead.lastMessage && !lead.signedAt && lead.stage === "new" && !lead.invitedAt && now.getTime() - Date.parse(lead.createdAt) <= 7 * 24 * 60 * MIN) {
      items.push({ key: `lead-new:${lead.id}`, kind: "lead_new", priority: 60, title: w.fresh(name), detail: firstTouchLine(lead, locale), since: lead.createdAt, href, ...steps.new, overdue: now.getTime() - Date.parse(lead.createdAt) >= 24 * 60 * MIN, minutes: 4, leadId: lead.id });
    }
  }

  for (const note of input.partnerNotes ?? []) {
    items.push({ key: `partner-note:${note.id}`, kind: "partner_note", priority: 65, title: w.partner(note.partnerFirstName, note.clientName), detail: "", since: note.at, href: `/equipo/clientes/${note.clientId}`, ...steps.partner, overdue: false, minutes: 5 });
  }

  for (const q of input.queue) {
    const card = playbookFor(q.exception.kind, locale);
    const severity = q.exception.severity;
    const priority = q.overdue ? (severity === "high" ? 92 : 84) : severity === "high" ? 70 : severity === "medium" ? 50 : 40;
    const who = q.group ? q.group.company : fullName(q.client);
    items.push({
      key: `queue:${q.id}`,
      kind: "queue",
      priority,
      title: `${EXCEPTION_LABELS[locale][q.exception.kind]} · ${who}`,
      detail: q.why,
      since: q.since,
      href: q.action.kind === "open" ? q.action.href : `/equipo/clientes/${q.client.id}`,
      steps: card.steps,
      doneWhen: card.doneWhen,
      overdue: q.overdue,
      minutes: q.minutes,
      queueItem: q,
    });
  }

  return items.sort((a, b) => b.priority - a.priority || a.since.localeCompare(b.since));
}

/** "~35 minutes" of work for the list, from the items' estimates. */
export function todayMinutes(items: readonly TodayItem[]): number {
  return items.reduce((n, i) => n + (i.minutes ?? 0), 0);
}
