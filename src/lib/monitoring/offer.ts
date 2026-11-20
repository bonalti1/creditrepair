// The credit-monitoring offer customers are sent to. Decision (2026-11-19):
// IdentityIQ, through its partner/affiliate program. This is the one place the
// provider's name, plan and price live; every page reads from here.
//
// Two rules the pages follow:
//  - The provider is named only once we hold a signup link from them
//    (NEXT_PUBLIC_MONITORING_SIGNUP_URL). Having the link means the partner
//    agreement is in place, and that agreement is what permits using their name.
//    Until then the copy says "monitoreo de crédito" without a brand.
//  - Wherever we send someone to subscribe, we say that we are paid for it.
//
// Price: IdentityIQ's public list price for the plan with monthly 3-bureau
// reports and scores (Secure Max) was $31.49/month on 2026-11-19. A partner
// link can carry a different price or trial, so set NEXT_PUBLIC_MONITORING_PRICE
// to match the checkout page the link leads to before going live.

const signupUrl = process.env.NEXT_PUBLIC_MONITORING_SIGNUP_URL || null;

export const MONITORING_OFFER = {
  /** Internal key; matches MONITORING_PROVIDER for the report adapter. */
  key: "identityiq",
  /** Null until the partner link exists. */
  providerName: signupUrl ? "IdentityIQ" : null,
  planName: "Secure Max",
  /** Shown as "~$32/mes" / "~$32 al mes". */
  priceLabel: process.env.NEXT_PUBLIC_MONITORING_PRICE || "~$32",
  signupUrl,
} as const;

/** "tu suscripción de monitoreo de crédito" or "... con IdentityIQ" once the link exists. */
export function monitoringNameEs(): string {
  return MONITORING_OFFER.providerName
    ? `tu suscripción de monitoreo de crédito con ${MONITORING_OFFER.providerName}`
    : "tu suscripción de monitoreo de crédito";
}

/** The same phrase in the reader's language. */
export function monitoringName(locale: "es" | "en"): string {
  if (locale === "es") return monitoringNameEs();
  return MONITORING_OFFER.providerName
    ? `your credit monitoring subscription with ${MONITORING_OFFER.providerName}`
    : "your credit monitoring subscription";
}

/**
 * Required wherever the monitoring subscription is offered. Worded so it holds
 * whether or not a signup link is on screen (the demo has none).
 */
export const AFFILIATE_DISCLOSURE = {
  es: "Transparencia: CreditCapi recibe una comisión del servicio de monitoreo cuando contratas tu suscripción.",
  en: "Disclosure: CreditCapi earns a commission from the monitoring service when you subscribe.",
} as const;
