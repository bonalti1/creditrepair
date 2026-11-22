import { paymentFailedBody, paymentMethodNeededBody, unpaidCharge } from "../billing/dunning";
import { BRAND } from "../brand";
import { clientLanguage, type StaffLocale } from "./i18n/locale";
import { documentNames, missingDocuments, RESPONSE_WINDOW_DAYS, type ExceptionKind, type StaffException } from "./stage";
import type { StaffClient } from "./types";

// WhatsApp messages the console drafts for staff. The person reads the draft
// in WhatsApp and sends it themselves; nothing here is sent automatically.
//
// They go to the CLIENT, so they are written in the client's language
// (i18n/locale.ts: clientLanguage), whatever language the console is showing
// the teammate. A client with no language on record gets Spanish.
//
// These go to clients, so they follow the same claim rules as everything else
// the company says (src/lib/compliance/guardrails.ts; checked in the tests, in
// both languages): no promised results, points or dates, and never a hint
// about which items the client should mark.

/** Digits for a wa.me link: "+17135550142" → "17135550142". */
export function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
}

/** A chat with this client, optionally with a drafted first message. */
export function whatsappHref(phone: string, text?: string): string {
  const base = `https://wa.me/${whatsappNumber(phone)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

function greeting(client: StaffClient, language: StaffLocale): string {
  return language === "en" ? `Hi ${client.firstName}, this is the ${BRAND.name} team.` : `Hola ${client.firstName}, te escribe el equipo de ${BRAND.name}.`;
}

type Body = (client: StaffClient, exception: StaffException) => string;

const BODY_ES: Record<ExceptionKind, Body> = {
  review_stalled: () =>
    `Vimos que todavía te faltan puntos por revisar en tu reporte. ${BRAND.assistant} te explica cada uno en la app y tú decides sobre cada punto. ¿Tienes alguna duda con la que te pueda ayudar?`,
  documents_missing: (client) => {
    const missing = missingDocuments(client);
    const what = missing.length > 0 ? documentNames(missing, "es") : "identificación y comprobante de domicilio";
    return `Para preparar tus cartas nos falta tu ${what}. Puedes subir una foto desde la app. ¿Te ayudo con algo?`;
  },
  report_stale: () =>
    "Tu reporte de crédito no se ha actualizado y necesitamos uno reciente para continuar. ¿Puedes revisar que tu monitoreo de crédito siga activo?",
  // The same plain words the automatic notices use: what was charged for, what happens next, how to fix it.
  payment_past_due: (client) => {
    const charge = unpaidCharge(client.billing);
    return charge
      ? paymentFailedBody(charge).es
      : "Uno de tus cobros no pasó. Puedes actualizar tu método de pago en la app, en «Mis pagos». ¿Te ayudo con algo?";
  },
  payment_method_missing: (client, exception) => {
    const round = roundOf(client, exception);
    return round
      ? paymentMethodNeededBody({ roundNumber: round.number, workDate: round.mailedAt! }).es
      : "Todavía no tenemos tu método de pago. Puedes agregarlo en la app, en «Mis pagos»; toma un minuto. ¿Te ayudo con algo?";
  },
  letter_returned: () =>
    "El correo nos devolvió una de tus cartas. Estamos revisando la dirección del destinatario para enviarla de nuevo; te aviso en cuanto salga.",
  question_waiting: (client, exception) => {
    const question = client.questions.find((q) => `question:${q.id}` === exception.key);
    return question ? `Sobre tu pregunta («${question.text}»): ` : "Sobre tu pregunta: ";
  },
  response_overdue: () =>
    `Ya pasaron los ${RESPONSE_WINDOW_DAYS} días que tienen los burós para responder y no hemos podido importar tu reporte nuevo. ¿Puedes revisar que tu monitoreo de crédito siga activo?`,
  identity_theft_report_missing: () =>
    "Vimos que en tu revisión dijiste que algo en tu reporte es resultado de robo de identidad. Para seguir con ese paso hace falta tu reporte de robo de identidad de la FTC, que se llena sin costo en IdentityTheft.gov. ¿Ya lo tienes? Si no, te explico cómo hacerlo.",
  // No persuading and no conditions: the client asked to stop, the team confirms it.
  service_end_requested: () =>
    "Recibimos tu solicitud para terminar el servicio y ya no se envía ninguna carta más. Te escribo para confirmarlo contigo y resolver cualquier duda que tengas.",
  agreement_unsigned: () =>
    "Tu cuenta ya está creada. Para empezar solo falta que firmes el acuerdo de servicio. Si tienes preguntas sobre el acuerdo, con gusto te las respondo por aquí.",
  // The team's own task (an address to look up), but if the client has a letter from that company, its address helps.
  furnisher_address_missing: () =>
    "Estamos preparando tus cartas. ¿Tienes alguna carta o estado de cuenta reciente de la empresa a la que le escribimos? Si nos mandas una foto, nos ayuda a confirmar su dirección.",
  // AI intake: what the automatic check could not confirm, said plainly. The client re-uploads from the app.
  document_check_needs_person: () =>
    "Revisamos el documento que subiste y necesitamos confirmar algo contigo. ¿Nos puedes mandar una foto nueva, completa y bien iluminada? Si es tu comprobante de domicilio, que sea un recibo o estado de cuenta reciente con tu dirección.",
  bureau_letter_needs_person: () =>
    "Gracias por subir la carta del buró. La estamos revisando: piden algo más y te escribimos para ver juntos qué hace falta.",
  // The client's own address, which the post office could not confirm: they confirm or correct it in the app.
  client_address_unconfirmed: () =>
    "Antes de enviar tus cartas revisamos tu dirección con los datos del correo y no la pudimos confirmar. ¿Me ayudas a revisarla? En la app, en «Confirmar dirección», la confirmas o la corriges con un toque.",
};

const BODY_EN: Record<ExceptionKind, Body> = {
  review_stalled: () =>
    `We noticed you still have items left to review on your report. ${BRAND.assistant} explains each one in the app, and you decide on each item. Is there anything I can help you with?`,
  documents_missing: (client) => {
    const missing = missingDocuments(client);
    const what = missing.length > 0 ? documentNames(missing, "en") : "ID and proof of address";
    return `To prepare your letters we still need your ${what}. You can upload a photo from the app. Can I help with anything?`;
  },
  report_stale: () =>
    "Your credit report hasn't updated, and we need a recent one to keep going. Could you check that your credit monitoring is still active?",
  payment_past_due: (client) => {
    const charge = unpaidCharge(client.billing);
    return charge
      ? paymentFailedBody(charge).en
      : 'One of your charges didn\'t go through. You can update your payment method in the app, under "My payments". Can I help with anything?';
  },
  payment_method_missing: (client, exception) => {
    const round = roundOf(client, exception);
    return round
      ? paymentMethodNeededBody({ roundNumber: round.number, workDate: round.mailedAt! }).en
      : 'We don\'t have your payment method yet. You can add it in the app, under "My payments"; it takes a minute. Can I help with anything?';
  },
  letter_returned: () =>
    "The post office returned one of your letters. We're checking the recipient's address so we can send it again; I'll let you know as soon as it goes out.",
  question_waiting: (client, exception) => {
    const question = client.questions.find((q) => `question:${q.id}` === exception.key);
    return question ? `About your question (“${question.text}”): ` : "About your question: ";
  },
  response_overdue: () =>
    `The ${RESPONSE_WINDOW_DAYS} days the bureaus have to answer are up, and we haven't been able to import your new report. Could you check that your credit monitoring is still active?`,
  identity_theft_report_missing: () =>
    "We saw that in your review you said something on your report is the result of identity theft. To take that step we need your FTC identity theft report, which you can fill out at no cost at IdentityTheft.gov. Do you have it already? If not, I can walk you through it.",
  service_end_requested: () =>
    "We got your request to end the service, and no more letters will go out. I'm writing to confirm it with you and answer any questions you have.",
  agreement_unsigned: () =>
    "Your account is set up. To get started, all that's left is signing the service agreement. If you have questions about the agreement, I'm happy to answer them here.",
  furnisher_address_missing: () =>
    "We're preparing your letters. Do you have a recent letter or statement from the company we're writing to? If you send us a photo, it helps us confirm their address.",
  document_check_needs_person: () =>
    "We checked the document you uploaded and need to confirm something with you. Could you send a new photo, complete and well lit? If it's your proof of address, it should be a recent bill or statement with your address.",
  bureau_letter_needs_person: () =>
    "Thanks for uploading the bureau's letter. We're reviewing it: they're asking for something more, and we'll write to you so we can see together what's needed.",
  client_address_unconfirmed: () =>
    'Before mailing your letters we check your address against the post office\'s records, and we couldn\'t confirm it. Could you help me check it? In the app, under "Confirm address", you can confirm or correct it with one tap.',
};

function roundOf(client: StaffClient, exception: StaffException) {
  const number = Number(exception.key.split(":")[1]);
  return client.rounds.find((r) => r.number === number && r.mailedAt);
}

/** Every drafted body, for the tests that run them through the claim rules in both languages. */
export const MESSAGE_BODIES: Record<StaffLocale, Record<ExceptionKind, Body>> = { en: BODY_EN, es: BODY_ES };

/** The drafted message for one exception, in the client's language. */
export function exceptionMessage(client: StaffClient, exception: StaffException): string {
  const language = clientLanguage(client);
  return `${greeting(client, language)} ${MESSAGE_BODIES[language][exception.kind](client, exception)}`;
}

/** What staff may not say, shown wherever the console opens a chat with a client. In the console's language. */
export const STAFF_MESSAGE_RULE_TEXT: Record<StaffLocale, readonly string[]> = {
  en: ["Don't promise results, points or dates. Results vary.", "Don't tell the client which items to mark. Their answers are their own."],
  es: ["No prometas resultados, puntos ni fechas. Los resultados varían.", "No le digas al cliente qué puntos marcar. Sus respuestas son suyas."],
};

/** The Spanish rules, as they always read. */
export const STAFF_MESSAGE_RULES: readonly string[] = STAFF_MESSAGE_RULE_TEXT.es;
