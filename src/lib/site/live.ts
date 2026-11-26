import { BRAND } from "../brand";
import type { Locale } from "../i18n/dictionaries";

// The words of the website's interactive pieces (docs/WEBSITE.md, "Interactive
// pieces"): the "Ask Alti" chat, the report check, the scroll story, the
// comparison toggle, the "When would I pay?" timeline, the two calculators,
// the home-ready teaser and the phone's sticky bar. English and Spanish.
//
// They are part of SITE_COPY (copy.ts, `live`), so every line here goes
// through the same tests as the rest of the site: both claim checks, no
// sentence over 25 words, nothing called free, no outcome words, no amounts.
// Every fact about credit reports carries a source (`source`), from the pages
// the Aprende lessons already cite (src/lib/learn/lessons.ts).

const brand = BRAND.name;
const alti = BRAND.assistant;

// The browser imports this file (the islands read their own words, functions
// included), so it imports nothing heavy: these two match the app's timing
// (src/lib/case/timeline.ts: CASE_NEXT_ROUND_DAYS, CASE_RESPONSE_DAYS), and a
// test holds them equal.
export const LIVE_ROUND_DAYS = 40;
export const LIVE_RESPONSE_DAYS = 30;
const CASE_NEXT_ROUND_DAYS = LIVE_ROUND_DAYS;

export interface LiveSource {
  label: string;
  url: string;
}

const SRC = {
  disputes: { label: "FTC", url: "https://consumer.ftc.gov/articles/disputing-errors-your-credit-reports" },
  howLong: { label: "CFPB", url: "https://www.consumerfinance.gov/ask-cfpb/how-long-do-negative-information-remain-on-my-credit-report-en-323/" },
  collections: { label: "CFPB", url: "https://www.consumerfinance.gov/ask-cfpb/how-do-collections-affect-my-credit-en-323/" },
  inquiry: { label: "CFPB", url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-credit-inquiry-en-1317/" },
  idTheft: { label: "IdentityTheft.gov", url: "https://www.identitytheft.gov/" },
  fcra605: { label: "15 U.S.C. §1681c", url: "https://www.law.cornell.edu/uscode/text/15/1681c" },
  utilization: { label: "CFPB", url: "https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-and-keep-a-good-credit-score-en-318/" },
} as const satisfies Record<string, LiveSource>;

export type QuizItemId = "late" | "collection" | "inquiry" | "personal" | "notMine" | "balance" | "old";

export const QUIZ_ITEM_IDS: readonly QuizItemId[] = ["late", "collection", "inquiry", "notMine", "personal", "balance", "old"];

export interface QuizItem {
  /** The chip the visitor taps. */
  label: string;
  title: string;
  /** What it is. */
  what: string;
  /** What the law or the bureaus say, in plain words. */
  right: string;
  /** What Credalti does about it. */
  we: string;
  source: LiveSource;
}

export interface LibraryEntry {
  q: string;
  a: string;
  /** Extra words people use for the same question. */
  keys: string;
}

export interface LiveCopy {
  ask: {
    launcher: string;
    title: string;
    subtitle: string;
    open: string;
    close: string;
    intro: string;
    privacy: string;
    inputLabel: string;
    placeholder: string;
    send: string;
    suggestionsLabel: string;
    suggestions: string[];
    typing: string;
    error: string;
    rateLimited: string;
    offTopic: string;
    personal: string;
    noMatch: string;
    ctaStart: string;
    ctaWhatsapp: string;
    ctaFaq: string;
    footnote: string;
    whatsappText: string;
    /** Answers to questions the FAQ doesn't cover, for the no-key path and to ground the model. */
    library: LibraryEntry[];
  };
  hero: { tabExample: string; tabAsk: string; tabsLabel: string; facts: string[] };
  stats: { of: (n: number) => string };
  quiz: {
    eyebrow: string;
    title: string;
    lead: string;
    question: string;
    hint: string;
    items: Record<QuizItemId, QuizItem>;
    none: string;
    show: string;
    restart: string;
    selected: (n: number) => string;
    resultTitle: string;
    resultLead: string;
    whatLabel: string;
    rightLabel: string;
    weLabel: string;
    sourceLabel: string;
    stepsTitle: string;
    steps: string[];
    noneTitle: string;
    noneBody: string;
    note: string;
    cta: string;
  };
  story: { eyebrow: string; title: string; lead: string; stepOf: (n: number) => string; swipe: string };
  compare: { label: string; showUs: string; showThem: string; hint: string };
  timeline: {
    title: string;
    lead: string;
    slider: string;
    month: (n: number) => string;
    planLabel: string;
    ruleOnly: string;
    signed: string;
    cancelEnds: string;
    mailed: (round: number) => string;
    chargeMay: string;
    noChargePeriod: string;
    day: (n: number) => string;
    summary: (rounds: number, charges: number, months: number) => string;
    rules: string[];
    note: string;
    legendMailed: string;
    legendCharge: string;
  };
  tools: {
    eyebrow: string;
    title: string;
    lead: string;
    tabUtil: string;
    tabStay: string;
    util: {
      title: string;
      lead: string;
      card: (n: number) => string;
      balance: string;
      limit: string;
      add: string;
      remove: string;
      result: (percent: number) => string;
      empty: string;
      low: string;
      mid: string;
      high: string;
      note: string;
    };
    stay: {
      title: string;
      lead: string;
      type: string;
      date: string;
      result: (when: string) => string;
      passed: (when: string) => string;
      accurate: string;
      wrong: string;
      lawNote: string;
      practiceNote: string;
      empty: string;
    };
    privacy: string;
  };
  after: {
    eyebrow: string;
    title: string;
    lead: string;
    cards: Array<{ title: string; body: string }>;
    note: string;
  };
  teaser: {
    title: string;
    lead: string;
    q1: string;
    goals: { home: string; build: string; check: string };
    q2: string;
    ids: { ssn: string; itin: string; skip: string };
    resultTitle: string;
    results: { build: string; home: string; itin: string; check: string };
    note: string;
    again: string;
  };
  mobileBar: { start: string; ask: string };
}

const en: LiveCopy = {
  ask: {
    launcher: `Ask ${alti}`,
    title: `Ask ${alti}`,
    subtitle: "Artificial intelligence, not a person",
    open: `Open the chat with ${alti}, our AI assistant`,
    close: "Close the chat",
    intro: `Hi, I'm ${alti}, ${brand}'s AI assistant. I'm artificial intelligence, not a person. Ask me about credit reports, disputes or how we work.`,
    privacy: "Please don't share personal details here, like your Social Security number, ITIN or account numbers.",
    inputLabel: `Your question for ${alti}`,
    placeholder: "Type your question",
    send: "Send",
    suggestionsLabel: "Questions people ask",
    suggestions: ["How does it work?", "When am I charged?", "Can I dispute errors myself?", "I have an ITIN. Can I start?", "What is a collection?"],
    typing: `${alti} is writing`,
    error: "Something went wrong. Please try again, or message our team on WhatsApp.",
    rateLimited: "That's a lot of questions at once. Please wait a few minutes, or message our team on WhatsApp.",
    offTopic: "I can only help with credit reports, disputes and how our service works. For anything else, a person on our team can help.",
    personal: "Please don't share personal details in this chat. I don't need them to answer general questions. Your team asks for what's needed, securely, once you start.",
    noMatch: "I don't have a good answer to that one. A person on our team can answer it, or you can browse all our questions.",
    ctaStart: "Start my review",
    ctaWhatsapp: "Chat with the team on WhatsApp",
    ctaFaq: "See all questions",
    footnote: `${alti} is AI and gives general information, not legal advice. Results vary. We keep no record of this chat.`,
    whatsappText: `Hi! I have a question for the ${brand} team.`,
    library: [
      {
        q: "What is the difference between Credalti Complete and Credalti DIY?",
        a: "Both start with your review: you decide what is inaccurate. With Credalti Complete our team prepares and mails your letters, and every charge waits for the work. With Credalti DIY, Alti prepares your letters and you print and mail them, for a monthly subscription after your 3 business days to cancel. You can start with Credalti DIY, upgrade to Credalti Complete anytime and keep everything you've done.",
        keys: "difference options option complete diy do it yourself done for you which plan choose mail myself print upgrade",
      },
      {
        q: "What is a collection?",
        a: "A collection means a debt collector says you owe a debt, often an old bill handed or sold to them. If it isn't yours, or the amount is wrong, you can dispute it.",
        keys: "collection collector debt collections agency owe cobranza",
      },
      {
        q: "What is a late payment on my report?",
        a: "It is a payment a creditor reported as late. If it's accurate, it can stay up to 7 years. If you paid on time, you can dispute it.",
        keys: "late payment paid on time 30 days late missed",
      },
      {
        q: "What is a hard inquiry?",
        a: "An inquiry shows who looked at your report. A hard inquiry usually comes from applying for credit. One you don't recognize may be a mistake or identity theft.",
        keys: "inquiry inquiries hard soft pulled checked",
      },
      {
        q: "How long can negative items stay on my report?",
        a: "Most negative items can be reported for 7 years, and some bankruptcies for 10. After that, a bureau can't keep reporting most of them. There are exceptions.",
        keys: "seven years how long stay old items 7 10 bankruptcy",
      },
      {
        q: "What is a credit bureau?",
        a: "Equifax, Experian and TransUnion keep the credit reports lenders read. Each one can have different information, so we look at all three.",
        keys: "bureau bureaus equifax experian transunion agency",
      },
      {
        q: "What is credit utilization?",
        a: "It's your card balances divided by your card limits. Many experts suggest keeping it under 30%. Our calculator on this page does the math.",
        keys: "utilization balance limit percent cards usage",
      },
      {
        q: "Can you help me build credit?",
        a: `Your app has a plan to build credit: paying on time, keeping balances low, keeping old accounts open and more. It's general information, alongside the service.`,
        keys: "build building credit history secured card",
      },
      {
        q: "I want to buy a home. Can you help?",
        a: `Your app has a home-ready path: milestones, and what lenders usually look at. Requirements vary by lender, and the lender decides. ${brand} isn't a lender.`,
        keys: "home house mortgage buy buying loan officer realtor",
      },
      {
        q: "Someone opened an account in my name.",
        a: "That can be identity theft. Report it at IdentityTheft.gov, which gives you a recovery plan. You can also dispute accounts that aren't yours.",
        keys: "identity theft stolen fraud opened account name",
      },
      {
        q: "Is Alti a person?",
        a: `No. I'm ${alti}, ${brand}'s AI assistant: artificial intelligence, not a person. A person on our team answers on WhatsApp whenever you want.`,
        keys: "person human robot real bot ai talk someone",
      },
    ],
  },
  hero: {
    tabExample: "Try the example",
    tabAsk: `Ask ${alti}`,
    tabsLabel: "What to show in the phone",
    facts: ["Every letter, with its dates", "Complete: charged after letters are mailed", "DIY: a simple monthly subscription", "3 business days to cancel at no cost", "English or Spanish"],
  },
  stats: { of: (n) => `1 of ${n}` },
  quiz: {
    eyebrow: "30-second check",
    title: "What's on your report?",
    lead: "Tap what you see on your report. We'll explain each one, what the law says, and what we do. No personal details needed.",
    question: "Do you see any of these on your report?",
    hint: "Tap all that apply.",
    items: {
      late: {
        label: "Late payments",
        title: "Late payments",
        what: "A creditor reported a payment as late.",
        right: "If it's accurate, it can stay up to 7 years. If you paid on time, you can dispute it.",
        we: "If you tell us it's wrong, our team prepares and mails letters asking the bureaus to check it.",
        source: SRC.howLong,
      },
      collection: {
        label: "Collections",
        title: "Collections",
        what: "A debt collector says you owe a debt, often an old bill handed or sold to them.",
        right: "You can dispute it if it isn't yours, the amount is wrong or it's out of date.",
        we: "Your letters go to the bureaus and, by certified mail, to the collector.",
        source: SRC.collections,
      },
      inquiry: {
        label: "Inquiries you don't recognize",
        title: "Inquiries you don't recognize",
        what: "An inquiry shows who looked at your report. A hard one usually comes from applying for credit.",
        right: "One you don't recognize can be a mistake or a sign of identity theft. You can dispute it.",
        we: "If you mark it, our team includes it in your letters to the bureaus.",
        source: SRC.inquiry,
      },
      notMine: {
        label: "Accounts that aren't mine",
        title: "Accounts that aren't yours",
        what: "An account you never opened can come from a mixed-up file or from identity theft.",
        right: "You can dispute accounts that aren't yours. If it's identity theft, report it at IdentityTheft.gov.",
        we: "You tell us which ones aren't yours. Our team prepares and mails the letters, and you see each date.",
        source: SRC.idTheft,
      },
      personal: {
        label: "Wrong name or address",
        title: "Wrong name, address or other details",
        what: "Your report lists names, addresses and other personal details.",
        right: "Wrong details can mix your file with someone else's. You can ask the bureau to correct them.",
        we: "Personal information is part of every review. Mark what's wrong, and it goes in your letters.",
        source: SRC.disputes,
      },
      balance: {
        label: "Wrong balance or status",
        title: "Wrong balance or status",
        what: "A balance, a limit or a status like open or paid can be reported wrong.",
        right: "You can dispute any detail you believe is inaccurate.",
        we: "You say what's wrong and why. The letter asks the bureau and the creditor to check that detail.",
        source: SRC.disputes,
      },
      old: {
        label: "Items older than 7 years",
        title: "Items older than 7 years",
        what: "Most negative items can be reported for 7 years. Some bankruptcies can stay 10.",
        right: "After that, the law says a bureau can't keep reporting most of them. There are exceptions.",
        we: "If you see one past its time, mark it as outdated. Our team includes it in your letters.",
        source: SRC.fcra605,
      },
    },
    none: "None of these",
    show: "Explain these",
    restart: "Start over",
    selected: (n) => (n === 1 ? "1 selected" : `${n} selected`),
    resultTitle: "Here's what each one means",
    resultLead: "General information from government sources. You can dispute errors yourself at no cost.",
    whatLabel: "What it is",
    rightLabel: "What the law says",
    weLabel: `What ${brand} does`,
    sourceLabel: "Source",
    stepsTitle: "If you'd rather have a team do it",
    steps: ["You tell us which items you believe are wrong, and why.", "Our team prepares and mails the letters.", "You see every letter and its dates in Mi caso."],
    noneTitle: "Nothing on this list? Good to know.",
    noneBody: "It's still smart to look. You can see your three reports every week, at no cost, at AnnualCreditReport.com.",
    note: "The bureaus decide, and results vary. This is general information, not legal advice.",
    cta: "Start my review",
  },
  story: {
    eyebrow: "How it works",
    title: "Scroll through the app, step by step",
    lead: "Real screens from the app, with sample data. You make the decisions; your team does the paperwork.",
    stepOf: (n) => `Step ${n} of 5`,
    swipe: "Swipe to see each step",
  },
  compare: {
    label: "Show",
    showUs: brand,
    showThem: "Many companies",
    hint: "Tap to switch between the two.",
  },
  timeline: {
    title: "When would I pay with Credalti Complete?",
    lead: "Slide through your first months. See when letters go out and when a charge can happen. (Credalti DIY is a simple monthly subscription instead.)",
    slider: "Months since you sign",
    month: (n) => (n === 1 ? "1 month" : `${n} months`),
    planLabel: "Plan",
    ruleOnly: "How every Complete plan works",
    signed: "You sign",
    cancelEnds: "Your 3 business days to cancel at no cost end",
    mailed: (round) => `Round ${round} letters mailed`,
    chargeMay: "A charge can happen, for letters already mailed",
    noChargePeriod: "No letters in this 30-day period: no charge",
    day: (n) => `Day ${n}`,
    summary: (rounds, charges, months) =>
      `In ${months === 1 ? "1 month" : `${months} months`}: ${rounds === 1 ? "1 round" : `${rounds} rounds`} mailed, and at most ${charges === 1 ? "1 charge" : `${charges} charges`}.`,
    rules: ["With Credalti Complete, nothing is charged before your first round is mailed.", "Never more than one charge in 30 days.", "The most you'll pay is written in your agreement before you sign."],
    note: `Example timing. Rounds go out about every ${CASE_NEXT_ROUND_DAYS} days; your real dates depend on your case.`,
    legendMailed: "Letters mailed",
    legendCharge: "A charge can happen",
  },
  tools: {
    eyebrow: "Tools",
    title: "Two quick calculators",
    lead: "Simple math with what you type. Nothing is saved or sent.",
    tabUtil: "Card utilization",
    tabStay: "How long can it stay?",
    util: {
      title: "Card utilization",
      lead: "Your card balances divided by your card limits.",
      card: (n) => `Card ${n}`,
      balance: "Balance",
      limit: "Credit limit",
      add: "Add a card",
      remove: "Remove",
      result: (percent) => `You're using ${percent}% of your limits`,
      empty: "Type a balance and a limit to see the math.",
      low: "Under 30%: what many experts suggest.",
      mid: "Between 30% and 50%. Many experts suggest under 30%.",
      high: "Over half of your limits. Many experts suggest under 30%.",
      note: "Many experts suggest keeping it under 30%. This is arithmetic only, not a prediction.",
    },
    stay: {
      title: "How long can this stay on my report?",
      lead: "Pick the kind of item and its date. We show the latest it may be reported.",
      type: "Kind of item",
      date: "Date",
      result: (when) => `It may be reported until about ${when}.`,
      passed: (when) => `That time ended around ${when}. If it's still there, you can dispute it as outdated.`,
      accurate: "If it's accurate, it can stay until then.",
      wrong: "If it's wrong, you can dispute it at any time.",
      lawNote: "From the Fair Credit Reporting Act. There are exceptions, and this is not legal advice.",
      practiceNote: "This one is bureau practice, not a rule in the law.",
      empty: "Pick a kind of item and a date.",
    },
    privacy: "Everything stays on this page. Nothing is saved or sent.",
  },
  after: {
    eyebrow: "After the letters",
    title: "Build your credit, at your own pace",
    lead: "Disputes are one part. Your app also has general guidance for what comes next.",
    cards: [
      { title: "A plan to build credit", body: "Six habits, ordered by your own report: paying on time, keeping balances low, keeping old accounts open and more." },
      { title: "A home-ready path", body: "Milestones, and what lenders usually look at. Requirements vary by lender, and the lender decides." },
      { title: "Help for ITIN holders", body: "How credit files work with an ITIN, getting reports by mail, and building credit." },
    ],
    note: "General information in your app, alongside the service. It is not a promise of a loan or a result.",
  },
  teaser: {
    title: "Getting ready for a home?",
    lead: "Two quick questions, and we'll show you what's in the app for you.",
    q1: "What are you working toward?",
    goals: { home: "Buying a home", build: "Building my credit", check: "Checking my report" },
    q2: "Do you have a Social Security number or an ITIN?",
    ids: { ssn: "Social Security number", itin: "ITIN", skip: "Rather not say" },
    resultTitle: "In your app, from day one",
    results: {
      build: "A plan to build credit, ordered by your own report.",
      home: "The home-ready path: milestones and what lenders usually look at.",
      itin: "The ITIN guide: reports by mail, building credit and home loans with an ITIN.",
      check: "Mi caso: every letter and its dates, so you always know where things are.",
    },
    note: "Requirements vary by lender, and the lender decides. Results vary.",
    again: "Change my answers",
  },
  mobileBar: { start: "Start my review", ask: `Ask ${alti}` },
};

const es: LiveCopy = {
  ask: {
    launcher: `Pregúntale a ${alti}`,
    title: `Pregúntale a ${alti}`,
    subtitle: "Inteligencia artificial, no una persona",
    open: `Abrir el chat con ${alti}, nuestro asistente con IA`,
    close: "Cerrar el chat",
    intro: `Hola, soy ${alti}, el asistente con IA de ${brand}. Soy inteligencia artificial, no una persona. Pregúntame sobre reportes de crédito, disputas o cómo trabajamos.`,
    privacy: "Por favor no compartas datos personales aquí, como tu número de Seguro Social, tu ITIN o números de cuenta.",
    inputLabel: `Tu pregunta para ${alti}`,
    placeholder: "Escribe tu pregunta",
    send: "Enviar",
    suggestionsLabel: "Preguntas frecuentes",
    suggestions: ["¿Cómo funciona?", "¿Cuándo me cobran?", "¿Puedo disputar errores por mi cuenta?", "Tengo ITIN. ¿Puedo empezar?", "¿Qué es una cobranza?"],
    typing: `${alti} está escribiendo`,
    error: "Algo salió mal. Inténtalo de nuevo, o escríbele a nuestro equipo por WhatsApp.",
    rateLimited: "Son muchas preguntas a la vez. Espera unos minutos, o escríbele a nuestro equipo por WhatsApp.",
    offTopic: "Solo puedo ayudarte con reportes de crédito, disputas y cómo funciona nuestro servicio. Para lo demás, te ayuda una persona del equipo.",
    personal: "Por favor no compartas datos personales en este chat. No los necesito para preguntas generales. Tu equipo te pide lo necesario, de forma segura, cuando empiezas.",
    noMatch: "No tengo una buena respuesta para eso. Una persona del equipo te puede responder, o puedes ver todas nuestras preguntas.",
    ctaStart: "Empezar mi revisión",
    ctaWhatsapp: "Escribirle al equipo por WhatsApp",
    ctaFaq: "Ver todas las preguntas",
    footnote: `${alti} es IA y da información general, no asesoría legal. Los resultados varían. No guardamos este chat.`,
    whatsappText: `¡Hola! Tengo una pregunta para el equipo de ${brand}.`,
    library: [
      {
        q: "¿Qué diferencia hay entre Credalti Complete y Credalti DIY?",
        a: "Las dos empiezan con tu revisión: tú decides qué es inexacto. Con Credalti Complete nuestro equipo prepara y envía tus cartas, y cada cobro espera al trabajo. Con Credalti DIY, Alti prepara tus cartas y tú las imprimes y las envías. Es una suscripción mensual que empieza después de tus 3 días hábiles para cancelar. Puedes empezar con Credalti DIY, cambiar a Credalti Complete cuando quieras y conservar todo lo que ya hiciste.",
        keys: "diferencia opciones opcion complete diy hazlo tu lo hacemos por ti cual elegir enviar yo imprimir cambiar",
      },
      {
        q: "¿Qué es una cobranza?",
        a: "Una cobranza quiere decir que un cobrador dice que debes una deuda, muchas veces una cuenta vieja que le pasaron o vendieron. Si no es tuya, o el monto está mal, puedes disputarla.",
        keys: "cobranza cobrador deuda cobranzas agencia debo collection",
      },
      {
        q: "¿Qué es un pago tarde en mi reporte?",
        a: "Es un pago que un acreedor reportó como atrasado. Si es correcto, puede quedarse hasta 7 años. Si pagaste a tiempo, puedes disputarlo.",
        keys: "pago tarde atrasado atraso pague tiempo 30 dias",
      },
      {
        q: "¿Qué es una consulta dura?",
        a: "Una consulta muestra quién vio tu reporte. Una consulta dura suele venir de pedir crédito. Una que no reconoces puede ser un error o robo de identidad.",
        keys: "consulta consultas dura suave revisaron inquiry",
      },
      {
        q: "¿Cuánto tiempo pueden quedarse las cosas negativas en mi reporte?",
        a: "La mayoría puede reportarse 7 años, y algunas bancarrotas 10. Después, un buró ya no puede seguir reportando la mayoría. Hay excepciones.",
        keys: "siete años cuanto tiempo viejas antiguas 7 10 bancarrota",
      },
      {
        q: "¿Qué es un buró de crédito?",
        a: "Equifax, Experian y TransUnion guardan los reportes de crédito que leen los prestamistas. Cada uno puede tener información distinta, por eso revisamos los tres.",
        keys: "buro buros equifax experian transunion agencia",
      },
      {
        q: "¿Qué es la utilización de crédito?",
        a: "Es el saldo de tus tarjetas dividido entre sus límites. Muchos expertos sugieren mantenerla debajo del 30%. La calculadora de esta página hace la cuenta.",
        keys: "utilizacion saldo limite porcentaje tarjetas uso",
      },
      {
        q: "¿Me ayudan a construir crédito?",
        a: "Tu app tiene un plan para construir crédito: pagar a tiempo, mantener saldos bajos, no cerrar cuentas viejas y más. Es información general, junto al servicio.",
        keys: "construir crédito historial tarjeta asegurada",
      },
      {
        q: "Quiero comprar casa. ¿Me ayudan?",
        a: `Tu app tiene un camino para comprar casa: metas y lo que suelen revisar los prestamistas. Los requisitos varían, y el prestamista decide. ${brand} no presta dinero.`,
        keys: "casa hogar hipoteca comprar préstamo oficial agente",
      },
      {
        q: "Alguien abrió una cuenta a mi nombre.",
        a: "Eso puede ser robo de identidad. Repórtalo en IdentityTheft.gov, que te da un plan para recuperarte. También puedes disputar cuentas que no son tuyas.",
        keys: "robo identidad robaron fraude abrieron cuenta nombre",
      },
      {
        q: "¿Alti es una persona?",
        a: `No. Soy ${alti}, el asistente con IA de ${brand}: inteligencia artificial, no una persona. Una persona del equipo te responde por WhatsApp cuando quieras.`,
        keys: "persona humano robot real bot ia hablar alguien",
      },
    ],
  },
  hero: {
    tabExample: "Prueba el ejemplo",
    tabAsk: `Pregúntale a ${alti}`,
    tabsLabel: "Qué mostrar en el teléfono",
    facts: ["Cada carta, con sus fechas", "Complete: se cobra después de enviar las cartas", "DIY: una suscripción mensual sencilla", "3 días hábiles para cancelar sin costo", "En inglés o en español"],
  },
  stats: { of: (n) => `1 de ${n}` },
  quiz: {
    eyebrow: "Revisión de 30 segundos",
    title: "¿Qué hay en tu reporte?",
    lead: "Toca lo que ves en tu reporte. Te explicamos cada cosa, qué dice la ley y qué hacemos. No necesitas datos personales.",
    question: "¿Ves alguna de estas cosas en tu reporte?",
    hint: "Toca todas las que apliquen.",
    items: {
      late: {
        label: "Pagos tarde",
        title: "Pagos tarde",
        what: "Un acreedor reportó un pago como atrasado.",
        right: "Si es correcto, puede quedarse hasta 7 años. Si pagaste a tiempo, puedes disputarlo.",
        we: "Si nos dices que está mal, nuestro equipo prepara y envía cartas pidiendo a los burós que lo revisen.",
        source: SRC.howLong,
      },
      collection: {
        label: "Cobranzas",
        title: "Cobranzas",
        what: "Un cobrador dice que debes una deuda, muchas veces una cuenta vieja que le pasaron o vendieron.",
        right: "Puedes disputarla si no es tuya, si el monto está mal o si es demasiado vieja.",
        we: "Tus cartas van a los burós y, por correo certificado, al cobrador.",
        source: SRC.collections,
      },
      inquiry: {
        label: "Consultas que no reconoces",
        title: "Consultas que no reconoces",
        what: "Una consulta muestra quién vio tu reporte. Una consulta dura suele venir de pedir crédito.",
        right: "Una que no reconoces puede ser un error o una señal de robo de identidad. Puedes disputarla.",
        we: "Si la marcas, nuestro equipo la incluye en tus cartas a los burós.",
        source: SRC.inquiry,
      },
      notMine: {
        label: "Cuentas que no son mías",
        title: "Cuentas que no son tuyas",
        what: "Una cuenta que nunca abriste puede venir de un expediente mezclado o de robo de identidad.",
        right: "Puedes disputar cuentas que no son tuyas. Si es robo de identidad, repórtalo en IdentityTheft.gov.",
        we: "Tú nos dices cuáles no son tuyas. Nuestro equipo prepara y envía las cartas, y ves cada fecha.",
        source: SRC.idTheft,
      },
      personal: {
        label: "Nombre o dirección incorrectos",
        title: "Nombre, dirección u otros datos incorrectos",
        what: "Tu reporte muestra nombres, direcciones y otros datos personales.",
        right: "Datos incorrectos pueden mezclar tu expediente con el de otra persona. Puedes pedirle al buró que los corrija.",
        we: "Tus datos personales son parte de cada revisión. Marca lo que está mal y va en tus cartas.",
        source: SRC.disputes,
      },
      balance: {
        label: "Saldo o estado incorrecto",
        title: "Saldo o estado incorrecto",
        what: "Un saldo, un límite o un estado como abierta o pagada puede estar mal reportado.",
        right: "Puedes disputar cualquier dato que creas inexacto.",
        we: "Tú dices qué está mal y por qué. La carta pide al buró y al acreedor que revisen ese dato.",
        source: SRC.disputes,
      },
      old: {
        label: "Cosas de hace más de 7 años",
        title: "Cosas de hace más de 7 años",
        what: "La mayoría de lo negativo puede reportarse 7 años. Algunas bancarrotas pueden quedarse 10.",
        right: "Después, la ley dice que un buró ya no puede seguir reportando la mayoría. Hay excepciones.",
        we: "Si ves algo que ya pasó su tiempo, márcalo como desactualizado. Nuestro equipo lo incluye en tus cartas.",
        source: SRC.fcra605,
      },
    },
    none: "Ninguna de estas",
    show: "Explícame",
    restart: "Empezar de nuevo",
    selected: (n) => (n === 1 ? "1 seleccionada" : `${n} seleccionadas`),
    resultTitle: "Esto quiere decir cada una",
    resultLead: "Información general de fuentes del gobierno. Puedes disputar errores por tu cuenta, sin costo.",
    whatLabel: "Qué es",
    rightLabel: "Qué dice la ley",
    weLabel: `Qué hace ${brand}`,
    sourceLabel: "Fuente",
    stepsTitle: "Si prefieres que un equipo lo haga",
    steps: ["Tú nos dices qué puntos crees que están mal, y por qué.", "Nuestro equipo prepara y envía las cartas.", "Ves cada carta y sus fechas en Mi caso."],
    noneTitle: "¿Nada de esta lista? Qué bueno saberlo.",
    noneBody: "Aun así conviene revisar. Puedes ver tus tres reportes cada semana, sin costo, en AnnualCreditReport.com.",
    note: "Los burós deciden, y los resultados varían. Es información general, no asesoría legal.",
    cta: "Empezar mi revisión",
  },
  story: {
    eyebrow: "Cómo funciona",
    title: "Recorre la app, paso a paso",
    lead: "Pantallas reales de la app, con datos de muestra. Tú decides; tu equipo hace el papeleo.",
    stepOf: (n) => `Paso ${n} de 5`,
    swipe: "Desliza para ver cada paso",
  },
  compare: {
    label: "Mostrar",
    showUs: brand,
    showThem: "Muchas empresas",
    hint: "Toca para cambiar entre las dos.",
  },
  timeline: {
    title: "¿Cuándo pagaría con Credalti Complete?",
    lead: "Recorre tus primeros meses. Mira cuándo salen las cartas y cuándo puede haber un cobro. (Credalti DIY es, en cambio, una suscripción mensual sencilla).",
    slider: "Meses desde que firmas",
    month: (n) => (n === 1 ? "1 mes" : `${n} meses`),
    planLabel: "Plan",
    ruleOnly: "Cómo funciona cualquier plan Complete",
    signed: "Firmas",
    cancelEnds: "Terminan tus 3 días hábiles para cancelar sin costo",
    mailed: (round) => `Se envían las cartas de la ronda ${round}`,
    chargeMay: "Puede haber un cobro, por cartas ya enviadas",
    noChargePeriod: "Sin cartas en este periodo de 30 días: no hay cobro",
    day: (n) => `Día ${n}`,
    summary: (rounds, charges, months) =>
      `En ${months === 1 ? "1 mes" : `${months} meses`}: ${rounds === 1 ? "1 ronda enviada" : `${rounds} rondas enviadas`}, y como máximo ${charges === 1 ? "1 cobro" : `${charges} cobros`}.`,
    rules: ["Con Credalti Complete, no se cobra nada antes de enviar tu primera ronda.", "Nunca más de un cobro en 30 días.", "Lo máximo que pagarás está escrito en tu acuerdo antes de firmar."],
    note: `Fechas de ejemplo. Las rondas salen más o menos cada ${CASE_NEXT_ROUND_DAYS} días; tus fechas reales dependen de tu caso.`,
    legendMailed: "Cartas enviadas",
    legendCharge: "Puede haber un cobro",
  },
  tools: {
    eyebrow: "Herramientas",
    title: "Dos calculadoras rápidas",
    lead: "Cuentas simples con lo que escribes. No se guarda ni se envía nada.",
    tabUtil: "Uso de tus tarjetas",
    tabStay: "¿Cuánto puede quedarse?",
    util: {
      title: "Uso de tus tarjetas",
      lead: "El saldo de tus tarjetas dividido entre sus límites.",
      card: (n) => `Tarjeta ${n}`,
      balance: "Saldo",
      limit: "Límite de crédito",
      add: "Agregar tarjeta",
      remove: "Quitar",
      result: (percent) => `Usas el ${percent}% de tus límites`,
      empty: "Escribe un saldo y un límite para ver la cuenta.",
      low: "Debajo del 30%: lo que sugieren muchos expertos.",
      mid: "Entre 30% y 50%. Muchos expertos sugieren debajo del 30%.",
      high: "Más de la mitad de tus límites. Muchos expertos sugieren debajo del 30%.",
      note: "Muchos expertos sugieren mantenerla debajo del 30%. Es solo una cuenta, no una predicción.",
    },
    stay: {
      title: "¿Cuánto tiempo puede quedarse en mi reporte?",
      lead: "Elige el tipo de punto y su fecha. Te mostramos hasta cuándo puede reportarse.",
      type: "Tipo de punto",
      date: "Fecha",
      result: (when) => `Puede reportarse hasta más o menos ${when}.`,
      passed: (when) => `Ese plazo terminó alrededor de ${when}. Si sigue ahí, puedes disputarlo como desactualizado.`,
      accurate: "Si es correcto, puede quedarse hasta entonces.",
      wrong: "Si está mal, puedes disputarlo en cualquier momento.",
      lawNote: "Según la ley de reportes de crédito (FCRA). Hay excepciones, y esto no es asesoría legal.",
      practiceNote: "Esto es lo que suelen hacer los burós, no una regla de la ley.",
      empty: "Elige un tipo de punto y una fecha.",
    },
    privacy: "Todo se queda en esta página. No se guarda ni se envía nada.",
  },
  after: {
    eyebrow: "Después de las cartas",
    title: "Construye tu crédito, a tu ritmo",
    lead: "Las disputas son una parte. Tu app también tiene una guía general para lo que sigue.",
    cards: [
      { title: "Un plan para construir crédito", body: "Seis hábitos, ordenados según tu propio reporte: pagar a tiempo, mantener saldos bajos, no cerrar cuentas viejas y más." },
      { title: "Un camino para comprar casa", body: "Metas, y lo que suelen revisar los prestamistas. Los requisitos varían, y el prestamista decide." },
      { title: "Ayuda para personas con ITIN", body: "Cómo funciona un expediente de crédito con ITIN, cómo pedir reportes por correo y cómo construir crédito." },
    ],
    note: "Información general en tu app, junto al servicio. No es una promesa de préstamo ni de resultados.",
  },
  teaser: {
    title: "¿Te preparas para comprar casa?",
    lead: "Dos preguntas rápidas, y te mostramos lo que hay en la app para ti.",
    q1: "¿Hacia qué estás trabajando?",
    goals: { home: "Comprar casa", build: "Construir mi crédito", check: "Revisar mi reporte" },
    q2: "¿Tienes número de Seguro Social o ITIN?",
    ids: { ssn: "Seguro Social", itin: "ITIN", skip: "Prefiero no decir" },
    resultTitle: "En tu app, desde el primer día",
    results: {
      build: "Un plan para construir crédito, ordenado según tu propio reporte.",
      home: "El camino para comprar casa: metas y lo que suelen revisar los prestamistas.",
      itin: "La guía para ITIN: reportes por correo, construir crédito y préstamos para casa con ITIN.",
      check: "Mi caso: cada carta y sus fechas, para que siempre sepas cómo va todo.",
    },
    note: "Los requisitos varían según el prestamista, y el prestamista decide. Los resultados varían.",
    again: "Cambiar mis respuestas",
  },
  mobileBar: { start: "Empezar mi revisión", ask: `Pregúntale a ${alti}` },
};

export const LIVE_COPY: Record<Locale, LiveCopy> = { en, es };
