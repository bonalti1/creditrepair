import type { ResolvedTerms } from "./terms";

// The "In plain words" summary above the contract (/acuerdo and the signup
// chat's sheet), for the option the agreement is for (docs/SERVICE-OPTIONS.md).
// Credalti Complete: the team prepares and mails the letters, and each charge
// comes only after the work it pays for (charged each month right after the
// letters are mailed). Credalti DIY: Alti prepares the letters and the client
// prints and mails them; a simple monthly subscription, charged after the 3
// business days to cancel. The contract itself is the text that governs.

type L = "en" | "es";

export function isDiyTerms(terms: Pick<ResolvedTerms, "serviceOption">): boolean {
  return terms.serviceOption === "diy";
}

/** "What your team does" (Complete) / "What we do" (DIY). */
export function plainWhoDoes(terms: Pick<ResolvedTerms, "serviceOption">, locale: L): { title: string; body: string } {
  const es = locale === "es";
  if (isDiyTerms(terms)) {
    return {
      title: es ? "Lo que hacemos" : "What we do",
      body: es
        ? "Alti prepara tus cartas con los modelos aprobados, sobre lo que tú digas que es inexacto; tú las imprimes y las envías. El equipo responde tus preguntas, y envía las cartas que nos pidas por la cuota que ves antes de confirmar."
        : "Alti prepares your letters from the approved templates, about what you say is inaccurate; you print and mail them. Our team answers your questions, and mails the letters you ask us to, for the fee you see before you confirm.",
    };
  }
  return {
    title: es ? "Lo que hace tu equipo" : "What your team does",
    body: es
      ? "Importa tu reporte, prepara las cartas sobre lo que tú digas que es inexacto y las envía por correo, en rondas cada 40 días más o menos."
      : "Imports your report, prepares the letters about what you say is inaccurate and mails them, in rounds about every 40 days.",
  };
}

/** When each charge happens, in one or two sentences (after the plan's own summary). */
export function plainWhenCharged(terms: Pick<ResolvedTerms, "serviceOption">, locale: L): string {
  const es = locale === "es";
  if (isDiyTerms(terms)) {
    return es
      ? "Credalti DIY es una suscripción mensual sencilla: se cobra después de tus 3 días hábiles para cancelar, y no por trabajo de nuestro equipo."
      : "Credalti DIY is a simple monthly subscription: it is charged after your 3 business days to cancel, not for work our team does.";
  }
  return es
    ? "Con Credalti Complete, cada cobro se hace solo después del trabajo que paga: cada mes, justo después de enviar tus cartas."
    : "With Credalti Complete, each charge is made only after the work it pays for: each month, right after your letters are mailed.";
}
