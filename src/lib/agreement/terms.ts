import { MONITORING_OFFER } from "../monitoring/offer";

// The business facts the documents are filled in with: who the company is,
// what the service costs, and the Texas registration and bond. None of them is
// decided in code. The owner sets them in the hosting settings; until every
// required one is set, the documents show a visible placeholder in its place
// and the agreement is "not ready to sign" (see readiness.ts).
//
// They are NEXT_PUBLIC_ variables because the client's own screen shows them
// (they are printed in a contract the client signs, so none of them is a
// secret). Each one is read by its full name so Next.js can put its value into
// the browser bundle.

/** What the documents are filled in with. Null means "not set yet". */
export interface ResolvedTerms {
  /** The company's legal name, as registered. */
  companyLegalName: string | null;
  /** Principal business address, one line. */
  companyAddress: string | null;
  /** Where a client writes to cancel, ask for a paper copy or withdraw consent. */
  companyEmail: string | null;
  /** Optional. Shown when set. */
  companyPhone: string | null;
  /** Monthly fee in U.S. dollars, for example "89.00". */
  monthlyFee: string | null;
  /** How many months the service is estimated to last. Whole number. */
  estimatedMonths: number | null;
  /** monthlyFee × estimatedMonths, for example "534.00". Null until both are set. */
  estimatedTotal: string | null;
  /** Texas credit services organization registration number (Secretary of State). */
  texasRegistrationNumber: string | null;
  /** The surety company that issued the $10,000 bond. */
  bondSuretyName: string | null;
  bondSuretyAddress: string | null;
  /** The agent in Texas authorized to receive service of process. */
  texasAgentName: string | null;
  texasAgentAddress: string | null;
  /** What the client pays the monitoring provider, not us. From the monitoring offer. */
  monitoringPriceLabel: string;
  monitoringProviderName: string | null;
}

/** The environment variable behind each term the owner must fill. */
export const TERM_ENV = {
  companyLegalName: "NEXT_PUBLIC_COMPANY_LEGAL_NAME",
  companyAddress: "NEXT_PUBLIC_COMPANY_ADDRESS",
  companyEmail: "NEXT_PUBLIC_COMPANY_EMAIL",
  companyPhone: "NEXT_PUBLIC_COMPANY_PHONE",
  monthlyFee: "NEXT_PUBLIC_PLAN_MONTHLY_FEE",
  estimatedMonths: "NEXT_PUBLIC_PLAN_ESTIMATED_MONTHS",
  texasRegistrationNumber: "NEXT_PUBLIC_TX_CSO_REGISTRATION_NUMBER",
  bondSuretyName: "NEXT_PUBLIC_TX_BOND_SURETY_NAME",
  bondSuretyAddress: "NEXT_PUBLIC_TX_BOND_SURETY_ADDRESS",
  texasAgentName: "NEXT_PUBLIC_TX_AGENT_NAME",
  texasAgentAddress: "NEXT_PUBLIC_TX_AGENT_ADDRESS",
} as const;

export type TermKey = keyof typeof TERM_ENV;

/** Every term that must be set before a real client can sign. The phone is optional. */
export const REQUIRED_TERMS: readonly TermKey[] = [
  "companyLegalName",
  "companyAddress",
  "companyEmail",
  "monthlyFee",
  "estimatedMonths",
  "texasRegistrationNumber",
  "bondSuretyName",
  "bondSuretyAddress",
  "texasAgentName",
  "texasAgentAddress",
];

/** What each term is, for the placeholder shown in its place and for the owner's checklist. */
export const TERM_LABEL: Record<TermKey, { es: string; en: string }> = {
  companyLegalName: { es: "nombre legal de la empresa", en: "company legal name" },
  companyAddress: { es: "domicilio principal de la empresa", en: "company principal business address" },
  companyEmail: { es: "correo electrónico de la empresa", en: "company email address" },
  companyPhone: { es: "teléfono de la empresa", en: "company phone number" },
  monthlyFee: { es: "cuota mensual", en: "monthly fee" },
  estimatedMonths: { es: "duración estimada en meses", en: "estimated length in months" },
  texasRegistrationNumber: { es: "número de registro en Texas", en: "Texas registration number" },
  bondSuretyName: { es: "nombre de la afianzadora", en: "surety company name" },
  bondSuretyAddress: { es: "domicilio de la afianzadora", en: "surety company address" },
  texasAgentName: { es: "nombre del agente registrado en Texas", en: "name of the registered agent in Texas" },
  texasAgentAddress: { es: "domicilio del agente registrado en Texas", en: "address of the registered agent in Texas" },
};

export type TermsSource = Partial<Record<TermKey, string | undefined>>;

// Static reads: Next.js replaces each of these with its value at build time.
const ENV_SOURCE: TermsSource = {
  companyLegalName: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME,
  companyAddress: process.env.NEXT_PUBLIC_COMPANY_ADDRESS,
  companyEmail: process.env.NEXT_PUBLIC_COMPANY_EMAIL,
  companyPhone: process.env.NEXT_PUBLIC_COMPANY_PHONE,
  monthlyFee: process.env.NEXT_PUBLIC_PLAN_MONTHLY_FEE,
  estimatedMonths: process.env.NEXT_PUBLIC_PLAN_ESTIMATED_MONTHS,
  texasRegistrationNumber: process.env.NEXT_PUBLIC_TX_CSO_REGISTRATION_NUMBER,
  bondSuretyName: process.env.NEXT_PUBLIC_TX_BOND_SURETY_NAME,
  bondSuretyAddress: process.env.NEXT_PUBLIC_TX_BOND_SURETY_ADDRESS,
  texasAgentName: process.env.NEXT_PUBLIC_TX_AGENT_NAME,
  texasAgentAddress: process.env.NEXT_PUBLIC_TX_AGENT_ADDRESS,
};

function text(value: string | undefined): string | null {
  const clean = value?.replace(/\s+/g, " ").trim();
  return clean ? clean : null;
}

/** "89", "$89", "89.5" → "89.00" / "89.50". Anything that is not a positive amount is "not set". */
function money(value: string | undefined): string | null {
  const clean = text(value)?.replace(/^\$/, "").replace(/,/g, "");
  if (!clean || !/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const amount = Number(clean);
  return amount > 0 ? amount.toFixed(2) : null;
}

function wholeMonths(value: string | undefined): number | null {
  const clean = text(value);
  if (!clean || !/^\d{1,2}$/.test(clean)) return null;
  const months = Number(clean);
  return months >= 1 ? months : null;
}

/** The terms as they stand: from the hosting settings, or from `source` in tests. */
export function resolveTerms(source: TermsSource = ENV_SOURCE): ResolvedTerms {
  const monthlyFee = money(source.monthlyFee);
  const estimatedMonths = wholeMonths(source.estimatedMonths);
  return {
    companyLegalName: text(source.companyLegalName),
    companyAddress: text(source.companyAddress),
    companyEmail: text(source.companyEmail),
    companyPhone: text(source.companyPhone),
    monthlyFee,
    estimatedMonths,
    estimatedTotal: monthlyFee && estimatedMonths ? (Number(monthlyFee) * estimatedMonths).toFixed(2) : null,
    texasRegistrationNumber: text(source.texasRegistrationNumber),
    bondSuretyName: text(source.bondSuretyName),
    bondSuretyAddress: text(source.bondSuretyAddress),
    texasAgentName: text(source.texasAgentName),
    texasAgentAddress: text(source.texasAgentAddress),
    monitoringPriceLabel: MONITORING_OFFER.priceLabel,
    monitoringProviderName: MONITORING_OFFER.providerName,
  };
}

/** Required terms that are not set, in the order of REQUIRED_TERMS. */
export function missingTerms(terms: ResolvedTerms): TermKey[] {
  return REQUIRED_TERMS.filter((key) => terms[key] === null);
}

export function termsComplete(terms: ResolvedTerms): boolean {
  return missingTerms(terms).length === 0;
}

/** The visible stand-in for a term that is not set: "[PENDIENTE: cuota mensual]". */
export function placeholder(key: TermKey, locale: "es" | "en"): string {
  return locale === "es" ? `[PENDIENTE: ${TERM_LABEL[key].es}]` : `[PENDING: ${TERM_LABEL[key].en}]`;
}

/** Finds placeholders in rendered text, so a screen can highlight them. */
export const PLACEHOLDER_PATTERN = /\[(?:PENDIENTE|PENDING): [^\]]+\]/g;
