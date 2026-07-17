import type { Locale } from "../i18n/dictionaries";

// The journey engine — the single biggest UX bet against Dispute Beast:
// at any moment the app tells the user exactly ONE next step, in plain
// language, with a button that takes them there. No dead ends, no guessing.

export interface JourneyState {
  reportImported: boolean;
  totalItems: number;
  reviewedCount: number;
  attestedCount: number;
  roundApproved: boolean;
  /** ISO date the current round mailed, if any. */
  mailedAt?: string | null;
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

export const RESPONSE_WINDOW_DAYS = 30; // FCRA reinvestigation window
export const NEXT_ROUND_DAYS = 40;

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
      title: "Tu ataque está listo para tu revisión",
      description: `${n} elemento(s) atestiguados. Lee cada carta (te la explicamos en palabras simples) y apruébala cuando estés seguro.`,
      cta: "Revisar mi ataque",
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
        "Tu reporte se vuelve a importar, comparamos qué se eliminó y qué sigue, y armas tu próximo ataque con un clic.",
      cta: "Armar siguiente ataque",
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
      title: "Your attack is ready for your review",
      description: `${n} attested item(s). Read each letter (we explain it in plain words) and approve when you're sure.`,
      cta: "Review my attack",
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
        "Your report re-imports, we compare what was deleted and what remains, and you build your next attack in one click.",
      cta: "Build next attack",
    },
  },
} as const;

export function nextAction(s: JourneyState, locale: Locale = "es"): JourneyStep {
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
      href: "/items",
    };
  }

  if (!s.roundApproved) {
    if (s.attestedCount === 0) {
      return { step: 2, totalSteps, key: "review-empty", ...c.reviewEmpty, href: "/items" };
    }
    return { step: 3, totalSteps, key: "attack", ...c.attack(s.attestedCount), href: "/attack" };
  }

  const mailed = s.mailedAt ? new Date(s.mailedAt) : new Date();
  const nextRound = new Date(mailed.getTime() + NEXT_ROUND_DAYS * 24 * 60 * 60 * 1000);
  const responseDue = new Date(mailed.getTime() + RESPONSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  if (now < nextRound) {
    const daysLeft = Math.max(0, Math.ceil((responseDue.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    return { step: 4, totalSteps, key: "waiting", ...c.waiting(daysLeft), href: "/rounds" };
  }

  return { step: 5, totalSteps, key: "next-round", ...c.nextRound, href: "/attack" };
}

export function stepLabel(locale: Locale): string {
  return COPY[locale].stepLabel;
}
