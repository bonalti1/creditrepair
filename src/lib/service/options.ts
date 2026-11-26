import { DEFAULT_SERVICE_MODE, type ServiceMode } from "./mode";

// The two service options, in words a client reads before choosing, and the
// rules for which option applies to a client (docs/SERVICE-OPTIONS.md).
//
// The choice is pressure-free: the comparison lists the same rows for both,
// neither is "recommended", "popular" or pre-selected, and Alti explains the
// difference when asked but never pushes one (coach/systemPrompt.ts).

export type ServiceOption = ServiceMode;
/** Complete first, DIY second, in every comparison and list (the owner's decision, 2026-11-25). */
export const SERVICE_OPTIONS: readonly ServiceOption[] = ["full_service", "diy"];

type L = "en" | "es";
type Bilingual = { en: string; es: string };

export function parseServiceOption(value: unknown): ServiceOption | null {
  if (value === "full_service" || value === "full" || value === "done_for_you") return "full_service";
  if (value === "diy" || value === "self_serve") return "diy";
  return null;
}

/** The option a signed agreement is for: terms.serviceOption, absent on every agreement before 0042 (full service). */
export function optionOfTerms(terms: unknown): ServiceOption {
  const value = terms && typeof terms === "object" ? (terms as { serviceOption?: unknown }).serviceOption : undefined;
  return value === "diy" ? "diy" : "full_service";
}

/**
 * The option that applies to a client: the signed agreement in force decides
 * (it is what they agreed to and what billing reads); before signing, the
 * option they chose; with neither, full service.
 */
export function effectiveOption(input: { signedOption?: ServiceOption | null; chosenOption?: ServiceOption | null }): ServiceOption {
  return input.signedOption ?? input.chosenOption ?? DEFAULT_SERVICE_MODE;
}

// The names the owner chose (2026-11-25), used everywhere: the signup chat,
// /precios, the invitation, the client app, the console, the agreements and
// the plans. The brand name is not translated; the subtitle is.
export const OPTION_NAME: Record<ServiceOption, Bilingual> = {
  full_service: { en: "Credalti Complete", es: "Credalti Complete" },
  diy: { en: "Credalti DIY", es: "Credalti DIY" },
};

export const OPTION_SUBTITLE: Record<ServiceOption, Bilingual> = {
  full_service: { en: "Done for you", es: "Lo hacemos por ti" },
  diy: { en: "Do it yourself, guided by Alti", es: "Hazlo tú, con la guía de Alti" },
};

/** "Who it's for", one short line each. */
export const OPTION_FOR: Record<ServiceOption, Bilingual> = {
  full_service: { en: "Busy, buying a home soon, or want it handled", es: "Con poco tiempo, por comprar casa pronto, o quieres que nos encarguemos" },
  diy: { en: "Hands-on, tighter budget, not in a rush", es: "Te gusta hacerlo tú, presupuesto más justo, sin prisa" },
};

export const WHO_ITS_FOR: Bilingual = { en: "Who it's for", es: "Para quién es" };

/** Shown on every comparison. */
export const START_WITH_DIY: Bilingual = {
  en: "Start with DIY, upgrade anytime and keep everything you've done.",
  es: "Empieza con DIY, cambia a Complete cuando quieras y conserva todo lo que ya hiciste.",
};

/** One short line under each name. */
export const OPTION_TAGLINE: Record<ServiceOption, Bilingual> = {
  full_service: {
    en: "You review your report with Alti and decide. Our team prepares and mails your letters.",
    es: "Revisas tu reporte con Alti y tú decides. Nuestro equipo prepara y envía tus cartas.",
  },
  diy: {
    en: "You review your report with Alti and decide. Alti prepares your letters; you print and mail them.",
    es: "Revisas tu reporte con Alti y tú decides. Alti prepara tus cartas; tú las imprimes y las envías.",
  },
};

/** The staff console's short badge. */
export const OPTION_BADGE: Record<ServiceOption, Bilingual> = {
  full_service: { en: "Complete", es: "Complete" },
  diy: { en: "DIY", es: "DIY" },
};

export type ComparisonRow = "decides" | "letters" | "mailing" | "next_round" | "help" | "price" | "when_pay";

export const COMPARISON_ROWS: readonly ComparisonRow[] = ["decides", "letters", "mailing", "next_round", "help", "price", "when_pay"];

export const COMPARISON_LABEL: Record<ComparisonRow, Bilingual> = {
  decides: { en: "Who decides what is inaccurate", es: "Quién decide qué es inexacto" },
  letters: { en: "Who prepares the letters", es: "Quién prepara las cartas" },
  mailing: { en: "Who mails them", es: "Quién las envía" },
  next_round: { en: "The next round", es: "La siguiente ronda" },
  help: { en: "Help from people", es: "Ayuda de personas" },
  price: { en: "Price", es: "Precio" },
  when_pay: { en: "When you pay", es: "Cuándo pagas" },
};

/** The cells, the same rows for both, in plain words. Price is filled from the offered plans (priceCell). */
export const COMPARISON: Record<ServiceOption, Record<Exclude<ComparisonRow, "price">, Bilingual>> = {
  full_service: {
    decides: { en: "You. Only you.", es: "Tú. Solo tú." },
    letters: { en: "Our team, from approved templates", es: "Nuestro equipo, con modelos aprobados" },
    mailing: { en: "Our team mails them for you", es: "Nuestro equipo las envía por ti" },
    next_round: { en: "Our team prepares it, about every 40 days", es: "Nuestro equipo la prepara, cada 40 días más o menos" },
    help: { en: "Our team works your case and answers your questions", es: "Nuestro equipo trabaja tu caso y responde tus preguntas" },
    when_pay: {
      en: "Only after the work is done: nothing before your letters are mailed",
      es: "Solo después del trabajo: nada antes de que se envíen tus cartas",
    },
  },
  diy: {
    decides: { en: "You. Only you.", es: "Tú. Solo tú." },
    letters: { en: "Alti, from the same approved templates", es: "Alti, con los mismos modelos aprobados" },
    mailing: {
      en: "You print and mail them, or we mail them for a fee per letter, shown first",
      es: "Tú las imprimes y las envías, o las enviamos por una cuota por carta que ves antes",
    },
    next_round: { en: "Alti tells you when it is due", es: "Alti te avisa cuándo toca" },
    help: { en: "People answer your questions", es: "Personas responden tus preguntas" },
    when_pay: {
      en: "A monthly subscription from the start, after your 3 business days to cancel",
      es: "Una suscripción mensual desde el inicio, después de tus 3 días hábiles para cancelar",
    },
  },
};

/** "Both: 3 business days to cancel at no cost. No promises about results." */
export const BOTH_OPTIONS_NOTE: Bilingual = {
  en: "With either option, you decide what is inaccurate and you have 3 business days to cancel at no cost. Nobody can promise how the bureaus respond. You can switch later.",
  es: "Con cualquiera de las dos, tú decides qué es inexacto y tienes 3 días hábiles para cancelar sin costo. Nadie puede prometer cómo responden los burós. Puedes cambiar después.",
};

export const NO_PRICE_YET: Bilingual = {
  en: "Shown in your agreement before you sign",
  es: "Aparece en tu acuerdo antes de firmar",
};

/** The website's section around the comparison. */
export const OPTIONS_SECTION_TEXT: Record<L, { title: string; lead: string }> = {
  en: {
    title: "Two ways to work with us. You choose.",
    lead: "Credalti Complete: our team prepares and mails your letters, and every charge waits for the work. Credalti DIY: Alti prepares your letters and you mail them, for a monthly subscription. Both start with your review: you decide what is inaccurate.",
  },
  es: {
    title: "Dos formas de trabajar con nosotros. Tú eliges.",
    lead: "Credalti Complete: nuestro equipo prepara y envía tus cartas, y cada cobro espera al trabajo. Credalti DIY: Alti prepara tus cartas y tú las envías, con una suscripción mensual. Las dos empiezan con tu revisión: tú decides qué es inexacto.",
  },
};

/** The demo, where no plan is offered: the price lives on the Plans screen. */
export const PRICE_SET_BY_TEAM: Bilingual = { en: "Price set by the team", es: "Precio que fija el equipo" };

export function optionName(option: ServiceOption, locale: L): string {
  return OPTION_NAME[option][locale];
}

/** "Credalti DIY (Do it yourself, guided by Alti)". */
export function optionFullName(option: ServiceOption, locale: L): string {
  return `${OPTION_NAME[option][locale]} (${OPTION_SUBTITLE[option][locale]})`;
}
