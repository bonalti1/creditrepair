import { BRAND } from "../brand";
import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import { AGREEMENT_GRACE_DAYS, DOCUMENTS_GRACE_DAYS, EXCEPTION_LABEL, HANDLED_QUIET_DAYS, RESPONSE_WINDOW_DAYS, REVIEW_STALLED_DAYS, type ExceptionKind } from "./stage";

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
      "Escríbele con el botón: dice qué ronda se cobró y que actualice su método de pago en «Mis pagos» de la app.",
      "No pidas números de tarjeta por teléfono ni por WhatsApp. No negocies montos ni plazos: eso lo decide un administrador.",
      "Marca «Atendido» y deja una nota con lo que te dijo.",
    ],
    doneWhen: "Puso un método de pago y el cobro pasó (el caso sigue solo), o un administrador decidió qué hacer y lo anotó.",
  },
  payment_method_missing: {
    title: EXCEPTION_LABEL.payment_method_missing,
    steps: [
      "Su ronda ya se envió y el sistema no tiene con qué cobrarla. El piloto automático le recuerda hasta 3 veces antes de llegar aquí.",
      "Escríbele con el botón: el mensaje dice qué trabajo ya se hizo y que agregue su método de pago en «Mis pagos».",
      "El cliente pone su tarjeta él mismo en la app. Nunca la pidas por teléfono ni por mensaje.",
      "Marca «Atendido».",
    ],
    doneWhen: "Hay un método de pago en archivo; el sistema cobra solo.",
  },
  letter_returned: {
    title: EXCEPTION_LABEL.letter_returned,
    steps: [
      "Abre la carta con el botón y lee el motivo que dio el correo.",
      "Si el problema es la dirección de un acreedor o cobrador, búscala y corrígela en «Acreedores» con una fuente; si es la del cliente, confírmala con él.",
      "Nunca envíes a una dirección adivinada: solo a una verificada.",
      "Si hay que volver a enviarla, avísale a un administrador. Deja una nota con lo que cambiaste y marca «Atendido».",
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
      "La ronda tiene una carta para una empresa sin dirección verificada para disputas. La ronda no sale hasta tenerla.",
      "Toca «Agregar la dirección»: abre «Acreedores» con la empresa escrita.",
      "Busca la dirección de disputas en el sitio de la empresa o en una carta del cliente. Escribe de dónde la sacaste.",
      "Guárdala como verificada. La ronda queda lista sola.",
    ],
    doneWhen: "La dirección está guardada y verificada; la ronda aparece en «Listas para enviar».",
  },
  document_check_needs_person: {
    title: EXCEPTION_LABEL.document_check_needs_person,
    steps: [
      "La revisión automática no pudo confirmar su identificación o su comprobante de domicilio. El motivo está en el aviso.",
      "Abre el documento con el botón y míralo tú: ¿se lee?, ¿el nombre coincide?, ¿la dirección es la de sus cartas?, ¿es reciente?",
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
};

/** The card for one kind of notice. */
export function playbookFor(kind: ExceptionKind): PlaybookCard {
  return PLAYBOOK[kind];
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
    what: "Tus datos, tu resumen de la mañana y tu lista del primer día.",
    steps: ["Elige si quieres el resumen de la mañana, por dónde y a qué hora.", "Mira cómo se ve antes de encenderlo."],
    playbooks: [],
  },
  "/equipo/bienvenida": {
    title: "Bienvenida",
    what: "Lo que hace cada pantalla, las reglas y un recorrido de 5 minutos por un cliente.",
    steps: ["Haz el recorrido una vez.", "Vuelve a las reglas cuando tengas duda."],
    playbooks: [],
  },
  "/equipo/cartas": { title: "Cartas", what: "Las plantillas de las cartas.", steps: ["Solo un administrador las edita."], playbooks: [] },
};

/** The help for the screen at this path. */
export function helpForPath(pathname: string): ScreenHelp {
  const keys = Object.keys(SCREEN_HELP)
    .filter((prefix) => (prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)))
    .sort((a, b) => b.length - a.length);
  // "/equipo/clientes/" (a client's page) is more specific than "/equipo/clientes".
  const exact = keys.find((k) => k === pathname);
  return SCREEN_HELP[exact ?? keys[0] ?? "/equipo"]!;
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
  { href: "/equipo/perfil", name: "Tu perfil", what: "Tu resumen de la mañana y esta lista." },
];

/** The 5-minute tour: one demo client, from its notice to its answer. `?recorrido=N` on each step shows the guide bar. */
export const TOUR_STEPS: ReadonlyArray<{ title: string; text: string; href: string }> = [
  { title: "Tu lista de hoy", text: "Arriba dice cuántas cosas hay y cuántos minutos llevan. La primera es la más urgente.", href: "/equipo" },
  { title: "Una cosa a la vez", text: "Toca «Siguiente». Cada aviso trae «Cómo se resuelve» y «Hecho cuando…».", href: "/equipo" },
  { title: "El caso de un cliente", text: "«Dónde está» y «Qué sigue» resumen todo. Abajo están sus avisos.", href: "/equipo/clientes/c04" },
  { title: "Responder una pregunta", text: `En «Conversación» hay una respuesta guardada o un borrador de ${BRAND.assistant}. Léelo, corrígelo y envíalo.`, href: "/equipo/clientes/c04#conversacion" },
  { title: "Las respuestas son del cliente", text: "En «Reporte y respuestas» ves lo que el cliente marcó. Tú no lo cambias ni le dices qué marcar.", href: "/equipo/clientes/c04#reporte" },
];

/** How long a quiet notice stays off the list, for the help text. */
export { HANDLED_QUIET_DAYS };
