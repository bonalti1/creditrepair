import type { CheckStrength } from "../domain/checks";
import type { Locale } from "../i18n/dictionaries";

// The words around the data checks (domain/checks.ts) on the review screens
// and the team's client page. The rule for every line here: say what the data
// shows and that the customer decides. Never "this is wrong", never "we
// recommend disputing", never a promise about what a bureau will do.

export interface ChecksCopy {
  title: string;
  /** Under the title. */
  lead: string;
  strength: Record<CheckStrength, string>;
  /** Before the related reasons of one check. */
  relatedReasons: string;
  /** After every check: the customer decides. */
  youDecide: string;
  /** The tag on a reason in the picker that relates to a check. */
  reasonTag: string;
  /** The opt-in box under the picker, when the picked reason relates to a check. */
  includeTitle: string;
  includeHelp: string;
  /** Above the English sentences that would go in the letter. */
  includeLetterLabel: string;
  /** The team's read-only view. */
  staffTitle: string;
  staffLead: string;
  staffIncluded: string;
}

export const CHECKS_COPY: Record<Locale, ChecksCopy> = {
  es: {
    title: "Lo que notamos en tus datos",
    lead: "Comparamos lo que dice tu reporte. Esto es lo que muestran los datos, no una conclusión.",
    strength: {
      objective: "Se ve en los datos",
      worth_checking: "Vale la pena revisarlo",
    },
    relatedReasons: "Si decides que es inexacto, estos motivos tienen que ver con esto:",
    youDecide: "Solo tú sabes si es correcto. Tú decides: si se ve bien, responde «Se ve correcto».",
    reasonTag: "Tiene que ver con lo que notamos",
    includeTitle: "Incluir en mi carta lo que muestran mis datos",
    includeHelp: "Opcional. Si lo marcas, tu carta dirá exactamente esto después del motivo. Si no, la carta lleva solo el motivo.",
    includeLetterLabel: "Lo que diría tu carta (en inglés):",
    staffTitle: "Lo que muestran los datos",
    staffLead: "Solo para responder preguntas. Nadie del equipo puede aplicarlo: el cliente decide qué es inexacto y por qué.",
    staffIncluded: "El cliente decidió incluir estos datos en su carta.",
  },
  en: {
    title: "What we noticed in your data",
    lead: "We compared what your report says. This is what the data shows, not a conclusion.",
    strength: {
      objective: "Shown in the data",
      worth_checking: "Worth checking",
    },
    relatedReasons: "If you decide it is inaccurate, these reasons have to do with this:",
    youDecide: "Only you know whether it is accurate. You decide: if it looks right, answer “Looks correct”.",
    reasonTag: "Has to do with what we noticed",
    includeTitle: "Include in my letter what my data shows",
    includeHelp: "Optional. If you tick it, your letter will say exactly this after the reason. If not, the letter carries only the reason.",
    includeLetterLabel: "What your letter would say:",
    staffTitle: "What the data shows",
    staffLead: "Only for answering questions. Nobody on the team can apply it: the client decides what is inaccurate and why.",
    staffIncluded: "The client chose to include these facts in their letter.",
  },
};
