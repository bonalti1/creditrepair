import { BRAND } from "../brand";
import { AFFILIATE_DISCLOSURE, MONITORING_OFFER, monitoringName } from "../monitoring/offer";
import type { Locale } from "./dictionaries";

// Copy for the pages a visitor sees before the app: the landing page, the
// /empezar funnel page and onboarding. English first, Spanish if needed
// (src/lib/i18n/detect.ts): a visitor sees English unless their browser
// prefers Spanish or they chose it. The two say the same thing: the same
// claims, the same disclaimers and the same commission disclosure, with
// nothing added in either. Every string, in both languages, is run through the
// advertising claim rules and the plain-language check in the test suite.
//
// What the pages describe is full service: the client says what is wrong on
// their report, and the team prepares and mails the letters. Sales comes first,
// so the main button leads to a conversation with the team. Two things these
// pages never do: promise a result, and say what the service costs. The fee is
// not written here; the team explains the plan and the agreement carries it.
// The one price shown is the monitoring provider's, on the onboarding step
// where the client is about to subscribe to it.

/** The monitoring provider's price, shown only on the onboarding step that offers it. */
const price = MONITORING_OFFER.priceLabel;
const brand = BRAND.name;
const assistant = BRAND.assistant;

export interface MarketingCopy {
  landing: {
    signIn: string;
    assistantHello: string;
    /** Name tags under the two characters in the hero. */
    assistantTag: string;
    teamTag: string;
    headline: string;
    headlineAccent: string;
    lead: string;
    /** The main button when there is a WhatsApp number to write to. */
    talk: string;
    /** The main button when there is none (the demo): it leads to onboarding. */
    start: string;
    whatsappText: string;
    demo: string;
    cards: Array<[title: string, body: string]>;
    footer: string;
  };
  empezar: {
    headline: string;
    headlineAccent: string;
    leadBefore: string;
    leadStrong: string;
    leadAfter: string;
    ctaWhatsapp: string;
    ctaStart: string;
    whatsappText: string;
    underCta: string;
    step: (n: number) => string;
    /** Name tags beside the characters next to steps 2 and 3. */
    assistantTag: string;
    teamTag: string;
    steps: Array<{ title: string; body: string; alt: string }>;
    communityTitle: string;
    community: Array<[title: string, body: string]>;
    faqTitle: string;
    faq: Array<[question: string, answer: string]>;
    footer: string;
    more: string;
  };
  onboarding: {
    stepOf: (index: number, total: number) => string;
    hello: (name: string | null) => string;
    /** Beside the team character on the welcome screen. */
    teamTag: string;
    sentBy: (refName: string | null) => string;
    yourGoal: string;
    yourState: string;
    welcomeNote: string;
    yesStart: string;
    changeAnswers: string;
    goalTitle: string;
    goalSub: string;
    next: string;
    stateTitle: string;
    stateSub: string;
    stateLabel: string;
    notYetTitle: string;
    notYetBody: string;
    emailPlaceholder: string;
    emailLabel: string;
    notifyMe: string;
    monitoringTitle: string;
    monitoringSub: string;
    monitoringRows: (providerName: string | null) => Array<[label: string, value: string]>;
    disclosure: string;
    itinQuestion: string;
    itinLink: string;
    itinWhatsappText: string;
    activate: string;
    haveIt: string;
    demoReport: string;
    assistTitle: string;
    assistSub: string;
    withAssistant: string;
    withAssistantSub: string;
    withPerson: string;
    withPersonSub: string;
    assistNote: string;
    assistWhatsappText: string;
    waitlistDone: string;
    waitlistDoneSub: string;
    backHome: string;
  };
}

const es: MarketingCopy = {
  landing: {
    signIn: "Entrar",
    assistantHello: `Hola, soy ${assistant}, tu asistente con IA`,
    assistantTag: `${assistant} · IA`,
    teamTag: `Tu equipo ${brand}`,
    headline: "Tu crédito,",
    headlineAccent: "con un equipo a tu lado.",
    lead: "Tú nos dices qué está mal en tu reporte. Nuestro equipo prepara y envía las cartas por ti y te mantiene al tanto.",
    talk: "Habla con nuestro equipo",
    start: "Empezar",
    whatsappText: `¡Hola! Quiero saber cómo funciona ${brand}.`,
    demo: "Ver la demo",
    cards: [
      [
        "Tú dices qué está mal",
        `Revisas tu reporte punto por punto con ${assistant}, tu asistente con IA. Solo se disputa lo que tú nos dices que es inexacto.`,
      ],
      [
        "Nosotros enviamos las cartas",
        "Nuestro equipo prepara las cartas, las envía por correo y te avisa cómo va cada ronda.",
      ],
      [
        "En inglés o en español, y por escrito",
        "La app y nuestro equipo te atienden en inglés o en español, como prefieras. Antes de que firmes, el equipo te explica el plan.",
      ],
    ],
    footer: `${brand} es una empresa de servicios de crédito. Tú decides qué es inexacto en tu reporte; nuestro equipo prepara y envía las cartas por ti. No garantizamos resultados: los burós de crédito deciden, y los resultados varían según cada caso. ${assistant} es un asistente de inteligencia artificial. Disponible en Texas. Esto no es asesoría legal.`,
  },
  empezar: {
    headline: "Tú nos dices qué está mal.",
    headlineAccent: "Nosotros enviamos las cartas.",
    leadBefore: `Revisas tu reporte de crédito con ${assistant}, tu asistente con IA, y nos dices qué es inexacto y por qué.`,
    leadStrong: "Nuestro equipo prepara y envía las cartas por ti",
    leadAfter: "y te mantiene al tanto en cada ronda. Los resultados varían: los burós deciden.",
    ctaWhatsapp: "Habla con nuestro equipo por WhatsApp →",
    ctaStart: "Empezar →",
    whatsappText: `¡Hola! Quiero saber cómo funciona ${brand}.`,
    underCta: "Primero hablas con una persona · Te explicamos el plan antes de firmar · 3 días hábiles para cancelar sin costo",
    step: (n) => `Paso ${n}`,
    assistantTag: `${assistant}, tu asistente con IA`,
    teamTag: `Tu equipo ${brand}`,
    steps: [
      {
        title: "Habla con nuestro equipo",
        body: "Escríbenos por WhatsApp. Una persona te explica cómo trabajamos y el plan, y responde tus dudas. Si decides empezar, te manda tu enlace para entrar a la app y firmas tu acuerdo de servicio.",
        alt: `La bienvenida de ${brand} cuando el equipo te manda tu enlace`,
      },
      {
        title: "Revisa tu reporte y dinos qué está mal",
        body: `Conectas ${monitoringName("es")} y subes tu identificación y un comprobante de domicilio. ${assistant} te explica cada cuenta, cobranza o consulta en palabras simples. Tú marcas solo lo que crees inexacto, no verificable o desactualizado, y dices por qué. Esas respuestas son tuyas: nadie las decide por ti.`,
        alt: "Revisión guiada de un elemento del reporte",
      },
      {
        title: "Nuestro equipo prepara y envía las cartas",
        body: "Con lo que tú nos dijiste, el equipo prepara las cartas de disputa y las envía por correo. En la app ves cada carta, explicada, y cómo va. Más o menos cada 40 días revisamos tu reporte de nuevo y te mostramos qué cambió.",
        alt: "Las cartas de tu ronda y su estado",
      },
    ],
    communityTitle: "Hecho para nuestra comunidad",
    community: [
      [
        `Un equipo de personas, y ${assistant}`,
        `Hablas con una persona desde el primer día. En la app, ${assistant}, tu asistente con IA, te explica tu reporte paso a paso.`,
      ],
      [
        "Tú decides, punto por punto",
        "Solo se disputa lo que tú nos dices que es inexacto. Nadie marca nada por ti ni te dice qué marcar.",
      ],
      [
        "En tu idioma",
        "En inglés o en español: la app, las explicaciones y el equipo. Cambias de idioma con un toque, cuando quieras.",
      ],
      [
        "Sin promesas",
        "Nadie puede prometerte un resultado: lo que cambia en tu reporte lo deciden los burós. Lo que sí hacemos es decirte siempre cómo va cada carta.",
      ],
    ],
    faqTitle: "Preguntas que nos hacen siempre",
    // The questions Hispanic families actually ask before trusting a credit company.
    // Answers stay inside the claim guardrails and promise nothing we can't control.
    faq: [
      [
        "Ya me estafaron antes. ¿Cómo sé que esto es diferente?",
        "No te pedimos que confíes a ciegas. Antes de que firmes, una persona te explica el plan y te da el acuerdo por escrito. En la app ves cada carta que enviamos y cómo va. Y no prometemos resultados: quien te los promete, te está mintiendo.",
      ],
      [
        "¿Ustedes disputan por mí?",
        "Sí, en lo que tú nos indicas. Tú revisas tu reporte y dices qué es inexacto y por qué; esa decisión es solo tuya. Con eso, nuestro equipo prepara las cartas y las envía por correo. No disputamos todo lo negativo, ni información que tú sabes que es correcta.",
      ],
      [
        "¿Cuánto cuesta?",
        `El servicio de ${brand} tiene una cuota mensual. Nuestro equipo te explica el plan antes de que firmes, y queda escrito en tu acuerdo. Cada cobro es por trabajo que ya se hizo; no se cobra por adelantado. Aparte está ${monitoringName("es")}, que le pagas directo al servicio de monitoreo.`,
      ],
      [
        "¿Y si firmo y cambio de opinión?",
        "Tienes 3 días hábiles después de firmar para cancelar sin costo. Está escrito en tu acuerdo.",
      ],
      [
        "¿Esto tiene que ver con mi estatus migratorio?",
        `No. Revisar y disputar tu propio reporte de crédito es un derecho de todo consumidor bajo la ley federal (FCRA). ${brand} no te pide información migratoria. (Esto no es asesoría legal.)`,
      ],
      [
        "¿Necesito número de Seguro Social?",
        "El servicio de monitoreo verifica tu identidad para mostrarte tu reporte. Si usas ITIN en lugar de Seguro Social, escríbenos por WhatsApp antes de empezar y te decimos tus opciones.",
      ],
      [
        "No se me da bien la tecnología. ¿Voy a poder?",
        `Sí. Es un chat, como WhatsApp: ${assistant} te va diciendo qué sigue. Puedes escuchar las explicaciones en vez de leerlas, y una persona del equipo te ayuda por WhatsApp si te atoras.`,
      ],
    ],
    footer: `${brand} es una empresa de servicios de crédito. Tú decides qué es inexacto en tu reporte; nuestro equipo prepara y envía las cartas por ti. No garantizamos resultados: los burós de crédito deciden, y los resultados varían según cada caso. Nadie puede quitar de un reporte información que es correcta y actual. El servicio requiere una suscripción activa de monitoreo de crédito. Se contrata y se paga aparte, con un servicio de monitoreo independiente. ${brand} recibe una comisión por esa suscripción. Disponible en Texas. Esto no es asesoría legal.`,
    more: "Más información",
  },
  onboarding: {
    stepOf: (index, total) => `Paso ${index} de ${total}`,
    hello: (name) => (name ? `¡Hola, ${name}!` : "¡Hola!"),
    teamTag: `Tu equipo ${brand}`,
    sentBy: (refName) =>
      refName
        ? `${refName}, de nuestro equipo, te envió aquí. Ya anotó lo que platicaron, así que no tienes que repetirlo.`
        : "Nuestro equipo te envió aquí. Ya anotamos lo que platicaron, así que no tienes que repetirlo.",
    yourGoal: "Tu meta",
    yourState: "Tu estado",
    welcomeNote: `Dentro de la app te acompaña ${assistant}, un asistente con inteligencia artificial. Tú nos dices qué está mal en tu reporte y nuestro equipo prepara y envía las cartas por ti. Los resultados varían según cada caso.`,
    yesStart: "Sí, empezar",
    changeAnswers: "Cambiar mis respuestas",
    goalTitle: "¿Para qué quieres mejorar tu crédito?",
    goalSub: "Tu meta nos dice qué es importante para ti. Puedes cambiarla después.",
    next: "Continuar",
    stateTitle: "¿En qué estado vives?",
    stateSub: "Abrimos estado por estado, porque cada uno tiene sus propias reglas. Hoy: Texas.",
    stateLabel: "Estado",
    notYetTitle: "Todavía no llegamos a tu estado",
    notYetBody: "Déjanos tu correo y te avisamos en cuanto abramos ahí.",
    emailPlaceholder: "tu@correo.com",
    emailLabel: "Correo electrónico",
    notifyMe: "Avisarme",
    monitoringTitle: "Activa tu monitoreo de crédito",
    monitoringSub:
      "Es lo que nos deja ver tu reporte de los 3 burós. Es una suscripción aparte, que le pagas al servicio de monitoreo.",
    monitoringRows: (providerName) => [
      ["Monitoreo", `${price} al mes`],
      ["Se lo pagas a", providerName ?? "Un servicio de monitoreo independiente"],
      [`Servicio de ${brand}`, "Va aparte. Tu equipo te explica el plan."],
      ["Cancelar el monitoreo", "Cuando quieras, directo con el servicio"],
    ],
    disclosure: AFFILIATE_DISCLOSURE.es,
    itinQuestion: "¿Usas ITIN en lugar de Seguro Social?",
    itinLink: "Escríbenos antes de contratar.",
    itinWhatsappText: "Hola, uso ITIN. ¿Puedo contratar el monitoreo?",
    activate: "Activar mi monitoreo",
    haveIt: "Ya lo tengo, continuar",
    demoReport: "En esta demo usamos un reporte de ejemplo.",
    assistTitle: "¿Cómo quieres hacer tu revisión?",
    assistSub: "De cualquier forma, las respuestas son tuyas y nuestro equipo envía las cartas.",
    withAssistant: `Con ${assistant}, mi asistente`,
    withAssistantSub: `${assistant} te explica cada paso en palabras simples.`,
    withPerson: "Con una persona a mi lado",
    withPersonSub: "Alguien del equipo te acompaña por WhatsApp.",
    assistNote: `${assistant} y el equipo te explican y te acompañan, pero no te dicen qué marcar: tú dices qué es inexacto. Los resultados varían según cada caso.`,
    assistWhatsappText: `¡Hola! Quiero ayuda en vivo para revisar mi reporte con ${brand}.`,
    waitlistDone: "Listo. Te avisamos pronto.",
    waitlistDoneSub: "En cuanto abramos en tu estado, serás de los primeros en saberlo.",
    backHome: "Volver al inicio",
  },
};

const en: MarketingCopy = {
  landing: {
    signIn: "Sign in",
    assistantHello: `Hi, I'm ${assistant}, your AI assistant`,
    assistantTag: `${assistant} · AI`,
    teamTag: `Your ${brand} team`,
    headline: "Your credit,",
    headlineAccent: "with a team by your side.",
    lead: "You tell us what is wrong on your report. Our team prepares and mails the letters for you and keeps you posted.",
    talk: "Talk to our team",
    start: "Get started",
    whatsappText: `Hi! I want to know how ${brand} works.`,
    demo: "See the demo",
    cards: [
      [
        "You say what is wrong",
        `You go through your report item by item with ${assistant}, your AI assistant. Only what you tell us is inaccurate gets disputed.`,
      ],
      ["We mail the letters", "Our team prepares the letters, mails them and tells you how each round is going."],
      [
        "In English or Spanish, and in writing",
        "The app and our team work with you in English or Spanish, whichever you prefer. Before you sign, the team explains the plan.",
      ],
    ],
    footer: `${brand} is a credit services company. You decide what is inaccurate on your report; our team prepares and mails the letters for you. We do not guarantee results: the credit bureaus decide, and results vary case by case. ${assistant} is an artificial intelligence assistant. Available in Texas. This is not legal advice.`,
  },
  empezar: {
    headline: "You tell us what is wrong.",
    headlineAccent: "We mail the letters.",
    leadBefore: `You go through your credit report with ${assistant}, your AI assistant, and tell us what is inaccurate and why.`,
    leadStrong: "Our team prepares and mails the letters for you",
    leadAfter: "and keeps you posted on every round. Results vary: the bureaus decide.",
    ctaWhatsapp: "Talk to our team on WhatsApp →",
    ctaStart: "Get started →",
    whatsappText: `Hi! I want to know how ${brand} works.`,
    underCta: "You talk to a person first · We explain the plan before you sign · 3 business days to cancel at no cost",
    step: (n) => `Step ${n}`,
    assistantTag: `${assistant}, your AI assistant`,
    teamTag: `Your ${brand} team`,
    steps: [
      {
        title: "Talk to our team",
        body: "Message us on WhatsApp. A person explains how we work and the plan, and answers your questions. If you decide to start, they send you your link into the app and you sign your service agreement.",
        alt: `The ${brand} welcome when the team sends you your link`,
      },
      {
        title: "Review your report and tell us what is wrong",
        body: `You connect ${monitoringName("en")} and upload your ID and a proof of address. ${assistant} explains each account, collection or inquiry in plain words. You flag only what you believe is inaccurate, unverifiable or outdated, and you say why. Those answers are yours: nobody makes them for you.`,
        alt: "Guided review of one item on the report",
      },
      {
        title: "Our team prepares and mails the letters",
        body: "From what you told us, the team prepares the dispute letters and mails them. In the app you see each letter, explained, and how it is going. About every 40 days we look at your report again and show you what changed.",
        alt: "The letters in your round and their status",
      },
    ],
    communityTitle: "Made for our community",
    community: [
      [
        `A team of people, and ${assistant}`,
        `You talk to a person from day one. In the app, ${assistant}, your AI assistant, explains your report step by step.`,
      ],
      [
        "You decide, item by item",
        "Only what you tell us is inaccurate gets disputed. Nobody flags anything for you, and nobody tells you what to flag.",
      ],
      [
        "In your language",
        "In English or Spanish: the app, the explanations and the team. Switch languages with one tap, any time.",
      ],
      [
        "No promises",
        "Nobody can promise you a result: what changes on your report is up to the bureaus. What we do is always tell you how each letter is going.",
      ],
    ],
    faqTitle: "Questions we always get",
    faq: [
      [
        "I've been scammed before. How do I know this is different?",
        "We don't ask you to trust blindly. Before you sign, a person explains the plan and gives you the agreement in writing. In the app you see every letter we mail and how it is going. And we don't promise results: anyone who promises them is lying to you.",
      ],
      [
        "Do you dispute for me?",
        "Yes, for what you point out to us. You review your report and say what is inaccurate and why; that decision is yours alone. From that, our team prepares the letters and mails them. We do not dispute everything negative, or information you know is correct.",
      ],
      [
        "How much does it cost?",
        `The ${brand} service has a monthly fee. Our team explains the plan before you sign, and it is written in your agreement. Each charge is for work already done; nothing is charged in advance. Separately there is ${monitoringName("en")}, which you pay directly to the monitoring service.`,
      ],
      [
        "What if I sign and change my mind?",
        "You have 3 business days after signing to cancel at no cost. It is written in your agreement.",
      ],
      [
        "Does this have anything to do with my immigration status?",
        `No. Reviewing and disputing your own credit report is a right every consumer has under federal law (FCRA). ${brand} does not ask you for immigration information. (This is not legal advice.)`,
      ],
      [
        "Do I need a Social Security number?",
        "The monitoring service verifies your identity to show you your report. If you use an ITIN instead of a Social Security number, message us on WhatsApp before you start and we'll tell you your options.",
      ],
      [
        "I'm not good with technology. Will I be able to do it?",
        `Yes. It's a chat, like WhatsApp: ${assistant} tells you what comes next. You can listen to the explanations instead of reading them, and a person from the team helps you on WhatsApp if you get stuck.`,
      ],
    ],
    footer: `${brand} is a credit services company. You decide what is inaccurate on your report; our team prepares and mails the letters for you. We do not guarantee results: the credit bureaus decide, and results vary case by case. No one can take correct, current information off a credit report. The service requires an active credit monitoring subscription, bought and paid for separately from an independent monitoring service; ${brand} earns a commission on that subscription. Available in Texas. This is not legal advice.`,
    more: "More information",
  },
  onboarding: {
    stepOf: (index, total) => `Step ${index} of ${total}`,
    hello: (name) => (name ? `Hi, ${name}!` : "Hi!"),
    teamTag: `Your ${brand} team`,
    sentBy: (refName) =>
      refName
        ? `${refName}, from our team, sent you here. They already noted what you talked about, so you don't have to repeat it.`
        : "Our team sent you here. We already noted what you talked about, so you don't have to repeat it.",
    yourGoal: "Your goal",
    yourState: "Your state",
    welcomeNote: `Inside the app you have ${assistant} with you, an artificial intelligence assistant. You tell us what is wrong on your report and our team prepares and mails the letters for you. Results vary case by case.`,
    yesStart: "Yes, start",
    changeAnswers: "Change my answers",
    goalTitle: "What do you want better credit for?",
    goalSub: "Your goal tells us what matters to you. You can change it later.",
    next: "Continue",
    stateTitle: "Which state do you live in?",
    stateSub: "We open state by state, because each one has its own rules. Today: Texas.",
    stateLabel: "State",
    notYetTitle: "We're not in your state yet",
    notYetBody: "Leave us your email and we'll let you know as soon as we open there.",
    emailPlaceholder: "you@email.com",
    emailLabel: "Email",
    notifyMe: "Notify me",
    monitoringTitle: "Activate your credit monitoring",
    monitoringSub:
      "It's what lets us see your 3-bureau report. It is a separate subscription, which you pay to the monitoring service.",
    monitoringRows: (providerName) => [
      ["Monitoring", `${price} a month`],
      ["You pay it to", providerName ?? "An independent monitoring service"],
      [`${brand} service`, "It is separate. Your team explains the plan."],
      ["Cancel monitoring", "Whenever you want, directly with the service"],
    ],
    disclosure: AFFILIATE_DISCLOSURE.en,
    itinQuestion: "Do you use an ITIN instead of a Social Security number?",
    itinLink: "Message us before you subscribe.",
    itinWhatsappText: "Hi, I use an ITIN. Can I sign up for the monitoring?",
    activate: "Activate my monitoring",
    haveIt: "I already have it, continue",
    demoReport: "In this demo we use a sample report.",
    assistTitle: "How do you want to do your review?",
    assistSub: "Either way, the answers are yours and our team mails the letters.",
    withAssistant: `With ${assistant}, my assistant`,
    withAssistantSub: `${assistant} explains each step in plain words.`,
    withPerson: "With a person by my side",
    withPersonSub: "Someone from the team stays with you on WhatsApp.",
    assistNote: `${assistant} and the team explain and stay with you, but they do not tell you what to flag: you say what is inaccurate. Results vary case by case.`,
    assistWhatsappText: `Hi! I want live help reviewing my report with ${brand}.`,
    waitlistDone: "Done. We'll let you know soon.",
    waitlistDoneSub: "As soon as we open in your state, you'll be among the first to know.",
    backHome: "Back to home",
  },
};

export const MARKETING: Record<Locale, MarketingCopy> = { es, en };

/**
 * Every string a locale's pages can show, for the copy checks. Lines built
 * from a name or a number are included with sample values, in each variant.
 */
export function marketingStrings(locale: Locale): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  const { landing, empezar, onboarding } = MARKETING[locale];
  walk(landing);
  walk({ ...empezar, step: empezar.step(1) });
  walk({
    ...onboarding,
    stepOf: onboarding.stepOf(1, 4),
    hello: [onboarding.hello("María"), onboarding.hello(null)],
    sentBy: [onboarding.sentBy("Ana"), onboarding.sentBy(null)],
    monitoringRows: [onboarding.monitoringRows(null), onboarding.monitoringRows("IdentityIQ")],
  });
  return out;
}
