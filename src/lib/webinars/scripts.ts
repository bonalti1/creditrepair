import { BRAND } from "../brand";

// What the team says during a webinar (docs/WEBINARS.md, «During»): the
// moderator's copy-paste chat messages, the run of show with its three
// call-to-action moments, and the host's script, in English and Spanish.
// docs/LIVE-FUNNEL.md (the keyword funnel, built separately) did not exist
// when these were written; if it lands with its own chat lines, they replace
// MODERATOR_MESSAGES here and nothing else changes.
//
// Every line passes the same rules as the website and the ads (the tests
// run the content check on each): no promised result, never "free", no
// pressure, no score talk, the person decides what is inaccurate, Alti is
// the AI assistant and never stands in for a person.

export interface ScriptVars {
  keyword: string;
  /** The chat signup's link, with the webinar's campaign tag. */
  signupLink: string;
  /** The webinar's own page (join links and the replay). */
  pageLink: string;
  /** The team's WhatsApp number, as people should type it, or null. */
  whatsapp: string | null;
  /**
   * The two packages' monthly prices, from the offered (attorney-approved)
   * plans; "[price]" when none is offered yet (the demo, and before launch).
   */
  prices: { complete: string; diy: string };
}

/** Before a plan is offered, the scripts say "[price]": the host reads the offered plan's price. */
export const PRICE_PLACEHOLDER = "[price]";

/**
 * The two packages' monthly prices from the offered (attorney-approved)
 * plans: a plan named with "Complete" or "DIY", its first dollar amount.
 * "[price]" for a package no offered plan names yet (the demo, before launch).
 */
export function packagePrices(plans: ReadonlyArray<{ name: string; terms: readonly string[]; most?: string }>): { complete: string; diy: string } {
  const priceOf = (re: RegExp) => {
    const plan = plans.find((p) => re.test(p.name));
    const amount = plan ? [...plan.terms, plan.most ?? ""].join(" ").match(/\$\s?\d[\d,]*(?:\.\d{2})?/) : null;
    return amount ? amount[0].replace(/\s/g, "") : PRICE_PLACEHOLDER;
  };
  return { complete: priceOf(/complete/i), diy: priceOf(/\bdiy\b|do it yourself|hazlo t[uú]/i) };
}

export const MODERATOR_MESSAGE_KEYS = ["welcome", "noPersonalInfo", "link", "keyword", "packages", "signUpYourself", "questionPrompt", "homeBuyer", "replay"] as const;
export type ModeratorMessageKey = (typeof MODERATOR_MESSAGE_KEYS)[number];

export interface ModeratorMessage {
  key: ModeratorMessageKey;
  /** For the moderator: when to paste it. */
  when: { en: string; es: string };
  text: { en: string; es: string };
}

export function moderatorMessages(v: ScriptVars): ModeratorMessage[] {
  const wa = v.whatsapp ? { en: ` or on WhatsApp at ${v.whatsapp}`, es: ` o por WhatsApp al ${v.whatsapp}` } : { en: "", es: "" };
  return [
    {
      key: "welcome",
      when: { en: "As people arrive", es: "Mientras llega la gente" },
      text: {
        en: `Welcome! 👋 This is ${BRAND.name}'s live class on your credit report. Tell us in the chat where you're watching from. We start in a moment.`,
        es: `¡Bienvenidos! 👋 Esta es la clase en vivo de ${BRAND.name} sobre tu reporte de crédito. Cuéntanos en el chat desde dónde nos ves. Empezamos en un momento.`,
      },
    },
    {
      key: "noPersonalInfo",
      when: { en: "Right after the welcome, and again whenever someone shares a number", es: "Justo después de la bienvenida, y otra vez si alguien comparte un número" },
      text: {
        en: "A friendly reminder: please don't post your Social Security number, account numbers or your address in the chat. This chat is public. Questions are welcome.",
        es: "Un recordatorio: por favor no pongas tu número de Seguro Social, números de cuenta ni tu dirección en el chat. Este chat es público. Las preguntas son bienvenidas.",
      },
    },
    {
      key: "link",
      when: { en: "When someone asks for the link", es: "Cuando alguien pide el enlace" },
      text: { en: `Here's the class page, with the replay afterwards: ${v.pageLink}`, es: `Aquí está la página de la clase, con la repetición después: ${v.pageLink}` },
    },
    {
      key: "keyword",
      when: { en: "Call to action 1 (minute 15)", es: "Invitación 1 (minuto 15)" },
      text: {
        en: `Want the class notes and a short video on reading your report? Type ${v.keyword} here${wa.en}, and our team sends them to you.`,
        es: `¿Quieres las notas de la clase y un video corto sobre cómo leer tu reporte? Escribe ${v.keyword} aquí${wa.es}, y el equipo te los manda.`,
      },
    },
    {
      key: "packages",
      when: { en: "Call to action 2 (minute 35), as the host presents the packages", es: "Invitación 2 (minuto 35), mientras se presentan los paquetes" },
      text: {
        en: `Two packages: Credalti Complete, where our team prepares and mails your letters (${v.prices.complete} a month), and Credalti DIY, where Alti guides you step by step and you mail them (${v.prices.diy} a month). With Complete, you're charged each month right after your letters are mailed; DIY is a simple monthly subscription. Not sure? Start with DIY. If it gets to be too much, switch to Complete anytime and keep everything you've done. Credit monitoring (IdentityIQ) is a separate monthly subscription.`,
        es: `Dos paquetes: Credalti Complete, donde nuestro equipo prepara y envía tus cartas (${v.prices.complete} al mes), y Credalti DIY, donde Alti te guía paso a paso y tú las envías (${v.prices.diy} al mes). Con Complete, se te cobra cada mes justo después de que se envían tus cartas; DIY es una suscripción mensual sencilla. ¿No sabes cuál? Empieza con DIY. Si se vuelve demasiado, cámbiate a Complete cuando quieras y conservas todo lo que ya hiciste. El monitoreo de crédito (IdentityIQ) es una suscripción mensual aparte.`,
      },
    },
    {
      key: "signUpYourself",
      when: { en: "Right after the packages message", es: "Justo después del mensaje de los paquetes" },
      text: {
        en: `You can sign up yourself, for either package, in a short chat with Alti, our AI assistant (Texas only for now): ${v.signupLink}. You decide what's wrong on your report, and nobody can honestly promise results.`,
        es: `Puedes registrarte tú mismo, en cualquiera de los dos paquetes, en un chat corto con Alti, nuestro asistente con IA (por ahora solo Texas): ${v.signupLink}. Tú decides qué está mal en tu reporte, y nadie puede prometerte resultados con honestidad.`,
      },
    },
    {
      key: "questionPrompt",
      when: { en: "Opening the questions (minute 37)", es: "Al abrir las preguntas (minuto 37)" },
      text: {
        en: "What's your biggest question about your credit report? Write it here and we'll answer as many as we can, live. (No personal numbers, please.)",
        es: "¿Cuál es tu pregunta más grande sobre tu reporte de crédito? Escríbela aquí y respondemos todas las que podamos, en vivo. (Sin números personales, por favor.)",
      },
    },
    {
      key: "homeBuyer",
      when: { en: "During the questions", es: "Durante las preguntas" },
      text: {
        en: "Thinking about buying a home soon? Tell us in the chat. We'll cover what lenders look at on a report and which questions to ask a loan officer. If your purchase is close, Complete is the faster path: our team prepares and mails every round for you. Every lender decides for itself.",
        es: "¿Piensas comprar casa pronto? Dinos en el chat. Vemos qué miran los prestamistas en un reporte y qué preguntarle a un oficial de préstamos. Si tu compra está cerca, Complete es el camino más rápido: nuestro equipo prepara y envía cada ronda por ti. Cada prestamista decide por su cuenta.",
      },
    },
    {
      key: "replay",
      when: { en: "Call to action 3, at the close (minute 43)", es: "Invitación 3, al cierre (minuto 43)" },
      text: {
        en: `Thank you for being here! The replay will be on the class page: ${v.pageLink}. Type ${v.keyword} if you want the notes, and a person on our team will write to you.`,
        es: `¡Gracias por estar aquí! La repetición va a estar en la página de la clase: ${v.pageLink}. Escribe ${v.keyword} si quieres las notas, y una persona del equipo te escribe.`,
      },
    },
  ];
}

// ── The run of show (45 minutes) ─────────────────────────────────────────

export interface ShowSegment {
  /** Minutes from the start. */
  at: number;
  minutes: number;
  title: { en: string; es: string };
  /** What the host says, in short. */
  host: { en: string; es: string };
  /** What the moderator does (a chat message key, when there is one). */
  moderator: { en: string; es: string };
  paste?: ModeratorMessageKey;
  /** One of the three call-to-action moments. */
  cta?: 1 | 2 | 3;
}

export function runOfShow(v: Pick<ScriptVars, "keyword" | "prices">): ShowSegment[] {
  return [
    {
      at: 0,
      minutes: 2,
      title: { en: "Welcome", es: "Bienvenida" },
      host: {
        en: `Welcome everyone, thank you for being here. I'm part of the ${BRAND.name} team. In the next 45 minutes: your rights, how to read your report, and how a dispute works. Then your questions.`,
        es: `Bienvenidos, gracias por estar aquí. Soy parte del equipo de ${BRAND.name}. En los próximos 45 minutos: tus derechos, cómo leer tu reporte y cómo funciona una disputa. Luego tus preguntas.`,
      },
      moderator: { en: "Paste the welcome, then the reminder about personal information.", es: "Pega la bienvenida y luego el recordatorio de los datos personales." },
      paste: "welcome",
    },
    {
      at: 2,
      minutes: 3,
      title: { en: "Who we are", es: "Quiénes somos" },
      host: {
        en: `${BRAND.name} is a credit repair company in Texas. You tell us what is wrong on your report; our team prepares and mails the dispute letters, or Alti guides you to do it yourself. Alti is an AI, and he says so. People like me answer your questions.`,
        es: `${BRAND.name} es una empresa de reparación de crédito en Texas. Tú nos dices qué está mal en tu reporte; nuestro equipo prepara y envía las cartas de disputa, o Alti te guía para hacerlo tú mismo. Alti es una IA, y lo dice. Personas como yo responden tus preguntas.`,
      },
      moderator: { en: "Paste the reminder about personal information.", es: "Pega el recordatorio de los datos personales." },
      paste: "noPersonalInfo",
    },
    {
      at: 5,
      minutes: 10,
      title: { en: "Your rights, in plain words", es: "Tus derechos, en palabras sencillas" },
      host: {
        en: "Under the Fair Credit Reporting Act you can see your report from each bureau, and dispute what you believe is inaccurate. The bureau must look into it, usually within 30 days, and tell you what it found. You can do this yourself at no cost.",
        es: "Bajo la Ley de Informe Justo de Crédito puedes ver tu reporte de cada buró y disputar lo que creas que está mal. El buró debe investigarlo, por lo general en 30 días, y decirte lo que encontró. Lo puedes hacer tú mismo sin costo.",
      },
      moderator: { en: "Answer simple questions in the chat; note the hard ones for the questions part.", es: "Responde las preguntas sencillas en el chat; anota las difíciles para la parte de preguntas." },
    },
    {
      at: 15,
      minutes: 2,
      title: { en: "Call to action 1: the notes", es: "Invitación 1: las notas" },
      host: {
        en: `If you want the notes of this class and a short video on reading your report, type ${v.keyword} in the chat or on WhatsApp. Our team sends them.`,
        es: `Si quieres las notas de esta clase y un video corto sobre cómo leer tu reporte, escribe ${v.keyword} en el chat o por WhatsApp. El equipo te los manda.`,
      },
      moderator: { en: "Paste the keyword message. Watch the console's messages coming in.", es: "Pega el mensaje de la palabra clave. Mira los mensajes que llegan en la consola." },
      paste: "keyword",
      cta: 1,
    },
    {
      at: 17,
      minutes: 10,
      title: { en: "Reading your report", es: "Cómo leer tu reporte" },
      host: {
        en: "Three bureaus, three reports, and they don't always match. Look at your personal details, each account and its payment history, collections, and inquiries. Write down anything you don't recognize.",
        es: "Tres burós, tres reportes, y no siempre coinciden. Mira tus datos personales, cada cuenta y su historial de pagos, las cobranzas y las consultas. Anota lo que no reconozcas.",
      },
      moderator: { en: "Answer questions in the chat. Remind about personal information if someone shares a number.", es: "Responde preguntas en el chat. Recuerda lo de los datos personales si alguien comparte un número." },
    },
    {
      at: 27,
      minutes: 8,
      title: { en: "How a dispute works", es: "Cómo funciona una disputa" },
      host: {
        en: "You decide what is inaccurate. A letter says what is wrong and why, with your documents. The bureau investigates and answers. Nobody can promise what a bureau decides, and results vary.",
        es: "Tú decides qué está mal. Una carta dice qué está mal y por qué, con tus documentos. El buró investiga y responde. Nadie puede prometer lo que decide un buró, y los resultados varían.",
      },
      moderator: { en: "Collect the questions people write for the next part.", es: "Junta las preguntas que la gente escribe para la siguiente parte." },
    },
    {
      at: 35,
      minutes: 2,
      title: { en: "Call to action 2: the two packages", es: "Invitación 2: los dos paquetes" },
      host: {
        en: `There are two ways to work with us. First, Credalti Complete: our team prepares and mails your letters every round, ${v.prices.complete} a month. Then Credalti DIY: Alti guides you step by step and you mail your own letters, ${v.prices.diy} a month. With Complete, you're charged each month right after your letters are mailed; DIY is a simple monthly subscription. Not sure? Start with DIY. If it gets to be too much, switch to Complete anytime and keep everything you've done. Either way, you decide what's wrong on your report, and nobody can honestly promise results. Credit monitoring with IdentityIQ is a separate monthly subscription. You can sign up yourself in a short chat with Alti, in Texas for now, and read the agreement before you decide.`,
        es: `Hay dos formas de trabajar con nosotros. Primero, Credalti Complete: nuestro equipo prepara y envía tus cartas en cada ronda, ${v.prices.complete} al mes. Luego, Credalti DIY: Alti te guía paso a paso y tú envías tus propias cartas, ${v.prices.diy} al mes. Con Complete, se te cobra cada mes justo después de que se envían tus cartas; DIY es una suscripción mensual sencilla. ¿No sabes cuál? Empieza con DIY. Si se vuelve demasiado, cámbiate a Complete cuando quieras y conservas todo lo que ya hiciste. En los dos, tú decides qué está mal en tu reporte, y nadie puede prometerte resultados con honestidad. El monitoreo de crédito con IdentityIQ es una suscripción mensual aparte. Puedes registrarte tú mismo en un chat corto con Alti, por ahora en Texas, y leer el acuerdo antes de decidir.`,
      },
      moderator: { en: "Paste the packages message, then the sign-up message.", es: "Pega el mensaje de los paquetes y luego el de registrarse." },
      paste: "packages",
      cta: 2,
    },
    {
      at: 37,
      minutes: 6,
      title: { en: "Your questions", es: "Tus preguntas" },
      host: {
        en: "Let's take your questions. I'll answer in general terms: for your own report, our team can look at it with you after.",
        es: "Vamos con tus preguntas. Respondo en general: para tu propio reporte, el equipo lo puede ver contigo después.",
      },
      moderator: { en: "Paste the question prompt, then the home-buyer prompt. Read the best questions to the host.", es: "Pega la invitación a preguntar y luego la de compradores de casa. Léele al presentador las mejores preguntas." },
      paste: "questionPrompt",
    },
    {
      at: 43,
      minutes: 2,
      title: { en: "Call to action 3: close", es: "Invitación 3: cierre" },
      host: {
        en: `Thank you for your time. The replay goes on the class page. Type ${v.keyword} for the notes, and a person on our team writes to you. Results vary, and you're always the one who decides.`,
        es: `Gracias por tu tiempo. La repetición va en la página de la clase. Escribe ${v.keyword} para las notas, y una persona del equipo te escribe. Los resultados varían, y tú siempre decides.`,
      },
      moderator: { en: "Paste the closing message. After the stream, add the replay link on the webinar's page.", es: "Pega el mensaje de cierre. Al terminar, pon el enlace de la repetición en la página del webinar." },
      paste: "replay",
      cta: 3,
    },
  ];
}

/** Every line of the scripts, for the tests. */
export function allScriptLines(locale: "en" | "es", v: ScriptVars): string[] {
  return [
    ...moderatorMessages(v).flatMap((m) => [m.text[locale], m.when[locale]]),
    ...runOfShow(v).flatMap((s) => [s.title[locale], s.host[locale], s.moderator[locale]]),
  ];
}
