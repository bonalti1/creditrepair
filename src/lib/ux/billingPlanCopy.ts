// What "Mis pagos" says about the plan, statements, invoices and bank
// accounts (billing/plans.ts, migration 0026). English first, Spanish when
// needed. Kept apart so the tests run every line through the claim rules:
// plain, no promises, nothing about what the letters may achieve.

type L = "es" | "en";

export const PLAN_COPY = {
  en: {
    planTitle: "Your plan",
    mostLabel: "Most you'll pay",
    mostNote: "This is the most you can ever be charged under your signed agreement, whatever happens.",
    chargedSoFar: (charged: string, max: string) => `${charged} charged so far, of ${max}.`,
    onlyAfterWork: "With Credalti Complete, each charge is made only after the work it pays for is done.",
    onMailing: "Each month is charged right after that month's letters are mailed. A month with no letters mailed is not charged.",
    diyLead: "Credalti DIY is a monthly subscription for the software and Alti's guidance. It starts after your 3 business days to cancel. Letters we mail for you are charged after we mail them.",
    diyOnly: "The subscription is charged once each 30 days, from the end of your 3 business days to cancel. You can cancel anytime; no new month is charged after that.",
    diyMostNote: "This is the most the subscription can cost under your signed agreement. Letters we mail for you are separate, at the fee per letter shown before you confirm.",
    statementsTitle: "Statements",
    statementsEmpty: "No statements yet. The first comes with your first charge.",
    noWork: "No work this month, no charge",
    invoice: "Invoice",
    seeInvoice: "See invoice",
    hideInvoice: "Hide invoice",
    invoiceStatus: "Status",
    invoicePlan: "Plan",
    invoiceCredit: "Referral credit applied",
    invoiceTotal: "Total charged",
    status: { paid: "Paid", processing: "Processing", failed: "Did not go through", refunded: "Refunded", voided: "Voided", disputed: "Under review" },
    methodCard: "Card",
    methodBank: "Bank account (ACH)",
    methodBankWhy: "A bank account works like a card here: with Credalti Complete, charged only after the work, never in advance.",
    diyMethodBankWhy: "A bank account works like a card here: the subscription is charged once each 30 days, after your 3 business days to cancel.",
    diyMethodNoCharge: "Adding it charges nothing today. Credalti DIY is a simple monthly subscription, first charged after your 3 business days to cancel.",
    bankSecureTitle: "Your bank's secure fields",
    bankSecureBody: "Your account and routing numbers go straight to the payment processor. We never see or store them.",
    bankDemo: "Demo: choose a test account",
    bankDemoOk: "Test checking account that works",
    bankDemoReturns: "Test checking account the bank returns",
    bankLabel: (type: string, last4: string) => `${type === "savings" ? "Savings" : "Checking"} ···· ${last4}`,
    achAuthorizationTitle: "Bank debit authorization",
    bankStep: "2. Your bank account",
    perDelete:
      "If an item you disputed no longer appears on a later report, you pay the amount in your plan for it. If nothing changes, you pay nothing.",
  },
  es: {
    planTitle: "Tu plan",
    mostLabel: "Lo máximo que pagarás",
    mostNote: "Es lo máximo que se te puede cobrar con tu acuerdo firmado, pase lo que pase.",
    chargedSoFar: (charged: string, max: string) => `${charged} cobrado hasta ahora, de ${max}.`,
    onlyAfterWork: "Con Credalti Complete, cada cobro se hace solo después de hecho el trabajo que paga.",
    onMailing: "Cada mes se cobra justo después de enviar las cartas de ese mes. Un mes sin cartas enviadas no se cobra.",
    diyLead: "Credalti DIY es una suscripción mensual por el software y la guía de Alti. Empieza después de tus 3 días hábiles para cancelar. Las cartas que enviamos por ti se cobran después de enviarlas.",
    diyOnly: "La suscripción se cobra una vez cada 30 días, desde el fin de tus 3 días hábiles para cancelar. Puedes cancelar cuando quieras; después no se cobra ningún mes nuevo.",
    diyMostNote: "Es lo máximo que puede costar la suscripción con tu acuerdo firmado. Las cartas que enviamos por ti van aparte, con la cuota por carta que ves antes de confirmar.",
    statementsTitle: "Estados de cuenta",
    statementsEmpty: "Todavía no hay estados de cuenta. El primero llega con tu primer cobro.",
    noWork: "Sin trabajo este mes, sin cobro",
    invoice: "Factura",
    seeInvoice: "Ver factura",
    hideInvoice: "Ocultar factura",
    invoiceStatus: "Estado",
    invoicePlan: "Plan",
    invoiceCredit: "Crédito por referido aplicado",
    invoiceTotal: "Total cobrado",
    status: { paid: "Pagado", processing: "En proceso", failed: "No pasó", refunded: "Reembolsado", voided: "Anulado", disputed: "En revisión" },
    methodCard: "Tarjeta",
    methodBank: "Cuenta bancaria (ACH)",
    methodBankWhy: "Una cuenta bancaria funciona igual que una tarjeta aquí: con Credalti Complete, se cobra solo después del trabajo, nunca por adelantado.",
    diyMethodBankWhy: "Una cuenta bancaria funciona igual que una tarjeta aquí: la suscripción se cobra una vez cada 30 días, después de tus 3 días hábiles para cancelar.",
    diyMethodNoCharge: "Agregarlo hoy no cobra nada. Credalti DIY es una suscripción mensual sencilla; el primer cobro llega después de tus 3 días hábiles para cancelar.",
    bankSecureTitle: "Los campos seguros de tu banco",
    bankSecureBody: "Tu número de cuenta y de ruta van directo al procesador de pagos. Nosotros nunca los vemos ni los guardamos.",
    bankDemo: "Demo: elige una cuenta de prueba",
    bankDemoOk: "Cuenta de cheques de prueba que funciona",
    bankDemoReturns: "Cuenta de cheques de prueba que el banco devuelve",
    bankLabel: (type: string, last4: string) => `${type === "savings" ? "Ahorros" : "Cheques"} ···· ${last4}`,
    achAuthorizationTitle: "Autorización de débito bancario",
    bankStep: "2. Tu cuenta bancaria",
    perDelete:
      "Si un punto que disputaste ya no aparece en un reporte posterior, pagas por ese punto el monto de tu plan. Si nada cambia, no pagas nada.",
  },
} as const;

export type PlanCopy = (typeof PLAN_COPY)[L];

/** Every sentence above, for the claim-rule tests. */
export function planCopyStrings(locale: L): string[] {
  const c = PLAN_COPY[locale];
  return Object.values(c).flatMap((v) =>
    typeof v === "string" ? [v] : typeof v === "function" ? [(v as (a: string, b: string) => string)("$89.00", "$534.00")] : Object.values(v as Record<string, string>),
  );
}
