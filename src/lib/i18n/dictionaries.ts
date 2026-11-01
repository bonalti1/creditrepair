// UI chrome dictionaries. Spanish is the source of truth; English mirrors it.
// Longer educational content (explainers, glossary, journey copy) lives beside
// its domain code and is selected by the same Locale type.

export type Locale = "es" | "en";

const es = {
  nav: {
    home: "Inicio",
    audit: "Auditoría",
    review: "Revisar",
    attack: "Mi ataque",
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
      "Variantes de nombre, direcciones y empleos viejos. Limpiarlos evita mezclas con expedientes ajenos — por eso el Ataque 1 empieza aquí.",
    matrix: "¿En qué burós aparece cada elemento?",
    matrixNote:
      "Un elemento que aparece en un buró y no en otro, o con datos distintos entre burós, es una señal clásica de posible inexactitud.",
    cta: "Empezar mi revisión guiada →",
    ctaNote: "Tú decides qué disputar. La auditoría solo te muestra dónde mirar.",
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
    verified: "📄 «Verificado»",
    no_response: "⏳ Sin respuesta",
    verifiedHint:
      "¿Respondieron «verificado»? Tu siguiente carta exige el método de verificación (§611). Es el camino esperado — no te desanimes.",
    saved: "Registrado",
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
    audit: "Audit",
    review: "Review",
    attack: "My attack",
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
      "Name variants, old addresses, and employers. Cleaning these prevents mix-ups with other people's files — that's why Attack 1 starts here.",
    matrix: "Which bureaus show each item?",
    matrixNote:
      "An item that appears on one bureau but not another, or with different details across bureaus, is a classic sign of possible inaccuracy.",
    cta: "Start my guided review →",
    ctaNote: "You decide what to dispute. The audit just shows you where to look.",
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
    verified: "📄 “Verified”",
    no_response: "⏳ No response",
    verifiedHint:
      "They answered “verified”? Your next letter demands the method of verification (§611). It's the expected path — don't be discouraged.",
    saved: "Logged",
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
