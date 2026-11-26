import { aiByline, BRAND } from "../brand";
import { ID_TYPE_QUESTION } from "../aftercare/itin";
import { GOALS } from "../sales/invite";
import { stateLaw } from "../compliance/states";
import { reportSummaryLines } from "./reportSummary";
import { STEP_LABELS, type SignupProgress } from "./steps";
import { OPTION_NAME } from "../service/options";

// Every word of the chat signup with Alti (/registro), English first, with
// Spanish (docs/SIGNUP-CHAT.md). Alti is the AI assistant: his first message
// says he is AI and not a person, and every run of his messages carries
// "Alti · AI assistant" (aiByline) on screen. The robot never appears here.
//
// Rules the words follow, tested in src/lib/__tests__/signupChat.test.ts:
// process, never outcome (no "we remove", no points, dates or approvals);
// the client decides what is inaccurate; nothing is called free; no
// pressure ("today only", "last spots"); no score talk; no price that is not
// in an attorney-reviewed plan; short sentences.

type L = "en" | "es";

const A = BRAND.assistant;
const C = BRAND.name;

export const SIGNUP_COPY = {
  en: {
    metaTitle: `Sign up with ${A} · ${C}`,
    metaDescription: `Sign up for ${C} in a chat with ${A}, our AI assistant, in about 10 minutes. Or talk to a person on our team first.`,
    caseLabel: "Case",
    caseAria: (ref: string) => `Your case number is ${ref}`,
    progressAria: "Signup progress",
    choose: {
      title: "How would you like to start?",
      lead: "Either way, Credalti Complete is charged each month right after your letters are mailed. Credalti DIY is a simple monthly subscription.",
      alti: `Sign up now with ${A}`,
      altiSub: `About 10 minutes, in a chat. ${A} is an AI assistant, not a person.`,
      person: "Talk to a person first",
      personSub: "Our team answers your questions on WhatsApp.",
      personSubCalls: "On WhatsApp, or schedule a call.",
    },
    talk: {
      button: "Rather talk to someone?",
      title: "Talk to a person",
      lead: "A real person on our team answers. Your progress here is saved, so you can come back and pick up where you left off.",
      whatsapp: "Chat with our team on WhatsApp",
      whatsappText: (ref: string) => `Hi! I'd like to talk with someone before I sign up. My case number is ${ref}.`,
      call: "Schedule a call",
      noWhatsapp: "No one is online in this demo. With a real account, this opens a WhatsApp chat with our team.",
      close: "Back to the chat",
    },
    input: {
      send: "Send",
      firstName: "Your first name",
      lastName: "Your last name",
      email: "Your email",
      skipEmail: "Skip, use WhatsApp",
      next: "Continue",
      state: "Your state",
      question: "Your question",
      ask: "Ask",
    },
    alti: {
      hello: `Hi! I'm ${A}, ${C}'s AI assistant. I'm artificial intelligence, not a person.`,
      helloHow: "I'll help you sign up in about 10 minutes. Your progress is saved, so you can stop and come back.",
      caseRef: (ref: string) => `Your case number is ${ref}. Our team can find your signup with it.`,
      askFirstName: "What's your first name?",
      greet: (name: string) => `Nice to meet you, ${name}.`,
      askGoal: "What do you want better credit for? It tells us what matters to you.",
      askState: "Which state do you live in? We work only where the law lets us, one state at a time.",
      stateOpen: (state: string) => `Good, we work in ${state}.`,
      infoIntro: "Now a few details about you. I never ask for your Social Security number.",
      askLastName: "What's your last name, as it appears on your ID?",
      askIdType: `${ID_TYPE_QUESTION.en.title} ${ID_TYPE_QUESTION.en.sub}`,
      askEmail: "What email can we use? It's optional: most of our messages go by WhatsApp.",
      askPhone: "Last one: your cell phone number. You sign in with it. We text you a 6-digit code, only to sign in.",
      signedIn: "You're signed in. This case is now linked to your account.",
      signedInDemo: "This demo has no accounts, so we skip signing in.",
      identityIntro: "Next, a photo of your ID and a proof of address, like a utility bill. The bureaus ask for them, and they go inside every letter.",
      identityDone: "Thank you. A person on our team looks at anything the automatic check can't confirm.",
      identityLater: "That's fine. You can add them later in the app. Your letters wait until they're there.",
      reportSummary: "Here's what your report lists, in plain words:",
      reportDemo: "This is the demo's example report.",
      reportYouChoose: "After you sign, you go through each item and say which ones look wrong to you. Only you decide.",
      reportNoPromise: "Nobody can promise how the bureaus will respond. What is accurate stays on your report.",
      reportMonitoring: (provider: string | null, price: string) =>
        `Your report comes from credit monitoring${provider ? ` with ${provider}` : ""}. It's a separate subscription, about ${price} a month, that you pay to the provider.`,
      reportAfterSigning: "You turn it on right after you sign. That way you read your rights and the contract before you buy anything.",
      reportSoftPull: "I can get your report now with a soft inquiry. A soft inquiry does not affect your credit.",
      signupIntro: "Last step. Here's how the plan works.",
      optionIntro: "There are two ways to work with us, and you choose. Both start with your review: you decide what is inaccurate. Here they are side by side.",
      optionNoRush: "Take your time. I can explain the difference; the choice is yours, and you can change later.",
      optionChosen: (name: string) => `You chose ${name}. You can change it before you sign, or later.`,
      optionPreset: (name: string) => `You picked ${name} on your link, so it's marked below. Tap it to continue, or choose the other one: it's your choice.`,
      optionAsk: "What is the difference between Credalti Complete and Credalti DIY?",
      optionAskButton: "Ask Alti about the difference",
      planRule: "With Credalti Complete, nothing is charged before the work it pays for. Credalti DIY is a simple monthly subscription. Your plan is written in the agreement, so you read it before you sign.",
      disclosuresIntro: "Before the contract, the law asks that you read your rights, as their own document. Take your time.",
      questionPrompt: "Of course. What would you like to ask? I'll answer here, then we go back to the same spot.",
      backToSheet: "Whenever you're ready, we go back to where you were.",
      acknowledged: "Thanks for reading them. Now the contract: on top, what matters in plain words. Below, the full text you sign.",
      signed: (name: string, deadline: string) => `You're signed up, ${name}. You can cancel at no cost until ${deadline}.`,
      signedNext: "Your team starts no work until then. Next: turn on your credit monitoring, then review your report in the app.",
      notReady: "Your agreement is in its final review. A person on our team will write to you when it's ready to sign. Nothing is charged until you sign.",
      stateDocs: (state: string) => `Your agreement for ${state} is being prepared. A person on our team will write to you when you can read and sign it.`,
      waitlistDone: "Thank you. We'll write to you when we open in your state. Nothing else is done with your email.",
      welcomeBack: (name: string) => `Welcome back, ${name}. Let's pick up where you left off.`,
    },
    report: {
      title: "Your report",
      demoBadge: "Example",
      monitoringTitle: "Credit monitoring",
      rows: (price: string) => [
        ["What it is", "Your 3-bureau report, every month"],
        ["Price", `About ${price} a month`],
        ["Paid to", "The monitoring provider, not us"],
      ] as Array<[string, string]>,
      continue: "Continue to sign up",
      softPullConsent: "I agree",
    },
    plan: {
      title: "Your plan",
      ruleTitle: "How every charge works",
      none: "Your plan and its price are explained in the agreement before you sign.",
      continue: "Read my rights",
    },
    sheet: {
      stepOf: (n: number, state: string) => `Step ${n} of 2 · ${state}`,
      rightsTitle: "Your rights first",
      rightsLead: "The law asks that you get these statements before the contract, as their own document. Nothing is signed here yet.",
      esign: "I agree to receive and sign these documents electronically. I know I can ask for a paper copy at no cost.",
      read: "I read this",
      question: "I have a question first",
      contractTitle: "Your contract",
      contractLead: "On top, what matters in plain words. Below, the full contract: that is what you sign.",
      close: "Close",
      recorded: "The date and time you confirm are recorded.",
    },
    done: {
      title: "You're signed up",
      monitoring: "Turn on my credit monitoring",
      app: "Go to my app",
      copy: "See or print my copy",
      cancel: "You can cancel at no cost from the app, under My agreement.",
    },
    waitlist: { email: "Your email", notify: "Let me know" },
    demoAccounts: "Demo: accounts turn on once the service is set up.",
  },
  es: {
    metaTitle: `Regístrate con ${A} · ${C}`,
    metaDescription: `Regístrate en ${C} en un chat con ${A}, nuestro asistente con IA, en unos 10 minutos. O habla primero con una persona del equipo.`,
    caseLabel: "Caso",
    caseAria: (ref: string) => `Tu número de caso es ${ref}`,
    progressAria: "Avance del registro",
    choose: {
      title: "¿Cómo quieres empezar?",
      lead: "De cualquier forma, Credalti Complete se cobra cada mes justo después de enviar tus cartas. Credalti DIY es una suscripción mensual sencilla.",
      alti: `Regístrate ahora con ${A}`,
      altiSub: `Unos 10 minutos, en un chat. ${A} es un asistente con IA, no una persona.`,
      person: "Hablar primero con una persona",
      personSub: "Nuestro equipo responde tus preguntas por WhatsApp.",
      personSubCalls: "Por WhatsApp, o agenda una llamada.",
    },
    talk: {
      button: "¿Prefieres hablar con alguien?",
      title: "Hablar con una persona",
      lead: "Te responde una persona real del equipo. Tu avance aquí queda guardado: puedes volver y seguir donde te quedaste.",
      whatsapp: "Escribir al equipo por WhatsApp",
      whatsappText: (ref: string) => `¡Hola! Quiero hablar con alguien antes de registrarme. Mi número de caso es ${ref}.`,
      call: "Agendar una llamada",
      noWhatsapp: "En esta demo no hay personas conectadas. Con tu cuenta real, aquí se abre un chat de WhatsApp con nuestro equipo.",
      close: "Volver al chat",
    },
    input: {
      send: "Enviar",
      firstName: "Tu nombre",
      lastName: "Tus apellidos",
      email: "Tu correo",
      skipEmail: "Omitir, usar WhatsApp",
      next: "Continuar",
      state: "Tu estado",
      question: "Tu pregunta",
      ask: "Preguntar",
    },
    alti: {
      hello: `¡Hola! Soy ${A}, el asistente con IA de ${C}. Soy inteligencia artificial, no una persona.`,
      helloHow: "Te ayudo a registrarte en unos 10 minutos. Tu avance se guarda: puedes parar y volver cuando quieras.",
      caseRef: (ref: string) => `Tu número de caso es ${ref}. Con él, nuestro equipo encuentra tu registro.`,
      askFirstName: "¿Cómo te llamas? Solo tu nombre, por ahora.",
      greet: (name: string) => `Mucho gusto, ${name}.`,
      askGoal: "¿Para qué quieres un mejor crédito? Nos dice qué es importante para ti.",
      askState: "¿En qué estado vives? Trabajamos solo donde la ley lo permite, un estado a la vez.",
      stateOpen: (state: string) => `Bien, trabajamos en ${state}.`,
      infoIntro: "Ahora, unos datos tuyos. Nunca te pido tu número de Seguro Social.",
      askLastName: "¿Cuáles son tus apellidos, como aparecen en tu identificación?",
      askIdType: `${ID_TYPE_QUESTION.es.title} ${ID_TYPE_QUESTION.es.sub}`,
      askEmail: "¿Qué correo podemos usar? Es opcional: casi todos nuestros mensajes van por WhatsApp.",
      askPhone: "Por último, tu número de celular. Con él entras a tu cuenta. Te mandamos un código de 6 números por mensaje de texto, solo para entrar.",
      signedIn: "Ya entraste. Este caso quedó unido a tu cuenta.",
      signedInDemo: "Esta demo no tiene cuentas, así que saltamos la entrada.",
      identityIntro: "Ahora, una foto de tu identificación y un comprobante de domicilio, como un recibo de luz. Los burós los piden y van dentro de cada carta.",
      identityDone: "Gracias. Una persona del equipo revisa lo que la revisión automática no pueda confirmar.",
      identityLater: "Está bien. Puedes subirlos después en la app. Tus cartas esperan hasta que estén.",
      reportSummary: "Esto es lo que muestra tu reporte, en palabras simples:",
      reportDemo: "Este es el reporte de ejemplo de la demo.",
      reportYouChoose: "Después de firmar, revisas cada punto y dices cuáles te parecen incorrectos. Solo tú lo decides.",
      reportNoPromise: "Nadie puede prometerte cómo responderán los burós. Lo que es exacto se queda en tu reporte.",
      reportMonitoring: (provider: string | null, price: string) =>
        `Tu reporte viene del monitoreo de crédito${provider ? ` con ${provider}` : ""}. Es una suscripción aparte, de unos ${price} al mes, que pagas a quien lo ofrece.`,
      reportAfterSigning: "Lo activas justo después de firmar. Así lees tus derechos y el contrato antes de comprar nada.",
      reportSoftPull: "Puedo obtener tu reporte ahora con una consulta suave. Una consulta suave no afecta tu crédito.",
      signupIntro: "Último paso. Así funciona el plan.",
      optionIntro: "Hay dos formas de trabajar con nosotros, y tú eliges. Las dos empiezan con tu revisión: tú decides qué es inexacto. Aquí las ves lado a lado.",
      optionNoRush: "Tómate tu tiempo. Te explico la diferencia; la decisión es tuya, y puedes cambiar después.",
      optionChosen: (name: string) => `Elegiste ${name}. Puedes cambiarla antes de firmar, o después.`,
      optionPreset: (name: string) => `Elegiste ${name} en tu enlace, así que está marcada abajo. Tócala para seguir, o elige la otra: la decisión es tuya.`,
      optionAsk: "¿Qué diferencia hay entre Credalti Complete y Credalti DIY?",
      optionAskButton: "Preguntarle a Alti la diferencia",
      planRule: "Con Credalti Complete, nada se cobra antes del trabajo que paga. Credalti DIY es una suscripción mensual sencilla. Tu plan está escrito en el acuerdo, así lo lees antes de firmar.",
      disclosuresIntro: "Antes del contrato, la ley pide que leas tus derechos, como un documento aparte. Tómate tu tiempo.",
      questionPrompt: "Claro. ¿Qué quieres preguntar? Te respondo aquí y luego volvemos al mismo lugar.",
      backToSheet: "Cuando quieras, volvemos a donde estabas.",
      acknowledged: "Gracias por leerlos. Ahora el contrato: arriba, lo importante en palabras simples. Abajo, el texto completo que firmas.",
      signed: (name: string, deadline: string) => `Listo, ${name}: ya te registraste. Puedes cancelar sin costo hasta el ${deadline}.`,
      signedNext: "Tu equipo no empieza ningún trabajo antes. Lo que sigue: activa tu monitoreo de crédito y luego revisa tu reporte en la app.",
      notReady: "Tu acuerdo está en su última revisión. Una persona del equipo te escribe cuando esté listo para firmar. No se cobra nada hasta que firmes.",
      stateDocs: (state: string) => `Tu acuerdo para ${state} se está preparando. Una persona del equipo te escribe cuando puedas leerlo y firmarlo.`,
      waitlistDone: "Gracias. Te escribimos cuando abramos en tu estado. No usamos tu correo para nada más.",
      welcomeBack: (name: string) => `Qué gusto verte de nuevo, ${name}. Sigamos donde te quedaste.`,
    },
    report: {
      title: "Tu reporte",
      demoBadge: "Ejemplo",
      monitoringTitle: "Monitoreo de crédito",
      rows: (price: string) => [
        ["Qué es", "Tu reporte de los 3 burós, cada mes"],
        ["Precio", `Unos ${price} al mes`],
        ["Se paga a", "Quien ofrece el monitoreo, no a nosotros"],
      ] as Array<[string, string]>,
      continue: "Seguir al registro",
      softPullConsent: "Acepto",
    },
    plan: {
      title: "Tu plan",
      ruleTitle: "Cómo funciona cada cobro",
      none: "Tu plan y su precio se explican en el acuerdo antes de que firmes.",
      continue: "Leer mis derechos",
    },
    sheet: {
      stepOf: (n: number, state: string) => `Paso ${n} de 2 · ${state}`,
      rightsTitle: "Primero, tus derechos",
      rightsLead: "La ley pide que recibas estas declaraciones antes del contrato y por separado. Aquí todavía no firmas nada.",
      esign: "Acepto recibir y firmar estos documentos de forma electrónica. Sé que puedo pedir una copia en papel sin costo.",
      read: "Ya lo leí",
      question: "Primero tengo una pregunta",
      contractTitle: "Tu contrato",
      contractLead: "Arriba, lo importante en palabras simples. Abajo, el contrato completo: es lo que firmas.",
      close: "Cerrar",
      recorded: "Guardamos la fecha y la hora en que lo confirmas.",
    },
    done: {
      title: "Ya te registraste",
      monitoring: "Activar mi monitoreo de crédito",
      app: "Ir a mi app",
      copy: "Ver o imprimir mi copia",
      cancel: "Puedes cancelar sin costo desde la app, en Mi acuerdo.",
    },
    waitlist: { email: "Tu correo", notify: "Avísame" },
    demoAccounts: "Demo: las cuentas se activan al configurar el servicio.",
  },
} as const;

export type SignupCopy = (typeof SIGNUP_COPY)["en"];

/** A line in the chat. "alti" lines are the AI assistant's and are always labelled with aiByline. */
export interface ChatLine {
  key: string;
  who: "alti" | "you";
  text: string;
}

const goalLabel = (key: string | null, locale: L) => {
  const g = GOALS.find((x) => x.key === key);
  return g ? (locale === "es" ? g.label : g.labelEn) : "";
};

export const stateName = (code: string | null) => (code ? (stateLaw(code)?.name ?? code) : "");

/**
 * The conversation so far, rebuilt from what was answered (so it follows the
 * language switch and survives a reload). The question on screen now is the
 * last Alti line; the widget to answer it is drawn under it.
 */
export function transcript(p: SignupProgress, locale: L, extra: { demo: boolean; monitoring: { provider: string | null; price: string } }): ChatLine[] {
  const c = SIGNUP_COPY[locale];
  const a = p.answers;
  const out: ChatLine[] = [];
  const alti = (key: string, text: string) => out.push({ key, who: "alti", text });
  const you = (key: string, text: string) => out.push({ key, who: "you", text });
  const id = ID_TYPE_QUESTION[locale];

  alti("hello", c.alti.hello);
  alti("how", c.alti.helloHow);
  alti("ref", c.alti.caseRef(p.caseRef));
  alti("q-first", c.alti.askFirstName);
  if (!a.firstName) return out;
  you("a-first", a.firstName);
  alti("greet", c.alti.greet(a.firstName));
  alti("q-goal", c.alti.askGoal);
  if (!a.goal) return out;
  you("a-goal", goalLabel(a.goal, locale));
  alti("q-state", c.alti.askState);
  if (!a.state) return out;
  you("a-state", stateName(a.state));
  alti("state-ok", c.alti.stateOpen(stateName(a.state)));
  alti("info", c.alti.infoIntro);
  alti("q-last", c.alti.askLastName);
  if (!a.lastName) return out;
  you("a-last", a.lastName);
  alti("q-id", c.alti.askIdType);
  if (!a.idType) return out;
  you("a-id", a.idType === "ssn" ? id.ssn : id.itin);
  alti("q-email", c.alti.askEmail);
  if (a.email === null) return out;
  you("a-email", a.email || c.input.skipEmail);
  alti("q-phone", c.alti.askPhone);
  if (!p.signedIn) return out;
  alti("signed-in", extra.demo ? c.alti.signedInDemo : c.alti.signedIn);
  alti("identity", c.alti.identityIntro);
  if (!p.identity) return out;
  alti("identity-after", p.identity === "done" ? c.alti.identityDone : c.alti.identityLater);
  if (!p.reportSeen) return out;
  out.push(...reportLines(p, locale, extra.monitoring));
  alti("option", c.alti.optionIntro);
  alti("option-calm", c.alti.optionNoRush);
  if (!p.option) {
    if (p.presetOption) alti("option-preset", c.alti.optionPreset(OPTION_NAME[p.presetOption][locale]));
    return out;
  }
  you("a-option", OPTION_NAME[p.option][locale]);
  alti("option-chosen", c.alti.optionChosen(OPTION_NAME[p.option][locale]));
  alti("signup", c.alti.signupIntro);
  if (!p.planSeen) return out;
  alti("disclosures", c.alti.disclosuresIntro);
  return out;
}

/** What Alti says on the report step: the report in counts, or where the report comes from. */
export function reportLines(p: Pick<SignupProgress, "reportCounts" | "reportDemo">, locale: L, monitoring: { provider: string | null; price: string }): ChatLine[] {
  const c = SIGNUP_COPY[locale].alti;
  if (p.reportCounts) {
    return [
      { key: "report-summary", who: "alti", text: [c.reportSummary, ...reportSummaryLines(p.reportCounts, locale)].join(" ") },
      ...(p.reportDemo ? [{ key: "report-demo", who: "alti" as const, text: c.reportDemo }] : []),
      { key: "report-choose", who: "alti", text: c.reportYouChoose },
      { key: "report-promise", who: "alti", text: c.reportNoPromise },
    ];
  }
  return [
    { key: "report-monitoring", who: "alti", text: c.reportMonitoring(monitoring.provider, monitoring.price) },
    { key: "report-after", who: "alti", text: c.reportAfterSigning },
    { key: "report-choose", who: "alti", text: c.reportYouChoose },
  ];
}

/** The progress bar's step names, in order, for the screen. */
export function stepNames(locale: L): string[] {
  return Object.values(STEP_LABELS[locale]);
}

/** Every line the chat can show, for the copy checks (with sample values filled in). */
export function allSignupLines(locale: L): string[] {
  const lines: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") lines.push(v);
    else if (typeof v === "function") {
      const fn = v as (...args: unknown[]) => unknown;
      const out = fn.length >= 2 ? fn("Rosa", "December 2") : fn.length === 1 ? fn("Texas") : fn();
      walk(out);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(SIGNUP_COPY[locale]);
  lines.push(aiByline(locale), ...stepNames(locale));
  return lines;
}
