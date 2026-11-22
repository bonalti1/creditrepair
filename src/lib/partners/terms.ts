import { sha256Hex } from "../agreement/sha256";
import { BRAND } from "../brand";

// The partner terms a partner accepts the first time they open the portal
// (and again when the version changes), before they can see any client who
// shares with them. ATTORNEY-PENDING DRAFT: the wording is ours, to be
// reviewed with the questions in docs/PARTNERS.md.
//
// The version is also in the database (partner_terms_current(), migration
// 0023): the functions that return clients require an acceptance of exactly
// this version. Change both together; a test compares them.
//
// The fee clause has two forms: while "Comisiones a socios" is off, the terms
// say the program pays no referral fees. The hash recorded with the
// acceptance is of the form the partner was shown.

export const PARTNER_CLIENT_TERMS_VERSION = "2026-11-socios-terminos-v1";

export interface PartnerTerms {
  title: string;
  draftNote: string;
  intro: string;
  clauses: Array<{ title: string; body: string }>;
  accept: string;
  button: string;
}

const brand = BRAND.name;

export function partnerTerms(locale: "es" | "en", commissionsEnabled: boolean): PartnerTerms {
  if (locale === "en") {
    return {
      title: "Partner terms",
      draftNote: "Draft pending review by our attorney.",
      intro: `Before you see any client, please read and accept these terms. They protect the people you refer and you.`,
      clauses: [
        { title: "Confidentiality", body: "What a client shares with you is for following their progress only. Do not copy it, forward it or tell anyone else, and do not use it to make decisions about the client." },
        { title: "No promises", body: "Do not promise results to anyone: no points, no dates, no approvals. The bureaus decide and results vary." },
        { title: "No SSNs or reports", body: "Do not ask for, collect or keep Social Security numbers, dates of birth or credit reports. Each person gives their details in their own account." },
        { title: "No pressure", body: "Do not pressure anyone to sign up, to stay, or to share their progress with you." },
        commissionsEnabled
          ? { title: "Referral fees", body: `Only per client who signs or per active client, as recorded in your partner agreement. Never for what happens on a credit report. If you promote ${brand}, say that you receive a commission.` }
          : { title: "No referral fees", body: "For now, the partner program pays no referral fees. Do not accept anything of value from anyone for referring them." },
        { title: "The client decides", body: "Sharing their progress is each client's choice. They can stop at any time and you will stop seeing it at once. Every time you open a client's page, it is recorded and the client can see it." },
      ],
      accept: "I have read and accept the partner terms.",
      button: "Accept and continue",
    };
  }
  return {
    title: "Términos para socios",
    draftNote: "Borrador pendiente de revisión por nuestro abogado.",
    intro: "Antes de ver a cualquier cliente, lee y acepta estos términos. Protegen a las personas que refieres y a ti.",
    clauses: [
      { title: "Confidencialidad", body: "Lo que un cliente te comparte es solo para seguir su avance. No lo copies, no lo reenvíes ni se lo cuentes a nadie, y no lo uses para tomar decisiones sobre el cliente." },
      { title: "Sin promesas", body: "No prometas resultados a nadie: ni puntos, ni fechas, ni aprobaciones. Los burós deciden y los resultados varían." },
      { title: "Sin números de Seguro Social ni reportes", body: "No pidas, no juntes ni guardes números de Seguro Social, fechas de nacimiento ni reportes de crédito. Cada persona da sus datos en su propia cuenta." },
      { title: "Sin presión", body: "No presiones a nadie para que se inscriba, para que siga ni para que te comparta su avance." },
      commissionsEnabled
        ? { title: "Comisiones", body: `Solo por cliente que firma o por cliente activo, según tu acuerdo de socio. Nunca por lo que pase en un reporte de crédito. Si promocionas ${brand}, di que recibes una comisión.` }
        : { title: "Sin comisiones", body: "Por ahora, el programa de socios no paga comisiones por referir. No aceptes nada de valor de nadie por referirlo." },
      { title: "El cliente decide", body: "Compartir su avance es decisión de cada cliente. Puede dejar de hacerlo cuando quiera y tú dejas de verlo de inmediato. Cada vez que abres la página de un cliente, queda registrado y el cliente lo ve." },
    ],
    accept: "Leí y acepto los términos para socios.",
    button: "Aceptar y continuar",
  };
}

export function partnerTermsText(locale: "es" | "en", commissionsEnabled: boolean): string {
  const t = partnerTerms(locale, commissionsEnabled);
  return [t.title, t.draftNote, t.intro, ...t.clauses.map((c) => `${c.title}: ${c.body}`), t.accept].join("\n");
}

/** SHA-256 of exactly what the partner was shown. */
export function partnerTermsHash(locale: "es" | "en", commissionsEnabled: boolean, version: string = PARTNER_CLIENT_TERMS_VERSION): string {
  return sha256Hex([`version: ${version}`, `locale: ${locale}`, partnerTermsText(locale, commissionsEnabled)].join("\n\n"));
}
