// UI chrome dictionaries. Spanish is the source of truth; English mirrors it.
// Longer educational content (explainers, glossary, journey copy) lives beside
// its domain code and is selected by the same Locale type.

export type Locale = "es" | "en";

/** "1 carta" / "3 cartas": a count with the right singular or plural word. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const es = {
  nav: {
    assistant: "Asistente",
    more: "Más",
    home: "Inicio",
    audit: "Auditoría",
    review: "Revisar",
    attack: "Mis cartas",
    rounds: "Rondas",
    demo: "Demo",
  },
  audit: {
    title: "Auditoría de tu crédito",
    subtitle: (date: string) =>
      `Análisis automático de tu reporte de 3 burós importado el ${date}. Esto es lo que encontramos, en palabras simples.`,
    scores: "Tus puntajes hoy",
    scoreNote: "VantageScore 3.0 según tu servicio de monitoreo. Los resultados varían.",
    severityHigh: "🔴 Peso alto — revisa estos primero",
    severityHighNote:
      "Cobranzas, cargos dados de baja y registros públicos son lo que más pesa. Verifica cada dato: montos, fechas, duplicados.",
    severityMed: "🟡 Peso medio",
    severityMedNote: "Pagos tardíos y consultas duras. Revisa si las reconoces y si las fechas son correctas.",
    severityInfo: "🔵 Datos personales",
    severityInfoNote:
      "Variantes de nombre, direcciones y empleos viejos. Limpiarlos evita mezclas con expedientes ajenos — por eso la Ronda 1 empieza aquí.",
    matrix: "¿En qué burós aparece cada elemento?",
    matrixNote:
      "Un elemento que aparece en un buró y no en otro, o con datos distintos entre burós, es una señal clásica de posible inexactitud.",
    ctaNote: "Tú dices qué es inexacto. La auditoría solo te muestra dónde mirar.",
    print: "Imprimir / guardar PDF",
    clean: "✅ No encontramos elementos de peso alto en tu reporte. ¡Buena señal!",
  },
  scores: {
    title: "Tus puntajes",
    trend: (delta: number) => (delta >= 0 ? `+${delta} desde tu primer reporte` : `${delta} desde tu primer reporte`),
  },
  responses: {
    title: "¿Recibiste respuesta de los burós?",
    note: "Cuando llegue la carta de respuesta por correo, registra aquí qué pasó con cada elemento. Así tu siguiente ronda escala con la ley correcta.",
    deleted: "🎉 Eliminado",
    corrected: "✏️ Corregido",
    verified: "📄 Verificado",
    no_response: "⏳ Sin respuesta",
    verifiedHint:
      "¿Respondieron «verificado»? Tu siguiente carta exige el método de verificación (§611). Es el camino esperado — no te desanimes.",
    saved: "Registrado",
  },
  dashboard: {
    greeting: "Hola 👋",
    imported: (date: string) => `Reporte importado el ${date} · 3 burós`,
    items: (n: number) => count(n, "elemento", "elementos"),
    negatives: (n: number) => (n === 1 ? "1 posiblemente negativo" : `${n} posiblemente negativos`),
    goalTitle: "Tu meta: lista para hipoteca 🏡",
    goalNote:
      "El progreso refleja tu avance en el proceso (revisión y rondas), no un puntaje. Los resultados varían según cada caso.",
  },
  items: {
    title: "Revisa tu reporte",
    viewList: "Ver lista completa",
    viewWizard: "Volver a la guía",
    reviewed: (done: number, total: number) => `${done} de ${total} revisados`,
    remaining: (n: number) => (n === 1 ? "Último elemento" : `Quedan ${n} por revisar`),
    whatIsThis: "¿Qué es esto?",
    checkFirst: "Verifica antes de decidir:",
    looksCorrect: "✓ Se ve correcto",
    looksCorrectSub: "La información coincide con mi realidad. Siguiente.",
    looksWrong: "⚠️ Creo que es inexacto",
    looksWrongSub: "Algo no coincide, no lo reconozco o está desactualizado.",
    // The reason picker. Neutral on purpose: it asks, it does not recommend.
    reasonTitle: "¿Cuál es el motivo?",
    reasonHelp:
      "Elige la opción que describe lo que tú ves. Es tu propia declaración y se escribe en tu carta, en inglés.",
    reasonRequired: "Elige un motivo para continuar.",
    otherNeedsNote: "Con «Otro motivo», escribe con tus palabras cuál es.",
    identityTheftNote:
      "Para este motivo hace falta un reporte de robo de identidad de la FTC. Una persona del equipo te va a contactar para seguir con ese paso.",
    detailsLabel: "Añade detalles con tus palabras (opcional)",
    detailsLabelOther: "Describe el motivo con tus palabras",
    detailsPlaceholder: "Escribe aquí",
    detailsNote: "Lo que escribas aquí no va en la carta. Lo lee el equipo.",
    reasonOf: (label: string) => `Motivo: ${label}`,
    inLetter: "En la carta:",
    confirm: "Confirmar y seguir",
    back: "Volver",
    reportSays: "Lo que dice tu reporte:",
    attestationRequired:
      "La casilla de confirmación es necesaria: solo se disputan elementos que TÚ crees inexactos, no verificables o desactualizados.",
    doneNoItems:
      "No marcaste ningún elemento — si todo es correcto, ¡buena señal! Puedes cambiar cualquier decisión en la lista.",
    reviewAgain: "Revisar de nuevo",
    negativeBadge: "posiblemente negativo",
    attestedOn: (when: string) => `✍️ Confirmado el ${when}`,
    markedCorrect: "✓ Marcado como correcto",
    flaggedPending: "⚠️ Marcado — falta tu confirmación",
    afterMailedCard:
      "Las cartas de esta ronda ya salieron. Si cambias tu respuesta, el cambio cuenta desde tu siguiente ronda.",
    afterMailedList:
      "Las cartas de esta ronda ya salieron. Si vuelves a revisar un elemento y cambias tu respuesta, el cambio cuenta desde tu siguiente ronda.",
    afterMailedNoted:
      "Anotado. Las cartas de esta ronda ya salieron; si tu respuesta cambió, el cambio cuenta desde tu siguiente ronda.",
  },
  // The letters page. Under full service only the shared lines are shown (title,
  // empty state, what a letter covers, the notes inside a letter); the approval
  // lines are self-serve and the page shows the `team` section in their place.
  attack: {
    title: (n: number) => `Tu ronda de cartas #${n}`,
    /** `items` counts only the confirmed items that are inside these letters. */
    subtitle: (letters: number, items: number) =>
      `${letters === 1 ? "1 carta generada" : `${letters} cartas generadas`} con ${
        items === 1 ? "tu elemento confirmado" : `tus ${items} elementos confirmados`
      }. ${letters === 1 ? "Léela completa" : "Lee cada una"} — nada se envía hasta que tú apruebes.`,
    emptyTitle: "Aún no hay elementos en tu ronda de cartas",
    emptyBody:
      "Tu ronda de cartas se arma con los elementos que TÚ marcas y confirmas en la revisión guiada.",
    emptyFlagged: (n: number) =>
      n === 1
        ? " Tienes 1 elemento marcado al que le falta tu confirmación."
        : ` Tienes ${n} elementos marcados a los que les falta tu confirmación.`,
    goToReview: "Ir a la revisión guiada →",
    readLetter: "▼ Leer carta",
    inPlainWords: "En palabras simples:",
    covers: "Incluye:",
    placeholderNote:
      "El nombre y la dirección que ves en esta vista son de ejemplo. En tu carta van tu nombre y tu dirección.",
    letterFootnote:
      "La carta se envía en inglés (idioma operativo de los burós). Al enviarse, la redacción varía ligeramente para que tu carta sea única.",
    itemCount: (n: number) => count(n, "elemento", "elementos"),
    fileRequest: "solicitud de expediente",
    approveNote:
      "Al presionar el botón confirmas que leíste tus cartas y que tú decides enviarlas. Cada elemento incluido lleva tu confirmación registrada con fecha y hora.",
    approveButton: (n: number) => `Aprobar y enviar ${n === 1 ? "mi carta" : `mis ${n} cartas`} 🚀`,
    approvedTitle: "¡Tus cartas van en camino!",
    approvedBody:
      "(Demo) En producción: tus cartas se imprimen y envían por correo certificado, y te avisamos por WhatsApp. Los burós tienen ~30 días para responder.",
    trackRound: "Seguir mi ronda →",
    resetDemo: "Reiniciar demo",
  },
  // The rounds page, self-serve wording. Full service reads the `team` section.
  rounds: {
    title: "Tus rondas",
    subtitle: (resp: number, next: number) =>
      `Cada ronda: tú envías → los burós responden (~${resp} días) → tu reporte se actualiza y comparamos (~día ${next}) → armas la siguiente.`,
    inProgress: "En curso",
    mailed: (date: string) => `📬 Enviado ${date}`,
    responseBy: (date: string) => `⏳ Respuesta ~${date}`,
    nextRound: (n: number, date: string) => `🔁 Ronda ${n} ~${date}`,
    waitDays: (n: number) =>
      `Los burós tienen ~${count(n, "día", "días")} más para responder. No necesitas hacer nada — te avisamos por WhatsApp.`,
    lettersSent: (n: number) => (n === 1 ? "La carta que enviaste" : `Las ${n} cartas que enviaste`),
    waitingTitle: "En espera para tu siguiente ronda",
    emptyTitle: "Todavía no has enviado cartas",
    emptyBody:
      "Cuando apruebes tus cartas, aquí verás cuándo salieron, cuándo se espera la respuesta de los burós y cuándo toca la siguiente ronda.",
  },
  // Full service (src/lib/service/mode.ts): the letters and rounds pages as the
  // client reads them when the team prepares and mails the letters. The client
  // approves and sends nothing here; the pages show the work and how it stands.
  // The `attack` and `rounds` sections above keep the self-serve wording.
  team: {
    lettersLead: "Esto es lo que tu equipo envía por ti.",
    /** `items` counts only the confirmed items that are inside these letters. */
    lettersSubtitle: (letters: number, items: number) =>
      `${count(letters, "carta", "cartas")} con ${
        items === 1 ? "el elemento que tú confirmaste" : `los ${items} elementos que tú confirmaste`
      }. Nuestro equipo las prepara y las envía por correo. Tú no tienes que aprobar ni enviar nada.`,
    statusPreparing: "En preparación",
    statusMailed: (date: string) => `Enviada el ${date}`,
    statusWaiting: "Esperando respuesta",
    preparingTitle: "Tu equipo está preparando tus cartas",
    preparingBody:
      "Terminaste tu revisión. Con tus respuestas, nuestro equipo prepara las cartas y las envía por correo. Cuando salgan, lo verás aquí.",
    mailedTitle: "Tus cartas ya salieron",
    mailedBody: (date: string) =>
      `Tu equipo las envió por correo el ${date}. Los burós tienen unos 30 días para responder. No tienes que hacer nada.`,
    changeNote:
      "Las cartas dicen lo que tú nos dijiste. Si algo no está bien, cambia tu respuesta en la revisión o escríbele a tu equipo.",
    reviewFirstTitle: "Primero termina tu revisión",
    reviewFirstBody:
      "Cuando termines de revisar tu reporte y nos digas qué está mal, nuestro equipo prepara las cartas y las envía por ti. Aquí vas a poder leerlas y ver cómo van.",
    continueReview: "Seguir con mi revisión →",
    readLetters: (n: number): string => (n === 1 ? "Leer la carta completa" : "Leer cada carta completa"),
    trackRound: "Ver cómo va mi ronda →",
    roundsSubtitle: (resp: number, next: number) =>
      `Cada ronda: tu equipo envía las cartas → los burós responden (~${resp} días) → revisamos tu reporte de nuevo y te mostramos qué cambió (~día ${next}) → tu equipo prepara la siguiente.`,
    roundPreparingBody:
      "Tu equipo está preparando las cartas de esta ronda. Cuando salgan por correo, aquí verás la fecha, cuándo se espera la respuesta de los burós y cuándo toca la siguiente ronda.",
    lettersInRound: (n: number) => (n === 1 ? "La carta de esta ronda" : `Las ${n} cartas de esta ronda`),
    waitDays: (n: number) =>
      `Los burós tienen ~${count(n, "día", "días")} más para responder. No necesitas hacer nada: tu equipo te avisa.`,
    responseNote:
      "Los burós responden por correo a tu dirección. Si te llega una carta, guárdala y avísale a tu equipo.",
    roundsEmptyTitle: "Todavía no hay cartas enviadas",
    roundsEmptyBody:
      "Cuando tu equipo envíe tus cartas, aquí verás cuándo salieron, cuándo se espera la respuesta de los burós y cuándo toca la siguiente ronda.",
  },
};

export type Dict = typeof es;

const en: Dict = {
  nav: {
    assistant: "Assistant",
    more: "More",
    home: "Home",
    audit: "Audit",
    review: "Review",
    attack: "My letters",
    rounds: "Rounds",
    demo: "Demo",
  },
  audit: {
    title: "Your credit audit",
    subtitle: (date: string) =>
      `Automatic analysis of your 3-bureau report imported on ${date}. Here's what we found, in plain words.`,
    scores: "Your scores today",
    scoreNote: "VantageScore 3.0 per your monitoring service. Results vary.",
    severityHigh: "🔴 High weight — review these first",
    severityHighNote:
      "Collections, charge-offs, and public records weigh the most. Verify every detail: amounts, dates, duplicates.",
    severityMed: "🟡 Medium weight",
    severityMedNote: "Late payments and hard inquiries. Check whether you recognize them and whether dates are right.",
    severityInfo: "🔵 Personal info",
    severityInfoNote:
      "Name variants, old addresses, and employers. Cleaning these prevents mix-ups with other people's files — that's why Round 1 starts here.",
    matrix: "Which bureaus show each item?",
    matrixNote:
      "An item that appears on one bureau but not another, or with different details across bureaus, is a classic sign of possible inaccuracy.",
    ctaNote: "You say what is inaccurate. The audit only shows you where to look.",
    print: "Print / save PDF",
    clean: "✅ We found no high-weight items on your report. Good sign!",
  },
  scores: {
    title: "Your scores",
    trend: (delta: number) => (delta >= 0 ? `+${delta} since your first report` : `${delta} since your first report`),
  },
  responses: {
    title: "Did the bureaus respond?",
    note: "When the response letter arrives in the mail, log what happened to each item here. That way your next round escalates with the right law.",
    deleted: "🎉 Deleted",
    corrected: "✏️ Corrected",
    verified: "📄 Verified",
    no_response: "⏳ No response",
    verifiedHint:
      "They answered “verified”? Your next letter demands the method of verification (§611). It's the expected path — don't be discouraged.",
    saved: "Logged",
  },
  dashboard: {
    greeting: "Hi 👋",
    imported: (date: string) => `Report imported on ${date} · 3 bureaus`,
    items: (n: number) => count(n, "item", "items"),
    negatives: (n: number) => `${n} possibly negative`,
    goalTitle: "Your goal: mortgage-ready 🏡",
    goalNote:
      "Progress reflects how far you are in the process (review and rounds), not a score. Results vary case by case.",
  },
  items: {
    title: "Review your report",
    viewList: "View full list",
    viewWizard: "Back to guided review",
    reviewed: (done: number, total: number) => `${done} of ${total} reviewed`,
    remaining: (n: number) => (n === 1 ? "Last item" : `${n} left to review`),
    whatIsThis: "What is this?",
    checkFirst: "Check before you decide:",
    looksCorrect: "✓ Looks correct",
    looksCorrectSub: "The information matches my reality. Next.",
    looksWrong: "⚠️ I believe it's inaccurate",
    looksWrongSub: "Something doesn't match, I don't recognize it, or it's outdated.",
    reasonTitle: "What is the reason?",
    reasonHelp:
      "Choose the option that describes what you see. It is your own statement and it is written in your letter, in English.",
    reasonRequired: "Choose a reason to continue.",
    otherNeedsNote: "With “Another reason”, write in your own words what it is.",
    identityTheftNote:
      "This reason requires an identity theft report from the FTC. A person from the team will contact you to follow up on that step.",
    detailsLabel: "Add details in your own words (optional)",
    detailsLabelOther: "Describe the reason in your own words",
    detailsPlaceholder: "Write here",
    detailsNote: "What you write here does not go in the letter. The team reads it.",
    reasonOf: (label: string) => `Reason: ${label}`,
    inLetter: "In the letter:",
    confirm: "Confirm and continue",
    back: "Back",
    reportSays: "What your report says:",
    attestationRequired:
      "The confirmation checkbox is required: you only dispute items YOU believe are inaccurate, unverifiable, or outdated.",
    doneNoItems:
      "You didn't flag anything — if everything is accurate, that's good news! You can change any decision in the list.",
    reviewAgain: "Review again",
    negativeBadge: "possibly negative",
    attestedOn: (when: string) => `✍️ Confirmed on ${when}`,
    markedCorrect: "✓ Marked as correct",
    flaggedPending: "⚠️ Flagged — confirmation pending",
    afterMailedCard:
      "This round's letters have already gone out. If you change your answer, the change applies from your next round.",
    afterMailedList:
      "This round's letters have already gone out. If you review an item again and change your answer, the change applies from your next round.",
    afterMailedNoted:
      "Noted. This round's letters have already gone out; if your answer changed, the change applies from your next round.",
  },
  attack: {
    title: (n: number) => `Your round of letters #${n}`,
    subtitle: (letters: number, items: number) =>
      `${count(letters, "letter", "letters")} generated from ${
        items === 1 ? "your confirmed item" : `your ${items} confirmed items`
      }. ${letters === 1 ? "Read it in full" : "Read each one"} — nothing is sent until you approve.`,
    emptyTitle: "No items in your round of letters yet",
    emptyBody: "Your round of letters is built from the items YOU flag and confirm in the guided review.",
    emptyFlagged: (n: number) =>
      n === 1
        ? " You have 1 flagged item still missing your confirmation."
        : ` You have ${n} flagged items still missing your confirmation.`,
    goToReview: "Go to guided review →",
    readLetter: "▼ Read letter",
    inPlainWords: "In plain words:",
    covers: "Covers:",
    placeholderNote:
      "The name and address in this preview are placeholders. Your letter carries your own name and address.",
    letterFootnote:
      "Letters mail in English (the bureaus' operating language). On send, the wording varies slightly so your letter is unique.",
    itemCount: (n: number) => count(n, "item", "items"),
    fileRequest: "file disclosure request",
    approveNote:
      "Pressing the button confirms you read your letters and that you decide to send them. Every included item carries your date-and-time-stamped confirmation.",
    approveButton: (n: number) => `Approve and send ${n === 1 ? "my letter" : `my ${n} letters`} 🚀`,
    approvedTitle: "Your letters are on their way!",
    approvedBody:
      "(Demo) In production: your letters are printed and mailed, and we notify you on WhatsApp. Bureaus have ~30 days to respond.",
    trackRound: "Track my round →",
    resetDemo: "Reset demo",
  },
  rounds: {
    title: "Your rounds",
    subtitle: (resp: number, next: number) =>
      `Each round: you send → bureaus respond (~${resp} days) → your report refreshes and we compare (~day ${next}) → you build the next one.`,
    inProgress: "In progress",
    mailed: (date: string) => `📬 Mailed ${date}`,
    responseBy: (date: string) => `⏳ Response ~${date}`,
    nextRound: (n: number, date: string) => `🔁 Round ${n} ~${date}`,
    waitDays: (n: number) =>
      `Bureaus have ~${n} more ${n === 1 ? "day" : "days"} to respond. Nothing to do — we'll message you on WhatsApp.`,
    lettersSent: (n: number) => (n === 1 ? "The letter you sent" : `The ${n} letters you sent`),
    waitingTitle: "Waiting for your next round",
    emptyTitle: "You haven't sent any letters yet",
    emptyBody:
      "Once you approve your letters, this is where you'll see when they went out, when the bureaus' response is expected, and when the next round is due.",
  },
  team: {
    lettersLead: "This is what your team mails for you.",
    lettersSubtitle: (letters: number, items: number) =>
      `${count(letters, "letter", "letters")} with ${
        items === 1 ? "the item you confirmed" : `the ${items} items you confirmed`
      }. Our team prepares them and mails them. You do not have to approve or send anything.`,
    statusPreparing: "Being prepared",
    statusMailed: (date: string) => `Mailed on ${date}`,
    statusWaiting: "Waiting for a response",
    preparingTitle: "Your team is preparing your letters",
    preparingBody:
      "You finished your review. From your answers, our team prepares the letters and mails them. When they go out, you will see it here.",
    mailedTitle: "Your letters have gone out",
    mailedBody: (date: string) =>
      `Your team mailed them on ${date}. The bureaus have about 30 days to respond. There is nothing you need to do.`,
    changeNote:
      "The letters say what you told us. If something is not right, change your answer in the review or message your team.",
    reviewFirstTitle: "Finish your review first",
    reviewFirstBody:
      "Once you finish reviewing your report and tell us what is wrong, our team prepares the letters and mails them for you. This is where you will be able to read them and see how they are going.",
    continueReview: "Continue my review →",
    readLetters: (n: number) => (n === 1 ? "Read the full letter" : "Read each full letter"),
    trackRound: "See how my round is going →",
    roundsSubtitle: (resp: number, next: number) =>
      `Each round: your team mails the letters → bureaus respond (~${resp} days) → we look at your report again and show you what changed (~day ${next}) → your team prepares the next one.`,
    roundPreparingBody:
      "Your team is preparing this round's letters. Once they are mailed, this is where you will see the date, when the bureaus' response is expected, and when the next round is due.",
    lettersInRound: (n: number) => (n === 1 ? "This round's letter" : `This round's ${n} letters`),
    waitDays: (n: number) =>
      `Bureaus have ~${n} more ${n === 1 ? "day" : "days"} to respond. Nothing to do: your team will let you know.`,
    responseNote:
      "The bureaus respond by mail to your address. If a letter arrives, keep it and let your team know.",
    roundsEmptyTitle: "No letters have been mailed yet",
    roundsEmptyBody:
      "Once your team mails your letters, this is where you'll see when they went out, when the bureaus' response is expected, and when the next round is due.",
  },
};

export const DICTS: Record<Locale, Dict> = { es, en };
