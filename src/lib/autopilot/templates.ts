import { BRAND } from "../brand";
import type { FollowupKind, MessageLocale, StatusKind } from "./types";

// Every automatic message, written once, as a WhatsApp message template.
//
// WhatsApp only lets a business START a conversation (or write after 24 hours
// without a message from the client) with a template Meta approved in
// advance. Inside the 24-hour window the same words may go as plain text.
// So each message here is a template: a fixed text with numbered parameters
// ({{1}}, {{2}}…), in Spanish and English. The plain-text version is the same
// template with the parameters filled in, so the client reads the same words
// either way.
//
// Before going live, EACH template must be created and approved in Meta
// (WhatsApp Manager → Message templates), with exactly this name, category
// UTILITY, language es_MX and en_US, and this body. Then list the approved
// names in WHATSAPP_APPROVED_TEMPLATES. A message whose template is not
// approved never goes on WhatsApp outside the 24-hour window (channels.ts);
// email is tried instead, or the item goes to a person. docs/AUTOPILOT.md has
// the list.
//
// The words follow the brand rules (docs/BRAND.md): process, never outcome;
// no score, no promise, no date for a result; the client decides what is
// inaccurate; no pressure. Every template, filled in, passes
// checkClaimGuardrails (autopilot.test.ts). Each message says it is automatic
// and how to stop them.

export interface MessageTemplate {
  /** The template's name in Meta. Lowercase and underscores only. */
  name: string;
  /** What it is for, for the person approving it. */
  purpose: string;
  /** Parameter names, in order: {{1}} is the first. */
  params: readonly string[];
  body: Record<MessageLocale, string>;
}

/** The last line of every automatic message (a template footer in Meta). */
export const FOOTER: Record<MessageLocale, string> = {
  es: `Mensaje automático de ${BRAND.name}. Si no quieres recibir estos mensajes, responde BAJA.`,
  en: `Automated message from ${BRAND.name}. Reply STOP if you do not want these messages.`,
};

const T = (name: string, purpose: string, params: string[], es: string, en: string): MessageTemplate => ({
  name,
  purpose,
  params,
  body: { es, en },
});

const LAST_ES = "Es nuestro último recordatorio automático sobre esto; si prefieres hablarlo, responde aquí y una persona del equipo te contacta.";
const LAST_EN = "This is our last automated reminder about this; if you would rather talk it over, reply here and a person on our team will reach out.";

/** Follow-up templates: three steps per situation. */
export const FOLLOWUP_TEMPLATES: Record<FollowupKind, readonly [MessageTemplate, MessageTemplate, MessageTemplate]> = {
  agreement_unsigned: [
    T(
      "credalti_acuerdo_1",
      "Primer recordatorio: el cliente creó su cuenta y no ha firmado el acuerdo.",
      ["nombre", "enlace"],
      "Hola {{1}}, tu cuenta ya está creada. Cuando quieras, puedes leer el acuerdo de servicio en la app: ahí están tus derechos y cómo cancelar. Si tienes una pregunta antes de firmar, respóndenos aquí. {{2}}",
      "Hi {{1}}, your account is ready. Whenever you like, you can read the service agreement in the app: it explains your rights and how to cancel. If you have a question before signing, reply here. {{2}}",
    ),
    T(
      "credalti_acuerdo_2",
      "Segundo recordatorio del acuerdo sin firmar.",
      ["nombre", "enlace"],
      "Hola {{1}}, tu acuerdo de servicio sigue en la app. No empezamos ningún trabajo sin tu firma. Si algo no está claro, escríbenos y una persona del equipo te responde. {{2}}",
      "Hi {{1}}, your service agreement is still waiting in the app. We do not start any work without your signature. If anything is unclear, write to us and a person on our team will answer. {{2}}",
    ),
    T("credalti_acuerdo_3", "Último recordatorio automático del acuerdo.", ["nombre", "enlace"], `Hola {{1}}, tu acuerdo de servicio sigue sin firmar. ${LAST_ES} {{2}}`, `Hi {{1}}, your service agreement is still unsigned. ${LAST_EN} {{2}}`),
  ],
  documents_missing: [
    T(
      "credalti_documentos_1",
      "Primer recordatorio: falta la identificación o el comprobante de domicilio.",
      ["nombre", "documentos", "enlace"],
      "Hola {{1}}, para preparar tus cartas nos falta tu {{2}}. Puedes subir una foto desde la app en un minuto: {{3}}",
      "Hi {{1}}, to prepare your letters we still need your {{2}}. You can upload a photo from the app in a minute: {{3}}",
    ),
    T(
      "credalti_documentos_2",
      "Segundo recordatorio de documentos.",
      ["nombre", "documentos", "enlace"],
      "Hola {{1}}, todavía nos falta tu {{2}}. Los burós piden una copia junto con cada carta. Puedes subirla aquí: {{3}}",
      "Hi {{1}}, we still need your {{2}}. The bureaus ask for a copy with each letter. You can upload it here: {{3}}",
    ),
    T(
      "credalti_documentos_3",
      "Último recordatorio automático de documentos.",
      ["nombre", "documentos", "enlace"],
      `Hola {{1}}, todavía nos falta tu {{2}} para preparar tus cartas. ${LAST_ES} {{3}}`,
      `Hi {{1}}, we still need your {{2}} to prepare your letters. ${LAST_EN} {{3}}`,
    ),
  ],
  review_unfinished: [
    T(
      "credalti_revision_1",
      "Primer recordatorio: el cliente no ha terminado de revisar su reporte.",
      ["nombre", "pendientes", "enlace"],
      `Hola {{1}}, tu reporte te espera en la app: te faltan {{2}} por revisar. ${BRAND.assistant}, nuestro asistente con IA, te explica cada uno y tú decides sobre cada punto. {{3}}`,
      `Hi {{1}}, your report is waiting in the app: {{2}} left to review. ${BRAND.assistant}, our AI assistant, explains each one and you decide on every item. {{3}}`,
    ),
    T(
      "credalti_revision_2",
      "Segundo recordatorio de la revisión.",
      ["nombre", "pendientes", "enlace"],
      "Hola {{1}}, te faltan {{2}} de tu reporte por revisar. Puedes seguir donde te quedaste; solo tú decides qué es inexacto. {{3}}",
      "Hi {{1}}, you have {{2}} left to review on your report. You can pick up where you left off; only you decide what is inaccurate. {{3}}",
    ),
    T(
      "credalti_revision_3",
      "Último recordatorio automático de la revisión.",
      ["nombre", "pendientes", "enlace"],
      `Hola {{1}}, te faltan {{2}} de tu reporte por revisar. ${LAST_ES} {{3}}`,
      `Hi {{1}}, you have {{2}} left to review on your report. ${LAST_EN} {{3}}`,
    ),
  ],
  monitoring_inactive: [
    T(
      "credalti_monitoreo_1",
      "Primer aviso: no llega un reporte reciente del monitoreo de crédito.",
      ["nombre", "enlace"],
      "Hola {{1}}, no hemos podido importar un reporte reciente de tu monitoreo de crédito. ¿Puedes revisar que tu suscripción siga activa? Aquí te explicamos cómo: {{2}}",
      "Hi {{1}}, we have not been able to import a recent report from your credit monitoring. Could you check that your subscription is still active? Here is how: {{2}}",
    ),
    T(
      "credalti_monitoreo_2",
      "Segundo aviso del monitoreo.",
      ["nombre", "enlace"],
      "Hola {{1}}, tu monitoreo de crédito sigue sin enviarnos un reporte nuevo, y sin él no podemos seguir con tus cartas. Revisa tu suscripción aquí: {{2}}",
      "Hi {{1}}, your credit monitoring still has not sent us a new report, and without it we cannot continue with your letters. Check your subscription here: {{2}}",
    ),
    T("credalti_monitoreo_3", "Último aviso automático del monitoreo.", ["nombre", "enlace"], `Hola {{1}}, todavía no llega tu reporte nuevo. ${LAST_ES} {{2}}`, `Hi {{1}}, your new report has still not arrived. ${LAST_EN} {{2}}`),
  ],
  payment_method_missing: [
    T(
      "credalti_pago_metodo_1",
      "Primer recordatorio: una ronda ya se envió y no hay método de pago.",
      ["nombre", "ronda", "enlace"],
      "Hola {{1}}, tu equipo ya envió tu ronda {{2}} de cartas y todavía no tenemos tu método de pago. Puedes agregarlo en la app, en «Mis pagos»: {{3}}",
      "Hi {{1}}, your team already mailed your round {{2}} of letters and we do not have your payment method yet. You can add it in the app, under \"My payments\": {{3}}",
    ),
    T(
      "credalti_pago_metodo_2",
      "Segundo recordatorio del método de pago.",
      ["nombre", "ronda", "enlace"],
      "Hola {{1}}, falta tu método de pago para la ronda {{2}}. El cobro es por trabajo ya hecho y no hay cargos extra. {{3}}",
      "Hi {{1}}, your payment method for round {{2}} is still missing. The charge is for work already done and there are no extra fees. {{3}}",
    ),
    T(
      "credalti_pago_metodo_3",
      "Último recordatorio automático del método de pago.",
      ["nombre", "ronda", "enlace"],
      `Hola {{1}}, sigue faltando tu método de pago para la ronda {{2}}. ${LAST_ES} {{3}}`,
      `Hi {{1}}, your payment method for round {{2}} is still missing. ${LAST_EN} {{3}}`,
    ),
  ],
  identity_theft_report_missing: [
    T(
      "credalti_robo_identidad_1",
      "Pasos de la FTC cuando el cliente indicó robo de identidad. Una persona también lo contacta.",
      ["nombre", "enlace"],
      "Hola {{1}}, en tu revisión indicaste que algo en tu reporte es resultado de robo de identidad. Para ese paso hace falta tu reporte de robo de identidad de la FTC, que se llena sin costo en IdentityTheft.gov. Una persona del equipo te escribe para ayudarte con él. {{2}}",
      "Hi {{1}}, in your review you said something on your report is the result of identity theft. That step needs your FTC identity theft report, which you can fill out at no cost at IdentityTheft.gov. A person on our team will write to help you with it. {{2}}",
    ),
    T(
      "credalti_robo_identidad_2",
      "Recordatorio del reporte de robo de identidad.",
      ["nombre", "enlace"],
      "Hola {{1}}, ¿ya pudiste llenar tu reporte de robo de identidad en IdentityTheft.gov? Cuando lo tengas, una persona del equipo te ayuda a enviarlo. Si tienes dudas, respóndenos aquí. {{2}}",
      "Hi {{1}}, have you been able to fill out your identity theft report at IdentityTheft.gov? When you have it, a person on our team will help you send it. If you have questions, reply here. {{2}}",
    ),
    T(
      "credalti_robo_identidad_3",
      "Último recordatorio automático del reporte de robo de identidad.",
      ["nombre", "enlace"],
      `Hola {{1}}, todavía no tenemos tu reporte de robo de identidad de la FTC. ${LAST_ES} {{2}}`,
      `Hi {{1}}, we still do not have your FTC identity theft report. ${LAST_EN} {{2}}`,
    ),
  ],
  // The address on file is the return address of every letter. The post office's data did not recognise it:
  // the client confirms it (or corrects it) with one tap, prefilled with what the post office suggests.
  address_unconfirmed: [
    T(
      "credalti_direccion_1",
      "Primer aviso: la dirección del cliente no se pudo confirmar con los datos del correo antes de enviar sus cartas.",
      ["nombre", "enlace"],
      "Hola {{1}}, antes de enviar tus cartas revisamos tu dirección con los datos del correo (USPS) y no la pudimos confirmar. Va como remitente en cada carta. ¿Puedes revisarla? La confirmas o la corriges con un toque aquí: {{2}}",
      "Hi {{1}}, before mailing your letters we checked your address against the post office's (USPS) data and could not confirm it. It is the return address on every letter. Could you check it? You can confirm or correct it with one tap here: {{2}}",
    ),
    T(
      "credalti_direccion_2",
      "Segundo aviso de la dirección por confirmar.",
      ["nombre", "enlace"],
      "Hola {{1}}, tus cartas esperan a que confirmes tu dirección. Te mostramos la que reconoce el correo; si es la tuya, confírmala con un toque, y si no, corrígela aquí: {{2}}",
      "Hi {{1}}, your letters are waiting for you to confirm your address. We show you the one the post office recognises; if it is yours, confirm it with one tap, and if not, correct it here: {{2}}",
    ),
    T(
      "credalti_direccion_3",
      "Último aviso automático de la dirección.",
      ["nombre", "enlace"],
      `Hola {{1}}, todavía falta que confirmes tu dirección para enviar tus cartas. ${LAST_ES} {{2}}`,
      `Hi {{1}}, we still need you to confirm your address to mail your letters. ${LAST_EN} {{2}}`,
    ),
  ],
  // A document the automatic check could not accept, for a reason the client can fix: the reason in plain words.
  document_reupload: [
    T(
      "credalti_documento_nuevo_1",
      "Primer aviso: la revisión automática no pudo aceptar un documento, por un motivo que el cliente puede corregir.",
      ["nombre", "documento", "motivo", "enlace"],
      "Hola {{1}}, revisamos el documento que subiste ({{2}}) y no lo pudimos usar: {{3}}. ¿Puedes subir otro? Toma un minuto desde aquí: {{4}}",
      "Hi {{1}}, we checked the document you uploaded ({{2}}) and could not use it: {{3}}. Could you upload another one? It takes a minute from here: {{4}}",
    ),
    T(
      "credalti_documento_nuevo_2",
      "Segundo aviso del documento por subir de nuevo.",
      ["nombre", "documento", "motivo", "enlace"],
      "Hola {{1}}, todavía necesitamos una nueva copia de tu {{2}} ({{3}}). Va junto con cada carta. Puedes subirla aquí: {{4}}",
      "Hi {{1}}, we still need a new copy of your {{2}} ({{3}}). It goes with each letter. You can upload it here: {{4}}",
    ),
    T(
      "credalti_documento_nuevo_3",
      "Último aviso automático del documento.",
      ["nombre", "documento", "motivo", "enlace"],
      `Hola {{1}}, todavía falta una nueva copia de tu {{2}} ({{3}}). ${LAST_ES} {{4}}`,
      `Hi {{1}}, we still need a new copy of your {{2}} ({{3}}). ${LAST_EN} {{4}}`,
    ),
  ],
};

/** Status templates. `report_changes` has two: with items no longer listed, and without. */
export const STATUS_TEMPLATES: Record<StatusKind | "report_new" | "payment_paused", MessageTemplate> = {
  letters_mailed: T(
    "credalti_cartas_enviadas",
    "Aviso: el equipo envió las cartas de una ronda.",
    ["nombre", "cartas", "ronda", "enlace"],
    "Hola {{1}}, tu equipo envió por correo {{2}} de tu ronda {{3}}. Los burós tienen unos 30 días para responder. En la app ves cada carta y cómo va: {{4}}",
    "Hi {{1}}, your team mailed {{2}} of your round {{3}}. The bureaus have about 30 days to respond. In the app you can see each letter and how it is going: {{4}}",
  ),
  certified_delivered: T(
    "credalti_carta_entregada",
    "Aviso: el correo confirma la entrega de una carta certificada.",
    ["nombre", "destinatario", "fecha", "enlace"],
    "Hola {{1}}, el correo confirma que tu carta certificada para {{2}} se entregó el {{3}}. Puedes verla en la app: {{4}}",
    "Hi {{1}}, the post office confirms your certified letter to {{2}} was delivered on {{3}}. You can see it in the app: {{4}}",
  ),
  report_changes: T(
    "credalti_reporte_cambios",
    "Aviso: llegó el reporte nuevo y algunos puntos disputados ya no aparecen (solo el hecho).",
    ["nombre", "cambio", "enlace"],
    "Hola {{1}}, llegó tu reporte nuevo: {{2}}. Los resultados varían y la información puede volver a aparecer. Tu equipo prepara lo que sigue; en la app ves el detalle: {{3}}",
    "Hi {{1}}, your new report is in: {{2}}. Results vary and information can reappear. Your team is preparing what comes next; you can see the details in the app: {{3}}",
  ),
  report_new: T(
    "credalti_reporte_nuevo",
    "Aviso: llegó el reporte nuevo (sin puntos que dejaron de aparecer).",
    ["nombre", "enlace"],
    "Hola {{1}}, llegó tu reporte nuevo y tu equipo ya lo está revisando para preparar lo que sigue. En la app ves tu reporte: {{2}}",
    "Hi {{1}}, your new report is in and your team is reviewing it to prepare what comes next. You can see your report in the app: {{2}}",
  ),
  next_round_prepared: T(
    "credalti_ronda_preparada",
    "Aviso: el equipo preparó la siguiente ronda de cartas.",
    ["nombre", "ronda", "enlace"],
    "Hola {{1}}, tu equipo preparó tu ronda {{2}} de cartas con lo que tú confirmaste. Puedes leer cada carta en la app; no tienes que aprobar nada. {{3}}",
    "Hi {{1}}, your team prepared your round {{2}} of letters with what you confirmed. You can read each letter in the app; you do not need to approve anything. {{3}}",
  ),
  payment_receipt: T(
    "credalti_recibo",
    "Recibo de un cobro por una ronda ya enviada.",
    ["nombre", "recibo", "monto", "fecha", "trabajo", "enlace"],
    "Hola {{1}}, recibo {{2}}: cobramos {{3}} el {{4}} por trabajo ya hecho ({{5}}). Lo ves cuando quieras en «Mis pagos»: {{6}}",
    "Hi {{1}}, receipt {{2}}: we charged {{3}} on {{4}} for work already done ({{5}}). You can see it anytime under \"My payments\": {{6}}",
  ),
  // Billing's notices (billing/server.ts), each with the one-tap «Actualizar mi tarjeta» link. Updating the card retries the
  // same charge at once, under every billing rule (one charge per round, never before the work, never more often than 30 days).
  payment_declined: T(
    "credalti_pago_rechazado",
    "Aviso: un cobro por una ronda ya enviada no pasó; el sistema lo intenta de nuevo en la fecha dada.",
    ["nombre", "monto", "ronda", "fecha", "enlace"],
    "Hola {{1}}, no pudimos procesar el cobro de {{2}} por tu ronda {{3}} de cartas, que ya se envió. A veces es un dato de la tarjeta o un límite del banco. Lo intentamos de nuevo el {{4}}. Si prefieres, actualiza tu tarjeta aquí y el cobro se intenta enseguida: {{5}} No hay ningún cargo extra por esto.",
    "Hi {{1}}, we could not process the {{2}} charge for your round {{3}} of letters, which was already mailed. Sometimes it is a card detail or a bank limit. We will try again on {{4}}. If you prefer, update your card here and the charge is tried right away: {{5}} There is no extra charge for this.",
  ),
  payment_paused: T(
    "credalti_pago_pausa",
    "Aviso: el último intento de cobro no pasó; el caso queda en pausa hasta que el cliente actualice su tarjeta.",
    ["nombre", "monto", "ronda", "enlace"],
    "Hola {{1}}, no pudimos procesar el cobro de {{2}} por tu ronda {{3}} de cartas y ya no lo intentaremos por nuestra cuenta. No hay cargos extra ni recargos. Tu caso queda en pausa hasta que el pago quede resuelto; en cuanto actualices tu tarjeta aquí, sigue solo: {{4}} Si prefieres hablarlo con una persona, responde a este mensaje.",
    "Hi {{1}}, we could not process the {{2}} charge for your round {{3}} of letters, and we will not try again on our own. There are no extra charges and no late fees. Your case is paused until the payment is settled; as soon as you update your card here, it continues by itself: {{4}} If you would rather talk it over with a person, reply to this message.",
  ),
  payment_method_needed: T(
    "credalti_pago_falta_metodo",
    "Aviso: una ronda ya se envió, el cobro está al día y no hay método de pago.",
    ["nombre", "ronda", "fecha", "enlace"],
    "Hola {{1}}, tu equipo envió tu ronda {{2}} de cartas el {{3}} y todavía no tenemos tu método de pago. Puedes agregarlo en un minuto aquí: {{4}} El cobro es por ese trabajo, que ya se hizo.",
    "Hi {{1}}, your team mailed your round {{2}} of letters on {{3}} and we do not have your payment method yet. You can add it in a minute here: {{4}} The charge is for that work, which is already done.",
  ),
  letter_remailed: T(
    "credalti_carta_reenviada",
    "Aviso: el correo devolvió una carta y el sistema la envió de nuevo a la dirección corregida.",
    ["nombre", "destinatario", "ronda", "enlace"],
    "Hola {{1}}, el correo devolvió tu carta para {{2}} de la ronda {{3}}. Revisamos la dirección con los datos del correo y la enviamos de nuevo. Es parte de la misma ronda: tu cobro no cambia. En la app ves cómo va: {{4}}",
    "Hi {{1}}, the post office returned your letter to {{2}} from round {{3}}. We checked the address against the post office's data and mailed it again. It is part of the same round: your charge does not change. You can follow it in the app: {{4}}",
  ),
  // The review request (src/lib/reviews/reviews.ts): once per client, at a milestone every client reaches, whatever
  // they think of the service. No incentive, no "if you are happy", "good or bad" said out loud. In Meta this one is
  // likely category MARKETING, not UTILITY (docs/REVIEWS.md).
  review_request: T(
    "credalti_resena",
    "Pedido de reseña: una sola vez por cliente, en un momento al que llegan todos, sin importar cómo le va.",
    ["nombre", "enlace"],
    "Hola {{1}}, gracias por confiar en nosotros. Si tienes un minuto, ¿nos cuentas en una reseña cómo ha sido tu experiencia con Credalti, buena o mala? Aquí están los sitios: {{2}} Tu opinión honesta ayuda a otras personas a decidir. No damos nada a cambio, y dejarla o no, no cambia en nada tu servicio.",
    "Hi {{1}}, thank you for trusting us. If you have a minute, would you share in a review how your experience with Credalti has been, good or bad? Here are the sites: {{2}} Honest reviews help other people decide. We give nothing in exchange, and leaving one or not changes nothing about your service.",
  ),
};

/** Every template, for the settings screen and the docs. */
/**
 * The first monitoring reminder when the team found the client's monitoring
 * cancelled and their next report is due soon (fulfillment/monitoring.ts):
 * sent BEFORE the report is missing, so it says when it is due instead of
 * "we could not import a recent report". Later steps are the usual ones.
 */
export const MONITORING_BEFORE_DUE_TEMPLATE = "credalti_monitoreo_previo";

export const EXTRA_FOLLOWUP_TEMPLATES: readonly MessageTemplate[] = [
  T(
    MONITORING_BEFORE_DUE_TEMPLATE,
    "Aviso antes de la fecha: el monitoreo aparece cancelado y viene el siguiente reporte.",
    ["nombre", "fecha", "enlace"],
    "Hola {{1}}, tu siguiente reporte de crédito se necesita alrededor del {{2}}, y en nuestro registro tu monitoreo de crédito aparece cancelado. ¿Puedes revisar que tu suscripción esté activa? Aquí te explicamos cómo: {{3}}",
    "Hi {{1}}, your next credit report is needed around {{2}}, and our records show your credit monitoring as cancelled. Could you check that your subscription is active? Here is how: {{3}}",
  ),
];

export const ALL_TEMPLATES: readonly MessageTemplate[] = [
  ...Object.values(FOLLOWUP_TEMPLATES).flat(),
  ...EXTRA_FOLLOWUP_TEMPLATES,
  ...Object.values(STATUS_TEMPLATES),
];

/** The template's body with its parameters filled in, without the footer. Missing values read as "". */
export function renderTemplateBody(template: MessageTemplate, locale: MessageLocale, values: readonly string[]): string {
  return template.body[locale].replace(/\{\{(\d+)\}\}/g, (_, n: string) => (values[Number(n) - 1] ?? "").trim()).replace(/\s+$/g, "");
}

/** The message as WhatsApp shows it: the body and the footer. An email carries its own footer instead (integrations/email.ts). */
export function renderTemplate(template: MessageTemplate, locale: MessageLocale, values: readonly string[]): string {
  return `${renderTemplateBody(template, locale, values)}\n\n${FOOTER[locale]}`;
}

const SUBJECT: Record<string, Record<MessageLocale, string>> = {
  agreement_unsigned: { es: "Tu acuerdo de servicio", en: "Your service agreement" },
  documents_missing: { es: "Tus documentos", en: "Your documents" },
  review_unfinished: { es: "La revisión de tu reporte", en: "Your report review" },
  monitoring_inactive: { es: "Tu monitoreo de crédito", en: "Your credit monitoring" },
  payment_method_missing: { es: "Tu método de pago", en: "Your payment method" },
  identity_theft_report_missing: { es: "Tu reporte de robo de identidad", en: "Your identity theft report" },
  letters_mailed: { es: "Enviamos tus cartas", en: "Your letters were mailed" },
  certified_delivered: { es: "Se entregó tu carta certificada", en: "Your certified letter was delivered" },
  report_changes: { es: "Llegó tu reporte nuevo", en: "Your new report is in" },
  next_round_prepared: { es: "Tu siguiente ronda de cartas", en: "Your next round of letters" },
  payment_receipt: { es: "Tu recibo", en: "Your receipt" },
  address_unconfirmed: { es: "Confirma tu dirección", en: "Confirm your address" },
  document_reupload: { es: "Sube tu documento de nuevo", en: "Upload your document again" },
  payment_declined: { es: "Tu cobro no pasó", en: "Your payment did not go through" },
  payment_method_needed: { es: "Tu método de pago", en: "Your payment method" },
  letter_remailed: { es: "Enviamos tu carta de nuevo", en: "We mailed your letter again" },
  review_request: { es: "¿Cómo ha sido tu experiencia?", en: "How has your experience been?" },
  // A booked call's confirmation and reminder (src/lib/calls/messages.ts).
  call_booked: { es: "Tu llamada con nuestro equipo", en: "Your call with our team" },
};

/** The email's subject line for a message's topic. */
export function emailSubject(topic: string, locale: MessageLocale): string {
  return `${BRAND.name}: ${SUBJECT[topic]?.[locale] ?? (locale === "es" ? "Un aviso sobre tu servicio" : "An update about your service")}`;
}

/** The screen in the client's app, as a full link when the app's address is known. */
export function appLink(path: string, base: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  const root = (base ?? "").replace(/\/+$/, "");
  return root ? `${root}${path}` : path;
}
