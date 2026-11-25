import { BRAND } from "../brand";
import type { Audience, Bilingual, Channel, CharacterUse, ContentType, PieceCopy, Theme } from "./types";

// Reusable, pre-checked templates: a structure (the beats, in order) and
// example copy in English and Spanish that already passes every check in
// check.ts (a test runs each one through checkPiece and expects no issue at
// all, blocking or not). Starting a piece from a template copies the example;
// the team then changes the words and the checks run again on every edit.
//
// The facts are the website's (docs/WEBSITE.md, src/lib/site/copy.ts): the
// FCRA's right to dispute and the 30-day investigation (15 U.S.C. §1681i),
// 7 years for most late payments and collections (§1681c), weekly reports at
// AnnualCreditReport.com, and what the service does: the client says what is
// inaccurate, the team prepares and mails the letters. Never an outcome.

export interface ContentTemplate {
  id: string;
  title: Bilingual;
  /** One line: when to use it. */
  use: Bilingual;
  type: ContentType;
  theme: Theme;
  audience: Audience;
  channels: Channel[];
  characters: CharacterUse[];
  /** The beats, in order. */
  structure: Bilingual[];
  copy: PieceCopy;
}

const AI = `${BRAND.assistant} · ${BRAND.aiLabel.en}`;
const IA = `${BRAND.assistant} · ${BRAND.aiLabel.es}`;

export const CONTENT_TEMPLATES: readonly ContentTemplate[] = [
  {
    id: "myth-fact",
    title: { en: "Myth vs fact", es: "Mito o verdad" },
    use: { en: "Clear up one common belief about credit reports, in under 20 seconds.", es: "Aclara una creencia común sobre los reportes, en menos de 20 segundos." },
    type: "short_video",
    theme: "myths",
    audience: "consumers",
    channels: ["instagram", "tiktok", "facebook"],
    characters: [],
    structure: [
      { en: "Hook: say the myth out loud (on screen: MYTH).", es: "Gancho: di el mito en voz alta (en pantalla: MITO)." },
      { en: "The fact, in one plain sentence (on screen: FACT).", es: "La verdad, en una oración simple (en pantalla: VERDAD)." },
      { en: "What you can do about it.", es: "Lo que puedes hacer." },
      { en: "Call to action and \"Results vary.\"", es: "Llamada a la acción y \"Los resultados varían.\"" },
    ],
    copy: {
      hook: { en: "Myth: checking your own credit report hurts it.", es: "Mito: revisar tu propio reporte de crédito lo perjudica." },
      onScreen: { en: "MYTH · FACT · Your own check is a soft inquiry.", es: "MITO · VERDAD · Revisar tu reporte es una consulta suave." },
      script: {
        en: "Myth: checking your own credit report hurts it. Fact: looking at your own report is a soft inquiry. It doesn't count against you. You can see all three reports every week at AnnualCreditReport.com. If something looks wrong, you can dispute it.",
        es: "Mito: revisar tu propio reporte de crédito lo perjudica. Verdad: ver tu propio reporte es una consulta suave. No cuenta en tu contra. Puedes ver los tres reportes cada semana en AnnualCreditReport.com. Si algo se ve mal, lo puedes disputar.",
      },
      caption: {
        en: "Looking at your own report is a soft inquiry. See all three every week at AnnualCreditReport.com. If something is wrong, you tell us and our team prepares and mails the letters. Results vary.",
        es: "Ver tu propio reporte es una consulta suave. Mira los tres cada semana en AnnualCreditReport.com. Si algo está mal, tú nos dices y nuestro equipo prepara y envía las cartas. Los resultados varían.",
      },
      cta: { en: "Start my review", es: "Empezar mi revisión" },
    },
  },
  {
    id: "fcra-30s",
    title: { en: "Your rights under the FCRA in 30 seconds", es: "Tus derechos según la FCRA en 30 segundos" },
    use: { en: "One right, the law's name, and where to read more.", es: "Un derecho, el nombre de la ley y dónde leer más." },
    type: "short_video",
    theme: "rights",
    audience: "consumers",
    channels: ["instagram", "tiktok", "youtube", "facebook"],
    characters: [],
    structure: [
      { en: "Hook: \"You have a right most people don't use.\"", es: "Gancho: \"Tienes un derecho que casi nadie usa.\"" },
      { en: "The right, in plain words, with the law's name.", es: "El derecho, en palabras simples, con el nombre de la ley." },
      { en: "What happens after you dispute (the bureau investigates).", es: "Qué pasa después de disputar (el buró investiga)." },
      { en: "Where to learn more; \"Results vary.\"", es: "Dónde saber más; \"Los resultados varían.\"" },
    ],
    copy: {
      hook: { en: "You have a right most people never use.", es: "Tienes un derecho que casi nadie usa." },
      onScreen: { en: "The FCRA: you can dispute errors on your report.", es: "La FCRA: puedes disputar errores en tu reporte." },
      script: {
        en: "Under the Fair Credit Reporting Act, you can dispute information on your report that you believe is inaccurate. The bureau generally has 30 days to investigate. You can do it on your own, at no cost. Or our team can prepare and mail the letters for you.",
        es: "Según la Ley de Informe Justo de Crédito, la FCRA, puedes disputar la información de tu reporte que creas inexacta. El buró generalmente tiene 30 días para investigar. Lo puedes hacer por tu cuenta, sin costo. O nuestro equipo puede preparar y enviar las cartas por ti.",
      },
      caption: {
        en: "The FCRA lets you dispute what you believe is inaccurate, and the bureau generally has 30 days to look into it. You decide what is wrong. Results vary.",
        es: "La FCRA te permite disputar lo que creas inexacto, y el buró generalmente tiene 30 días para revisarlo. Tú decides qué está mal. Los resultados varían.",
      },
      cta: { en: "Learn your rights", es: "Conoce tus derechos" },
    },
  },
  {
    id: "dispute-letter",
    title: { en: "What a dispute letter is", es: "Qué es una carta de disputa" },
    use: { en: "Explain the letter itself: who it goes to and what it asks.", es: "Explica la carta: a quién va y qué pide." },
    type: "carousel",
    theme: "disputes",
    audience: "consumers",
    channels: ["instagram", "facebook"],
    characters: [],
    structure: [
      { en: "Slide 1: the question.", es: "Lámina 1: la pregunta." },
      { en: "Slide 2: who it goes to (the bureau, or the company that reported it).", es: "Lámina 2: a quién va (el buró o la empresa que lo reportó)." },
      { en: "Slide 3: what it asks (to check the item you marked).", es: "Lámina 3: qué pide (que revisen lo que marcaste)." },
      { en: "Slide 4: who decides what to dispute (you).", es: "Lámina 4: quién decide qué disputar (tú)." },
      { en: "Slide 5: call to action and \"Results vary.\"", es: "Lámina 5: llamada a la acción y \"Los resultados varían.\"" },
    ],
    copy: {
      hook: { en: "What is a dispute letter, really?", es: "¿Qué es, en realidad, una carta de disputa?" },
      onScreen: {
        en: "A letter to a credit bureau or a company. It asks them to check an item you say is inaccurate. You decide what goes in it.",
        es: "Una carta a un buró de crédito o a una empresa. Les pide revisar algo que tú dices que es inexacto. Tú decides qué lleva.",
      },
      script: { en: "", es: "" },
      caption: {
        en: "A dispute letter asks a bureau or a company to check information you believe is inaccurate. You tell us what is wrong; our team prepares and mails the letters and keeps you posted. Results vary.",
        es: "Una carta de disputa le pide a un buró o a una empresa revisar información que crees inexacta. Tú nos dices qué está mal; nuestro equipo prepara y envía las cartas y te mantiene al tanto. Los resultados varían.",
      },
      cta: { en: "Start my review", es: "Empezar mi revisión" },
    },
  },
  {
    id: "itin-spanish",
    title: { en: "ITIN and Spanish: your report too", es: "ITIN y español: tu reporte también" },
    use: { en: "For Hispanic consumers: you can check your report with an ITIN, in Spanish.", es: "Para consumidores hispanos: puedes revisar tu reporte con ITIN, en español." },
    type: "short_video",
    theme: "itin",
    audience: "hispanic",
    channels: ["instagram", "tiktok", "facebook", "whatsapp"],
    characters: [],
    structure: [
      { en: "Hook in Spanish first for this audience.", es: "Gancho en español primero para este público." },
      { en: "The fact: people with an ITIN can have a credit file.", es: "El dato: con ITIN también se puede tener historial." },
      { en: "We work in English or Spanish, the whole way.", es: "Trabajamos en inglés o en español, todo el camino." },
      { en: "Call to action and \"Results vary.\"", es: "Llamada a la acción y \"Los resultados varían.\"" },
    ],
    copy: {
      hook: { en: "Have an ITIN? You can have a credit report too.", es: "¿Tienes ITIN? También puedes tener reporte de crédito." },
      onScreen: { en: "ITIN · English or Spanish · You decide", es: "ITIN · Inglés o español · Tú decides" },
      script: {
        en: "Many people with an ITIN have a credit file and never look at it. It's worth checking. If something is wrong, you tell us what. Our team prepares and mails the letters, in English or Spanish.",
        es: "Mucha gente con ITIN tiene historial de crédito y nunca lo revisa. Vale la pena verlo. Si algo está mal, tú nos dices qué. Nuestro equipo prepara y envía las cartas, en inglés o en español.",
      },
      caption: {
        en: "With an ITIN you can have a credit report too. We work with you in English or Spanish. You decide what is inaccurate. Results vary.",
        es: "Con ITIN también puedes tener reporte de crédito. Te atendemos en inglés o en español. Tú decides qué es inexacto. Los resultados varían.",
      },
      cta: { en: "Start my review", es: "Empezar mi revisión" },
    },
  },
  {
    id: "partner-good-hands",
    title: { en: "Partner: your clients in good hands", es: "Socio: tus clientes en buenas manos" },
    use: { en: "For realtors and loan officers: what we do for the people they refer.", es: "Para agentes y oficiales de préstamo: lo que hacemos por quien refieren." },
    type: "partner",
    theme: "partners",
    audience: "partners",
    channels: ["partners", "email", "whatsapp"],
    characters: [],
    structure: [
      { en: "Headline for the partner.", es: "Titular para el socio." },
      { en: "What their client gets: a team, letters prepared and mailed, every step in the app.", es: "Lo que recibe su cliente: un equipo, cartas preparadas y enviadas, cada paso en la app." },
      { en: "What we never do (promise results, pressure).", es: "Lo que nunca hacemos (prometer resultados, presionar)." },
      { en: "Whether partners are paid; \"Results vary.\"", es: "Si a los socios se les paga; \"Los resultados varían.\"" },
    ],
    copy: {
      hook: { en: "Your clients, in good hands while they get ready.", es: "Tus clientes, en buenas manos mientras se preparan." },
      onScreen: { en: "Referred by you · Served in English or Spanish", es: "Referidos por ti · Atendidos en inglés o en español" },
      script: { en: "", es: "" },
      caption: {
        en: "When you refer a client, they tell us what is wrong on their report. Our team prepares and mails the letters and shows every step in the app. We never promise results, and nobody is pushed to sign. Results vary. The partner program pays no referral fees.",
        es: "Cuando nos refieres a un cliente, nos dice qué está mal en su reporte. Nuestro equipo prepara y envía las cartas y muestra cada paso en la app. Nunca prometemos resultados y a nadie se le presiona. Los resultados varían. El programa de socios no paga comisiones por referidos.",
      },
      cta: { en: "Refer a client", es: "Referir a un cliente" },
    },
  },
  {
    id: "aftercare-building",
    title: { en: "After the letters: building credit", es: "Después de las cartas: construir crédito" },
    use: { en: "General habits that help a credit file, with no promise attached.", es: "Hábitos generales que ayudan al historial, sin prometer nada." },
    type: "carousel",
    theme: "aftercare",
    audience: "consumers",
    channels: ["instagram", "facebook"],
    characters: [],
    structure: [
      { en: "Slide 1: \"After the letters, what then?\"", es: "Lámina 1: \"Después de las cartas, ¿qué sigue?\"" },
      { en: "Slides 2 to 4: one habit each (pay on time, keep balances low, open new accounts slowly).", es: "Láminas 2 a 4: un hábito cada una (pagar a tiempo, saldos bajos, abrir cuentas despacio)." },
      { en: "Slide 5: the app's build-your-credit plan; \"Results vary.\"", es: "Lámina 5: el plan para construir crédito de la app; \"Los resultados varían.\"" },
    ],
    copy: {
      hook: { en: "After the letters, what comes next?", es: "Después de las cartas, ¿qué sigue?" },
      onScreen: {
        en: "Pay on time. Keep balances low. Open new accounts slowly.",
        es: "Paga a tiempo. Mantén saldos bajos. Abre cuentas nuevas despacio.",
      },
      script: { en: "", es: "" },
      caption: {
        en: "Building credit takes time and steady habits. Your plan in the app shows the next step, at your pace. Lenders decide, and results vary.",
        es: "Construir crédito toma tiempo y hábitos constantes. Tu plan en la app te muestra el siguiente paso, a tu ritmo. Los prestamistas deciden y los resultados varían.",
      },
      cta: { en: "See my plan", es: "Ver mi plan" },
    },
  },
  {
    id: "meet-alti",
    title: { en: "Meet Alti, the AI assistant", es: "Conoce a Alti, el asistente con IA" },
    use: { en: "Introduce Alti, always labelled as AI, never as a person.", es: "Presenta a Alti, siempre como IA, nunca como persona." },
    type: "short_video",
    theme: "team",
    audience: "consumers",
    channels: ["instagram", "tiktok", "facebook"],
    characters: ["alti"],
    structure: [
      { en: `Alti waves (the waving loop) with the label "${AI}" on screen the whole time.`, es: `Alti saluda (el saludo animado) con la etiqueta "${IA}" en pantalla todo el tiempo.` },
      { en: "He says he is AI, not a person.", es: "Dice que es IA, no una persona." },
      { en: "What he does: explains your report in plain words.", es: "Lo que hace: explica tu reporte en palabras simples." },
      { en: "The team prepares and mails the letters; \"Results vary.\"", es: "El equipo prepara y envía las cartas; \"Los resultados varían.\"" },
    ],
    copy: {
      hook: { en: "Hi, I'm Alti. I'm an AI assistant, not a person.", es: "Hola, soy Alti. Soy un asistente con IA, no una persona." },
      onScreen: { en: AI, es: IA },
      script: {
        en: "Hi, I'm Alti, Credalti's AI assistant. I'm not a person. I explain your credit report in plain words, in English or Spanish. You tell us what is wrong, and our team prepares and mails the letters.",
        es: "Hola, soy Alti, el asistente con IA de Credalti. No soy una persona. Te explico tu reporte de crédito en palabras simples, en inglés o en español. Tú nos dices qué está mal y nuestro equipo prepara y envía las cartas.",
      },
      caption: {
        en: "Alti is Credalti's AI assistant: artificial intelligence, not a person. He explains your report; our team prepares and mails the letters. Results vary.",
        es: "Alti es el asistente con IA de Credalti: inteligencia artificial, no una persona. Te explica tu reporte; nuestro equipo prepara y envía las cartas. Los resultados varían.",
      },
      cta: { en: "Ask Alti", es: "Pregúntale a Alti" },
    },
  },
];

export function templateById(id: string | null | undefined): ContentTemplate | null {
  return CONTENT_TEMPLATES.find((t) => t.id === id) ?? null;
}
