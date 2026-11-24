import { MONITORING_OFFER } from "../monitoring/offer";
import type { AftercareSourceKey } from "./sources";

// ITIN clients: people with an Individual Taxpayer Identification Number
// instead of a Social Security number. Other companies serve them poorly; we
// give them the right path from the first question.
//
// What was found (2026-11-24, docs/AFTERCARE.md, "ITIN"):
//  - Monitoring: IdentityIQ's public pages say nothing either way about
//    enrolling with an ITIN (IDIQ question 8 in docs/IDENTITYIQ.md is still
//    open). So the app says "ask our team" and never claims it works. Another
//    monitoring service announced online 3-bureau access for people without
//    an SSN in April 2026 (a press release, unverified); staff see that in the
//    doc, clients do not, because a provider is named only once we hold an
//    agreement with it (src/lib/monitoring/offer.ts).
//  - Reports: a credit file can exist under an ITIN. AnnualCreditReport.com
//    asks for an SSN online; with an ITIN you ask each bureau by mail, with
//    copies of your ID and proof of address (Experian's help pages).
//  - Letters: no letter template prints a Social Security number or its last
//    four digits, so there is nothing to swap. The one place an SSN appears is
//    an enclosure label ("Copy of Social Security card"); for an ITIN client it
//    reads as the IRS letter that assigned the ITIN (enclosureLabelFor). Full
//    numbers are never asked for, stored or printed.
//
// Every line here passes the claim rules (aftercare.test.ts).

export type L = "es" | "en";
type Bi = Record<L, string>;

export type IdType = "ssn" | "itin";

export function parseIdType(v: unknown): IdType | null {
  return v === "ssn" || v === "itin" ? v : null;
}

/**
 * Whether the monitoring provider is confirmed to accept an ITIN. Unknown
 * until IDIQ answers in writing; set NEXT_PUBLIC_MONITORING_ITIN=accepted only then.
 */
export const MONITORING_ITIN_POLICY: "accepted" | "unknown" = process.env.NEXT_PUBLIC_MONITORING_ITIN === "accepted" ? "accepted" : "unknown";

export interface ItinSection {
  key: "what" | "monitoring" | "reports" | "letters" | "building" | "home";
  title: Bi;
  body: Record<L, string[]>;
  sources: AftercareSourceKey[];
  /** True when the section needs the team's answer before the client acts. */
  askTeam?: boolean;
}

function monitoringBody(): Record<L, string[]> {
  const provider = MONITORING_OFFER.providerName;
  if (MONITORING_ITIN_POLICY === "accepted" && provider) {
    return {
      en: [`${provider} accepts an ITIN for sign-up.`, "If it asks for something you do not have, write to your team before you pay."],
      es: [`${provider} acepta ITIN para inscribirte.`, "Si te pide algo que no tienes, escríbele a tu equipo antes de pagar."],
    };
  }
  return {
    en: [
      "Monitoring services check who you are before they show your report, and many ask for a Social Security number.",
      "We are still confirming whether our monitoring service accepts an ITIN. Ask our team before you sign up or pay.",
      "Some services now say they accept an ITIN. Our team checks which ones work and tells you your options.",
    ],
    es: [
      "Los servicios de monitoreo verifican quién eres antes de mostrarte tu reporte, y muchos piden número de Seguro Social.",
      "Todavía estamos confirmando si nuestro servicio de monitoreo acepta ITIN. Pregúntale a nuestro equipo antes de inscribirte o pagar.",
      "Algunos servicios ya dicen que aceptan ITIN. Nuestro equipo revisa cuáles funcionan y te dice tus opciones.",
    ],
  };
}

export function itinSections(): ItinSection[] {
  return [
    {
      key: "what",
      title: { en: "You can have a credit file with an ITIN", es: "Puedes tener un expediente de crédito con ITIN" },
      body: {
        en: [
          "An ITIN is a tax number from the IRS for people who cannot get a Social Security number.",
          "The bureaus can keep a credit file under your name and ITIN. Accounts you open with your ITIN can show on it.",
        ],
        es: [
          "El ITIN es un número de impuestos del IRS para personas que no pueden tener número de Seguro Social.",
          "Los burós pueden tener un expediente con tu nombre y tu ITIN. Las cuentas que abres con tu ITIN pueden aparecer ahí.",
        ],
      },
      sources: ["irsItin", "experianItin"],
    },
    {
      key: "monitoring",
      title: { en: "Credit monitoring with an ITIN", es: "Monitoreo de crédito con ITIN" },
      body: monitoringBody(),
      sources: [],
      askTeam: MONITORING_ITIN_POLICY !== "accepted",
    },
    {
      key: "reports",
      title: { en: "How to get your reports", es: "Cómo pedir tus reportes" },
      body: {
        en: [
          "AnnualCreditReport.com asks for a Social Security number online, so it may not work with an ITIN.",
          "You can ask each bureau by mail: Equifax, Experian and TransUnion. Use the official request form from AnnualCreditReport.com.",
          "Send your full name, ITIN, date of birth and your addresses for the last two years.",
          "Include a copy of a government ID and of a recent utility bill or bank statement.",
          "Your team can help you fill it in. Check each bureau's mailing address on its own site first.",
        ],
        es: [
          "AnnualCreditReport.com pide número de Seguro Social en línea, así que puede no funcionar con ITIN.",
          "Puedes pedirlos por correo a cada buró: Equifax, Experian y TransUnion. Usa el formulario oficial de AnnualCreditReport.com.",
          "Manda tu nombre completo, tu ITIN, tu fecha de nacimiento y tus direcciones de los últimos dos años.",
          "Incluye una copia de una identificación oficial y de una factura de servicios o un estado de cuenta reciente.",
          "Tu equipo te ayuda a llenarlo. Revisa primero la dirección de cada buró en su propio sitio.",
        ],
      },
      sources: ["experianAnnualNoSsn", "experianItin", "annualCreditReportForm"],
    },
    {
      key: "letters",
      title: { en: "Your dispute letters", es: "Tus cartas de disputa" },
      body: {
        en: [
          "Our letters never print a Social Security number or an ITIN, not even the last four digits.",
          "When a letter needs proof of your number, we enclose the IRS letter that gave you your ITIN, if you give us a copy.",
          "Never send us your full number by message. We never ask for it.",
        ],
        es: [
          "Nuestras cartas nunca imprimen un número de Seguro Social ni un ITIN, ni siquiera los últimos cuatro números.",
          "Cuando una carta necesita prueba de tu número, adjuntamos la carta del IRS que te dio tu ITIN, si nos das una copia.",
          "Nunca nos mandes tu número completo por mensaje. Nunca te lo pedimos.",
        ],
      },
      sources: [],
    },
    {
      key: "building",
      title: { en: "Building credit with an ITIN", es: "Construir crédito con ITIN" },
      body: {
        en: [
          "Some banks and credit unions open secured cards and credit-builder loans with an ITIN. Ask before you apply.",
          "In your plan, offers marked \"Accepts ITIN\" say they take one. Confirm it with them too.",
        ],
        es: [
          "Algunos bancos y cooperativas abren tarjetas aseguradas y préstamos para construir crédito con ITIN. Pregunta antes de pedirlos.",
          "En tu plan, las ofertas marcadas «Acepta ITIN» dicen que lo aceptan. Confírmalo con ellos también.",
        ],
      },
      sources: ["cfpbBuildCredit"],
    },
    {
      key: "home",
      title: { en: "Buying a home with an ITIN", es: "Comprar casa con ITIN" },
      body: {
        en: [
          "Some lenders have home loans for people with an ITIN. They often ask for a larger down payment.",
          "The home-ready path explains what lenders usually look at.",
        ],
        es: [
          "Algunos prestamistas tienen préstamos para casa para personas con ITIN. Muchas veces piden un enganche más grande.",
          "El camino para comprar casa explica lo que los prestamistas suelen revisar.",
        ],
      },
      sources: ["itinLoans"],
    },
  ];
}

/** Every sentence of the ITIN guide, for the tests. */
export function itinCopy(locale: L): string[] {
  return itinSections().flatMap((s) => [s.title[locale], ...s.body[locale]]);
}

/** The onboarding question. */
export const ID_TYPE_QUESTION = {
  en: {
    title: "Do you have a Social Security number or an ITIN?",
    sub: "So we can show you the right steps. We never ask for the number itself.",
    ssn: "Social Security number",
    ssnSub: "The 9-digit number from Social Security.",
    itin: "ITIN",
    itinSub: "The tax number from the IRS. It starts with 9.",
    note: "We only save which kind you have. Never type your number in this app or in a message.",
  },
  es: {
    title: "¿Tienes número de Seguro Social o ITIN?",
    sub: "Así te mostramos los pasos correctos. Nunca te pedimos el número.",
    ssn: "Número de Seguro Social",
    ssnSub: "El número de 9 dígitos del Seguro Social.",
    itin: "ITIN",
    itinSub: "El número de impuestos del IRS. Empieza con 9.",
    note: "Solo guardamos qué tipo tienes. Nunca escribas tu número en esta app ni en un mensaje.",
  },
} as const;

/** The ITIN box on the monitoring step of onboarding. */
export function itinMonitoringNote(locale: L): { title: string; body: string } {
  const es = locale === "es";
  if (MONITORING_ITIN_POLICY === "accepted") {
    return {
      title: es ? "Con tu ITIN" : "With your ITIN",
      body: es ? "Este servicio de monitoreo acepta ITIN. Si te pide algo que no tienes, escríbenos." : "This monitoring service accepts an ITIN. If it asks for something you do not have, write to us.",
    };
  }
  return {
    title: es ? "Con tu ITIN: pregúntale a nuestro equipo primero" : "With your ITIN: ask our team first",
    body: es
      ? "Todavía estamos confirmando si este servicio de monitoreo acepta ITIN. Antes de pagar, escríbenos y te decimos tus opciones. Puedes seguir con tu acuerdo y tu revisión mientras tanto."
      : "We are still confirming whether this monitoring service accepts an ITIN. Before you pay, write to us and we will tell you your options. You can go on with your agreement and your review meanwhile.",
  };
}

/**
 * Saved answers for the team's library (src/lib/staff/answers.ts): what
 * AltiBot may send when a question closely matches one an administrator
 * approved. The monitoring question is left out on purpose: it is not
 * confirmed, so it stays a person's answer.
 */
export const ITIN_SAVED_ANSWERS: ReadonlyArray<{ id: string; question: string; answer: string; language: L }> = [
  {
    id: "00000000-0000-4000-a000-000000000021",
    question: "¿Puedo tener historial de crédito con ITIN?",
    answer:
      "Sí. Los burós pueden tener un expediente con tu nombre y tu ITIN, y las cuentas que abres con tu ITIN pueden aparecer ahí. En la app, «Construye tu crédito» tiene una guía para ITIN con los pasos.",
    language: "es",
  },
  {
    id: "00000000-0000-4000-a000-000000000022",
    question: "¿Cómo pido mi reporte de crédito si tengo ITIN?",
    answer:
      "AnnualCreditReport.com pide número de Seguro Social en línea. Con ITIN, lo pides por correo a cada buró (Equifax, Experian y TransUnion) con el formulario oficial de AnnualCreditReport.com, una copia de tu identificación y un comprobante de domicilio. Tu equipo te ayuda a llenarlo.",
    language: "es",
  },
  {
    id: "00000000-0000-4000-a000-000000000023",
    question: "¿Mis cartas llevan mi número de ITIN?",
    answer: "No. Nuestras cartas no imprimen tu número de Seguro Social ni tu ITIN, ni los últimos cuatro números. Nunca nos mandes tu número completo por mensaje.",
    language: "es",
  },
  {
    id: "00000000-0000-4000-a000-000000000024",
    question: "Can I have a credit history with an ITIN?",
    answer:
      "Yes. The bureaus can keep a file under your name and ITIN, and accounts you open with your ITIN can show on it. In the app, \"Build your credit\" has an ITIN guide with the steps.",
    language: "en",
  },
  {
    id: "00000000-0000-4000-a000-000000000025",
    question: "How do I get my credit report if I have an ITIN?",
    answer:
      "AnnualCreditReport.com asks for a Social Security number online. With an ITIN, you ask each bureau (Equifax, Experian and TransUnion) by mail, with the official form from AnnualCreditReport.com, a copy of your ID and a proof of address. Your team can help you fill it in.",
    language: "en",
  },
  {
    id: "00000000-0000-4000-a000-000000000026",
    question: "Do my letters show my ITIN number?",
    answer: "No. Our letters never print your Social Security number or your ITIN, not even the last four digits. Never send us your full number by message.",
    language: "en",
  },
];

/**
 * A full Social Security number or ITIN in a text (nine digits, with or
 * without dashes or spaces). AltiBot's replies are refused when they contain
 * one; nothing the app writes ever does.
 */
export function containsTaxpayerNumber(text: string): boolean {
  return /(?<!\d)\d{3}[-\s]?\d{2}[-\s]?\d{4}(?!\d)/.test(text);
}

/** Enclosure labels on a letter, for this client's kind of number. Never a number. */
export function enclosureLabelFor(kind: string, idType: IdType | null, labels: Readonly<Record<string, string>>): string | undefined {
  if (kind === "ssn_card" && idType === "itin") return "Copy of IRS letter assigning my ITIN";
  return labels[kind];
}
