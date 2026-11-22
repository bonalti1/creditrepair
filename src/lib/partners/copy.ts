import { BRAND } from "../brand";

// Every word a partner (or someone applying to be one) reads: the /socios
// signup page and the partner portal, in Spanish (the source) and English (a
// faithful translation). The test suite runs every string through the
// advertising claim rules (checkMarketingCopy): partner copy describes the
// process, never an outcome. The rules partners agree to are here too, and
// repeated in docs/PARTNERS.md.

/** The version of the partner rules an applicant accepts (partners.terms_version). Change it when PARTNER_RULES change. */
export const PARTNER_TERMS_VERSION = "2026-11-socios-v1";

/** How long the referral link's cookie lasts, in days (src/app/r/[code]/route.ts). */
export const REFERRAL_COOKIE_DAYS = 60;
export const REFERRAL_COOKIE = "credalti_socio";

const brand = BRAND.name;

export interface PartnerCopy {
  signup: {
    eyebrow: string;
    title: string;
    lead: string;
    stepsTitle: string;
    steps: Array<{ title: string; body: string }>;
    rulesTitle: string;
    formTitle: string;
    name: string;
    company: string;
    kind: string;
    phone: string;
    email: string;
    state: string;
    optional: string;
    accept: string;
    submit: string;
    sending: string;
    doneTitle: string;
    doneBody: string;
    demoNote: string;
    problems: Record<"required" | "invalid", string>;
    error: string;
    disclosureTitle: string;
    disclosure: string;
    portalLink: string;
  };
  portal: {
    title: string;
    hello: (name: string) => string;
    linkTitle: string;
    linkHelp: string;
    copy: string;
    copied: string;
    qrAlt: string;
    qrHelp: string;
    sendTitle: string;
    sendHelp: string;
    firstName: string;
    lastName: string;
    phone: string;
    consent: string;
    submit: string;
    sending: string;
    sent: string;
    sentNote: string;
    referralsTitle: string;
    referralsEmpty: string;
    statusHelp: string;
    statusMeaning: Record<"contacted" | "signed" | "active" | "not_continued", string>;
    commissionTitle: string;
    owed: string;
    paid: string;
    balance: string;
    commissionHelp: string;
    rulesTitle: string;
    notApproved: string;
    signOut: string;
    demoNote: string;
    error: string;
  };
  /** What a partner agrees to. Shown on the signup page and in the portal. */
  rules: string[];
  /** The line a partner adds when promoting us (FTC endorsement guides). */
  disclosureLine: string;
  /** What the partner confirms when sending a referral; stored with the prospect. */
  referralConsent: string;
}

export const PARTNER_COPY: Record<"es" | "en", PartnerCopy> = {
  es: {
    signup: {
      eyebrow: "Programa de socios",
      title: `Refiere a tus clientes a ${brand}`,
      lead: `Para agentes de bienes raíces, oficiales de préstamos y preparadores de impuestos. Tú nos presentas a la persona; nuestro equipo le explica el servicio por WhatsApp y, si decide empezar, prepara y envía sus cartas de disputa por los puntos que ella misma indique.`,
      stepsTitle: "Cómo funciona",
      steps: [
        { title: "Solicita tu cuenta", body: "Llena el formulario. Una persona del equipo revisa tu solicitud y te escribe." },
        { title: "Comparte tu enlace o envía un referido", body: "Con tu enlace personal, o desde tu portal con el nombre y el teléfono de la persona, si aceptó que la contactemos." },
        { title: "Sigue a tus referidos", body: "En tu portal ves si los contactamos, si firmaron y si su servicio está activo. Nada de su información de crédito." },
      ],
      rulesTitle: "Las reglas para socios",
      formTitle: "Solicitud",
      name: "Tu nombre completo",
      company: "Empresa o agencia",
      kind: "A qué te dedicas",
      phone: "Tu teléfono",
      email: "Tu correo",
      state: "Estado donde trabajas",
      optional: "opcional",
      accept: "Leí y acepto las reglas para socios.",
      submit: "Enviar solicitud",
      sending: "Enviando…",
      doneTitle: "Recibimos tu solicitud",
      doneBody: "Una persona del equipo la revisa y te escribe. Cuando quede aprobada, entras a tu portal con tu teléfono o tu correo.",
      demoNote: "Demostración: la solicitud se guarda solo en este navegador.",
      problems: { required: "Falta este dato.", invalid: "Revisa este dato." },
      error: "No pudimos enviar tu solicitud. Inténtalo de nuevo en un momento.",
      disclosureTitle: "Si nos promocionas",
      disclosure: "Di claramente que recibes una comisión por referir. Por ejemplo:",
      portalLink: "¿Ya eres socio? Entra a tu portal",
    },
    portal: {
      title: "Portal de socios",
      hello: (name) => `Hola, ${name}`,
      linkTitle: "Tu enlace",
      linkHelp: "Quien entra por tu enlace queda registrado como tu referido durante 60 días en ese navegador.",
      copy: "Copiar enlace",
      copied: "Enlace copiado",
      qrAlt: "Código QR de tu enlace",
      qrHelp: "Para imprimir en una tarjeta o mostrar en tu teléfono.",
      sendTitle: "Enviar un referido",
      sendHelp: "Nuestro equipo le escribe por WhatsApp. Nunca nos mandes su número de Seguro Social, su fecha de nacimiento ni su reporte.",
      firstName: "Nombre",
      lastName: "Apellido",
      phone: "Teléfono (WhatsApp)",
      consent: "Esta persona aceptó que el equipo la contacte por WhatsApp.",
      submit: "Enviar referido",
      sending: "Enviando…",
      sent: "Listo. El equipo le escribe pronto.",
      sentNote: "Si esta persona ya estaba en contacto con nosotros, no aparecerá en tu lista.",
      referralsTitle: "Tus referidos",
      referralsEmpty: "Todavía no tienes referidos.",
      statusHelp: "Solo ves en qué paso va cada persona. Su información de crédito, sus cartas y sus pagos son privados.",
      statusMeaning: {
        contacted: "El equipo está en contacto.",
        signed: "Firmó su acuerdo de servicio.",
        active: "Su servicio está activo.",
        not_continued: "Decidió no seguir.",
      },
      commissionTitle: "Comisiones",
      owed: "Registradas",
      paid: "Pagadas",
      balance: "Por pagar",
      commissionHelp: "Las registra una persona administradora según tu acuerdo de socio. Ninguna comisión depende de lo que pase en un reporte.",
      rulesTitle: "Recuerda",
      notApproved: "Tu cuenta de socio todavía no está aprobada. Te escribimos en cuanto lo esté.",
      signOut: "Cerrar sesión",
      demoNote: "Demostración: los referidos son inventados y nada se envía.",
      error: "No pudimos enviarlo. Revisa los datos e inténtalo de nuevo.",
    },
    rules: [
      "No prometas resultados: ni puntos, ni fechas, ni aprobaciones de crédito. Los burós deciden y los resultados varían.",
      "No pidas ni guardes números de Seguro Social, fechas de nacimiento ni reportes de crédito. Cada persona da sus datos en su propia cuenta.",
      "Refiere solo a quien aceptó que lo contactemos.",
      "Tu comisión nunca depende de lo que pase en un reporte de crédito.",
      "Si nos promocionas, di que recibes una comisión por referir.",
      `No cobres nada a la persona por referirla. El plan y su precio los explica el equipo de ${brand}, por escrito.`,
    ],
    disclosureLine: `Recibo una comisión si te refiero a ${brand}.`,
    referralConsent: `El socio confirma que la persona aceptó que el equipo de ${brand} la contacte por WhatsApp.`,
  },
  en: {
    signup: {
      eyebrow: "Partner program",
      title: `Refer your clients to ${brand}`,
      lead: "For real estate agents, loan officers and tax preparers. You introduce the person; our team explains the service on WhatsApp and, if they decide to start, prepares and mails their dispute letters for the items they themselves point out.",
      stepsTitle: "How it works",
      steps: [
        { title: "Apply for an account", body: "Fill in the form. A person on our team reviews your application and writes to you." },
        { title: "Share your link or send a referral", body: "With your personal link, or from your portal with the person's name and phone, if they agreed to be contacted." },
        { title: "Follow your referrals", body: "Your portal shows whether we contacted them, whether they signed and whether their service is active. Nothing from their credit file." },
      ],
      rulesTitle: "The partner rules",
      formTitle: "Application",
      name: "Your full name",
      company: "Company or agency",
      kind: "What you do",
      phone: "Your phone",
      email: "Your email",
      state: "State where you work",
      optional: "optional",
      accept: "I have read and accept the partner rules.",
      submit: "Send application",
      sending: "Sending…",
      doneTitle: "We received your application",
      doneBody: "A person on our team reviews it and writes to you. Once it is approved, you sign in to your portal with your phone or email.",
      demoNote: "Demo: the application is kept only in this browser.",
      problems: { required: "This is missing.", invalid: "Please check this." },
      error: "We could not send your application. Please try again in a moment.",
      disclosureTitle: "If you promote us",
      disclosure: "Say clearly that you receive a commission for referring. For example:",
      portalLink: "Already a partner? Sign in to your portal",
    },
    portal: {
      title: "Partner portal",
      hello: (name) => `Hello, ${name}`,
      linkTitle: "Your link",
      linkHelp: "Whoever comes in through your link is recorded as your referral for 60 days in that browser.",
      copy: "Copy link",
      copied: "Link copied",
      qrAlt: "QR code for your link",
      qrHelp: "To print on a card or show on your phone.",
      sendTitle: "Send a referral",
      sendHelp: "Our team writes to them on WhatsApp. Never send us their Social Security number, date of birth or credit report.",
      firstName: "First name",
      lastName: "Last name",
      phone: "Phone (WhatsApp)",
      consent: "This person agreed to be contacted by the team on WhatsApp.",
      submit: "Send referral",
      sending: "Sending…",
      sent: "Done. The team will write to them soon.",
      sentNote: "If this person was already in touch with us, they will not appear in your list.",
      referralsTitle: "Your referrals",
      referralsEmpty: "You have no referrals yet.",
      statusHelp: "You only see which step each person is at. Their credit information, letters and payments are private.",
      statusMeaning: {
        contacted: "The team is in touch.",
        signed: "Signed their service agreement.",
        active: "Their service is active.",
        not_continued: "Decided not to continue.",
      },
      commissionTitle: "Commissions",
      owed: "Recorded",
      paid: "Paid",
      balance: "To be paid",
      commissionHelp: "An administrator records them under your partner agreement. No commission depends on what happens on a report.",
      rulesTitle: "Remember",
      notApproved: "Your partner account is not approved yet. We will write to you as soon as it is.",
      signOut: "Sign out",
      demoNote: "Demo: the referrals are invented and nothing is sent.",
      error: "We could not send it. Check the details and try again.",
    },
    rules: [
      "Do not promise results: no points, no dates, no credit approvals. The bureaus decide and results vary.",
      "Do not ask for or keep Social Security numbers, dates of birth or credit reports. Each person gives their details in their own account.",
      "Refer only people who agreed to be contacted.",
      "Your commission never depends on what happens on a credit report.",
      "If you promote us, say that you receive a commission for referring.",
      `Do not charge the person anything for the referral. The ${brand} team explains the plan and its price, in writing.`,
    ],
    disclosureLine: `I receive a commission if I refer you to ${brand}.`,
    referralConsent: `The partner confirms the person agreed to be contacted by the ${brand} team on WhatsApp.`,
  },
};

/** Every string in the partner copy, for the claim-rule test. */
export function allPartnerStrings(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") out.push(String((value as (n: string) => string)("Laura")));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(PARTNER_COPY);
  return out;
}
