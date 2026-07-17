// UI chrome dictionaries. Spanish is the source of truth; English mirrors it.
// Longer educational content (explainers, glossary, journey copy) lives beside
// its domain code and is selected by the same Locale type.

export type Locale = "es" | "en";

const es = {
  nav: {
    home: "Inicio",
    review: "Revisar",
    attack: "Mi ataque",
    rounds: "Rondas",
    demo: "Demo",
  },
  dashboard: {
    greeting: "Hola 👋",
    imported: (date: string) => `Reporte importado el ${date} · 3 burós`,
    items: (n: number) => `${n} elementos`,
    negatives: (n: number) => `${n} posiblemente negativos`,
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
    reasonLabel: "¿Qué crees que está mal? (opcional, te ayuda a llevar registro)",
    reasonPlaceholder: "Ej.: no reconozco esta cuenta / el saldo no coincide",
    confirm: "Confirmar y seguir",
    back: "Volver",
    attestationRequired:
      "La casilla de atestiguación es necesaria: solo se disputan elementos que TÚ crees inexactos, no verificables o desactualizados.",
    doneTitle: "¡Revisaste todo!",
    doneWithItems: (n: number) =>
      `Marcaste y atestiguaste ${n} elemento(s). Tu ataque está listo para que lo revises.`,
    doneNoItems:
      "No marcaste ningún elemento — si todo es correcto, ¡buena señal! Puedes cambiar cualquier decisión en la lista.",
    goToAttack: "Revisar mi ataque →",
    reviewAgain: "Revisar de nuevo",
    negativeBadge: "posiblemente negativo",
    attestedOn: (when: string) => `✍️ Atestiguado el ${when}`,
    markedCorrect: "✓ Marcado como correcto",
    flaggedPending: "⚠️ Marcado — falta tu atestiguación",
  },
  attack: {
    title: (n: number) => `Tu ataque #${n}`,
    subtitle: (letters: number, items: number) =>
      `${letters} carta(s) generadas con tus ${items} elemento(s) atestiguados. Lee cada una — nada se envía hasta que tú apruebes.`,
    emptyTitle: "Aún no hay elementos en tu ataque",
    emptyBody:
      "Tu ataque se arma con los elementos que TÚ marcas y atestiguas en la revisión guiada.",
    emptyFlagged: (n: number) =>
      ` Tienes ${n} elemento(s) marcados a los que les falta la atestiguación.`,
    goToReview: "Ir a la revisión guiada →",
    readLetter: "▼ Leer carta",
    inPlainWords: "En palabras simples:",
    letterFootnote:
      "La carta se envía en inglés (idioma operativo de los burós). Al enviarse, la redacción varía ligeramente para que tu carta sea única.",
    itemCount: (n: number) => `${n} elemento(s)`,
    fileRequest: "solicitud de expediente",
    approveNote:
      "Al presionar el botón confirmas que leíste tus cartas y que tú decides enviarlas. Cada elemento incluido lleva tu atestiguación registrada con fecha y hora.",
    approveButton: (n: number) => `Aprobar y enviar mi ataque (${n} cartas) 🚀`,
    approvedTitle: "¡Tu ataque va en camino!",
    approvedBody:
      "(Demo) En producción: tus cartas se imprimen y envían por correo certificado, y te avisamos por WhatsApp. Los burós tienen ~30 días para responder.",
    trackRound: "Seguir mi ronda →",
    resetDemo: "Reiniciar demo",
  },
  rounds: {
    title: "Tus rondas",
    subtitle: (resp: number, next: number) =>
      `Cada ronda: tú envías → los burós responden (~${resp} días) → tu reporte se actualiza y comparamos (~día ${next}) → armas la siguiente.`,
    inProgress: "En curso",
    completed: "Completada",
    mailed: (date: string) => `📬 Enviado ${date}`,
    responseBy: (date: string) => `⏳ Respuesta ~${date}`,
    nextRound: (n: number, date: string) => `🔁 Ronda ${n} ~${date}`,
    waitDays: (n: number) =>
      `Los burós tienen ~${n} día(s) más para responder. No necesitas hacer nada — te avisamos por WhatsApp.`,
    windowClosed:
      "La ventana de respuesta cerró. Tu reporte se re-importa pronto para comparar qué cambió.",
  },
};

export type Dict = typeof es;

const en: Dict = {
  nav: {
    home: "Home",
    review: "Review",
    attack: "My attack",
    rounds: "Rounds",
    demo: "Demo",
  },
  dashboard: {
    greeting: "Hi 👋",
    imported: (date: string) => `Report imported on ${date} · 3 bureaus`,
    items: (n: number) => `${n} items`,
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
    reasonLabel: "What do you think is wrong? (optional — helps you keep a record)",
    reasonPlaceholder: "E.g.: I don't recognize this account / the balance doesn't match",
    confirm: "Confirm and continue",
    back: "Back",
    attestationRequired:
      "The attestation checkbox is required: you only dispute items YOU believe are inaccurate, unverifiable, or outdated.",
    doneTitle: "You reviewed everything!",
    doneWithItems: (n: number) =>
      `You flagged and attested ${n} item(s). Your attack is ready for your review.`,
    doneNoItems:
      "You didn't flag anything — if everything is accurate, that's good news! You can change any decision in the list.",
    goToAttack: "Review my attack →",
    reviewAgain: "Review again",
    negativeBadge: "possibly negative",
    attestedOn: (when: string) => `✍️ Attested on ${when}`,
    markedCorrect: "✓ Marked as correct",
    flaggedPending: "⚠️ Flagged — attestation pending",
  },
  attack: {
    title: (n: number) => `Your attack #${n}`,
    subtitle: (letters: number, items: number) =>
      `${letters} letter(s) generated from your ${items} attested item(s). Read each one — nothing is sent until you approve.`,
    emptyTitle: "No items in your attack yet",
    emptyBody: "Your attack is built from the items YOU flag and attest in the guided review.",
    emptyFlagged: (n: number) => ` You have ${n} flagged item(s) still missing your attestation.`,
    goToReview: "Go to guided review →",
    readLetter: "▼ Read letter",
    inPlainWords: "In plain words:",
    letterFootnote:
      "Letters mail in English (the bureaus' operating language). On send, the wording varies slightly so your letter is unique.",
    itemCount: (n: number) => `${n} item(s)`,
    fileRequest: "file disclosure request",
    approveNote:
      "Pressing the button confirms you read your letters and that you decide to send them. Every included item carries your date-and-time-stamped attestation.",
    approveButton: (n: number) => `Approve and send my attack (${n} letters) 🚀`,
    approvedTitle: "Your attack is on its way!",
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
    completed: "Completed",
    mailed: (date: string) => `📬 Mailed ${date}`,
    responseBy: (date: string) => `⏳ Response ~${date}`,
    nextRound: (n: number, date: string) => `🔁 Round ${n} ~${date}`,
    waitDays: (n: number) =>
      `Bureaus have ~${n} more day(s) to respond. Nothing to do — we'll message you on WhatsApp.`,
    windowClosed:
      "The response window closed. Your report re-imports soon so we can compare what changed.",
  },
};

export const DICTS: Record<Locale, Dict> = { es, en };
