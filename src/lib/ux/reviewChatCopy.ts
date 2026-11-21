import type { ServiceMode } from "../service/mode";

// The assistant's scripted lines around the end of the review: the place in the chat
// where the two service modes say different things. Under full service the
// team prepares and mails the letters, and the client has nothing to approve.
// Under self-serve the client reads the letters and gives the OK.
//
// Every line is written in both languages at once (the thread follows the
// language switch) and is run through the claim rules in the tests. None of
// them says which items to mark, and none promises what a letter will achieve.

export interface ChatLine {
  es: string;
  en: string;
}

const confirmedEs = (n: number) => (n === 1 ? "1 elemento confirmado" : `${n} elementos confirmados`);
const confirmedEn = (n: number) => (n === 1 ? "1 confirmed item" : `${n} confirmed items`);

/** The second message of a new thread, while items still wait for an answer. */
export function reviewIntroLine(mode: ServiceMode, left: number): ChatLine {
  const leftEs = left === 1 ? "Queda 1" : `Quedan ${left}`;
  if (mode === "full_service") {
    return {
      es: `Vamos a revisarlos juntos, uno por uno. Yo te explico cada uno y tú decides. Con lo que tú confirmes, nuestro equipo prepara y envía las cartas por ti. ${leftEs}.`,
      en: `Let's review them together, one by one. I explain each and you decide. From what you confirm, our team prepares and mails the letters for you. ${left} left.`,
    };
  }
  return {
    es: `Vamos a revisarlos juntos, uno por uno. Yo te explico cada uno y tú decides. ${leftEs}.`,
    en: `Let's review them together, one by one. I explain each and you decide. ${left} left.`,
  };
}

/** The second message of a new thread, when the review is already finished with something confirmed. */
export function reviewCompleteLine(mode: ServiceMode, confirmed: number): ChatLine {
  if (mode === "full_service") {
    return {
      es: `Tu revisión está completa: ${confirmedEs(confirmed)}. Con tus respuestas, nuestro equipo prepara tus cartas y las envía por ti. Abajo ves qué va en cada una.`,
      en: `Your review is complete: ${confirmedEn(confirmed)}. From your answers, our team prepares your letters and mails them for you. Below you can see what goes in each one.`,
    };
  }
  return {
    es: `Tu revisión está completa: ${confirmedEs(confirmed)}. Preparé tus cartas. Revísalas y dame el OK.`,
    en: `Your review is complete: ${confirmedEn(confirmed)}. I prepared your letters. Review them and give me the OK.`,
  };
}

/** Right after the last answer, with at least one item confirmed. */
export function reviewFinishedLine(mode: ServiceMode): ChatLine {
  if (mode === "full_service") {
    return {
      es: "¡Revisaste todo! 🎉 Con tus respuestas, nuestro equipo prepara tus cartas y las envía por ti. Abajo ves qué va en cada una. No tienes que aprobar nada.",
      en: "You reviewed everything! 🎉 From your answers, our team prepares your letters and mails them for you. Below you can see what goes in each one. There is nothing for you to approve.",
    };
  }
  return {
    es: "¡Revisaste todo! 🎉 Preparé tus cartas. Revísalas abajo y dame el OK cuando lo tengas claro.",
    en: "You reviewed everything! 🎉 I prepared your letters. Review them below and give me the OK when you're sure.",
  };
}

/** The second message of a new thread, when the letters are already out. The same in both modes. */
export const LETTERS_OUT_LINE: ChatLine = {
  es: "Tus cartas van en camino. Los burós tienen ~30 días para responder y yo te aviso aquí con cualquier novedad. ¿Tienes preguntas mientras tanto?",
  en: "Your letters are on their way. Bureaus have ~30 days to respond and I'll message you here with any news. Any questions meanwhile?",
};
