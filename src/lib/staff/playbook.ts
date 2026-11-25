import { BRAND } from "../brand";
import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import { AGREEMENT_GRACE_DAYS, DOCUMENTS_GRACE_DAYS, EXCEPTION_LABELS, HANDLED_QUIET_DAYS, RESPONSE_WINDOW_DAYS, REVIEW_STALLED_DAYS, type ExceptionKind } from "./stage";
import { type StaffLocale, staffLocaleFallback } from "./i18n/locale";

const EXCEPTION_LABEL = EXCEPTION_LABELS.es;
const EXCEPTION_LABEL_EN = EXCEPTION_LABELS.en;

// "Cómo se resuelve": one short card per kind of notice in the work queue,
// written for someone on their first week. Three to five plain steps, then
// "Hecho cuando…": the moment the notice is really done (most of them leave
// the list by themselves when the situation changes; «Atendido» only quiets
// one for a few days).
//
// Each card was written from what the app actually does for that notice:
// the rule that raises it (stage.ts, intake/exceptions.ts), the button the
// queue offers (the WhatsApp draft in messages.ts, or the page it opens) and
// what the system already tried (autopilot/followups.ts). A test checks that
// every kind of notice has a card and that no card promises a result.
//
// The same file holds the help behind "¿Qué hago aquí?" on every staff screen
// and the new teammate's first-day checklist.
//
// Everything here exists in English and Spanish (the console's language,
// i18n/locale.ts). The unsuffixed constants are the Spanish originals; the
// console reads the per-language maps (PLAYBOOKS, SCREEN_HELPS, …) through
// playbookFor / helpForPath with the member's locale.

export interface PlaybookCard {
  /** The notice's own label, for the card's title. */
  title: string;
  /** 3 to 5 steps, in order. */
  steps: string[];
  /** When it is really done. */
  doneWhen: string;
}

export const PLAYBOOK: Record<ExceptionKind, PlaybookCard> = {
  question_waiting: {
    title: EXCEPTION_LABEL.question_waiting,
    steps: [
      `Lee la pregunta y la conversación en su caso (sección «Conversación»). ${BRAND.assistant} la pasó al equipo porque no le tocaba responderla.`,
      `Si hay una respuesta guardada que coincide, aparece primero; si no, ${BRAND.assistant} te prepara un borrador. Léelo completo y corrígelo.`,
      "Si pregunta qué marcar como inexacto, no se lo digas: explícale qué revisar (¿lo reconoce?, ¿las fechas y los montos coinciden?) y que la decisión es suya.",
      "Precios, cancelaciones o dudas legales: no adivines. Si no sabes, dile que lo confirmas y pregúntale a un administrador.",
      "Envía desde la app. Si la respuesta sirve para otros clientes, toca «Guardar como respuesta».",
    ],
    doneWhen: "Le respondiste en su conversación: el aviso se va solo en cuanto envías.",
  },
  agreement_unsigned: {
    title: EXCEPTION_LABEL.agreement_unsigned,
    steps: [
      `Creó su cuenta hace más de ${AGREEMENT_GRACE_DAYS} días y no ha firmado. Si el piloto automático está encendido, ya recibió 3 recordatorios (mira «Lo que ya hizo el sistema»).`,
      "Llámale o escríbele con el botón. Pregunta si tiene dudas sobre el acuerdo; no lo presiones ni le pongas fecha límite.",
      "No vendas por teléfono ni ofrezcas descuentos o resultados: explica cómo funciona el servicio y que tiene 3 días hábiles para cancelar sin costo.",
      "Si ya no le interesa, déjalo en una nota. Marca «Atendido».",
    ],
    doneWhen: "Firmó (el aviso se va solo), o dejaste una nota con lo que decidió.",
  },
  documents_missing: {
    title: EXCEPTION_LABEL.documents_missing,
    steps: [
      `Firmó hace más de ${DOCUMENTS_GRACE_DAYS} días y falta su identificación, su comprobante de domicilio o ambos. Mira cuál en «Documentos».`,
      "Escríbele con el botón: el mensaje ya dice qué falta y que se sube con una foto desde la app.",
      "Si se le complica, explícale: una foto clara con el teléfono basta; el comprobante debe tener su nombre y dirección y ser reciente (un recibo o estado de cuenta).",
      "No le pidas que te mande documentos por WhatsApp: se suben en la app, donde quedan protegidos. Marca «Atendido».",
    ],
    doneWhen: "Los dos documentos están en archivo. La revisión automática los confirma; si duda de uno, te llega como «Documento para revisar».",
  },
  review_stalled: {
    title: EXCEPTION_LABEL.review_stalled,
    steps: [
      `Su reporte llegó hace más de ${REVIEW_STALLED_DAYS} días y le faltan puntos por revisar. Mira cuántos en «Reporte y respuestas».`,
      "Escríbele o llámale con el botón y pregunta qué le impide terminar: un punto que no entiende, tiempo, la app.",
      `Si tiene dudas sobre un punto, ${BRAND.assistant} se lo explica en la app. Tú puedes decirle qué revisar, nunca qué marcar: sus respuestas son suyas.`,
      "Deja una nota con lo que acordaron y marca «Atendido».",
    ],
    doneWhen: "Terminó su revisión (el aviso se va solo y el sistema prepara la ronda 1), o hay una nota con el día en que dijo que terminaría.",
  },
  report_stale: {
    title: EXCEPTION_LABEL.report_stale,
    steps: [
      `Su reporte tiene más de ${FRESH_REPORT_DAYS} días. Mientras sea así no sale ninguna carta: es una regla y no se salta.`,
      "Casi siempre su monitoreo de crédito se canceló o tiene un problema de pago con el servicio de monitoreo. Escríbele con el botón para que lo revise.",
      "Cuando su monitoreo tenga un reporte nuevo, impórtalo desde su caso («Importar reporte») si el sistema no lo hizo solo.",
      "Marca «Atendido» cuando le hayas escrito.",
    ],
    doneWhen: `Hay un reporte de menos de ${FRESH_REPORT_DAYS} días en su caso.`,
  },
  response_overdue: {
    title: EXCEPTION_LABEL.response_overdue,
    steps: [
      `Pasaron los ${RESPONSE_WINDOW_DAYS} días de respuesta de los burós y no llegó un reporte nuevo, así que no se sabe qué respondieron.`,
      "Escríbele con el botón para que revise que su monitoreo siga activo.",
      "Si subió cartas de los burós, léelas en «Documentos»; son opcionales: el resultado de la ronda sale del reporte nuevo.",
      "Cuando haya reporte nuevo, impórtalo desde su caso si el sistema no lo hizo solo. Marca «Atendido».",
    ],
    doneWhen: "Se importó un reporte nuevo: la ronda queda con sus resultados y el sistema prepara la siguiente.",
  },
  payment_past_due: {
    title: EXCEPTION_LABEL.payment_past_due,
    steps: [
      "Un cobro no pasó después de todos los reintentos y su caso está en pausa. Nadie cobra a mano: no hay manera, y no hace falta.",
      "Antes de llegar aquí, el sistema le mandó cada aviso con el enlace «Actualizar mi tarjeta» (al actualizarla, el cobro se intenta solo). En «Lo que ya hizo el sistema» ves las palabras exactas que recibió.",
      "Escríbele o llámale: pregúntale si recibió el enlace y si algo le impide usarlo. No le repitas lo que ya leyó.",
      "No pidas números de tarjeta por teléfono ni por WhatsApp. No negocies montos ni plazos: eso lo decide un administrador.",
      "Marca «Atendido» y deja una nota con lo que te dijo.",
    ],
    doneWhen: "Puso un método de pago y el cobro pasó (el caso sigue solo), o un administrador decidió qué hacer y lo anotó.",
  },
  payment_method_missing: {
    title: EXCEPTION_LABEL.payment_method_missing,
    steps: [
      "Su ronda ya se envió y el sistema no tiene con qué cobrarla. El sistema le avisó y le recordó hasta 3 veces, cada vez con el enlace «Actualizar mi tarjeta», antes de llegar aquí.",
      "Llámale o escríbele: pregúntale si le llegó el enlace. Pone su tarjeta él mismo en esa página; al guardarla, el cobro se intenta solo, con todas las reglas de cobro.",
      "El cliente pone su tarjeta él mismo en la app. Nunca la pidas por teléfono ni por mensaje.",
      "Marca «Atendido».",
    ],
    doneWhen: "Hay un método de pago en archivo; el sistema cobra solo.",
  },
  letter_returned: {
    title: EXCEPTION_LABEL.letter_returned,
    steps: [
      "Llega aquí solo lo que el sistema no pudo resolver: si la dirección se pudo corregir con los datos del correo, la carta ya salió de nuevo una vez (misma ronda, sin otro cobro); si era la del cliente, se le pidió confirmarla.",
      "Abre la carta con el botón y lee el motivo que dio el correo. Si ya se reenvió una vez y volvió, no se reenvía sola otra vez.",
      "Si el problema es la dirección de un acreedor o cobrador, el sistema ya la quitó de verificadas: búscala y guárdala en «Acreedores» con una fuente.",
      "Nunca envíes a una dirección adivinada: solo a una verificada. Deja una nota con lo que hiciste y marca «Atendido».",
    ],
    doneWhen: "La dirección está corregida y verificada, y hay una nota de qué se hizo con la carta.",
  },
  identity_theft_report_missing: {
    title: EXCEPTION_LABEL.identity_theft_report_missing,
    steps: [
      "Dijo que algo de su reporte es robo de identidad. La app le avisó que una persona lo contactaría: este aviso es tuyo desde el primer día.",
      "Escríbele o llámale con calma: es un tema delicado. Explícale que el reporte de robo de identidad de la FTC se llena sin costo en IdentityTheft.gov.",
      "Pídele que lo suba en la app. No se envían cartas de robo de identidad hasta tenerlo en archivo.",
      "No le digas qué puntos son robo de identidad: eso lo dice él. Marca «Atendido» cuando le hayas escrito.",
    ],
    doneWhen: "Su reporte de la FTC está en «Documentos».",
  },
  service_end_requested: {
    title: EXCEPTION_LABEL.service_end_requested,
    steps: [
      "Pidió terminar el servicio. Ya no sale ninguna carta.",
      "Escríbele con el botón para confirmarlo. No intentes convencerle de quedarse ni le pongas condiciones.",
      "Si tiene preguntas de cobros o reembolsos, pásalas a un administrador.",
      "Deja una nota con lo que confirmaron y marca «Atendido».",
    ],
    doneWhen: "Confirmaste con el cliente y un administrador cerró el servicio.",
  },
  furnisher_address_missing: {
    title: EXCEPTION_LABEL.furnisher_address_missing,
    steps: [
      "Es un aviso por empresa, no por cliente: la libreta es una para todos, y el aviso dice cuántos clientes esperan esa dirección.",
      "Si el aviso trae una dirección «sugerida», salió de los reportes: muchas veces es la de pagos, no la de disputas. Nunca se envía a ella sin verificar.",
      "Toca el botón: abre «Acreedores» con la empresa (y la sugerencia) escrita. Compruébala en el sitio de la empresa o en una carta, y escribe la fuente.",
      "Guárdala como verificada. Las rondas de todos los clientes que esperaban quedan listas solas.",
    ],
    doneWhen: "La dirección está guardada y verificada; la ronda aparece en «Listas para enviar».",
  },
  document_check_needs_person: {
    title: EXCEPTION_LABEL.document_check_needs_person,
    steps: [
      "La revisión automática no pudo confirmar su identificación o su comprobante de domicilio. El motivo está en el aviso.",
      "Abre el documento con el botón y míralo tú: ¿se lee?, ¿el nombre coincide?, ¿la dirección es la de sus cartas?, ¿es reciente?",
      "Llega aquí solo si el motivo no se arregla con otra foto, o si el sistema ya le pidió otra (con el motivo) y volvió a fallar o no respondió.",
      "Si está mal, escríbele para que suba una foto nueva, completa y bien iluminada.",
      "Marca «Atendido» cuando lo hayas decidido.",
    ],
    doneWhen: "Hay un documento de ese tipo que se lee bien y coincide con sus datos.",
  },
  bureau_letter_needs_person: {
    title: EXCEPTION_LABEL.bureau_letter_needs_person,
    steps: [
      "El cliente subió una carta de un buró que pide algo más o llama «frívola» a una disputa.",
      "Ábrela con el botón y léela completa: qué pide y para cuándo.",
      "Si pide un documento, escríbele al cliente qué falta. Si no sabes qué responder, pregúntale a un administrador.",
      "Deja una nota con lo que pide la carta y marca «Atendido».",
    ],
    doneWhen: "Hay una nota con lo que pide el buró y quién se encarga.",
  },
  client_address_unconfirmed: {
    title: EXCEPTION_LABEL.client_address_unconfirmed,
    steps: [
      "El correo (USPS) no pudo confirmar la dirección del cliente: no entrega ahí, o falta el número de departamento. Sus cartas esperan.",
      "Antes de llegar aquí el sistema le pidió confirmarla con un toque, con la sugerencia del correo, hasta 3 veces. Llega aquí si no respondió, o si la que confirmó tampoco pasó.",
      "Llámale y pregúntale su dirección tal como le llega el correo (número de departamento incluido). No la escribas tú: pídele que la confirme o la corrija en la app, en «Confirmar dirección».",
      "Marca «Atendido» y deja una nota con lo que dijo.",
    ],
    doneWhen: "El cliente confirmó una dirección que el correo reconoce; la ronda sale sola.",
  },
};

const PLAYBOOK_EN: Record<ExceptionKind, PlaybookCard> = {
  question_waiting: {
    title: EXCEPTION_LABEL_EN.question_waiting,
    steps: [
      `Read the question and the conversation in their case (the “Conversation” section). ${BRAND.assistant} passed it to the team because it wasn't one for it to answer.`,
      `If a saved answer matches, it shows first; if not, ${BRAND.assistant} prepares a draft for you. Read all of it and fix what needs fixing.`,
      "If they ask what to mark as inaccurate, don't tell them: explain what to check (do they recognize it? do the dates and amounts match?) and that the decision is theirs.",
      "Prices, cancellations or legal questions: don't guess. If you don't know, tell them you'll confirm and ask an administrator.",
      "Send it from the app. If the answer works for other clients, tap “Save as answer”.",
    ],
    doneWhen: "You answered them in their conversation: the notice goes away as soon as you send.",
  },
  agreement_unsigned: {
    title: EXCEPTION_LABEL_EN.agreement_unsigned,
    steps: [
      `They created their account more than ${AGREEMENT_GRACE_DAYS} days ago and haven't signed. If the autopilot is on, they already got 3 reminders (see “What the system already did”).`,
      "Call or message them with the button. Ask if they have questions about the agreement; don't pressure them or give them a deadline.",
      "Don't sell over the phone or offer discounts or results: explain how the service works and that they have 3 business days to cancel at no cost.",
      "If they're no longer interested, leave a note. Mark it “Handled”.",
    ],
    doneWhen: "They signed (the notice goes away on its own), or you left a note with what they decided.",
  },
  documents_missing: {
    title: EXCEPTION_LABEL_EN.documents_missing,
    steps: [
      `They signed more than ${DOCUMENTS_GRACE_DAYS} days ago and their ID, proof of address or both are missing. See which under “Documents”.`,
      "Message them with the button: the message already says what's missing and that they upload it with a photo from the app.",
      "If it's hard for them, explain: a clear phone photo is enough; the proof of address must show their name and address and be recent (a bill or a statement).",
      "Don't ask them to send documents over WhatsApp: they upload them in the app, where they stay protected. Mark it “Handled”.",
    ],
    doneWhen: "Both documents are on file. The automatic check confirms them; if it isn't sure about one, it comes to you as “Document to review”.",
  },
  review_stalled: {
    title: EXCEPTION_LABEL_EN.review_stalled,
    steps: [
      `Their report came in more than ${REVIEW_STALLED_DAYS} days ago and they still have items to review. See how many under “Report and answers”.`,
      "Message or call them with the button and ask what's keeping them from finishing: an item they don't understand, time, the app.",
      `If they have questions about an item, ${BRAND.assistant} explains it in the app. You can tell them what to check, never what to mark: their answers are theirs.`,
      "Leave a note with what you agreed and mark it “Handled”.",
    ],
    doneWhen: "They finished their review (the notice goes away and the system prepares round 1), or there's a note with the day they said they'd finish.",
  },
  report_stale: {
    title: EXCEPTION_LABEL_EN.report_stale,
    steps: [
      `Their report is more than ${FRESH_REPORT_DAYS} days old. While that's true, no letter goes out: it's a rule and it isn't skipped.`,
      "Almost always their credit monitoring was cancelled or has a payment problem with the monitoring service. Message them with the button so they check it.",
      "Once their monitoring has a new report, import it from their case (“Import report”) if the system didn't do it on its own.",
      "Mark it “Handled” once you've messaged them.",
    ],
    doneWhen: `There's a report less than ${FRESH_REPORT_DAYS} days old in their case.`,
  },
  response_overdue: {
    title: EXCEPTION_LABEL_EN.response_overdue,
    steps: [
      `The bureaus' ${RESPONSE_WINDOW_DAYS} days to answer are up and no new report came in, so we don't know what they answered.`,
      "Message them with the button so they check that their monitoring is still active.",
      "If they uploaded letters from the bureaus, read them under “Documents”; they're optional: the round's result comes from the new report.",
      "Once there's a new report, import it from their case if the system didn't do it on its own. Mark it “Handled”.",
    ],
    doneWhen: "A new report was imported: the round gets its results and the system prepares the next one.",
  },
  payment_past_due: {
    title: EXCEPTION_LABEL_EN.payment_past_due,
    steps: [
      "A charge failed after every retry and their case is paused. Nobody charges by hand: there's no way to, and there's no need.",
      "Before it got here, the system sent them every notice with the “Update my card” link (once they update it, the charge is retried on its own). Under “What the system already did” you can see the exact words they got.",
      "Message or call them: ask if they got the link and whether something keeps them from using it. Don't repeat what they already read.",
      "Don't ask for card numbers by phone or WhatsApp. Don't negotiate amounts or dates: an administrator decides that.",
      "Mark it “Handled” and leave a note with what they told you.",
    ],
    doneWhen: "They added a payment method and the charge went through (the case moves on by itself), or an administrator decided what to do and wrote it down.",
  },
  payment_method_missing: {
    title: EXCEPTION_LABEL_EN.payment_method_missing,
    steps: [
      "Their round already went out and the system has nothing to charge it to. The system told them and reminded them up to 3 times, each time with the “Update my card” link, before it got here.",
      "Call or message them: ask if they got the link. They enter their card themselves on that page; once it's saved, the charge is tried on its own, under every billing rule.",
      "The client enters their card themselves in the app. Never ask for it by phone or message.",
      "Mark it “Handled”.",
    ],
    doneWhen: "There's a payment method on file; the system charges on its own.",
  },
  letter_returned: {
    title: EXCEPTION_LABEL_EN.letter_returned,
    steps: [
      "Only what the system couldn't fix gets here: if the address could be corrected with the post office's data, the letter already went out again once (same round, no extra charge); if it was the client's address, they were asked to confirm it.",
      "Open the letter with the button and read the reason the post office gave. If it was already re-sent once and came back, it isn't re-sent on its own again.",
      "If the problem is a creditor's or collector's address, the system already took it off the verified list: look it up and save it under “Creditors” with a source.",
      "Never send to a guessed address: only to a verified one. Leave a note with what you did and mark it “Handled”.",
    ],
    doneWhen: "The address is corrected and verified, and there's a note about what was done with the letter.",
  },
  identity_theft_report_missing: {
    title: EXCEPTION_LABEL_EN.identity_theft_report_missing,
    steps: [
      "They said something on their report is identity theft. The app told them a person would reach out: this notice is yours from day one.",
      "Message or call them calmly: it's a sensitive topic. Explain that the FTC identity theft report is filled out at no cost at IdentityTheft.gov.",
      "Ask them to upload it in the app. No identity theft letters go out until it's on file.",
      "Don't tell them which items are identity theft: they say that. Mark it “Handled” once you've messaged them.",
    ],
    doneWhen: "Their FTC report is under “Documents”.",
  },
  service_end_requested: {
    title: EXCEPTION_LABEL_EN.service_end_requested,
    steps: [
      "They asked to end the service. No more letters go out.",
      "Message them with the button to confirm it. Don't try to talk them into staying or set conditions.",
      "If they have questions about charges or refunds, pass them to an administrator.",
      "Leave a note with what you confirmed and mark it “Handled”.",
    ],
    doneWhen: "You confirmed with the client and an administrator closed the service.",
  },
  furnisher_address_missing: {
    title: EXCEPTION_LABEL_EN.furnisher_address_missing,
    steps: [
      "This notice is per company, not per client: there's one address book for everyone, and the notice says how many clients are waiting on that address.",
      "If the notice shows a “suggested” address, it came from the reports: often it's the payments address, not the disputes one. Nothing is ever sent to it unverified.",
      "Tap the button: it opens “Creditors” with the company (and the suggestion) filled in. Check it on the company's website or on a letter, and write down the source.",
      "Save it as verified. The rounds of every client who was waiting are ready on their own.",
    ],
    doneWhen: "The address is saved and verified; the round shows up under “Ready to send”.",
  },
  document_check_needs_person: {
    title: EXCEPTION_LABEL_EN.document_check_needs_person,
    steps: [
      "The automatic check couldn't confirm their ID or their proof of address. The reason is in the notice.",
      "Open the document with the button and look at it yourself: is it readable? does the name match? is the address the one on their letters? is it recent?",
      "It only gets here if the reason isn't fixed by another photo, or if the system already asked for another one (with the reason) and it failed again or they didn't answer.",
      "If it's wrong, message them to upload a new photo, complete and well lit.",
      "Mark it “Handled” once you've decided.",
    ],
    doneWhen: "There's a document of that kind that reads well and matches their details.",
  },
  bureau_letter_needs_person: {
    title: EXCEPTION_LABEL_EN.bureau_letter_needs_person,
    steps: [
      "The client uploaded a letter from a bureau that asks for something more or calls a dispute “frivolous”.",
      "Open it with the button and read all of it: what it asks for and by when.",
      "If it asks for a document, message the client about what's missing. If you don't know how to answer, ask an administrator.",
      "Leave a note with what the letter asks for and mark it “Handled”.",
    ],
    doneWhen: "There's a note with what the bureau asks for and who's handling it.",
  },
  client_address_unconfirmed: {
    title: EXCEPTION_LABEL_EN.client_address_unconfirmed,
    steps: [
      "The post office (USPS) couldn't confirm the client's address: it doesn't deliver there, or the apartment number is missing. Their letters are waiting.",
      "Before it got here the system asked them to confirm it with one tap, with the post office's suggestion, up to 3 times. It gets here if they didn't answer, or if the one they confirmed didn't pass either.",
      "Call them and ask for their address exactly as their mail arrives (apartment number included). Don't type it in yourself: ask them to confirm or correct it in the app, under “Confirm address”.",
      "Mark it “Handled” and leave a note with what they said.",
    ],
    doneWhen: "The client confirmed an address the post office recognizes; the round goes out on its own.",
  },
};

/** Every card, in each language. */
export const PLAYBOOKS: Record<StaffLocale, Record<ExceptionKind, PlaybookCard>> = { en: PLAYBOOK_EN, es: PLAYBOOK };

/** The card for one kind of notice, in the console's language. */
export function playbookFor(kind: ExceptionKind, locale: StaffLocale = staffLocaleFallback()): PlaybookCard {
  return PLAYBOOKS[locale][kind];
}

// ── "¿Qué hago aquí?" ───────────────────────────────────────────────────

export interface ScreenHelp {
  title: string;
  /** What the screen is for, in one or two sentences. */
  what: string;
  /** What to do here, in order. */
  steps: string[];
  /** Notice kinds whose cards are relevant on this screen. */
  playbooks: ExceptionKind[];
}

const ALL_KINDS = Object.keys(PLAYBOOK) as ExceptionKind[];

/** By path prefix; the longest prefix wins. */
export const SCREEN_HELP: Record<string, ScreenHelp> = {
  "/equipo": {
    title: "Inicio: tu trabajo de hoy",
    what: "Todo lo que necesita una persona, en el orden en que conviene hacerlo. Lo demás lo hace el sistema solo.",
    steps: [
      "Arriba ves cuántas cosas hay y cuántos minutos llevan, más o menos.",
      "Toca «Siguiente» para trabajarlas una por una. Cada una trae su tarjeta «Cómo se resuelve».",
      "Cuando termines una, toca «Atendido». Si la situación sigue igual en unos días, vuelve.",
      "A la derecha: las rondas listas para enviar y lo que el sistema está haciendo por su cuenta.",
    ],
    playbooks: ALL_KINDS,
  },
  "/equipo/clientes": {
    title: "Clientes",
    what: "La lista de clientes que te tocan, con su etapa y quién hace lo siguiente.",
    steps: ["Busca por nombre o teléfono.", "Filtra por etapa con los chips de arriba.", "Toca un nombre para abrir su caso."],
    playbooks: [],
  },
  "/equipo/clientes/": {
    title: "El caso de un cliente",
    what: "Dónde está, qué sigue y quién lo hace; sus avisos, su conversación, su reporte con sus respuestas, sus cartas, sus documentos y sus notas.",
    steps: [
      "Arriba: «Dónde está» y «Qué sigue». Si el siguiente paso es del equipo, el botón está ahí.",
      "«Necesita una persona»: los avisos de este cliente.",
      "«Conversación»: lo que habló con la app. Si te hizo una pregunta, hay una respuesta guardada o un borrador para revisar y enviar.",
      "Las respuestas del reporte son del cliente: tú las lees, no las cambias.",
    ],
    playbooks: ["question_waiting", "documents_missing", "review_stalled", "letter_returned", "identity_theft_report_missing"],
  },
  "/equipo/respuestas": {
    title: "Respuestas guardadas",
    what: `Respuestas aprobadas a preguntas que se repiten. Las aprobadas aparecen primero cuando un cliente pregunta algo parecido, y ${BRAND.assistant} puede usarlas para responder sin pasar la pregunta al equipo.`,
    steps: [
      "Después de enviar una respuesta, toca «Guardar como respuesta» para proponerla.",
      "Un administrador la lee, la corrige si hace falta y la aprueba.",
      "Una respuesta guardada no lleva nombres, montos ni datos de un cliente: sirve para todos.",
    ],
    playbooks: ["question_waiting"],
  },
  "/equipo/enviar": {
    title: "Enviar rondas",
    what: "Antes de que salga una carta ves a dónde va, cómo va (normal o certificada) y cuánto cuesta.",
    steps: ["Revisa la dirección de cada carta.", "Cambia la clase de envío solo si hace falta.", "Confirma. Las reglas (acuerdo, reporte vigente, direcciones) se revisan otra vez al enviar."],
    playbooks: ["furnisher_address_missing", "report_stale"],
  },
  "/equipo/imprimir": {
    title: "Imprimir",
    what: "Las cartas listas para imprimir aquí y enviar a mano.",
    steps: ["Imprime en papel tamaño carta.", "Mete cada carta en su sobre de ventana.", "Marca las rondas como enviadas solo cuando salgan por correo."],
    playbooks: [],
  },
  "/equipo/acreedores": {
    title: "Acreedores",
    what: "Las direcciones de disputa de acreedores y cobradores. Una carta solo sale a una dirección verificada.",
    steps: ["Busca la empresa.", "Agrega o corrige la dirección y escribe de dónde la sacaste.", "Cada cambio queda en su historial."],
    playbooks: ["furnisher_address_missing", "letter_returned"],
  },
  "/equipo/actividad": {
    title: "Actividad",
    what: "Quién hizo qué y cuándo, incluido lo que hizo el sistema solo.",
    steps: ["Filtra por persona o por cliente.", "Úsala para saber si alguien ya le escribió a un cliente antes de escribirle tú."],
    playbooks: [],
  },
  "/equipo/piloto": {
    title: "Piloto automático",
    what: "Lo que el sistema hace solo: recordatorios, avisos de estado y, si se enciende, el envío de rondas listas.",
    steps: ["Solo un administrador lo cambia.", "Ve aquí qué está encendido y a quién se detuvo."],
    playbooks: [],
  },
  "/equipo/negocio": {
    title: "Negocio",
    what: "Los números del negocio, cada uno con su definición («?»).",
    steps: ["Elige el periodo arriba.", "Toca «?» para ver cómo se cuenta cada número."],
    playbooks: [],
  },
  "/equipo/socios": { title: "Socios", what: "Las personas y negocios que refieren clientes, y sus comisiones.", steps: ["Revisa solicitudes nuevas.", "Solo un administrador aprueba y fija comisiones."], playbooks: [] },
  "/equipo/equipo": { title: "Equipo", what: "Quién está en el equipo y con qué rol.", steps: ["Agrega por correo o teléfono.", "Cambia el rol o desactiva; nadie se borra."], playbooks: [] },
  "/equipo/invitar": { title: "Invitar", what: "El enlace de invitación que ventas le manda a un prospecto.", steps: ["Escribe su nombre y teléfono.", "Copia el mensaje y envíalo por WhatsApp."], playbooks: ["agreement_unsigned"] },
  "/equipo/perfil": {
    title: "Tu perfil",
    what: "Tus datos, tu idioma, tu resumen de la mañana y tu lista del primer día.",
    steps: ["Elige el idioma de la consola.", "Elige si quieres el resumen de la mañana, por dónde y a qué hora.", "Mira cómo se ve antes de encenderlo."],
    playbooks: [],
  },
  "/equipo/bienvenida": {
    title: "Bienvenida",
    what: "Lo que hace cada pantalla, las reglas y un recorrido de 5 minutos por un cliente.",
    steps: ["Haz el recorrido una vez.", "Vuelve a las reglas cuando tengas duda."],
    playbooks: [],
  },
  "/equipo/cartas": { title: "Cartas", what: "Las plantillas de las cartas.", steps: ["Solo un administrador las edita."], playbooks: [] },
  "/equipo/contenido": { title: "Contenido", what: "Las piezas de marketing, de la idea a los resultados, con la revisión de cumplimiento y marca.", steps: ["Crea la pieza (en blanco, con plantilla o con Alti) y corrige lo que marque la revisión.", "Marca la lista y mándala a revisión; solo un administrador aprueba.", "Publícala (o prográmala) y agrega los resultados reales."], playbooks: [] },
  "/equipo/seo": { title: "SEO", what: "Cómo encuentran el sitio: salud del sitio, guías, números de Search Console, frases seguidas y la lista local. Sin puntaje: cada revisión pasa o dice qué arreglar.", steps: ["Corre la revisión del sitio y arregla lo que liste, lo más importante primero.", "Escribe una guía (en blanco o con el borrador de Alti), da a cada dato legal una fuente oficial, marca la lista y mándala a aprobación; solo un administrador publica.", "Sigue las frases que importan (solo Texas), convierte los huecos de contenido en encargos, y avanza con el dueño la lista local."], playbooks: [] },
  "/equipo/planes": {
    title: "Planes de cobro",
    what: "Los planes que se ofrecen a los clientes, como en Credit Repair Cloud, y la vista previa de cuándo se cobra.",
    steps: [
      "Guarda un borrador, envíalo al abogado y registra su aprobación; solo entonces se puede ofrecer.",
      "Un plan ofrecido no cambia: para cambiarlo, guarda una versión nueva. Quien ya firmó sigue con la suya.",
      "No hay cuota de inscripción: la cuota de primer trabajo se cobra después de enviar la primera ronda.",
    ],
    playbooks: [],
  },
  "/equipo/cobros": {
    title: "Facturas y contracargos",
    what: "Cada cobro es una factura. Filtra, exporta a CSV o a QuickBooks y registra contracargos.",
    steps: ["Filtra por estado, método o fecha.", "Descarga el CSV que necesites.", "Ante un contracargo, abre el paquete de evidencia y envíalo al procesador."],
    playbooks: [],
  },
  // Credalti Control (docs/CONTROL.md).
  "/equipo/control": {
    title: "Resumen y Hoy",
    what: "El negocio en una pantalla: una tarjeta por área con números reales y lo que te necesita. «Hoy» junta todo lo que necesita una persona, en orden, con sus pasos.",
    steps: ["Mira «Te necesita» en cada tarjeta y tócalo para ir a resolverlo.", "Abre «Hoy» y trabaja de arriba hacia abajo; cada cosa trae su paso a paso.", "Si algo no te toca (dinero, cancelar, lo legal), toca «Pasar al dueño» con una nota."],
    playbooks: ["question_waiting", "payment_past_due"],
  },
  "/equipo/leads": {
    title: "Prospectos",
    what: "Cada conversación con un prospecto, venga de WhatsApp, HighLevel, un socio o el registro con Alti. Solo una persona mueve un prospecto de etapa.",
    steps: ["Empieza por «Esperando».", "Abre la conversación: «✨ Sugerir respuesta» o una respuesta guardada; léela y envíala.", "Pasado un día sin que escriba, solo se puede enviar la plantilla aprobada.", "Cuando esté listo, «Preparar su invitación». «Invitado» y «Firmó» se ponen solos."],
    playbooks: [],
  },
  "/equipo/alertas": {
    title: "Alertas al teléfono",
    what: "Tú eliges qué te avisa al teléfono. Todo empieza apagado.",
    steps: ["Enciende los temas que te tocan.", "Toca «Recibir alertas en este teléfono» y da permiso.", "Manda una prueba para ver cómo se ven."],
    playbooks: [],
  },
};

const SCREEN_HELP_EN: Record<string, ScreenHelp> = {
  "/equipo": {
    title: "Home: your work for today",
    what: "Everything that needs a person, in the order it makes sense to do it. The system handles the rest on its own.",
    steps: [
      "At the top you see how many things there are and roughly how many minutes they take.",
      "Tap “Next” to work through them one at a time. Each one comes with its “How to handle it” card.",
      "When you finish one, tap “Handled”. If the situation is the same in a few days, it comes back.",
      "On the right: the rounds ready to send and what the system is doing on its own.",
    ],
    playbooks: ALL_KINDS,
  },
  "/equipo/clientes": {
    title: "Clients",
    what: "The list of clients that are yours, with their stage and who does the next thing.",
    steps: ["Search by name or phone.", "Filter by stage with the chips at the top.", "Tap a name to open their case."],
    playbooks: [],
  },
  "/equipo/clientes/": {
    title: "A client's case",
    what: "Where they are, what's next and who does it; their notices, their conversation, their report with their answers, their letters, their documents and their notes.",
    steps: [
      "At the top: “Where they are” and “What's next”. If the next step is the team's, the button is right there.",
      "“Needs a person”: this client's notices.",
      "“Conversation”: what they talked about with the app. If they asked you something, there's a saved answer or a draft to review and send.",
      "The answers on the report are the client's: you read them, you don't change them.",
    ],
    playbooks: ["question_waiting", "documents_missing", "review_stalled", "letter_returned", "identity_theft_report_missing"],
  },
  "/equipo/respuestas": {
    title: "Saved answers",
    what: `Approved answers to questions that keep coming up. Approved ones show first when a client asks something similar, and ${BRAND.assistant} can use them to answer without passing the question to the team.`,
    steps: [
      "After you send a reply, tap “Save as answer” to propose it.",
      "An administrator reads it, fixes it if needed and approves it.",
      "A saved answer has no names, amounts or client details: it works for everyone. Each one is in one language and only goes to clients who speak it.",
    ],
    playbooks: ["question_waiting"],
  },
  "/equipo/enviar": {
    title: "Send rounds",
    what: "Before a letter goes out you see where it's going, how (regular or certified) and what it costs.",
    steps: ["Check each letter's address.", "Change the mail class only if needed.", "Confirm. The rules (agreement, current report, addresses) are checked again when sending."],
    playbooks: ["furnisher_address_missing", "report_stale"],
  },
  "/equipo/imprimir": {
    title: "Print",
    what: "The letters ready to print here and mail by hand.",
    steps: ["Print on letter-size paper.", "Put each letter in its window envelope.", "Mark the rounds as sent only once they're in the mail."],
    playbooks: [],
  },
  "/equipo/acreedores": {
    title: "Creditors",
    what: "Dispute addresses for creditors and collectors. A letter only goes to a verified address.",
    steps: ["Look up the company.", "Add or correct the address and write down where you got it.", "Every change stays in its history."],
    playbooks: ["furnisher_address_missing", "letter_returned"],
  },
  "/equipo/actividad": {
    title: "Activity",
    what: "Who did what and when, including what the system did on its own.",
    steps: ["Filter by person or by client.", "Use it to see whether someone already messaged a client before you do."],
    playbooks: [],
  },
  "/equipo/piloto": {
    title: "Autopilot",
    what: "What the system does on its own: reminders, status notices and, if it's turned on, mailing ready rounds.",
    steps: ["Only an administrator changes it.", "See here what's on and who it's on hold for."],
    playbooks: [],
  },
  "/equipo/negocio": {
    title: "Business",
    what: "The business numbers, each with its definition (“?”).",
    steps: ["Pick the period at the top.", "Tap “?” to see how each number is counted."],
    playbooks: [],
  },
  "/equipo/socios": { title: "Partners", what: "The people and businesses who refer clients, and their commissions.", steps: ["Review new applications.", "Only an administrator approves and sets commissions."], playbooks: [] },
  "/equipo/equipo": { title: "Team", what: "Who's on the team and with what role.", steps: ["Add people by email or phone.", "Change the role or deactivate; nobody gets deleted."], playbooks: [] },
  "/equipo/invitar": { title: "Invite", what: "The invite link sales sends to a lead.", steps: ["Enter their name and phone.", "Copy the message and send it on WhatsApp."], playbooks: ["agreement_unsigned"] },
  "/equipo/perfil": {
    title: "Your profile",
    what: "Your details, your language, your morning summary and your first-day list.",
    steps: ["Pick the console's language.", "Choose whether you want the morning summary, how and at what time.", "See how it looks before turning it on."],
    playbooks: [],
  },
  "/equipo/bienvenida": {
    title: "Welcome",
    what: "What each screen does, the rules and a 5-minute tour through one client.",
    steps: ["Take the tour once.", "Come back to the rules when you're unsure."],
    playbooks: [],
  },
  "/equipo/cartas": { title: "Letters", what: "The letter templates.", steps: ["Only an administrator edits them."], playbooks: [] },
  "/equipo/contenido": { title: "Content", what: "Marketing pieces, from the idea to the results, with the compliance and brand check.", steps: ["Create the piece (blank, from a template or with Alti) and fix what the check marks.", "Tick the checklist and send it for review; only an administrator approves.", "Post it (or schedule it) and add the real results."], playbooks: [] },
  "/equipo/seo": { title: "SEO", what: "How the website is found: site health, guides, Search Console numbers, tracked phrases and the local checklist. No score: each check passes or says what to fix.", steps: ["Run the site check and fix what it lists, most important first.", "Write a guide (blank or drafted by Alti), give every legal fact an official source, tick the checklist and send it for approval; only an administrator publishes.", "Track the phrases that matter (Texas only), turn content gaps into briefs, and work through the local to-dos with the owner."], playbooks: [] },
  "/equipo/planes": {
    title: "Billing plans",
    what: "The plans offered to clients, as in Credit Repair Cloud, with a preview of when each charge happens.",
    steps: [
      "Save a draft, send it to the attorney and record the approval; only then can it be offered.",
      "An offered plan never changes: to change it, save a new version. Clients who signed keep theirs.",
      "There is no setup fee: the first work fee is charged after the first round is mailed.",
    ],
    playbooks: [],
  },
  "/equipo/cobros": {
    title: "Invoices and chargebacks",
    what: "Every charge is an invoice. Filter, export to CSV or QuickBooks, and record chargebacks.",
    steps: ["Filter by status, method or date.", "Download the CSV you need.", "For a chargeback, open the evidence pack and send it to the processor."],
    playbooks: [],
  },
  // Credalti Control (docs/CONTROL.md).
  "/equipo/control": {
    title: "Overview and Today",
    what: "The business on one screen: one card per department with real numbers and what needs you. “Today” gathers everything that needs a person, in order, with its steps.",
    steps: ["Look at “Needs you” on each card and tap it to go and do it.", "Open “Today” and work top to bottom; each item carries its steps.", "If something isn't yours (money, cancelling, legal), tap “Escalate to the owner” with a note."],
    playbooks: ["question_waiting", "payment_past_due"],
  },
  "/equipo/leads": {
    title: "Leads",
    what: "Every lead conversation, from WhatsApp, HighLevel, a partner or the chat signup. Only a person moves a lead's stage.",
    steps: ["Start with “Waiting”.", "Open the conversation: “✨ Suggest reply” or a saved answer; read it and send it.", "A day after their last message, only the approved template can be sent.", "When they're ready, “Prepare invitation”. “Invited” and “Signed” set themselves."],
    playbooks: [],
  },
  "/equipo/alertas": {
    title: "Phone alerts",
    what: "You choose what pings your phone. Everything starts off.",
    steps: ["Turn on the topics that are yours.", "Tap “Get alerts on this phone” and allow it.", "Send a test to see how they look."],
    playbooks: [],
  },
};

/** Every screen's help, in each language (the same paths). */
export const SCREEN_HELPS: Record<StaffLocale, Record<string, ScreenHelp>> = { en: SCREEN_HELP_EN, es: SCREEN_HELP };

/** The help for the screen at this path, in the console's language. */
export function helpForPath(pathname: string, locale: StaffLocale = staffLocaleFallback()): ScreenHelp {
  const table = SCREEN_HELPS[locale];
  const keys = Object.keys(table)
    .filter((prefix) => (prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)))
    .sort((a, b) => b.length - a.length);
  // "/equipo/clientes/" (a client's page) is more specific than "/equipo/clientes".
  const exact = keys.find((k) => k === pathname);
  return table[exact ?? keys[0] ?? "/equipo"]!;
}

// ── A new teammate's first day ──────────────────────────────────────────

/** The rules, in the words a new teammate needs. Shown on the checklist and the welcome page. */
export const HOUSE_RULES: readonly string[] = [
  "No prometas resultados, puntos ni fechas. Lo que cambia en un reporte lo deciden los burós; los resultados varían.",
  "No le digas a un cliente qué marcar como inexacto ni qué motivo elegir. Sus respuestas son suyas; tú le dices qué revisar.",
  "No vendas por teléfono. Ventas explica el servicio y manda la invitación; nadie presiona para firmar.",
  "No pidas tarjetas ni documentos por WhatsApp o por teléfono: el cliente los pone en la app.",
  "Si no sabes algo (precios, cancelaciones, temas legales), no adivines: pregúntale a un administrador.",
];

export interface ChecklistItem {
  id: string;
  title: string;
  detail: string;
  href: string;
}

export const NEW_HIRE_CHECKLIST: readonly ChecklistItem[] = [
  { id: "screens", title: "Conoce las pantallas", detail: "Qué hace cada una, en un minuto.", href: "/equipo/bienvenida#pantallas" },
  { id: "tour", title: "Recorrido de 5 minutos", detail: "Un cliente de ejemplo, de su aviso a su respuesta.", href: "/equipo/bienvenida#recorrido" },
  { id: "rules", title: "Lee las reglas", detail: "Sin promesas, el cliente decide qué marcar, sin ventas por teléfono.", href: "/equipo/bienvenida#reglas" },
  { id: "playbook", title: "Abre una tarjeta «Cómo se resuelve»", detail: "Cada aviso de tu lista trae la suya.", href: "/equipo#necesita" },
  { id: "summary", title: "Elige tu resumen de la mañana", detail: "Tu trabajo del día por WhatsApp o correo.", href: "/equipo/perfil#resumen" },
];

/** What each screen is for, for the welcome page. */
export const SCREENS_TOUR: ReadonlyArray<{ href: string; name: string; what: string }> = [
  { href: "/equipo", name: "Inicio", what: "Tu lista de hoy: lo que necesita una persona, en orden, con minutos estimados. «Siguiente» la recorre una por una." },
  { href: "/equipo/clientes", name: "Clientes", what: "Todos tus clientes, con su etapa. Toca uno para abrir su caso." },
  { href: "/equipo/respuestas", name: "Respuestas", what: "Respuestas aprobadas a preguntas que se repiten." },
  { href: "/equipo/enviar", name: "Enviar", what: "Revisar a dónde va cada carta y confirmar el envío." },
  { href: "/equipo/acreedores", name: "Acreedores", what: "Direcciones de disputa verificadas." },
  { href: "/equipo/actividad", name: "Actividad", what: "Quién hizo qué, incluido el sistema." },
  { href: "/equipo/perfil", name: "Tu perfil", what: "Tu idioma, tu resumen de la mañana y esta lista." },
];

/** The 5-minute tour: one demo client, from its notice to its answer. `?recorrido=N` on each step shows the guide bar. */
export const TOUR_STEPS: ReadonlyArray<{ title: string; text: string; href: string }> = [
  { title: "Tu lista de hoy", text: "Arriba dice cuántas cosas hay y cuántos minutos llevan. La primera es la más urgente.", href: "/equipo" },
  { title: "Una cosa a la vez", text: "Toca «Siguiente». Cada aviso trae «Cómo se resuelve» y «Hecho cuando…».", href: "/equipo" },
  { title: "El caso de un cliente", text: "«Dónde está» y «Qué sigue» resumen todo. Abajo están sus avisos.", href: "/equipo/clientes/c04" },
  { title: "Responder una pregunta", text: `En «Conversación» hay una respuesta guardada o un borrador de ${BRAND.assistant}. Léelo, corrígelo y envíalo.`, href: "/equipo/clientes/c04#conversacion" },
  { title: "Las respuestas son del cliente", text: "En «Reporte y respuestas» ves lo que el cliente marcó. Tú no lo cambias ni le dices qué marcar.", href: "/equipo/clientes/c04#reporte" },
];

// ── The same, in English ────────────────────────────────────────────────

const HOUSE_RULES_EN: readonly string[] = [
  "Don't promise results, points or dates. What changes on a report is up to the bureaus; results vary.",
  "Don't tell a client what to mark as inaccurate or which reason to pick. Their answers are their own; you tell them what to check.",
  "Don't sell over the phone. Sales explains the service and sends the invite; nobody pushes anyone to sign.",
  "Don't ask for cards or documents over WhatsApp or by phone: the client enters them in the app.",
  "If you don't know something (prices, cancellations, legal questions), don't guess: ask an administrator.",
];

const NEW_HIRE_CHECKLIST_EN: readonly ChecklistItem[] = [
  { id: "screens", title: "Get to know the screens", detail: "What each one does, in a minute.", href: "/equipo/bienvenida#pantallas" },
  { id: "tour", title: "5-minute tour", detail: "A sample client, from their notice to your reply.", href: "/equipo/bienvenida#recorrido" },
  { id: "rules", title: "Read the rules", detail: "No promises, the client decides what to mark, no selling over the phone.", href: "/equipo/bienvenida#reglas" },
  { id: "playbook", title: "Open a “How to handle it” card", detail: "Every notice on your list comes with one.", href: "/equipo#necesita" },
  { id: "summary", title: "Set up your morning summary", detail: "Your work for the day by WhatsApp or email.", href: "/equipo/perfil#resumen" },
];

const SCREENS_TOUR_EN: ReadonlyArray<{ href: string; name: string; what: string }> = [
  { href: "/equipo", name: "Home", what: "Your list for today: what needs a person, in order, with estimated minutes. “Next” goes through it one at a time." },
  { href: "/equipo/clientes", name: "Clients", what: "All your clients, with their stage. Tap one to open their case." },
  { href: "/equipo/respuestas", name: "Answers", what: "Approved answers to questions that keep coming up." },
  { href: "/equipo/enviar", name: "Send", what: "Check where each letter is going and confirm the mailing." },
  { href: "/equipo/acreedores", name: "Creditors", what: "Verified dispute addresses." },
  { href: "/equipo/actividad", name: "Activity", what: "Who did what, including the system." },
  { href: "/equipo/perfil", name: "Your profile", what: "Your language, your morning summary and this list." },
];

const TOUR_STEPS_EN: ReadonlyArray<{ title: string; text: string; href: string }> = [
  { title: "Your list for today", text: "The top says how many things there are and how many minutes they take. The first one is the most urgent.", href: "/equipo" },
  { title: "One thing at a time", text: "Tap “Next”. Each notice comes with “How to handle it” and “Done when…”.", href: "/equipo" },
  { title: "A client's case", text: "“Where they are” and “What's next” sum it all up. Their notices are below.", href: "/equipo/clientes/c04" },
  { title: "Answering a question", text: `In “Conversation” there's a saved answer or a draft from ${BRAND.assistant}. Read it, fix it and send it.`, href: "/equipo/clientes/c04#conversacion" },
  { title: "The answers are the client's", text: "In “Report and answers” you see what the client marked. You don't change it or tell them what to mark.", href: "/equipo/clientes/c04#reporte" },
];

export const HOUSE_RULE_TEXT: Record<StaffLocale, readonly string[]> = { en: HOUSE_RULES_EN, es: HOUSE_RULES };
export const NEW_HIRE_CHECKLISTS: Record<StaffLocale, readonly ChecklistItem[]> = { en: NEW_HIRE_CHECKLIST_EN, es: NEW_HIRE_CHECKLIST };
export const SCREENS_TOURS: Record<StaffLocale, ReadonlyArray<{ href: string; name: string; what: string }>> = { en: SCREENS_TOUR_EN, es: SCREENS_TOUR };
export const TOUR_STEP_TEXT: Record<StaffLocale, ReadonlyArray<{ title: string; text: string; href: string }>> = { en: TOUR_STEPS_EN, es: TOUR_STEPS };

/** How long a quiet notice stays off the list, for the help text. */
export { HANDLED_QUIET_DAYS };
