import { paymentFailedBody, paymentMethodNeededBody, unpaidCharge } from "../billing/dunning";
import { BRAND } from "../brand";
import { documentNames, missingDocuments, RESPONSE_WINDOW_DAYS, type ExceptionKind, type StaffException } from "./stage";
import type { StaffClient } from "./types";

// WhatsApp messages the console drafts for staff. The person reads the draft
// in WhatsApp and sends it themselves; nothing here is sent automatically.
//
// These go to clients, so they follow the same claim rules as everything else
// the company says (src/lib/compliance/guardrails.ts; checked in the tests):
// no promised results, points or dates, and never a hint about which items
// the client should mark.

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

function greeting(client: StaffClient): string {
  return `Hola ${client.firstName}, te escribe el equipo de ${BRAND.name}.`;
}

const BODY: Record<ExceptionKind, (client: StaffClient, exception: StaffException) => string> = {
  review_stalled: () =>
    `Vimos que todavía te faltan puntos por revisar en tu reporte. ${BRAND.assistant} te explica cada uno en la app y tú decides sobre cada punto. ¿Tienes alguna duda con la que te pueda ayudar?`,
  documents_missing: (client) => {
    const missing = missingDocuments(client);
    const what = missing.length > 0 ? documentNames(missing) : "identificación y comprobante de domicilio";
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
    const number = Number(exception.key.split(":")[1]);
    const round = client.rounds.find((r) => r.number === number && r.mailedAt);
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

/** The drafted message for one exception. */
export function exceptionMessage(client: StaffClient, exception: StaffException): string {
  return `${greeting(client)} ${BODY[exception.kind](client, exception)}`;
}

/** What staff may not say, shown wherever the console opens a chat with a client. */
export const STAFF_MESSAGE_RULES: readonly string[] = [
  "No prometas resultados, puntos ni fechas. Los resultados varían.",
  "No le digas al cliente qué puntos marcar. Sus respuestas son suyas.",
];
