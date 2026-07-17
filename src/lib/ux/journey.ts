// The journey engine — the single biggest UX bet against Dispute Beast:
// at any moment the app tells the user exactly ONE next step, in plain
// Spanish, with a button that takes them there. No dead ends, no guessing.

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

export function nextAction(s: JourneyState): JourneyStep {
  const totalSteps = 5;

  if (!s.reportImported) {
    return {
      step: 1,
      totalSteps,
      key: "import",
      title: "Conecta tu monitoreo e importa tu reporte",
      description:
        "Tu suscripción de monitoreo nos deja importar tu reporte de los 3 burós. Es el punto de partida de todo.",
      cta: "Conectar monitoreo",
      href: "/onboarding",
    };
  }

  if (s.reviewedCount < s.totalItems) {
    const remaining = s.totalItems - s.reviewedCount;
    return {
      step: 2,
      totalSteps,
      key: "review",
      title:
        s.reviewedCount === 0
          ? "Revisa los elementos de tu reporte"
          : `Sigue revisando: te faltan ${remaining}`,
      description:
        "Te mostramos cada elemento uno por uno, explicado en palabras simples. Tú decides cuáles crees que son inexactos.",
      cta: s.reviewedCount === 0 ? "Empezar revisión" : "Continuar revisión",
      href: "/items",
    };
  }

  if (!s.roundApproved) {
    if (s.attestedCount === 0) {
      return {
        step: 2,
        totalSteps,
        key: "review-empty",
        title: "Revisaste todo — ningún elemento marcado",
        description:
          "No marcaste elementos para disputar. Si todo en tu reporte es correcto, ¡esa es una buena noticia! Puedes volver a revisar cuando quieras.",
        cta: "Volver a revisar",
        href: "/items",
      };
    }
    return {
      step: 3,
      totalSteps,
      key: "attack",
      title: "Tu ataque está listo para tu revisión",
      description: `${s.attestedCount} elemento(s) atestiguados. Lee cada carta (te la explicamos en palabras simples) y apruébala cuando estés seguro.`,
      cta: "Revisar mi ataque",
      href: "/attack",
    };
  }

  const mailed = s.mailedAt ? new Date(s.mailedAt) : new Date();
  const responseDue = new Date(mailed.getTime() + RESPONSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const nextRound = new Date(mailed.getTime() + NEXT_ROUND_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  if (now < nextRound) {
    const daysLeft = Math.max(0, Math.ceil((responseDue.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    return {
      step: 4,
      totalSteps,
      key: "waiting",
      title: "Tus cartas van en camino 📬",
      description:
        daysLeft > 0
          ? `Los burós tienen ~${RESPONSE_WINDOW_DAYS} días para responder (quedan ~${daysLeft}). Te avisamos por WhatsApp con cualquier novedad — no tienes que hacer nada.`
          : "La ventana de respuesta de los burós ya pasó. En cuanto tu reporte se actualice, comparamos y te mostramos qué cambió.",
      cta: "Ver mis rondas",
      href: "/rounds",
    };
  }

  return {
    step: 5,
    totalSteps,
    key: "next-round",
    title: "Es hora de tu siguiente ronda",
    description:
      "Tu reporte se vuelve a importar, comparamos qué se eliminó y qué sigue, y armas tu próximo ataque con un clic.",
    cta: "Armar siguiente ataque",
    href: "/attack",
  };
}
