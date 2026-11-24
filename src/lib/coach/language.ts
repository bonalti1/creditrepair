import type { Locale } from "../i18n/dictionaries";

// Which language a client wrote in, so Alti answers in it (English first,
// Spanish if needed). A small word count, not a model: it only has to tell
// English from Spanish in a short chat message. When a message gives no clear
// signal ("ok", a name, a number), the answer is null and the app's language
// decides (replyLanguage).

const SPANISH_WORDS = new Set(
  "el la los las un una unos unas de del que y en por para con sin mi mis tu tus su sus es son está están esta este esto eso qué que cómo como cuánto cuanto cuándo cuando dónde donde por qué porque puedo puede quiero tengo tiene hola gracias buenas buenos días tardes noches reporte crédito credito carta cartas cuenta cuentas deuda pago pagos pagar ayuda ayudar necesito sí también pero muy más mas ya me te se le lo al hay ser hacer saber cobranza cobro burós buró puntaje".split(
    " ",
  ),
);

const ENGLISH_WORDS = new Set(
  "the an and or of to in on for with without my your his her their is are was were be been it this that these those what how why when where who which can could would should do does did i i'm im you we they me hello hi hey thanks thank please want need have has had help report credit letter letters account accounts debt payment payments pay score bureau bureaus collection yes also but very more not don't dont about will".split(
    " ",
  ),
);

/** "es", "en", or null when the message does not say. */
export function detectMessageLanguage(text: string): Locale | null {
  const lower = text.toLowerCase();
  let es = /[ñ¿¡áéíóú]/.test(lower) ? 2 : 0;
  let en = 0;
  for (const word of lower.match(/[a-záéíóúüñ']+/g) ?? []) {
    if (SPANISH_WORDS.has(word)) es += 1;
    if (ENGLISH_WORDS.has(word)) en += 1;
  }
  if (es === en) return null;
  return es > en ? "es" : "en";
}

/** The language to answer in: the one the client wrote in, else the app's (English unless they chose Spanish). */
export function replyLanguage(text: string, appLocale: Locale | null | undefined): Locale {
  return detectMessageLanguage(text) ?? (appLocale === "es" ? "es" : "en");
}

/** What Alti sends instead of a reply that broke the claim rules, in the reply's language. */
export const COACH_SAFE_FALLBACK: Record<Locale, string> = {
  en: "I can help you understand your report and the dispute process, but I can't promise results: every case is different and results vary. Which item on your report would you like to understand better?",
  es: "Puedo ayudarte a entender tu reporte y el proceso de disputa, pero no puedo prometer resultados: cada caso es distinto y los resultados varían. ¿Qué elemento de tu reporte quieres entender mejor?",
};
