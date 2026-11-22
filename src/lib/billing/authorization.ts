import { sha256Hex } from "../agreement/sha256";
import { placeholder, type ResolvedTerms } from "../agreement/terms";
import { BRAND } from "../brand";
import { DUNNING_RETRY_DAYS } from "./dunning";
import { feeToCents, formatCents, MIN_DAYS_BETWEEN_CHARGES } from "./rules";
import { mostYoullPay, paymentTermsLines, type PlanSnapshot } from "./plans";
import type { L } from "./types";

/** Under a plan: what the plan charges, in the plan's own generated words, and the most-you'll-pay total. */
function planCharged(terms: AuthorizationTerms, locale: L): string | null {
  if (!terms.plan) return null;
  const lines = paymentTermsLines(terms.plan.terms, terms.plan.effective, locale).filter((l) => !/^(Most you'll pay|Lo máximo)/.test(l));
  const none =
    locale === "es"
      ? "No hay cuota de inscripción, cargos por pago tardío, cargos por cancelar ni cargos por el envío de las cartas."
      : "There is no enrollment fee, no late fee, no charge for cancelling and no charge for mailing the letters.";
  return `${lines.join(" ")} ${mostYoullPay(terms.plan, locale)}. ${none}`;
}

// The recurring-payment authorization: the short text a client accepts when
// they put a payment method on file. It says what will be charged, when (only
// after each round is mailed), how to stop it and how to get a copy.
//
// NOT REVIEWED BY AN ATTORNEY. It is a draft, marked "attorney_pending" like
// the agreement documents, and versioned and hashed the same way: accepting it
// records the version, the language and a SHA-256 of exactly the text shown.
// Any change to a word needs a new PAYMENT_AUTHORIZATION_VERSION. What the
// attorney is asked about it is in docs/BILLING.md (question 4).

export const PAYMENT_AUTHORIZATION_VERSION = "2026-11-21-draft.1";

/**
 * The business facts the text is filled in with. From the client's SIGNED
 * agreement when there is one; `plan` is its plan snapshot (migration 0026),
 * absent for an agreement signed before plans existed.
 */
export type AuthorizationTerms = Pick<ResolvedTerms, "companyLegalName" | "companyEmail" | "monthlyFee"> & { plan?: PlanSnapshot | null };

export interface PaymentAuthorization {
  version: string;
  locale: L;
  /** Always "attorney_pending" until an attorney has approved this version. */
  reviewStatus: "attorney_pending";
  title: string;
  /** One short lead-in, then the points, each a heading and a sentence or two. */
  intro: string;
  points: Array<{ heading: string; text: string }>;
  /** What the client ticks. */
  consent: string;
}

/** "$89.00", or null when the agreement carries no fee yet (then no price is printed). */
export function authorizationFee(terms: AuthorizationTerms): string | null {
  const cents = feeToCents(terms.monthlyFee);
  return cents === null ? null : formatCents(cents);
}

export function paymentAuthorization(locale: L, terms: AuthorizationTerms): PaymentAuthorization {
  const company = terms.companyLegalName ? `${terms.companyLegalName} («${BRAND.name}»)` : BRAND.name;
  const companyEn = terms.companyLegalName ? `${terms.companyLegalName} ("${BRAND.name}")` : BRAND.name;
  const email = terms.companyEmail ?? placeholder("companyEmail", locale);
  const fee = authorizationFee(terms);
  const [firstRetry, secondRetry] = DUNNING_RETRY_DAYS;

  if (locale === "es") {
    return {
      version: PAYMENT_AUTHORIZATION_VERSION,
      locale,
      reviewStatus: "attorney_pending",
      title: "Autorización de pagos recurrentes",
      intro: `Autorizo a ${company} a cobrar a mi método de pago la cuota de servicio de mi acuerdo firmado, en las condiciones que siguen.`,
      points: [
        {
          heading: "Qué se cobra",
          text: planCharged(terms, locale) ?? (fee
            ? `La cuota de mi acuerdo firmado: ${fee} cada vez. No hay cuota de inscripción, cargos por pago tardío, cargos por cancelar ni cargos por el envío de las cartas.`
            : "La cuota de servicio que dice mi acuerdo firmado, y nada más. No hay cuota de inscripción, cargos por pago tardío, cargos por cancelar ni cargos por el envío de las cartas."),
        },
        {
          heading: "Cuándo se cobra",
          text: terms.plan
            ? `Solo después de realizado el trabajo que paga cada cobro, como dice arriba. Nunca por adelantado, nunca dos veces por el mismo trabajo y nunca más de una vez cada ${MIN_DAYS_BETWEEN_CHARGES} días.`
            : `Solo después de que mi equipo envió por correo una ronda de mis cartas. Cada cobro paga ese trabajo, que ya se hizo. Nunca se cobra por adelantado, nunca más de un cobro por ronda y nunca más de una vez cada ${MIN_DAYS_BETWEEN_CHARGES} días. El cobro se hace a partir del día siguiente al envío.`,
        },
        {
          heading: "Mi recibo",
          text: "Cada cobro deja un recibo en la aplicación, en «Mis pagos», con la fecha, el monto y la ronda de cartas que pagó.",
        },
        {
          heading: "Si un cobro no pasa",
          text: `${BRAND.name} lo intenta de nuevo a los ${firstRetry} y a los ${secondRetry} días y me avisa cada vez. No hay ningún cargo por un pago que no pasó. Si después de eso sigue sin pasar, mi caso queda en pausa hasta que yo actualice mi método de pago.`,
        },
        {
          heading: "Cómo la detengo",
          text: `Puedo retirar esta autorización en cualquier momento y sin costo: quitando mi método de pago en «Mis pagos» o escribiendo a ${email}. También puedo terminar el servicio en «Mi acuerdo». Desde ese momento no se hace ningún cobro automático.`,
        },
        {
          heading: "Si creo que un cobro es un error",
          text: `Aviso a ${email} o a mi equipo. Un cobro hecho por error se devuelve completo dentro de los 10 días siguientes a mi aviso.`,
        },
        {
          heading: "Mi copia",
          text: "Puedo leer e imprimir esta autorización cuando quiera en «Mis pagos», y pedir que me la envíen por correo electrónico.",
        },
        {
          heading: "Lo que no cubre",
          text: "Mi suscripción de monitoreo de crédito es aparte: la pago directamente al servicio de monitoreo, no con esta autorización.",
        },
      ],
      consent: "Leí esta autorización y acepto los cobros recurrentes que describe.",
    };
  }

  return {
    version: PAYMENT_AUTHORIZATION_VERSION,
    locale,
    reviewStatus: "attorney_pending",
    title: "Recurring payment authorization",
    intro: `I authorize ${companyEn} to charge my payment method the service fee in my signed agreement, on the terms below.`,
    points: [
      {
        heading: "What is charged",
        text: planCharged(terms, locale) ?? (fee
          ? `The fee in my signed agreement: ${fee} each time. There is no enrollment fee, no late fee, no charge for cancelling and no charge for mailing the letters.`
          : "The service fee stated in my signed agreement, and nothing else. There is no enrollment fee, no late fee, no charge for cancelling and no charge for mailing the letters."),
      },
      {
        heading: "When it is charged",
        text: terms.plan
          ? `Only after the work each charge pays for has been performed, as described above. Never in advance, never twice for the same work, and never more than once every ${MIN_DAYS_BETWEEN_CHARGES} days.`
          : `Only after my team has mailed a round of my letters. Each charge pays for that work, which is already done. Never in advance, never more than one charge per round, and never more than once every ${MIN_DAYS_BETWEEN_CHARGES} days. The charge is made from the day after the mailing.`,
      },
      {
        heading: "My receipt",
        text: 'Every charge leaves a receipt in the app, under "My payments", with the date, the amount and the round of letters it paid for.',
      },
      {
        heading: "If a charge does not go through",
        text: `${BRAND.name} tries again after ${firstRetry} and ${secondRetry} days and tells me each time. There is no charge for a payment that did not go through. If it still does not go through after that, my case is paused until I update my payment method.`,
      },
      {
        heading: "How I stop it",
        text: `I can withdraw this authorization at any time and at no cost: by removing my payment method under "My payments" or by writing to ${email}. I can also end the service under "My agreement". From that moment no automatic charge is made.`,
      },
      {
        heading: "If I believe a charge is a mistake",
        text: `I tell ${email} or my team. A charge made by mistake is returned in full within 10 days of my telling them.`,
      },
      {
        heading: "My copy",
        text: 'I can read and print this authorization whenever I want under "My payments", and ask for it to be emailed to me.',
      },
      {
        heading: "What it does not cover",
        text: "My credit monitoring subscription is separate: I pay it directly to the monitoring service, not under this authorization.",
      },
    ],
    consent: "I have read this authorization and I accept the recurring charges it describes.",
  };
}

/** The authorization as plain text: exactly what is hashed, and what a copy prints. */
export function paymentAuthorizationText(authorization: PaymentAuthorization): string {
  return [
    `# ${authorization.title}`,
    authorization.intro,
    ...authorization.points.map((point) => `## ${point.heading}\n${point.text}`),
    authorization.consent,
  ].join("\n");
}

/**
 * SHA-256 of exactly what the client is shown when they accept: this version,
 * in this language, with these terms filled in. Stored with the payment
 * method, like the agreement's document hash.
 */
export function paymentAuthorizationHash(version: string, locale: L, terms: AuthorizationTerms): string {
  return sha256Hex(
    [`version: ${version}`, `locale: ${locale}`, paymentAuthorizationText(paymentAuthorization(locale, terms))].join("\n\n"),
  );
}
