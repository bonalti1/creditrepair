import type { StaffLocale } from "./locale";

// Messages that come back from a check or a route (the team's validation, the
// staff API routes) are written once, in Spanish, where the rule lives. The
// console shows them in the member's language through staffMessage: an exact
// sentence from MESSAGE_EN, or a pattern for the ones that carry a name. A
// message nobody listed here is shown as it came.

/** Spanish → English, exact sentences. */
export const MESSAGE_EN: Record<string, string> = {
  // The team (team.ts)
  "Escribe el nombre de la persona (solo letras).": "Write the person's name (letters only).",
  "Elige un rol.": "Pick a role.",
  "Escribe su correo o su teléfono: con eso entra a la consola.": "Enter their email or phone: that's how they sign in to the console.",
  "Ese correo no parece válido.": "That email doesn't look valid.",
  "Ese teléfono no parece válido. Usa 10 dígitos de EE. UU.": "That phone number doesn't look valid. Use 10 US digits.",
  "No encontramos a esa persona en el equipo.": "We couldn't find that person on the team.",
  "No puedes desactivar tu propia cuenta. Pídeselo a otra persona administradora.": "You can't deactivate your own account. Ask another administrator.",
  "Esa persona no está en el equipo.": "That person isn't on the team.",
  "Ventas no trabaja los casos. Asigna a un especialista o a un administrador.": "Sales doesn't work cases. Assign a specialist or an administrator.",
  "Escribe su nombre.": "Enter their first name.",
  "Escribe su apellido.": "Enter their last name.",
  "Escribe un teléfono de 10 dígitos de EE. UU.": "Enter a 10-digit US phone number.",
  "Ese correo no parece válido. Puedes dejarlo vacío.": "That email doesn't look valid. You can leave it blank.",
  "Elige el estado donde vive.": "Pick the state they live in.",
  "Elige su meta.": "Pick their goal.",
  "Elige quién de ventas lo trae.": "Pick who in sales brought them in.",
  "Revisa los datos marcados.": "Check the highlighted fields.",
  "No se pudo guardar. Intenta de nuevo.": "Couldn't save. Try again.",
  "No se pudo guardar.": "Couldn't save.",
  // Clients, cases and replies (data.ts, actions.ts, routes)
  "Este cliente no está entre los tuyos.": "This client isn't one of yours.",
  "No encontramos a este cliente.": "We couldn't find this client.",
  "La respuesta no se envió: rompe una regla.": "The reply wasn't sent: it breaks a rule.",
  "No se pudo enviar la respuesta.": "Couldn't send the reply.",
  "No se pudo guardar el reporte.": "Couldn't save the report.",
  "No se pudo guardar la muestra.": "Couldn't save the sample.",
  "No se pudo guardar la nota.": "Couldn't save the note.",
  "No se pudo preparar el borrador.": "Couldn't prepare the draft.",
  "No pudimos conectar. Revisa tu conexión e intenta de nuevo.": "We couldn't connect. Check your connection and try again.",
  // Saved answers (answersServer.ts, useSavedAnswers.ts)
  "No se guardó: rompe una regla.": "Not saved: it breaks a rule.",
  "Tu rol no responde a clientes.": "Your role doesn't reply to clients.",
  "Esa respuesta ya no existe.": "That answer doesn't exist anymore.",
  "Solo un administrador aprueba respuestas.": "Only an administrator approves answers.",
  "Solo un administrador cambia una respuesta aprobada o la de otra persona.": "Only an administrator changes an approved answer or someone else's.",
  "Revisa la pregunta y la respuesta.": "Check the question and the answer.",
  "Escribe la pregunta del cliente.": "Write the client's question.",
  "La respuesta es muy corta.": "The answer is too short.",
  "Nadie ha iniciado sesión.": "Nobody is signed in.",
  // Drafts (drafts.ts) — the route answers in Spanish when it is not told the member's language
  "Tu rol no responde a clientes, así que no hay borrador.": "Your role doesn't reply to clients, so there's no draft.",
  "No hay una pregunta del cliente esperando respuesta.": "There's no client question waiting for an answer.",
  "No hay borrador ahora.": "No draft right now.",
  // The address book (mail/furnishers.ts, mail/address.ts)
  "Revisa los campos: alguno es demasiado largo o tiene un formato que no se reconoce.": "Check the fields: one is too long or in a format we don't recognize.",
  "Escribe el nombre de la empresa.": "Enter the company's name.",
  "Una dirección verificada necesita la dirección.": "A verified address needs the address.",
  "Escribe la fuente: dónde se comprobó la dirección (enlace a la página de la empresa, o la carta de la que salió).":
    "Enter the source: where the address was checked (a link to the company's page, or the letter it came from).",
  "La fecha de verificación no es válida.": "The verification date isn't valid.",
  "La fecha de verificación no puede ser futura.": "The verification date can't be in the future.",
  "No hay dirección.": "There's no address.",
  "Falta la calle o el apartado postal.": "The street or P.O. box is missing.",
  "Falta la ciudad.": "The city is missing.",
  "El estado no es un estado de EE. UU.": "The state isn't a US state.",
  "Falta el código postal (5 dígitos, o 5 + 4).": "The ZIP code is missing (5 digits, or 5 + 4).",
  "Tiene más de dos líneas de calle; no se sabe cuál es la de entrega.": "It has more than two street lines; there's no telling which one is for delivery.",
  // Marking rounds as mailed, sending, partners
  "No se pudo marcar como enviadas. Intenta de nuevo.": "Couldn't mark them as mailed. Try again.",
  "No se pudo enviar. Intenta de nuevo.": "Couldn't send. Try again.",
  "No se pudo enviar.": "Couldn't send.",
  "La ronda no se puede enviar ahora.": "The round can't be sent right now.",
  // The server's mailing gate (rounds/send.ts)
  "Un cobro de este cliente no pasó y su caso está en pausa. No se envía una ronda nueva hasta que el pago quede resuelto.":
    "A charge for this client didn't go through and their case is paused. No new round goes out until the payment is sorted out.",
  "La dirección del cliente no se puede leer. Pídele que la escriba en su app.": "The client's address can't be read. Ask them to enter it in their app.",
  // Partners (partners/data.ts, partners/rules.ts)
  "No encontramos a ese socio.": "We couldn't find that partner.",
  "Escribe un monto válido.": "Enter a valid amount.",
  "Elige cómo se gana la comisión.": "Pick how the commission is earned.",
  "Escribe un monto entre $1 y $1,000.": "Enter an amount between $1 and $1,000.",
  "No se pudo guardar. Inténtalo de nuevo.": "Couldn't save. Try again.",
  "No se pudo guardar. Revisa tu conexión.": "Couldn't save. Check your connection.",
  "Las comisiones a socios están apagadas. Una persona administradora las enciende cuando el abogado lo apruebe.":
    "Partner commissions are off. An administrator turns them on once the attorney approves.",
  // The letter editor (letters/versions/validate.ts, versions.ts, data.ts)
  "Esa carta no existe en la biblioteca.": "That letter isn't in the library.",
  "Falta el asunto (la línea «Re:»).": "The subject (the “Re:” line) is missing.",
  "El asunto va en una sola línea.": "The subject goes on a single line.",
  "El asunto no lleva fichas: escríbelo como texto.": "The subject takes no chips: write it as text.",
  "La carta no tiene texto.": "The letter has no text.",
  "Hay una llave «{» o «}» suelta. Las fichas se insertan con los botones; no se escriben a mano.":
    "There's a stray “{” or “}”. Chips are inserted with the buttons; they aren't typed by hand.",
  "La lista de partidas va sola en su párrafo, con una línea en blanco antes y después.":
    "The item list goes alone in its paragraph, with a blank line before and after.",
  "Un mismo párrafo no puede llevar «Palabras del cliente» y «Solo si no escribió nada».":
    "One paragraph can't have both “Client's words” and “Only if they wrote nothing”.",
  "Una línea que empieza con «- » se confunde con la lista de partidas. Escríbela como frase.":
    "A line that starts with “- ” looks like the item list. Write it as a sentence.",
  "Las cartas se envían en inglés: quita los acentos, la ñ y los signos ¿ ¡.": "Letters are mailed in English: remove accents, ñ and the ¿ ¡ marks.",
  "La carta va en primera persona, con la voz del cliente (I, my).": "The letter is in the first person, in the client's voice (I, my).",
  "El saludo, la línea «Re:» y la firma se agregan solos: no los escribas en el texto.":
    "The greeting, the “Re:” line and the signature are added automatically: don't write them in the text.",
  "El texto dice que algo va adjunto fuera de la ficha «Frase de adjuntos». Una carta solo menciona lo que de verdad va en el sobre.":
    "The text says something is enclosed outside the “Enclosures sentence” chip. A letter only mentions what really goes in the envelope.",
  "No hay cambios respecto al texto en uso.": "Nothing changed from the text in use.",
  "No hay borrador: el texto en uso ya está aprobado.": "There's no draft: the text in use is already approved.",
  "Esta carta ya está con el abogado.": "This letter is already with the attorney.",
  "El abogado ya revisó la versión incluida. Para cambiarla, edita la carta.": "The attorney already reviewed the built-in version. To change it, edit the letter.",
  "La versión incluida cambió en el código después de la revisión. Edita la carta para enviar el texto nuevo.":
    "The built-in version changed in the code after the review. Edit the letter to send the new text.",
  "No encontramos esa versión.": "We couldn't find that version.",
  "Solo se registra la decisión de una versión que está con el abogado.": "A decision can only be recorded for a version that's with the attorney.",
  "Confirma que es la decisión del abogado.": "Confirm that this is the attorney's decision.",
  "Escribe el nombre completo del abogado.": "Enter the attorney's full name.",
  "Escribe la fecha en que decidió el abogado.": "Enter the date the attorney decided.",
  "La fecha de la decisión no puede ser futura.": "The decision date can't be in the future.",
  "La nota es muy larga: máximo 2,000 caracteres.": "The note is too long: 2,000 characters at most.",
  "Anota qué pidió cambiar el abogado.": "Write down what the attorney asked to change.",
  "El texto de esta versión ya no coincide con el que se envió. No se puede aprobar.": "This version's text no longer matches what was sent. It can't be approved.",
  "Solo se descarta un borrador. Lo enviado al abogado queda como registro.": "Only a draft can be discarded. What was sent to the attorney stays on record.",
  "No pudimos conectar. Intenta de nuevo.": "We couldn't connect. Try again.",
};

/** Messages with a name or a number in them. */
const PATTERNS_EN: ReadonlyArray<[RegExp, (...groups: string[]) => string]> = [
  [/^(.+) es la única persona administradora\. Nombra a otra antes de cambiar su rol\.$/, (name) => `${name} is the only administrator. Name another one before changing their role.`],
  [/^(.+) es la única persona administradora\. Nombra a otra antes de desactivarla\.$/, (name) => `${name} is the only administrator. Name another one before deactivating them.`],
  [/^(.+) está desactivada\.$/, (name) => `${name} is deactivated.`],
  [/^(.+) ya está en el equipo con ese (correo|teléfono)\.$/, (name, what) => `${name} is already on the team with that ${what === "correo" ? "email" : "phone number"}.`],
  [
    /^(.+) ya estuvo en el equipo con ese (correo|teléfono)\. Reactívala en lugar de agregarla de nuevo\.$/,
    (name, what) => `${name} was on the team before with that ${what === "correo" ? "email" : "phone number"}. Reactivate them instead of adding them again.`,
  ],
  [/^Ya hay un cliente con este teléfono: (.+)\.$/, (name) => `There's already a client with this phone number: ${name}.`],
  // The address book
  [/^La dirección no se puede leer: (.+)$/, (why) => `The address can't be read: ${staffMessage(why, "en")}`],
  [/^La dirección de (.+) no se puede leer: (.+)$/, (name, why) => `${name}'s address can't be read: ${staffMessage(why, "en")}`],
  [/^Una línea pasa de (\d+) caracteres, el máximo que acepta el servicio de correo\.$/, (n) => `A line is longer than ${n} characters, the most the mail service accepts.`],
  [/^«(.+)» ya corresponde a (.+)\.$/, (alias, name) => `“${alias}” already belongs to ${name}.`],
  [/^«(.+)» coincide con (\d+) empresas de la libreta \((.+)\)\. Deja ese nombre en una sola\.$/, (name, n, list) => `“${name}” matches ${n} companies in the address book (${list}). Keep that name on just one.`],
  [/^(.+) no está en la libreta de acreedores\. Falta su dirección para disputas\.$/, (name) => `${name} isn't in the creditor address book. Its dispute address is missing.`],
  [/^Falta la dirección para disputas de (.+)\.$/, (name) => `${name}'s dispute address is missing.`],
  [/^La dirección de (.+) no está verificada \(falta la fuente o la fecha\)\.$/, (name) => `${name}'s address isn't verified (the source or the date is missing).`],
  // The letter editor: a chip is named by its Spanish label in the message; the English one replaces it.
  [/^El asunto es muy largo: máximo (\d+) caracteres\.$/, (n) => `The subject is too long: ${n} characters at most.`],
  [/^La carta es muy larga: máximo ([\d,]+) caracteres\.$/, (n) => `The letter is too long: ${n} characters at most.`],
  [/^La ficha \{(.*)\} no existe\. Usa solo las fichas de la lista\.$/, (token) => `The chip {${token}} doesn't exist. Use only the chips on the list.`],
  [/^Esta carta no usa la ficha «(.+)» \(\{(.+)\}\): su versión incluida no la tiene\.$/, (label, key) => `This letter doesn't use the “${chipLabelEn(label)}” chip ({${key}}): its built-in version doesn't have it.`],
  [/^Falta la ficha «(.+)» \(\{(.+)\}\)\. Lo que el cliente declaró tiene que quedar en la carta\.$/, (label, key) => `The “${chipLabelEn(label)}” chip ({${key}}) is missing. What the client stated has to stay in the letter.`],
  [/^La ficha «(.+)» va una sola vez\.$/, (label) => `The “${chipLabelEn(label)}” chip goes in only once.`],
  [/^Promete o insinúa un resultado: «(.+)»\. Una carta pide; no promete ni asegura nada\.$/, (match) => `It promises or hints at a result: “${match}”. A letter asks; it doesn't promise or guarantee anything.`],
  [/^La carta es del cliente y va en su nombre: no menciona a (.+), a (.+) ni dice «on behalf of»\.$/, (brand, assistant) => `The letter is the client's and goes out in their name: it doesn't mention ${brand} or ${assistant}, or say “on behalf of”.`],
  [/^Se quitó una cita legal de la versión incluida: (.+)\.$/, (list) => `A legal citation from the built-in version was removed: ${list}.`],
  // The server's document hold (fulfillment/documents.ts documentHoldMessageEs)
  [
    /^No se envía: (?:un documento requerido no fue aceptado|dos documentos requeridos no fueron aceptados) en la revisión \((.+)\)\. La ronda sale cuando el cliente suba uno nuevo y el equipo lo acepte\.$/,
    (names) =>
      `Not sent: ${names.includes(" y ") ? "two required documents weren't" : "a required document wasn't"} accepted in review (${names
        .split(" y ")
        .map((n) => DOCUMENT_EN[n] ?? n)
        .join(" and ")}). The round goes out once the client uploads a new one and the team accepts it.`,
  ],
  // The send's summary when the server held some rounds (staff/data.ts markRoundsSent): each reason in English too.
  [
    /^(?:Se (?:envió (1) ronda|enviaron (\d+) rondas)\. )?(?:Una ronda no salió|(\d+) rondas no salieron): (.+)$/s,
    (one, many, heldCount, list) => {
      const sent = one ? "1 round sent. " : many ? `${many} rounds sent. ` : "";
      const held = heldCount ? `${heldCount} rounds didn't go out` : "One round didn't go out";
      const items = list
        .split(" · ")
        .map((part) => {
          const m = part.match(/^ronda (\d+) — (.+)$/s);
          return m ? `round ${m[1]} — ${staffMessage(m[2]!, "en")}` : staffMessage(part, "en");
        })
        .join(" · ");
      return `${sent}${held}: ${items}`;
    },
  ],
  [/^Esta ronda usa cartas que el abogado todavía no aprobó \((.+)\)\. Un administrador las aprueba en Cartas \(\/equipo\/cartas\) y después se envía la ronda\.$/, (list) => `This round uses letters the attorney hasn't approved yet (${list}). An administrator approves them in Letters (/equipo/cartas), then the round can be sent.`],
];

/** The required documents' names (fulfillment/documents.ts DOCUMENT_KIND_LABEL), Spanish → English. */
const DOCUMENT_EN: Record<string, string> = {
  "Identificación con foto": "Photo ID",
  "Comprobante de domicilio": "Proof of address",
};

/** A letter chip's English label from its Spanish one: the labels of letters/versions/source.ts (CHIPS, CHIP_TEXT_EN). */
const CHIP_LABEL_EN: Record<string, string> = {
  "Lista de partidas": "Item list",
  "Palabras del cliente": "Client's words",
  "Solo si no escribió nada": "Only if they wrote nothing",
  "Frase de adjuntos": "Enclosures sentence",
  "Nombre del cliente": "Client's name",
  Destinatario: "Recipient",
};

function chipLabelEn(label: string): string {
  return CHIP_LABEL_EN[label] ?? label;
}

/** A check's or a route's message in the member's language. */
export function staffMessage(text: string, locale: StaffLocale): string {
  if (locale === "es" || !text) return text;
  const exact = MESSAGE_EN[text];
  if (exact) return exact;
  for (const [pattern, build] of PATTERNS_EN) {
    const match = text.match(pattern);
    if (match) return build(...match.slice(1));
  }
  return text;
}
