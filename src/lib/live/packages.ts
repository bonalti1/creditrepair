// The two packages a person may choose after their review (owner, 2026-11-25).
// Another part of the app builds the packages themselves (each client's
// `option`); this file only names them, says who each is for and how it is
// charged, and builds the signup link with the chosen package preselected:
//
//   /onboarding?...&option=complete    or    &option=diy
//
// (the `option` query parameter: "complete" | "diy"; anything else is ignored
// and the person picks on the signup itself). Complete is always listed first.
// Nothing here is a price: amounts live only in the attorney-approved plans.

export const PACKAGES = ["complete", "diy"] as const;
export type PackageKey = (typeof PACKAGES)[number];

/** The query parameter the signup reads to preselect a package. */
export const OPTION_PARAM = "option";

export function isPackageKey(value: unknown): value is PackageKey {
  return value === "complete" || value === "diy";
}

export const PACKAGE_TEXT: Record<"en" | "es", Record<PackageKey, { name: string; what: string; who: string; charged: string }> & { upgrade: string; charges: string }> = {
  en: {
    complete: {
      name: "Credalti Complete",
      what: "Done for you: you tell us what is inaccurate, and our team prepares and mails the letters.",
      who: "For you if you're busy, buying a home soon, or want it handled.",
      charged: "Monthly, charged right after each month's letters are mailed.",
    },
    diy: {
      name: "Credalti DIY",
      what: "You do it yourself, guided step by step by Alti, our AI assistant.",
      who: "For you if you're hands-on, on a tighter budget, or not in a rush.",
      charged: "A simple monthly subscription from the start.",
    },
    upgrade: "Start with DIY, upgrade anytime and keep everything you've done.",
    charges: "With Complete, you're charged each month right after your letters are mailed; DIY is a simple monthly subscription.",
  },
  es: {
    complete: {
      name: "Credalti Complete",
      what: "Lo hacemos por ti: tú nos dices qué es inexacto y nuestro equipo prepara y envía las cartas.",
      who: "Para ti si tienes poco tiempo, vas a comprar casa pronto o quieres que lo hagamos nosotros.",
      charged: "Mensual, se cobra justo después de enviar las cartas de cada mes.",
    },
    diy: {
      name: "Credalti DIY",
      what: "Lo haces tú, con la guía paso a paso de Alti, nuestro asistente con IA.",
      who: "Para ti si te gusta hacerlo tú, tienes un presupuesto más ajustado o no tienes prisa.",
      charged: "Una suscripción mensual sencilla desde el inicio.",
    },
    upgrade: "Empieza con DIY, cambia a Complete cuando quieras y conserva todo lo que ya hiciste.",
    charges: "Con Complete, se cobra cada mes justo después de enviar tus cartas; DIY es una suscripción mensual sencilla.",
  },
};
