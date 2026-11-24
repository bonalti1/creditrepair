import type { Locale } from "../i18n/dictionaries";
import { formatAgreementDay, workMayStart, type AgreementRecord } from "../agreement/gate";
import { SERVICE_MODE, type ServiceMode } from "../service/mode";
import { readStoredAgreement } from "./agreementLocal";
import { readPaymentMethodOnFile } from "./billingLocal";
import { ESTIMATED_CYCLE_DAYS, nextRoundDue, REINVESTIGATION_DAYS } from "../rounds/timing";

// The journey engine — the single biggest UX bet against Dispute Beast:
// at any moment the app tells the user exactly ONE next step, in plain
// language, with a button that takes them there. No dead ends, no guessing.
//
// Two journeys, by service mode (src/lib/service/mode.ts):
//
//  - Full service (the business today). The client signs the agreement first,
//    then connects monitoring and reviews their report. From there the team
//    works: it prepares and mails the letters, and prepares each next round.
//    No step asks the client to send or approve a letter, and no step says a
//    letter was sent while the agreement does not yet allow work to start
//    (src/lib/agreement/gate.ts: signed, not cancelled, and the 3-business-day
//    cancellation period over). Once the client's own part is finished and
//    work may start, one nudge may appear: put a payment method on file. It
//    comes after the review, never before it, and it holds nothing back: the
//    team prepares and mails the letters either way, and a charge is made only
//    after a round was mailed (src/lib/billing/rules.ts).
//  - Self-serve (kept for later). The client reviews, approves and sends their
//    own letters, as the product worked before.

export interface JourneyState {
  reportImported: boolean;
  totalItems: number;
  reviewedCount: number;
  attestedCount: number;
  /** Self-serve: the client approved the round. Full service: the team mailed it. */
  roundApproved: boolean;
  /** ISO date the current round mailed, if any. */
  mailedAt?: string | null;
  /**
   * When the next round is due for the mailed round (rounds/timing.ts, nextRoundDue), when the
   * caller knows its letters' tracking. Missing: worked out from the mailing date alone.
   */
  nextRoundDueAt?: string | null;
  /** Full service: the client's agreement as on record. Null or missing means none. */
  agreement?: AgreementRecord | null;
  /**
   * Full service: whether a payment method is on file. False brings the nudge
   * to add one, after the review. Missing means "not known": no nudge.
   */
  paymentMethodOnFile?: boolean;
}

export interface JourneyStep {
  step: number;
  totalSteps: number;
  key: string;
  title: string;
  description: string;
  cta: string;
  href: string;
}

export const RESPONSE_WINDOW_DAYS = REINVESTIGATION_DAYS; // FCRA reinvestigation window
/** The next round's date with no tracking (mailing + 5 days' transit + 30 + 5): rounds/timing.ts. */
export const NEXT_ROUND_DAYS = ESTIMATED_CYCLE_DAYS;

const COPY = {
  es: {
    stepLabel: "¿Qué sigue?",
    import: {
      title: "Conecta tu monitoreo e importa tu reporte",
      description:
        "Tu suscripción de monitoreo nos deja importar tu reporte de los 3 burós. Es el punto de partida de todo.",
      cta: "Conectar monitoreo",
    },
    reviewStart: { title: "Revisa los elementos de tu reporte", cta: "Empezar revisión" },
    reviewContinue: (n: number) => ({ title: `Sigue revisando: te faltan ${n}`, cta: "Continuar revisión" }),
    reviewDescription:
      "Te mostramos cada elemento uno por uno, explicado en palabras simples. Tú decides cuáles crees que son inexactos.",
    reviewEmpty: {
      title: "Revisaste todo — ningún elemento marcado",
      description:
        "No marcaste elementos para disputar. Si todo en tu reporte es correcto, ¡esa es una buena noticia! Puedes volver a revisar cuando quieras.",
      cta: "Volver a revisar",
    },
    attack: (n: number) => ({
      title: "Tus cartas están listas para tu revisión",
      description: `${n === 1 ? "1 elemento confirmado" : `${n} elementos confirmados`}. Lee cada carta (te la explicamos en palabras simples) y aprueba cuando lo tengas claro.`,
      cta: "Revisar mis cartas",
    }),
    waiting: (daysLeft: number) => ({
      title: "Tus cartas van en camino 📬",
      description:
        daysLeft > 0
          ? `Los burós tienen ~${RESPONSE_WINDOW_DAYS} días para responder (quedan ~${daysLeft}). Te avisamos por WhatsApp con cualquier novedad — no tienes que hacer nada.`
          : "La ventana de respuesta de los burós ya pasó. En cuanto tu reporte se actualice, comparamos y te mostramos qué cambió.",
      cta: "Ver mis rondas",
    }),
    nextRound: {
      title: "Es hora de tu siguiente ronda",
      description:
        "Tu reporte se vuelve a importar, comparamos qué se eliminó y qué sigue, y armas tu próxima ronda de cartas con un clic.",
      cta: "Armar mi siguiente ronda",
    },
    // Full service. The client decides what is inaccurate; the team does the rest.
    full: {
      agreementStart: {
        title: "Primero: tu acuerdo de servicio",
        description:
          "Antes de empezar lees tus derechos y firmas tu acuerdo. Toma unos minutos, y después de firmar tienes 3 días hábiles para cancelar sin costo.",
        cta: "Leer y firmar",
      },
      agreementContinue: {
        title: "Te falta firmar tu acuerdo",
        description:
          "Ya leíste tus derechos. Falta el contrato: léelo con calma y fírmalo. Después de firmar tienes 3 días hábiles para cancelar sin costo.",
        cta: "Continuar",
      },
      agreementCancelled: {
        title: "Cancelaste tu acuerdo",
        description:
          "No se hace ningún trabajo ni se envía ninguna carta, y no debes nada. Si más adelante quieres volver, puedes firmar un acuerdo nuevo.",
        cta: "Ver mi acuerdo",
      },
      endRequested: {
        title: "Pediste terminar el servicio",
        description:
          "Recibimos tu solicitud y no se envía nada más. Una persona del equipo te va a escribir para confirmarlo contigo.",
        cta: "Ver mi acuerdo",
      },
      reviewEmpty: {
        title: "Revisaste todo — ningún elemento marcado",
        description:
          "No marcaste ningún elemento como inexacto, así que no hay cartas que preparar. Si todo en tu reporte es correcto, ¡esa es una buena noticia! Puedes volver a revisar cuando quieras.",
        cta: "Volver a revisar",
      },
      teamPreparing: (n: number) => ({
        title: "Listo: tu equipo prepara y envía tus cartas",
        description: `${n === 1 ? "Confirmaste 1 elemento" : `Confirmaste ${n} elementos`}. Tú ya terminaste: tu equipo prepara las cartas y las envía por correo. Te avisamos por WhatsApp cuando salgan.`,
        cta: "Ver cómo va",
      }),
      teamStartsOn: (n: number, day: string) => ({
        title: "Listo: tu equipo prepara y envía tus cartas",
        description: `${n === 1 ? "Confirmaste 1 elemento" : `Confirmaste ${n} elementos`}. Tú ya terminaste. Tu equipo empieza el ${day}, cuando termina tu plazo de 3 días hábiles para cancelar sin costo. La ley no permite empezar antes.`,
        cta: "Ver mi acuerdo",
      }),
      waiting: (daysLeft: number) => ({
        title: "Tus cartas van en camino 📬",
        description:
          daysLeft > 0
            ? `Tu equipo ya las envió. Los burós tienen ~${RESPONSE_WINDOW_DAYS} días para responder (quedan ~${daysLeft}). Te avisamos por WhatsApp con cualquier novedad — no tienes que hacer nada.`
            : "La ventana de respuesta de los burós ya pasó. En cuanto tu reporte se actualice, lo comparamos con el anterior y te mostramos qué cambió.",
        cta: "Ver mis rondas",
      }),
      paymentMethod: {
        title: "Agrega tu método de pago",
        description:
          "Tu parte de la revisión ya está, y esto no detiene tus cartas. Cada cobro paga trabajo ya hecho: se hace después de que tu equipo envía una ronda de cartas, nunca antes. Agregarlo toma un minuto y no cobra nada.",
        cta: "Agregar método de pago",
      },
      nextRound: {
        title: "Tu equipo prepara la siguiente ronda",
        description:
          "Volvemos a importar tu reporte y lo comparamos con el anterior. Tu equipo prepara y envía la siguiente ronda de cartas sobre los puntos que confirmaste. No tienes que hacer nada.",
        cta: "Ver mis rondas",
      },
    },
  },
  en: {
    stepLabel: "What's next?",
    import: {
      title: "Connect your monitoring and import your report",
      description:
        "Your monitoring subscription lets us import your 3-bureau report. Everything starts here.",
      cta: "Connect monitoring",
    },
    reviewStart: { title: "Review the items on your report", cta: "Start review" },
    reviewContinue: (n: number) => ({ title: `Keep reviewing: ${n} left`, cta: "Continue review" }),
    reviewDescription:
      "We show you each item one at a time, explained in plain words. You decide which ones you believe are inaccurate.",
    reviewEmpty: {
      title: "You reviewed everything — nothing flagged",
      description:
        "You didn't flag any items to dispute. If everything on your report is accurate, that's good news! You can review again anytime.",
      cta: "Review again",
    },
    attack: (n: number) => ({
      title: "Your letters are ready for your review",
      description: `${n === 1 ? "1 confirmed item" : `${n} confirmed items`}. Read each letter (we explain it in plain words) and approve when you're sure.`,
      cta: "Review my letters",
    }),
    waiting: (daysLeft: number) => ({
      title: "Your letters are on their way 📬",
      description:
        daysLeft > 0
          ? `Bureaus have ~${RESPONSE_WINDOW_DAYS} days to respond (~${daysLeft} left). We'll message you on WhatsApp with any news — nothing to do.`
          : "The bureaus' response window has passed. As soon as your report refreshes, we compare and show you what changed.",
      cta: "See my rounds",
    }),
    nextRound: {
      title: "Time for your next round",
      description:
        "Your report re-imports, we compare what was deleted and what remains, and you build your next round of letters in one click.",
      cta: "Build my next round",
    },
    full: {
      agreementStart: {
        title: "First: your service agreement",
        description:
          "Before anything starts you read your rights and sign your agreement. It takes a few minutes, and after signing you have 3 business days to cancel at no cost.",
        cta: "Read and sign",
      },
      agreementContinue: {
        title: "Your agreement still needs your signature",
        description:
          "You already read your rights. The contract is next: read it calmly and sign it. After signing you have 3 business days to cancel at no cost.",
        cta: "Continue",
      },
      agreementCancelled: {
        title: "You cancelled your agreement",
        description:
          "No work is done and no letter is sent, and you owe nothing. If you want to come back later, you can sign a new agreement.",
        cta: "See my agreement",
      },
      endRequested: {
        title: "You asked to end the service",
        description:
          "Your request was received and nothing more is sent. A person on the team will write to you to confirm it.",
        cta: "See my agreement",
      },
      reviewEmpty: {
        title: "You reviewed everything — nothing flagged",
        description:
          "You didn't mark any item as inaccurate, so there are no letters to prepare. If everything on your report is accurate, that's good news! You can review again anytime.",
        cta: "Review again",
      },
      teamPreparing: (n: number) => ({
        title: "Done: your team prepares and mails your letters",
        description: `${n === 1 ? "You confirmed 1 item" : `You confirmed ${n} items`}. Your part is finished: your team prepares the letters and mails them. You'll get a WhatsApp message when they go out.`,
        cta: "See how it's going",
      }),
      teamStartsOn: (n: number, day: string) => ({
        title: "Done: your team prepares and mails your letters",
        description: `${n === 1 ? "You confirmed 1 item" : `You confirmed ${n} items`}. Your part is finished. Your team starts on ${day}, when your 3 business days to cancel at no cost are over. The law does not allow starting sooner.`,
        cta: "See my agreement",
      }),
      waiting: (daysLeft: number) => ({
        title: "Your letters are on their way 📬",
        description:
          daysLeft > 0
            ? `Your team already mailed them. Bureaus have ~${RESPONSE_WINDOW_DAYS} days to respond (~${daysLeft} left). You'll get a WhatsApp message with any news — nothing to do.`
            : "The bureaus' response window has passed. As soon as your report refreshes, it is compared with the last one and you see what changed.",
        cta: "See my rounds",
      }),
      paymentMethod: {
        title: "Add your payment method",
        description:
          "Your part of the review is done, and this does not hold your letters. Each charge pays for work already done: it is made after your team mails a round of letters, never before. Adding it takes a minute and charges nothing.",
        cta: "Add payment method",
      },
      nextRound: {
        title: "Your team is preparing the next round",
        description:
          "Your report is imported again and compared with the last one. Your team prepares and mails the next round of letters on the items you confirmed. Nothing to do.",
        cta: "See my rounds",
      },
    },
  },
} as const;

/**
 * The journey state for the demo session, built the same way on every screen
 * so they all agree on the next step. Only decisions about items that are on
 * the current report count; a decision left over from an older report does not.
 *
 * `agreement` is the client's agreement. A screen that holds it passes it;
 * left out, it is read from this device's copy (ux/agreementLocal.ts), so a
 * screen that does not know about the agreement still agrees with the others.
 */
export function sessionJourneyState(
  items: ReadonlyArray<{ fingerprint: string }>,
  flags: Readonly<Record<string, { state: string } | undefined>>,
  roundApproved: boolean,
  agreement: AgreementRecord | null | undefined = readStoredAgreement(),
  paymentMethodOnFile: boolean | undefined = readPaymentMethodOnFile(),
): JourneyState {
  const decided = items.map((i) => flags[i.fingerprint]).filter((f) => f !== undefined);
  return {
    reportImported: true,
    totalItems: items.length,
    reviewedCount: decided.length,
    attestedCount: decided.filter((f) => f.state === "attested").length,
    roundApproved,
    // The demo keeps no mailing date; an approved round counts as mailed today.
    mailedAt: roundApproved ? new Date().toISOString() : null,
    agreement: agreement ?? null,
    ...(paymentMethodOnFile === undefined ? {} : { paymentMethodOnFile }),
  };
}

export interface JourneyOptions {
  /** Defaults to the mode the app is running in. */
  mode?: ServiceMode;
  now?: Date;
}

export function nextAction(s: JourneyState, locale: Locale = "en", options: JourneyOptions = {}): JourneyStep {
  const now = options.now ?? new Date();
  return (options.mode ?? SERVICE_MODE) === "full_service" ? fullServiceStep(s, locale, now) : selfServeStep(s, locale, now);
}

function roundTiming(s: JourneyState, now: Date): { beforeNextRound: boolean; daysLeft: number } {
  const mailed = s.mailedAt ? new Date(s.mailedAt) : now;
  const nextRound = new Date(s.nextRoundDueAt ?? nextRoundDue({ mailedAt: mailed.toISOString() })!.dueAt);
  const responseDue = new Date(mailed.getTime() + RESPONSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return {
    beforeNextRound: now < nextRound,
    daysLeft: Math.max(0, Math.ceil((responseDue.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))),
  };
}

/** Self-serve: the client reviews, approves and sends their own letters. */
function selfServeStep(s: JourneyState, locale: Locale, now: Date): JourneyStep {
  const totalSteps = 5;
  const c = COPY[locale];

  if (!s.reportImported) {
    return { step: 1, totalSteps, key: "import", ...c.import, href: "/onboarding" };
  }

  if (s.reviewedCount < s.totalItems) {
    const remaining = s.totalItems - s.reviewedCount;
    const variant = s.reviewedCount === 0 ? c.reviewStart : c.reviewContinue(remaining);
    return {
      step: 2,
      totalSteps,
      key: "review",
      title: variant.title,
      description: c.reviewDescription,
      cta: variant.cta,
      href: "/asistente",
    };
  }

  if (!s.roundApproved) {
    if (s.attestedCount === 0) {
      return { step: 2, totalSteps, key: "review-empty", ...c.reviewEmpty, href: "/items" };
    }
    return { step: 3, totalSteps, key: "attack", ...c.attack(s.attestedCount), href: "/asistente" };
  }

  const { beforeNextRound, daysLeft } = roundTiming(s, now);
  if (beforeNextRound) {
    return { step: 4, totalSteps, key: "waiting", ...c.waiting(daysLeft), href: "/rounds" };
  }
  return { step: 5, totalSteps, key: "next-round", ...c.nextRound, href: "/asistente" };
}

/**
 * Full service: the agreement first, then the client's review, then the team.
 * After the review no step is the client's: the team prepares and mails.
 */
function fullServiceStep(s: JourneyState, locale: Locale, now: Date): JourneyStep {
  const totalSteps = 6;
  const c = COPY[locale];
  const f = c.full;
  const gate = workMayStart(s.agreement, now);

  // 1. The agreement. Nothing else is offered until it is signed.
  if (!gate.allowed && gate.code === "disclosure_not_acknowledged") {
    return { step: 1, totalSteps, key: "agreement", ...f.agreementStart, href: "/acuerdo" };
  }
  if (!gate.allowed && gate.code === "not_signed") {
    return { step: 1, totalSteps, key: "agreement", ...f.agreementContinue, href: "/acuerdo" };
  }
  if (!gate.allowed && gate.code === "cancelled") {
    return { step: 1, totalSteps, key: "agreement-cancelled", ...f.agreementCancelled, href: "/acuerdo" };
  }
  if (!gate.allowed && gate.code === "service_end_requested") {
    return { step: 4, totalSteps, key: "end-requested", ...f.endRequested, href: "/acuerdo" };
  }

  // 2 and 3. The client's own part: the report, then saying what is inaccurate.
  if (!s.reportImported) {
    return { step: 2, totalSteps, key: "import", ...c.import, href: "/onboarding" };
  }
  if (s.reviewedCount < s.totalItems) {
    const remaining = s.totalItems - s.reviewedCount;
    const variant = s.reviewedCount === 0 ? c.reviewStart : c.reviewContinue(remaining);
    return {
      step: 3,
      totalSteps,
      key: "review",
      title: variant.title,
      description: c.reviewDescription,
      cta: variant.cta,
      href: "/asistente",
    };
  }
  if (s.attestedCount === 0 && !s.roundApproved) {
    return { step: 3, totalSteps, key: "review-empty", ...f.reviewEmpty, href: "/items" };
  }

  // 4. The team's part. Inside the cancellation period nothing has been sent,
  // whatever else is on record, and the step says when the team starts.
  if (!gate.allowed) {
    const day = gate.startsAt ? formatAgreementDay(new Date(gate.startsAt), locale) : "";
    const copy = day ? f.teamStartsOn(s.attestedCount, day) : f.teamPreparing(s.attestedCount);
    return { step: 4, totalSteps, key: "team-starts-soon", ...copy, href: "/acuerdo" };
  }
  // The one thing left that is the client's: a payment method, if there is
  // none. Asked only here, after the review and once work may start, so it is
  // never a condition for the client's own part; and it stops nothing: the
  // step says so, and the team's work goes on either way.
  if (s.paymentMethodOnFile === false) {
    return { step: s.roundApproved ? 5 : 4, totalSteps, key: "payment-method", ...f.paymentMethod, href: "/pagos" };
  }
  if (!s.roundApproved) {
    return { step: 4, totalSteps, key: "team-preparing", ...f.teamPreparing(s.attestedCount), href: "/rounds" };
  }

  // 5 and 6. Mailed: waiting on the bureaus, then the team's next round.
  const { beforeNextRound, daysLeft } = roundTiming(s, now);
  if (beforeNextRound) {
    return { step: 5, totalSteps, key: "waiting", ...f.waiting(daysLeft), href: "/rounds" };
  }
  return { step: 6, totalSteps, key: "next-round", ...f.nextRound, href: "/rounds" };
}

export function stepLabel(locale: Locale): string {
  return COPY[locale].stepLabel;
}
