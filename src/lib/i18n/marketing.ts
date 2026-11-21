import { AFFILIATE_DISCLOSURE, MONITORING_OFFER, monitoringName } from "../monitoring/offer";
import type { Locale } from "./dictionaries";

// Copy for the pages a visitor sees before the app: the landing page, the
// /empezar funnel page and onboarding. Spanish is the source of truth. English
// is a faithful translation of it: the same claims, the same disclaimers and
// the same commission disclosure, with nothing added. Every English string is
// run through the advertising claim rules in the test suite.

const price = MONITORING_OFFER.priceLabel;

export interface MarketingCopy {
  landing: {
    signIn: string;
    capiHello: string;
    headline: string;
    headlineAccent: string;
    lead: string;
    start: string;
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
    withCapi: string;
    withCapiSub: string;
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
    capiHello: "Hola, soy Capi, tu asistente con IA",
    headline: "Tu crédito,",
    headlineAccent: "en tus manos.",
    lead: "Capi lee tu reporte, te lo explica en español y prepara tus cartas de disputa. Tú decides y tú apruebas.",
    start: "Empezar gratis",
    demo: "Ver la demo",
    cards: [
      ["Todo en español", "La app, las explicaciones y la ayuda de nuestro equipo. Puedes escucharlas en vez de leerlas."],
      ["Tú tienes el control", "Capi prepara todo. Nada se envía hasta que tú lo lees y lo apruebas."],
      ["Un solo costo", `El software es gratis. Solo necesitas tu suscripción de monitoreo de crédito (${price}/mes).`],
    ],
    footer:
      "Credalti es una herramienta de software para que tú hagas tus propias disputas. No disputamos por ti, no garantizamos resultados y los resultados varían según cada caso. Capi es un asistente de inteligencia artificial. Disponible en Texas. Esto no es asesoría legal.",
  },
  empezar: {
    headline: "Capi, tu asistente de crédito con IA.",
    headlineAccent: "Tú solo das el OK.",
    leadBefore:
      "La IA hace el trabajo pesado: lee tu reporte, encuentra lo negativo, te lo explica, escribe tus cartas y las envía por correo.",
    leadStrong: "Tú decides qué disputar y tú apruebas",
    leadAfter: `— 3 toques por ronda, ~5 minutos al mes. El software es gratis. El único costo es tu suscripción de monitoreo de crédito: ${price} al mes, y la cancelas cuando quieras.`,
    ctaWhatsapp: "Escríbenos por WhatsApp →",
    ctaStart: "Empezar ahora — es gratis →",
    whatsappText: "¡Hola! Quiero empezar a revisar mi crédito con Credalti.",
    underCta: "Sin contratos de servicio · Ayuda en vivo gratis si la quieres · Cancela tu monitoreo cuando quieras",
    step: (n) => `Paso ${n}`,
    steps: [
      {
        title: "Conecta tu monitoreo e importa tu reporte",
        body: `Con ${monitoringName("es")} (${price}/mes, el único costo), importamos tu reporte de los 3 burós — Equifax, Experian y TransUnion — y te mostramos exactamente qué sigue, un paso a la vez.`,
        alt: "Panel de Credalti mostrando el siguiente paso",
      },
      {
        title: "Revisa cada elemento, explicado en palabras simples",
        body: "Nada de tecnicismos: Capi te explica qué es cada cuenta, cobranza o consulta, y qué verificar. Tú marcas solo lo que crees inexacto, no verificable o desactualizado — y lo confirmas con tu firma electrónica.",
        alt: "Revisión guiada con confirmación",
      },
      {
        title: "Lee tus cartas y envíalas con un botón",
        body: "Generamos tus cartas de disputa bajo la ley FCRA y te las mostramos completas, con su explicación. Cuando TÚ apruebas, se imprimen y envían por correo — sin impresora, sin filas en el correo. Cada ~40 días, repites con tu reporte actualizado.",
        alt: "Vista previa de carta de disputa con explicación",
      },
    ],
    communityTitle: "Hecho para nuestra comunidad",
    community: [
      [
        "La IA trabaja, tú mandas",
        "Tu asistente prepara todo y te avisa por WhatsApp. Las compañías que 'lo hacen por ti' son las que acaban demandadas — aquí TÚ tienes el control, y eso te protege.",
      ],
      [
        "Ayuda humana gratis",
        "¿Prefieres que alguien te acompañe? Nuestro equipo te guía en vivo por WhatsApp mientras tú decides. Sin costo extra.",
      ],
      [
        "En tu idioma",
        "Todo en español — la app, las explicaciones y la ayuda. Si prefieres inglés, lo eliges dentro de la app.",
      ],
      ["Con la ley de tu lado", "Tus cartas usan tus derechos bajo la ley federal FCRA. Tú las lees antes de enviar."],
    ],
    faqTitle: "Preguntas que nos hacen siempre",
    // The questions Hispanic families actually ask before trusting a credit company.
    // Answers stay inside the claim guardrails and promise nothing we can't control.
    faq: [
      [
        "Ya me estafaron antes. ¿Cómo sé que esto es diferente?",
        "No te pedimos que confíes a ciegas: tú ves cada carta antes de que salga, tú decides qué disputar, y no firmas contratos. Tampoco prometemos resultados — quien te los promete, te está mintiendo.",
      ],
      [
        "¿Cuánto cuesta en total?",
        `Solo ${monitoringName("es")} (${price} al mes), que contratas directo con el servicio de monitoreo. La app, las cartas, el envío por correo y la ayuda de nuestro equipo van incluidos. Cancelas cuando quieras.`,
      ],
      [
        "¿Esto tiene que ver con mi estatus migratorio?",
        "No. Revisar y disputar tu propio reporte de crédito es un derecho de todo consumidor bajo la ley federal (FCRA). Credalti no te pide información migratoria. (Esto no es asesoría legal.)",
      ],
      [
        "¿Necesito número de Seguro Social?",
        "El servicio de monitoreo verifica tu identidad para mostrarte tu reporte. Si usas ITIN en lugar de Seguro Social, escríbenos por WhatsApp antes de empezar y te decimos tus opciones.",
      ],
      [
        "No se me da bien la tecnología. ¿Voy a poder?",
        "Sí. Es un chat, como WhatsApp: el asistente te va diciendo qué sigue. Puedes escuchar las explicaciones en vez de leerlas, y si quieres, una persona del equipo te acompaña en vivo — gratis.",
      ],
      [
        "¿Ustedes disputan por mí?",
        "No — y eso te protege. El asistente prepara todo (lee tu reporte, escribe las cartas, las envía por correo), pero tú decides y tú apruebas. Son 3 toques por ronda, unos 5 minutos al mes.",
      ],
    ],
    footer: `Credalti es una herramienta de software para que tú hagas tus propias disputas. No disputamos por ti y no garantizamos resultados — los resultados varían según cada caso. Disputar información correcta y actual no es el propósito de la herramienta. Requiere una suscripción activa de monitoreo de crédito (${price}/mes), que se contrata con un servicio de monitoreo independiente; Credalti recibe una comisión por esa suscripción. Disponible en Texas. Esto no es asesoría legal.`,
    more: "Más información",
  },
  onboarding: {
    stepOf: (index, total) => `Paso ${index} de ${total}`,
    hello: (name) => (name ? `¡Hola, ${name}!` : "¡Hola!"),
    sentBy: (refName) =>
      refName
        ? `${refName}, de nuestro equipo, te envió aquí. Ya anotó lo que platicaron, así que no tienes que repetirlo.`
        : "Nuestro equipo te envió aquí. Ya anotamos lo que platicaron, así que no tienes que repetirlo.",
    yourGoal: "Tu meta",
    yourState: "Tu estado",
    welcomeNote:
      "Dentro de la app te acompaña Capi, un asistente con inteligencia artificial. Tú decides qué disputar y tú apruebas cada carta. Los resultados varían según cada caso.",
    yesStart: "Sí, empezar",
    changeAnswers: "Cambiar mis respuestas",
    goalTitle: "¿Para qué quieres mejorar tu crédito?",
    goalSub: "Tu meta guía tu progreso. Puedes cambiarla después.",
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
    monitoringSub: "Es lo que nos deja ver tu reporte de los 3 burós, y es tu único costo.",
    monitoringRows: (providerName) => [
      ["Cuánto cuesta", `${price} al mes`],
      ["Con quién lo contratas", providerName ?? "Un servicio de monitoreo independiente"],
      ["Qué incluye Credalti", "La app, tus cartas y el envío por correo"],
      ["Cancelar", "Cuando quieras, directo con el servicio"],
    ],
    disclosure: AFFILIATE_DISCLOSURE.es,
    itinQuestion: "¿Usas ITIN en lugar de Seguro Social?",
    itinLink: "Escríbenos antes de contratar.",
    itinWhatsappText: "Hola, uso ITIN. ¿Puedo contratar el monitoreo?",
    activate: "Activar mi monitoreo",
    haveIt: "Ya lo tengo, continuar",
    demoReport: "En esta demo usamos un reporte de ejemplo.",
    assistTitle: "¿Cómo quieres hacerlo?",
    assistSub: "De cualquier forma, tú decides y tú envías.",
    withCapi: "Con Capi, mi asistente",
    withCapiSub: "Capi te explica cada paso en palabras simples.",
    withPerson: "Con una persona a mi lado",
    withPersonSub: "Alguien del equipo te acompaña por WhatsApp. Gratis.",
    assistNote:
      "La ayuda es educativa: te explicamos y acompañamos, pero cada decisión y cada envío es tuyo. Los resultados varían según cada caso.",
    assistWhatsappText: "¡Hola! Quiero ayuda en vivo para revisar mi crédito con Credalti.",
    waitlistDone: "Listo. Te avisamos pronto.",
    waitlistDoneSub: "En cuanto abramos en tu estado, serás de los primeros en saberlo.",
    backHome: "Volver al inicio",
  },
};

const en: MarketingCopy = {
  landing: {
    signIn: "Sign in",
    capiHello: "Hi, I'm Capi, your AI assistant",
    headline: "Your credit,",
    headlineAccent: "in your hands.",
    // "in Spanish or English": the Spanish page says "en español"; both are true
    // of the app, and a reader of this page is reading it in English.
    lead: "Capi reads your report, explains it to you in Spanish or English and prepares your dispute letters. You decide and you approve.",
    start: "Start free",
    demo: "See the demo",
    cards: [
      [
        "Everything in Spanish",
        "The app, the explanations and our team's help. You can listen to them instead of reading them.",
      ],
      ["You are in control", "Capi prepares everything. Nothing is sent until you read it and approve it."],
      ["One single cost", `The software is free. You only need your credit monitoring subscription (${price}/month).`],
    ],
    footer:
      "Credalti is a software tool for doing your own disputes. We do not dispute for you, we make no guarantees about results, and results vary case by case. Capi is an artificial intelligence assistant. Available in Texas. This is not legal advice.",
  },
  empezar: {
    headline: "Capi, your AI credit assistant.",
    headlineAccent: "You just give the OK.",
    leadBefore:
      "The AI does the heavy lifting: it reads your report, finds the negative items, explains them to you, writes your letters and mails them.",
    leadStrong: "You decide what to dispute and you approve",
    leadAfter: `— 3 taps per round, ~5 minutes a month. The software is free. The only cost is your credit monitoring subscription: ${price} a month, and you can cancel it whenever you want.`,
    ctaWhatsapp: "Message us on WhatsApp →",
    ctaStart: "Start now — it's free →",
    whatsappText: "Hi! I want to start reviewing my credit with Credalti.",
    underCta: "No service contracts · Free live help if you want it · Cancel your monitoring whenever you want",
    step: (n) => `Step ${n}`,
    steps: [
      {
        title: "Connect your monitoring and import your report",
        body: `With ${monitoringName("en")} (${price}/month, the only cost), we import your 3-bureau report — Equifax, Experian and TransUnion — and show you exactly what comes next, one step at a time.`,
        alt: "Credalti dashboard showing the next step",
      },
      {
        title: "Review each item, explained in plain words",
        body: "No jargon: Capi explains what each account, collection or inquiry is, and what to check. You flag only what you believe is inaccurate, unverifiable or outdated — and you confirm it with your electronic signature.",
        alt: "Guided review with confirmation",
      },
      {
        title: "Read your letters and send them with one button",
        body: "We generate your dispute letters under the FCRA and show them to you in full, with an explanation. When YOU approve, they are printed and mailed — no printer, no lines at the post office. Every ~40 days, you repeat with your updated report.",
        alt: "Dispute letter preview with explanation",
      },
    ],
    communityTitle: "Made for our community",
    community: [
      [
        "The AI works, you're in charge",
        "Your assistant prepares everything and messages you on WhatsApp. The companies that 'do it for you' are the ones that end up sued — here YOU are in control, and that protects you.",
      ],
      [
        "Free human help",
        "Would you rather have someone with you? Our team guides you live on WhatsApp while you decide. No extra cost.",
      ],
      [
        "In your language",
        "Everything in Spanish — the app, the explanations and the help. If you prefer English, you choose it inside the app.",
      ],
      [
        "With the law on your side",
        "Your letters use your rights under the federal FCRA. You read them before sending.",
      ],
    ],
    faqTitle: "Questions we always get",
    faq: [
      [
        "I've been scammed before. How do I know this is different?",
        "We don't ask you to trust blindly: you see every letter before it goes out, you decide what to dispute, and you sign no contracts. We don't promise results either — anyone who promises them is lying to you.",
      ],
      [
        "How much does it cost in total?",
        `Only ${monitoringName("en")} (${price} a month), which you buy directly from the monitoring service. The app, the letters, the mailing and our team's help are included. You cancel whenever you want.`,
      ],
      [
        "Does this have anything to do with my immigration status?",
        "No. Reviewing and disputing your own credit report is a right every consumer has under federal law (FCRA). Credalti does not ask you for immigration information. (This is not legal advice.)",
      ],
      [
        "Do I need a Social Security number?",
        "The monitoring service verifies your identity to show you your report. If you use an ITIN instead of a Social Security number, message us on WhatsApp before you start and we'll tell you your options.",
      ],
      [
        "I'm not good with technology. Will I be able to do it?",
        "Yes. It's a chat, like WhatsApp: the assistant tells you what comes next. You can listen to the explanations instead of reading them, and if you want, a person from the team stays with you live — free.",
      ],
      [
        "Do you dispute for me?",
        "No — and that protects you. The assistant prepares everything (reads your report, writes the letters, mails them), but you decide and you approve. It's 3 taps per round, about 5 minutes a month.",
      ],
    ],
    footer: `Credalti is a software tool for doing your own disputes. We do not dispute for you and we make no guarantees about results — results vary case by case. Disputing correct, current information is not the purpose of the tool. It requires an active credit monitoring subscription (${price}/month), bought from an independent monitoring service; Credalti earns a commission on that subscription. Available in Texas. This is not legal advice.`,
    more: "More information",
  },
  onboarding: {
    stepOf: (index, total) => `Step ${index} of ${total}`,
    hello: (name) => (name ? `Hi, ${name}!` : "Hi!"),
    sentBy: (refName) =>
      refName
        ? `${refName}, from our team, sent you here. They already noted what you talked about, so you don't have to repeat it.`
        : "Our team sent you here. We already noted what you talked about, so you don't have to repeat it.",
    yourGoal: "Your goal",
    yourState: "Your state",
    welcomeNote:
      "Inside the app you have Capi with you, an artificial intelligence assistant. You decide what to dispute and you approve every letter. Results vary case by case.",
    yesStart: "Yes, start",
    changeAnswers: "Change my answers",
    goalTitle: "What do you want better credit for?",
    goalSub: "Your goal guides your progress. You can change it later.",
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
    monitoringSub: "It's what lets us see your 3-bureau report, and it's your only cost.",
    monitoringRows: (providerName) => [
      ["What it costs", `${price} a month`],
      ["Who you buy it from", providerName ?? "An independent monitoring service"],
      ["What Credalti includes", "The app, your letters and the mailing"],
      ["Cancel", "Whenever you want, directly with the service"],
    ],
    disclosure: AFFILIATE_DISCLOSURE.en,
    itinQuestion: "Do you use an ITIN instead of a Social Security number?",
    itinLink: "Message us before you subscribe.",
    itinWhatsappText: "Hi, I use an ITIN. Can I sign up for the monitoring?",
    activate: "Activate my monitoring",
    haveIt: "I already have it, continue",
    demoReport: "In this demo we use a sample report.",
    assistTitle: "How do you want to do it?",
    assistSub: "Either way, you decide and you send.",
    withCapi: "With Capi, my assistant",
    withCapiSub: "Capi explains each step in plain words.",
    withPerson: "With a person by my side",
    withPersonSub: "Someone from the team stays with you on WhatsApp. Free.",
    assistNote:
      "The help is educational: we explain and stay with you, but every decision and every mailing is yours. Results vary case by case.",
    assistWhatsappText: "Hi! I want live help reviewing my credit with Credalti.",
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
