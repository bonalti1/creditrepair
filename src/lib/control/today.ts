import type { QueueItem } from "../autopilot/queue";
import { firstTouchLine, HANDOFF_LABELS, leadName, waitingMinutes } from "../leads/inbox";
import type { HandoffReason, Lead } from "../leads/types";
import { playbookFor } from "../staff/playbook";
import { EXCEPTION_LABELS } from "../staff/stage";
import type { StaffLocale } from "../staff/i18n/locale";
import { fullName } from "../staff/types";
import { formatCents } from "../accounting/money";
import { monthLabel } from "../accounting/periods";
import type { BooksDue } from "./books";
import { myChanges, type ContentSummary, type ContentViewer } from "./content";
import { videoNeedsOf, type VideoSummary } from "./marketing";

// The Today list (docs/CONTROL.md): ALTO Control's "one list a single
// assistant works top to bottom", for credit repair. It is the console's own
// work queue (autopilot/queue.ts, the notices that truly need a person) plus
// the lead inbox's waiting conversations and hand-offs, the partners' notes
// and, for the owner, what the team escalated, ranked in one order. Every
// item carries its short step-by-step procedure (the queue's «How to handle
// it» card, or a lead procedure below) and two ends besides doing it:
// «Handled» where the queue has one, and «Escalate to the owner».
// Content adds the pieces waiting for approval (approvers), the changes asked
// of an editor and the posts that failed, with the reason; Accounting (the
// owner) a month not closed after the 5th of the next and the expenses of $75
// or more without a receipt. Failed charges already come from billing through
// the work queue (payment notices), so the books add none.
// Nothing is sent from here.

export type TodayKind =
  | "lead_handoff"
  | "lead_waiting"
  | "signup_person"
  | "lead_new"
  | "queue"
  | "partner_note"
  | "escalation"
  | "content_review"
  | "content_changes"
  | "content_failed"
  | "video_review"
  | "video_changes"
  | "video_handoff"
  | "books_close"
  | "books_receipts";

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

type ProcedureKey = "waiting" | "handoff" | "money" | "signup" | "new" | "partner" | "escalation" | "contentReview" | "contentChanges" | "contentFailed" | "videoReview" | "videoChanges" | "videoHandOff" | "booksClose" | "booksReceipts";

const LEAD_STEPS: Record<StaffLocale, Record<ProcedureKey, { steps: string[]; doneWhen: string }>> = {
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
    contentReview: {
      steps: [
        "Open the piece and read it in each of its languages.",
        "Look at the check: nothing may block, and every line of the checklist must be ticked.",
        "Approve it, or tap “Request changes” and say what to change.",
      ],
      doneWhen: "It is approved or sent back with a note.",
    },
    contentChanges: {
      steps: ["Open the piece and read the note from the approver.", "Make the changes, and fix anything the check marks.", "Tick the checklist again and send it for review."],
      doneWhen: "It is back in review.",
    },
    contentFailed: {
      steps: [
        "Open the piece and read why the post failed.",
        "Fix the cause: connect the account again in Publishing, or add the file the channel needs.",
        "Tap “Back to approved”, then schedule it again or post it by hand and record the link.",
      ],
      doneWhen: "It is scheduled again or posted.",
    },
    videoReview: {
      steps: [
        "Open the video in the Video Studio and watch the exported file from start to end, with the sound on.",
        "Read the captions and the on-screen words in its language: no promises, no results, no pressure.",
        "Approve it, or tap “Ask for changes” and say what to change.",
      ],
      doneWhen: "It is approved or sent back with a note.",
    },
    videoChanges: {
      steps: ["Open the video and read the note from the approver.", "Make the changes in the editor and export the MP4 again.", "Tap “Send for approval” again."],
      doneWhen: "It is back waiting for approval.",
    },
    videoHandOff: {
      steps: ["Open the approved video in the Video Studio.", "Tap “Hand to Content”: it becomes a piece on the Content board with the approved file.", "Schedule or post it from Content."],
      doneWhen: "It is on the Content board.",
    },
    booksClose: {
      steps: [
        "Open Accounting, Reports, on that month.",
        "Go through the checklist: monthly expenses posted, bank statement imported, processor export reconciled, receipts.",
        "Tap “Close the month”. A mistake found later is fixed with an adjustment.",
      ],
      doneWhen: "The month shows as closed.",
    },
    booksReceipts: {
      steps: ["Open Accounting, Expenses, on that month.", "Find the expenses with no receipt (the largest first).", "Attach the photo or the PDF of each receipt (JPG, PNG or PDF, up to 10 MB)."],
      doneWhen: "Every expense of $75 or more has its receipt.",
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
    contentReview: {
      steps: [
        "Abre la pieza y léela en cada uno de sus idiomas.",
        "Mira la revisión: nada puede bloquear y cada punto de la lista tiene que estar marcado.",
        "Apruébala, o toca «Pedir cambios» y di qué cambiar.",
      ],
      doneWhen: "Está aprobada o devuelta con una nota.",
    },
    contentChanges: {
      steps: ["Abre la pieza y lee la nota de quien la revisó.", "Haz los cambios y corrige lo que marque la revisión.", "Marca la lista otra vez y mándala a revisión."],
      doneWhen: "Está otra vez en revisión.",
    },
    contentFailed: {
      steps: [
        "Abre la pieza y lee por qué falló la publicación.",
        "Corrige la causa: conecta otra vez la cuenta en Publicar, o agrega el archivo que pide el canal.",
        "Toca «Volver a aprobada» y prográmala otra vez, o publícala a mano y registra el enlace.",
      ],
      doneWhen: "Está programada otra vez o publicada.",
    },
    videoReview: {
      steps: [
        "Abre el video en el Estudio de video y mira el archivo exportado de principio a fin, con sonido.",
        "Lee los subtítulos y las palabras en pantalla en su idioma: sin promesas, sin resultados, sin presión.",
        "Apruébalo, o toca «Pedir cambios» y di qué cambiar.",
      ],
      doneWhen: "Está aprobado o devuelto con una nota.",
    },
    videoChanges: {
      steps: ["Abre el video y lee la nota de quien lo revisó.", "Haz los cambios en el editor y exporta el MP4 otra vez.", "Toca «Mandar a aprobación» otra vez."],
      doneWhen: "Está otra vez esperando aprobación.",
    },
    videoHandOff: {
      steps: ["Abre el video aprobado en el Estudio de video.", "Toca «Pasar a Contenido»: queda como pieza en el tablero de Contenido con el archivo aprobado.", "Prográmalo o publícalo desde Contenido."],
      doneWhen: "Está en el tablero de Contenido.",
    },
    booksClose: {
      steps: [
        "Abre Contabilidad, Informes, en ese mes.",
        "Revisa la lista: gastos mensuales registrados, estado de cuenta importado, exportación del procesador conciliada, recibos.",
        "Toca «Cerrar el mes». Un error que aparezca después se corrige con un ajuste.",
      ],
      doneWhen: "El mes aparece como cerrado.",
    },
    booksReceipts: {
      steps: ["Abre Contabilidad, Gastos, en ese mes.", "Busca los gastos sin recibo (los más grandes primero).", "Adjunta la foto o el PDF de cada recibo (JPG, PNG o PDF, hasta 10 MB)."],
      doneWhen: "Cada gasto de $75 o más tiene su recibo.",
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
    review: (title: string) => `Approve this piece: ${title}`,
    reviewDetail: "Ready for review in Content.",
    changes: (title: string) => `Changes requested: ${title}`,
    failed: (title: string, channel: string | null) => `A post failed: ${title}${channel ? ` (${channel})` : ""}`,
    failedWhy: "The reason was not recorded: open the piece's history.",
    videoReview: (title: string) => `Approve this video: ${title}`,
    videoReviewDetail: "Exported and waiting for approval in the Video Studio.",
    videoChanges: (title: string) => `Changes requested on a video: ${title}`,
    videoHandOff: (title: string) => `Hand this approved video to Content: ${title}`,
    videoHandOffDetail: "Approved; it goes out once it is a piece on the Content board.",
    close: (month: string) => `Close the books for ${month}`,
    closeDetail: "The month is over and the 5th has passed. Closing keeps its figures as they are.",
    receipts: (n: number) => `${n} ${n === 1 ? "expense" : "expenses"} of $75 or more without a receipt`,
    receiptsDetail: (vendor: string, amount: string, total: string) => `The largest: ${vendor}, ${amount}. In all ${total}, in the last 90 days.`,
  },
  es: {
    waiting: (name: string, m: number) => `${name} espera respuesta · ${m < 60 ? `${m} min` : `${Math.round(m / 60)} h`}`,
    handoff: (name: string, why: string) => `${name}: el piloto automático se lo pasó a una persona (${why.toLowerCase()})`,
    signup: (name: string, ref: string) => `${name} pidió una persona durante el registro con Alti (${ref})`,
    fresh: (name: string) => `${name} llegó y nadie le ha escrito`,
    partner: (partner: string, client: string) => `${partner} le escribió al equipo sobre ${client}`,
    escalation: (by: string) => `Lo pasó ${by}`,
    review: (title: string) => `Aprueba esta pieza: ${title}`,
    reviewDetail: "Lista para revisión en Contenido.",
    changes: (title: string) => `Pidieron cambios: ${title}`,
    failed: (title: string, channel: string | null) => `Falló una publicación: ${title}${channel ? ` (${channel})` : ""}`,
    failedWhy: "No quedó la razón: abre la historia de la pieza.",
    videoReview: (title: string) => `Aprueba este video: ${title}`,
    videoReviewDetail: "Exportado y esperando aprobación en el Estudio de video.",
    videoChanges: (title: string) => `Pidieron cambios a un video: ${title}`,
    videoHandOff: (title: string) => `Pasa este video aprobado a Contenido: ${title}`,
    videoHandOffDetail: "Aprobado; sale cuando sea una pieza en el tablero de Contenido.",
    close: (month: string) => `Cierra los libros de ${month}`,
    closeDetail: "El mes terminó y ya pasó el día 5. Cerrarlo guarda sus cifras como están.",
    receipts: (n: number) => `${n} ${n === 1 ? "gasto" : "gastos"} de $75 o más sin recibo`,
    receiptsDetail: (vendor: string, amount: string, total: string) => `El más grande: ${vendor}, ${amount}. En total ${total}, en los últimos 90 días.`,
  },
};

export interface TodayInput {
  queue: readonly QueueItem[];
  /** Null when the member does not work leads. */
  leads: readonly Lead[] | null;
  partnerNotes?: ReadonlyArray<{ id: string; clientId: string; clientName: string; partnerFirstName: string; at: string }>;
  /** Only for an administrator. */
  escalations?: ReadonlyArray<{ id: string; key: string; title: string; note: string | null; by: string; at: string }>;
  /** The content board (control/content.ts) and who is looking; omit for a member without content.view. */
  content?: { summary: ContentSummary; viewer: ContentViewer } | null;
  /** The Video Studio's board (control/marketing.ts), for the same viewer; omit without content.view. */
  video?: { summary: VideoSummary; viewer: ContentViewer } | null;
  /** What the books ask of the owner (control/books.ts); omit for a member without `accounting`. */
  books?: BooksDue | null;
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

  // Content. Ranked below the people waiting (leads, clients' urgent notices):
  // a failed post first (nothing goes out until someone fixes it), then a
  // piece waiting for approval (sooner once it has waited two days), then
  // the changes asked of an editor.
  const content = input.content;
  if (content) {
    const { summary, viewer } = content;
    const piece = (id: string) => `/equipo/contenido/pieza/${id}`;
    if (viewer.edit || viewer.approve) {
      for (const f of summary.failed) {
        items.push({ key: `content-failed:${f.id}`, kind: "content_failed", priority: 68, title: w.failed(f.title, f.channel), detail: f.note ?? w.failedWhy, since: f.since, href: piece(f.id), ...steps.contentFailed, overdue: false, minutes: 10 });
      }
    }
    if (viewer.approve) {
      for (const r of summary.review) {
        const waited = now.getTime() - Date.parse(r.since) >= 2 * 24 * 60 * MIN;
        items.push({ key: `content-review:${r.id}`, kind: "content_review", priority: waited ? 55 : 45, title: w.review(r.title), detail: w.reviewDetail, since: r.since, href: piece(r.id), ...steps.contentReview, overdue: false, minutes: 10 });
      }
    } else if (viewer.edit) {
      for (const c of myChanges(summary, viewer.handle)) {
        items.push({ key: `content-changes:${c.id}`, kind: "content_changes", priority: 47, title: w.changes(c.title), detail: c.note ?? "", since: c.since, href: piece(c.id), ...steps.contentChanges, overdue: false, minutes: 15 });
      }
    }
  }

  // The Video Studio, the same way as Content's pieces and the same rule as its own red circle
  // (video/rules.ts videoNeeds): approvers the videos waiting; editors the changes asked of them
  // and the approved videos still to hand to Content.
  const video = input.video;
  if (video) {
    const open = (id: string) => `/equipo/video/${id}`;
    const needs = videoNeedsOf(video.summary, video.viewer);
    for (const r of needs.ready) {
      const waited = now.getTime() - Date.parse(r.since) >= 2 * 24 * 60 * MIN;
      items.push({ key: `video-review:${r.id}`, kind: "video_review", priority: waited ? 55 : 45, title: w.videoReview(r.title), detail: w.videoReviewDetail, since: r.since, href: open(r.id), ...steps.videoReview, overdue: false, minutes: 10 });
    }
    for (const c of needs.changes) {
      items.push({ key: `video-changes:${c.id}`, kind: "video_changes", priority: 47, title: w.videoChanges(c.title), detail: c.note ?? "", since: c.since, href: open(c.id), ...steps.videoChanges, overdue: false, minutes: 20 });
    }
    for (const a of needs.approved) {
      items.push({ key: `video-handoff:${a.id}`, kind: "video_handoff", priority: 44, title: w.videoHandOff(a.title), detail: w.videoHandOffDetail, since: a.since, href: open(a.id), ...steps.videoHandOff, overdue: false, minutes: 5 });
    }
  }

  // The books (the owner): a month left open past the 5th, then the missing receipts.
  const books = input.books;
  if (books) {
    for (const month of books.unclosed) {
      items.push({
        key: `books-close:${month}`,
        kind: "books_close",
        priority: 58,
        title: w.close(monthLabel(month, locale)),
        detail: w.closeDetail,
        since: `${month}-01T12:00:00.000Z`,
        href: `/equipo/contabilidad?tab=reports&mes=${month}`,
        ...steps.booksClose,
        overdue: true,
        minutes: 20,
      });
    }
    const r = books.receipts;
    if (r.count > 0 && r.month) {
      items.push({
        key: `books-receipts:${r.month}:${r.count}`,
        kind: "books_receipts",
        priority: 42,
        title: w.receipts(r.count),
        detail: r.largest ? w.receiptsDetail(r.largest.vendor, formatCents(r.largest.cents), formatCents(r.cents)) : "",
        since: `${r.largest?.spentOn ?? `${r.month}-01`}T12:00:00.000Z`,
        href: `/equipo/contabilidad?tab=expenses&mes=${r.month}`,
        ...steps.booksReceipts,
        overdue: false,
        minutes: Math.min(30, 2 * r.count),
      });
    }
  }

  return items.sort((a, b) => b.priority - a.priority || a.since.localeCompare(b.since));
}

/** "~35 minutes" of work for the list, from the items' estimates. */
export function todayMinutes(items: readonly TodayItem[]): number {
  return items.reduce((n, i) => n + (i.minutes ?? 0), 0);
}
