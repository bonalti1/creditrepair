import { BRAND } from "../brand";
import { DUNNING_RETRY_DAYS } from "../billing/dunning";
import { MIN_DAYS_BETWEEN_CHARGES } from "../billing/rules";

// Everything the "Mis pagos" screen says, in one place, so the tests can run
// every line through the claim rules.
//
// The rules for this copy:
//  - each charge pays for work already done, and the screen says so;
//  - nothing about what the letters may achieve: no results, no scores;
//  - no price unless the plan fee is configured (the page prints the amount
//    from the client's signed agreement, never a number written here);
//  - the monitoring subscription is separate, and paid to its provider;
//  - a failed payment is told calmly: no fee, no threat, how to fix it.

type L = "es" | "en";

export const BILLING_COPY = {
  es: {
    navTitle: "Mis pagos",
    navDesc: "Lo que se ha cobrado y por qué trabajo, tus recibos y tu método de pago.",
    title: "Mis pagos",
    lead: "Cada cobro paga trabajo que ya se hizo: una ronda de cartas que tu equipo ya envió por correo. Nunca se cobra por adelantado.",
    demoBanner: "Demo: aquí los pagos son simulados. No se mueve dinero y no se pide ninguna tarjeta real.",
    draftBanner: "Borrador: la autorización de pagos está pendiente de revisión legal.",
    exampleBanner: "Situación de ejemplo: estas rondas, fechas y cobros son inventados para mostrar la pantalla.",
    nextTitle: "Qué sigue",
    feeLine: (amount: string) =>
      `Tu cuota es de ${amount} por cada ronda de cartas enviada, y nunca más de un cobro cada ${MIN_DAYS_BETWEEN_CHARGES} días. No hay cuota de inscripción ni cargos por pago tardío.`,
    feeUnknown: `Se cobra la cuota de tu acuerdo firmado por cada ronda de cartas enviada, y nunca más de un cobro cada ${MIN_DAYS_BETWEEN_CHARGES} días. No hay cuota de inscripción ni cargos por pago tardío.`,
    whenLine: "El cobro se hace después de que tu equipo envíe tu siguiente ronda, nunca antes.",
    failedTitle: "Un cobro no pasó",
    failedFix: "Actualizar mi método de pago",
    failedCalm: "No hay cargos extra por esto.",
    chargesTitle: "Lo que se ha cobrado",
    chargesEmpty: "Todavía no hay cobros. El primero llega después de que tu equipo envíe tu primera ronda de cartas.",
    status: { paid: "Pagado", refunded: "Reembolsado", processing: "En proceso", retrying: "No pasó", exhausted: "No pasó" },
    paidOn: (date: string) => `Cobrado el ${date}`,
    refundedOn: (date: string) => `Devuelto completo el ${date}`,
    retryOn: (date: string) => `Lo intentamos de nuevo el ${date}`,
    noMoreRetries: "Ya no lo intentamos por nuestra cuenta",
    feeOfAgreement: "La cuota de tu acuerdo",
    seeReceipt: "Ver recibo",
    hideReceipt: "Ocultar recibo",
    receipt: "Recibo",
    receiptDate: "Fecha",
    receiptAmount: "Monto",
    receiptWork: "Trabajo que pagó",
    receiptMethod: "Método de pago",
    receiptFrom: "Cobrado por",
    print: "Imprimir",
    methodTitle: "Método de pago",
    methodNone: "No tienes un método de pago guardado.",
    methodSince: (date: string) => `Guardado el ${date}`,
    methodAdd: "Agregar método de pago",
    methodReplace: "Cambiar método de pago",
    methodRemove: "Quitar",
    methodRemoveConfirm: "¿Quitar tu método de pago? Retiras tu autorización y no se hace ningún cobro automático. Puedes agregar otro cuando quieras.",
    methodRemoveYes: "Sí, quitarlo",
    methodRemoveNo: "No, dejarlo",
    methodNeedsAgreement: "Primero va tu acuerdo de servicio. Cuando lo firmes puedes agregar tu método de pago aquí.",
    methodGoAgreement: "Ir a mi acuerdo",
    methodNotAvailable: "Todavía no se puede agregar un método de pago: estamos terminando de configurar los pagos. Mientras tanto no se te cobra nada.",
    methodNoCharge: "Agregarlo no cobra nada. Solo se cobra después de que tu equipo envía una ronda de tus cartas.",
    formTitle: "Agregar un método de pago",
    formStepAuthorization: "1. Lee y acepta la autorización",
    formStepCard: "2. Tu tarjeta",
    secureFieldsTitle: "Campos seguros del procesador de pagos",
    secureFieldsBody: `En la app real, aquí escribes tu tarjeta en los campos del procesador de pagos. Tu número va directo al procesador: ${BRAND.name} nunca lo ve ni lo guarda. Solo guardamos la marca y los últimos 4 dígitos.`,
    secureFieldsDemo: "Demo: no escribas una tarjeta real. Elige una tarjeta de prueba.",
    demoCardOk: "Tarjeta de prueba que sí pasa",
    demoCardDeclined: "Tarjeta de prueba que no pasa",
    demoCardBrand: (brand: string) => `${brand} de prueba`,
    acceptedCards: (line: string) => `Aceptamos ${line}.`,
    formSave: "Guardar método de pago",
    formCancel: "Cancelar",
    formSaved: "Tu método de pago quedó guardado.",
    formSettled: "Tu método de pago quedó guardado y el cobro pendiente ya pasó. Tu caso sigue solo.",
    formStillDeclined: "Tu método de pago quedó guardado, pero el cobro pendiente no pasó con él. Puedes probar con otro.",
    errors: {
      generic: "No se pudo guardar. No cambió nada y no se cobró nada; inténtalo de nuevo en un momento.",
      refused: "El procesador no aceptó ese método de pago. No se guardó ni se cobró nada.",
      brand: "No aceptamos esa marca de tarjeta. No se guardó ni se cobró nada. Por favor usa otra tarjeta.",
      changed: "El texto de la autorización se actualizó mientras lo leías. Vuelve a cargar la página. No se guardó nada.",
      agreement: "Primero hay que firmar tu acuerdo de servicio.",
      unavailable: "Todavía no se pueden agregar métodos de pago. No se te cobra nada.",
    },
    authorizationTitle: "Tu autorización de pagos",
    authorizationOpen: "Leer la autorización completa",
    authorizationAccepted: (date: string) => `La aceptaste el ${date}.`,
    authorizationVersion: "Versión",
    monitoringTitle: "Tu monitoreo de crédito es aparte",
    monitoringBody: `Tu suscripción de monitoreo de crédito no aparece aquí: se la pagas directamente al servicio de monitoreo, no a ${BRAND.name}.`,
    retryPolicy: `Si un cobro no pasa, lo intentamos de nuevo a los ${DUNNING_RETRY_DAYS[0]} y a los ${DUNNING_RETRY_DAYS[1]} días y te avisamos cada vez. No hay cargos por un pago que no pasó.`,
    endTitle: "Cancelar o terminar el servicio",
    endBody: "Puedes hacerlo cuando quieras, desde tu acuerdo.",
    endLink: "Ir a mi acuerdo",
    helpLink: "¿Dudas sobre un cobro? Habla con una persona",
    scenarioTitle: "Demo: ver otra situación",
    scenarioBody: "Estas situaciones son ejemplos inventados. Tu pantalla real muestra solo lo que pasó en tu cuenta.",
  },
  en: {
    navTitle: "My payments",
    navDesc: "What was charged and for which work, your receipts and your payment method.",
    title: "My payments",
    lead: "Each charge pays for work that is already done: a round of letters your team has already mailed. Nothing is ever charged in advance.",
    demoBanner: "Demo: payments here are simulated. No money moves and no real card is asked for.",
    draftBanner: "Draft: the payment authorization is pending legal review.",
    exampleBanner: "Example situation: these rounds, dates and charges are invented to show the screen.",
    nextTitle: "What happens next",
    feeLine: (amount: string) =>
      `Your fee is ${amount} for each round of letters mailed, and never more than one charge every ${MIN_DAYS_BETWEEN_CHARGES} days. There is no enrollment fee and no late fee.`,
    feeUnknown: `The fee in your signed agreement is charged for each round of letters mailed, and never more than one charge every ${MIN_DAYS_BETWEEN_CHARGES} days. There is no enrollment fee and no late fee.`,
    whenLine: "The charge is made after your team mails your next round, never before.",
    failedTitle: "A charge did not go through",
    failedFix: "Update my payment method",
    failedCalm: "There is no extra charge for this.",
    chargesTitle: "What has been charged",
    chargesEmpty: "No charges yet. The first one comes after your team mails your first round of letters.",
    status: { paid: "Paid", refunded: "Refunded", processing: "Processing", retrying: "Did not go through", exhausted: "Did not go through" },
    paidOn: (date: string) => `Charged on ${date}`,
    refundedOn: (date: string) => `Returned in full on ${date}`,
    retryOn: (date: string) => `We will try again on ${date}`,
    noMoreRetries: "We are no longer trying on our own",
    feeOfAgreement: "The fee in your agreement",
    seeReceipt: "See receipt",
    hideReceipt: "Hide receipt",
    receipt: "Receipt",
    receiptDate: "Date",
    receiptAmount: "Amount",
    receiptWork: "Work it paid for",
    receiptMethod: "Payment method",
    receiptFrom: "Charged by",
    print: "Print",
    methodTitle: "Payment method",
    methodNone: "You have no payment method on file.",
    methodSince: (date: string) => `Saved on ${date}`,
    methodAdd: "Add a payment method",
    methodReplace: "Change payment method",
    methodRemove: "Remove",
    methodRemoveConfirm: "Remove your payment method? You withdraw your authorization and no automatic charge is made. You can add another one whenever you want.",
    methodRemoveYes: "Yes, remove it",
    methodRemoveNo: "No, keep it",
    methodNeedsAgreement: "Your service agreement comes first. Once you sign it you can add your payment method here.",
    methodGoAgreement: "Go to my agreement",
    methodNotAvailable: "A payment method cannot be added yet: we are finishing the payment setup. Nothing is charged in the meantime.",
    methodNoCharge: "Adding it charges nothing. A charge is made only after your team mails a round of your letters.",
    formTitle: "Add a payment method",
    formStepAuthorization: "1. Read and accept the authorization",
    formStepCard: "2. Your card",
    secureFieldsTitle: "The payment processor's secure fields",
    secureFieldsBody: `In the real app, this is where you type your card into the payment processor's fields. Your number goes straight to the processor: ${BRAND.name} never sees or stores it. We keep only the brand and the last 4 digits.`,
    secureFieldsDemo: "Demo: do not type a real card. Pick a test card.",
    demoCardOk: "Test card that goes through",
    demoCardDeclined: "Test card that is declined",
    demoCardBrand: (brand: string) => `Test ${brand}`,
    acceptedCards: (line: string) => `We take ${line}.`,
    formSave: "Save payment method",
    formCancel: "Cancel",
    formSaved: "Your payment method was saved.",
    formSettled: "Your payment method was saved and the pending charge went through. Your case continues by itself.",
    formStillDeclined: "Your payment method was saved, but the pending charge did not go through with it. You can try another one.",
    errors: {
      generic: "It could not be saved. Nothing changed and nothing was charged; please try again in a moment.",
      refused: "The processor did not accept that payment method. Nothing was saved or charged.",
      brand: "We don't take that card brand. Nothing was saved or charged. Please use another card.",
      changed: "The authorization text was updated while you were reading. Reload the page. Nothing was saved.",
      agreement: "Your service agreement has to be signed first.",
      unavailable: "Payment methods cannot be added yet. Nothing is charged.",
    },
    authorizationTitle: "Your payment authorization",
    authorizationOpen: "Read the full authorization",
    authorizationAccepted: (date: string) => `You accepted it on ${date}.`,
    authorizationVersion: "Version",
    monitoringTitle: "Your credit monitoring is separate",
    monitoringBody: `Your credit monitoring subscription does not appear here: you pay it directly to the monitoring service, not to ${BRAND.name}.`,
    retryPolicy: `If a charge does not go through, we try again after ${DUNNING_RETRY_DAYS[0]} and ${DUNNING_RETRY_DAYS[1]} days and tell you each time. There is no charge for a payment that did not go through.`,
    endTitle: "Cancel or end the service",
    endBody: "You can do it whenever you want, from your agreement.",
    endLink: "Go to my agreement",
    helpLink: "Questions about a charge? Talk to a person",
    scenarioTitle: "Demo: see another situation",
    scenarioBody: "These situations are invented examples. Your real screen shows only what happened on your account.",
  },
} as const;

export type BillingCopy = (typeof BILLING_COPY)[L];

/** Every plain string of the copy, for the tests (functions are called with a sample value). */
export function billingCopyStrings(locale: L): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") out.push(String((value as (sample: string) => string)(locale === "es" ? "4 de noviembre" : "November 4")));
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(BILLING_COPY[locale]);
  return out;
}
