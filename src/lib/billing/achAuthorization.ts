import { sha256Hex } from "../agreement/sha256";
import { placeholder } from "../agreement/terms";
import { BRAND } from "../brand";
import { DUNNING_RETRY_DAYS } from "./dunning";
import { formatCents } from "./money";
import { mostYoullPay, paymentTermsLines } from "./plans";
import type { AuthorizationTerms } from "./authorization";
import { authorizationFee } from "./authorization";
import type { L } from "./types";

// The ACH debit authorization: what a client accepts to pay from a bank
// account instead of a card (lower processing fees). Nacha's rules for a
// consumer debit authorized online (a "WEB" entry) ask, as we understand
// them, for an authorization that is in writing or electronic, readily
// identifiable as an authorization, with clear and readily understandable
// terms: the amount (or how it is determined), when and how often, the
// account, and how to revoke it; and that the client can keep a copy.
//
// NOT REVIEWED BY AN ATTORNEY, and the Nacha points above are from memory
// (UNVERIFIED against the current Nacha Operating Rules). It is versioned
// and hashed like the card authorization: accepting it records the version,
// the language, a SHA-256 of exactly the text shown, the time, the IP and
// the browser (payment_methods, kind 'ach').

export const ACH_AUTHORIZATION_VERSION = "2026-11-22-draft.1";

export interface AchAuthorization {
  version: string;
  locale: L;
  reviewStatus: "attorney_pending";
  title: string;
  intro: string;
  points: Array<{ heading: string; text: string }>;
  consent: string;
}

export interface AchAccountShown {
  accountType: "checking" | "savings";
  last4: string;
}

/** The amounts, from the signed plan when there is one, else the signed fee. */
function amountText(terms: AuthorizationTerms, locale: L): string {
  if (terms.plan) {
    const lines = paymentTermsLines(terms.plan.terms, terms.plan.effective, locale).filter((l) => !/^(Most you'll pay|Lo máximo)/.test(l));
    return `${lines.join(" ")} ${mostYoullPay(terms.plan, locale)}.`;
  }
  const fee = authorizationFee(terms);
  if (locale === "es") return fee ? `La cuota de mi acuerdo firmado: ${fee} cada vez.` : "La cuota de servicio que dice mi acuerdo firmado, y nada más.";
  return fee ? `The fee in my signed agreement: ${fee} each time.` : "The service fee stated in my signed agreement, and nothing else.";
}

export function achAuthorization(locale: L, terms: AuthorizationTerms, account: AchAccountShown | null = null): AchAuthorization {
  const company = terms.companyLegalName ? `${terms.companyLegalName} (${BRAND.name})` : BRAND.name;
  const email = terms.companyEmail ?? placeholder("companyEmail", locale);
  const [first, second] = DUNNING_RETRY_DAYS;
  const max = terms.plan ? formatCents(terms.plan.effective.maxTotalCents) : null;
  if (locale === "es") {
    const acct = account ? `mi cuenta de ${account.accountType === "savings" ? "ahorros" : "cheques"} que termina en ${account.last4}` : "la cuenta bancaria que indico abajo";
    return {
      version: ACH_AUTHORIZATION_VERSION,
      locale,
      reviewStatus: "attorney_pending",
      title: "Autorización de débito bancario (ACH)",
      intro: `Autorizo a ${company} y a su procesador de pagos a debitar ${acct} mediante transferencias electrónicas (ACH), en las condiciones que siguen.`,
      points: [
        { heading: "Cuánto", text: amountText(terms, locale) },
        {
          heading: "Cuándo y cada cuánto",
          text: "Solo después de realizado el trabajo que paga cada débito, como dice mi acuerdo firmado. Nunca por adelantado y nunca más de una vez cada 30 días.",
        },
        ...(max ? [{ heading: "El total", text: `En total nunca se me debitará más de ${max}.` }] : []),
        {
          heading: "Si un débito no pasa",
          text: `Si mi banco devuelve un débito por falta de fondos, se intenta de nuevo a los ${first} y a los ${second} días y me avisan cada vez. No hay ningún cargo por un débito devuelto.`,
        },
        {
          heading: "Cómo la cancelo",
          text: `Puedo cancelar esta autorización cuando quiera y sin costo: quitando la cuenta en «Mis pagos» o escribiendo a ${email}. Se aplica en cuanto se recibe; un débito que ya se envió al banco antes de mi aviso puede tardar unos días en terminar.`,
        },
        { heading: "Mi copia", text: "Puedo leer, imprimir o pedir por correo esta autorización cuando quiera en «Mis pagos»." },
        { heading: "Mis datos bancarios", text: `${BRAND.name} no ve ni guarda mi número de cuenta ni el número de ruta: los recibe directamente el procesador de pagos.` },
      ],
      consent: "Autorizo los débitos a mi cuenta bancaria que describe esta autorización.",
    };
  }
  const acct = account ? `my ${account.accountType} account ending in ${account.last4}` : "the bank account I enter below";
  return {
    version: ACH_AUTHORIZATION_VERSION,
    locale,
    reviewStatus: "attorney_pending",
    title: "Bank debit (ACH) authorization",
    intro: `I authorize ${company} and its payment processor to debit ${acct} by electronic transfer (ACH), on the terms below.`,
    points: [
      { heading: "How much", text: amountText(terms, locale) },
      {
        heading: "When and how often",
        text: "Only after the work each debit pays for has been performed, as my signed agreement says. Never in advance and never more than once every 30 days.",
      },
      ...(max ? [{ heading: "The total", text: `In total I will never be debited more than ${max}.` }] : []),
      {
        heading: "If a debit does not go through",
        text: `If my bank returns a debit for lack of funds, it is tried again after ${first} and ${second} days and I am told each time. There is no fee for a returned debit.`,
      },
      {
        heading: "How I cancel it",
        text: `I can cancel this authorization at any time and at no cost: by removing the account under "My payments" or by writing to ${email}. It takes effect when it is received; a debit already sent to the bank before my notice may take a few days to finish.`,
      },
      { heading: "My copy", text: 'I can read, print or ask for a copy of this authorization by email at any time under "My payments".' },
      { heading: "My bank details", text: `${BRAND.name} never sees or stores my account or routing number: the payment processor receives them directly.` },
    ],
    consent: "I authorize the debits to my bank account that this authorization describes.",
  };
}

export function achAuthorizationText(a: AchAuthorization): string {
  return [`# ${a.title}`, a.intro, ...a.points.map((p) => `## ${p.heading}\n${p.text}`), a.consent].join("\n");
}

/** SHA-256 of exactly what is shown when accepted (without the account line, which the processor fills in after). */
export function achAuthorizationHash(version: string, locale: L, terms: AuthorizationTerms): string {
  return sha256Hex([`version: ${version}`, `locale: ${locale}`, achAuthorizationText(achAuthorization(locale, terms))].join("\n\n"));
}
