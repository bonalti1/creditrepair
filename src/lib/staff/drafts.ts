import { BRAND } from "../brand";
import { accountStanding, unpaidCharge } from "../billing/dunning";
import { sensitiveIn, redactSensitive } from "../intake/redact";
import { bestMatch, type AnswerMatch, type SavedAnswer } from "./answers";
import { checkStaffReply, MAX_REPLY_CHARS, openQuestions, threadAuthor, type ReplyProblem } from "./conversation";
import { can } from "./permissions";
import { agreementLine, clientStage, documentNames, formatDay, latestRound, missingDocuments, nextStep, reviewProgress, STAGE_TEXT, workStartsAt } from "./stage";
import type { StaffClient, StaffRole } from "./types";
import { clientLanguage, type StaffLocale } from "./i18n/locale";

// AltiBot's drafted replies for the team: when a client's question is
// waiting, the teammate sees an answer already written, in the CLIENT's
// language (i18n/locale.ts: clientLanguage, never the teammate's console
// language), that they read, edit and send with one tap. The send itself is
// the one send path (data.sendReply → /api/staff/case), with its checks.
//
// What the model is given is assembled here, and only here, so a test can
// read exactly what goes out for each role (draftFacts, draftPrompt):
//   - the client's question and the recent conversation (SSN-like numbers
//     redacted, as for AI intake);
//   - the case facts the teammate's role may see: stage, next step,
//     agreement dates, documents on file, review progress (counts only),
//     rounds and each letter's mail status; billing standing only for a role
//     with "billing.view", and never an amount. Never the report's personal
//     information, account numbers, the client's phone or address;
//   - Credalti's service facts and voice, and the claim rules;
//   - the closest approved saved answer, if there is one.
//
// What comes back is checked before anyone sees it: the staff reply rules
// (checkStaffReply), no advice on what to mark, no SSN-like number, no
// amount. A draft that fails is written again ONCE with the reasons; if the
// second one fails too, there is no draft and the screen says why.
//
// The model never decides what is inaccurate on a report. If the client asks
// what to mark, the draft explains what to check and that the decision is
// theirs (the instructions say so, and draftProblems refuses a draft that
// tells them what to mark).
//
// The instructions and the case facts given to the model stay in Spanish (the
// model reads them; nobody else does) and say which language to write in.
// What the teammate reads about a draft (why there is none, why it failed)
// is in the console's language: DraftInput.locale.

export interface DraftLetterFact {
  to: string;
  status: string;
}

export interface DraftRoundFact {
  number: number;
  status: string;
  mailedOn: string | null;
  letters: DraftLetterFact[];
}

/** The case facts a draft may use, as the teammate's role may see them. */
export interface DraftFacts {
  firstName: string;
  language: "es" | "en";
  stage: string;
  stageMeaning: string;
  nextStep: string;
  agreement: string;
  workStarts: string | null;
  documentsOnFile: string[];
  documentsMissing: string[];
  review: { total: number; answered: number; pending: number; markedInaccurate: number } | null;
  rounds: DraftRoundFact[];
  /** Null when the role may not see billing ("billing.view"). Never an amount. */
  billing: string | null;
  /** What was left out for this role, so the model says a person will check rather than guess. */
  withheld: string[];
}

/** May this role get a draft at all: they must be able to read the case and answer the client. */
export function draftAllowed(role: StaffRole | null | undefined): boolean {
  return can(role, "clients.reply") && can(role, "case.view");
}

const ROUND_STATUS: Record<string, string> = {
  draft: "en preparación",
  ready: "preparada, todavía no sale",
  mailed: "enviada, esperando respuesta de los burós",
  responded: "respondida (llegó un reporte nuevo)",
};

const MAIL_STATUS: Record<string, string> = {
  not_sent: "sin enviar",
  in_transit: "en camino",
  delivered: "entregada",
  returned: "devuelta por el correo",
  undeliverable: "no se pudo entregar",
};

const DOC_LABEL: Record<string, string> = {
  government_id: "identificación",
  proof_of_address: "comprobante de domicilio",
  ssn_card: "tarjeta de Seguro Social",
  identity_theft_report: "reporte de robo de identidad (FTC)",
};

/** The billing standing in words, without an amount. */
function billingFact(client: StaffClient): string {
  if (client.billing.pause) return "Cobros pausados por el equipo.";
  const standing = accountStanding(client.billing);
  const method = client.billing.paymentMethod ? "Tiene método de pago en archivo." : "No tiene método de pago en archivo.";
  if (standing === "past_due") {
    const charge = unpaidCharge(client.billing);
    return `Un cobro${charge ? ` de la ronda ${charge.roundNumber}` : ""} no pasó después de los reintentos; el caso está en pausa hasta que actualice su método de pago en «Mis pagos». ${method}`;
  }
  if (standing === "retrying") return `Un cobro fue rechazado y el sistema lo vuelve a intentar solo. ${method}`;
  if (standing === "current") return `Sus cobros están al corriente. Solo se cobra una ronda ya enviada. ${method}`;
  return `Todavía no se le ha cobrado nada: solo se cobra una ronda ya enviada. ${method}`;
}

/**
 * The facts for one client, as this role may see them. Null when the role
 * may not have a draft (it cannot read the case or answer the client).
 */
export function draftFacts(client: StaffClient, role: StaffRole | null | undefined, now: Date): DraftFacts | null {
  if (!draftAllowed(role)) return null;
  const stage = clientStage(client, now);
  const review = client.report ? reviewProgress(client) : null;
  const starts = workStartsAt(client, now);
  const withheld: string[] = [];
  const seesBilling = can(role, "billing.view");
  if (!seesBilling) withheld.push("cobros y pagos");
  return {
    firstName: client.firstName,
    language: client.locale === "es" ? "es" : "en",
    stage: STAGE_TEXT.es[stage].label,
    stageMeaning: STAGE_TEXT.es[stage].description,
    nextStep: nextStep(client, now, "es").text,
    agreement: agreementLine(client, now, "es"),
    workStarts: starts ? formatDay(starts) : null,
    documentsOnFile: client.documents.map((d) => DOC_LABEL[d] ?? d),
    documentsMissing: missingDocuments(client).length > 0 ? [documentNames(missingDocuments(client))] : [],
    review: review ? { total: review.total, answered: review.answered, pending: review.pending, markedInaccurate: review.inaccurate } : null,
    rounds: [...client.rounds]
      .sort((a, b) => a.number - b.number)
      .map((round) => ({
        number: round.number,
        status: ROUND_STATUS[round.status] ?? round.status,
        mailedOn: round.mailedAt ? formatDay(new Date(round.mailedAt)) : null,
        letters: round.letters.map((letter) => ({ to: letter.recipient.name, status: MAIL_STATUS[letter.mailStatus] ?? letter.mailStatus })),
      })),
    billing: seesBilling ? billingFact(client) : null,
    withheld,
  };
}

/** The question to answer: the oldest one AltiBot passed to the team, else the client's last message if nobody answered it yet. */
export function questionToAnswer(client: StaffClient): string | null {
  const waiting = openQuestions(client).find((q) => q.text.trim());
  if (waiting) return waiting.text;
  const thread = client.conversation ?? [];
  const last = thread[thread.length - 1];
  return last && last.role === "user" ? last.text : null;
}

const MAX_THREAD_LINES = 12;
const MAX_LINE_CHARS = 1000;

/** The recent conversation as lines, labelled by who wrote them, sensitive numbers redacted. */
export function conversationLines(client: StaffClient): string[] {
  return (client.conversation ?? []).slice(-MAX_THREAD_LINES).map((message) => {
    const author = threadAuthor(message, "es");
    const who = author.voice === "client" ? "Cliente" : author.voice === "assistant" ? `${BRAND.assistant} (IA)` : `Equipo (${author.label})`;
    const text = redactSensitive(message.text.replace(/\s+/g, " ").trim()).slice(0, MAX_LINE_CHARS);
    return `${who}: ${text}`;
  });
}

// ── The instructions ────────────────────────────────────────────────────

/** Fixed for every draft, so the prompt cache serves it. */
export const DRAFT_SYSTEM_PROMPT = `Escribes BORRADORES de respuesta para una persona del equipo de ${BRAND.name}. Esa persona lee el borrador, lo corrige si hace falta y lo envía en la conversación del cliente en la app, firmado con su propio nombre. Tú no envías nada.

Sobre ${BRAND.name} (lo que es cierto y se puede decir):
- Es una empresa de servicios de crédito con servicio completo, en inglés y en español, en Texas.
- El cliente firma su acuerdo de servicio; tiene 3 días hábiles para cancelar sin costo y antes de eso la ley no permite empezar ningún trabajo.
- Sube su identificación y un comprobante de domicilio en la app, y conecta su monitoreo de crédito (una suscripción aparte que le paga al servicio de monitoreo).
- Revisa cada punto de su reporte con ${BRAND.assistant} (el asistente con IA) y dice cuáles cree que son inexactos y por qué. Esas respuestas son SOLO del cliente.
- Con esas respuestas, el equipo prepara las cartas de disputa y las envía por correo, en rondas de unos 40 días. El cliente no aprueba ni envía cartas; puede leerlas y ver cómo van en la app.
- Los burós tienen unos 30 días para responder a una carta. Después, el equipo revisa el reporte nuevo y la app le muestra al cliente qué cambió.
- Solo se cobra una ronda ya enviada; nunca un trabajo antes de hacerlo. El plan y la cuota están escritos en su acuerdo.

Reglas (obligatorias, sin excepción):
1. Nunca prometas ni insinúes un resultado: nada de eliminar, borrar, reparar, arreglar, limpiar, subir el puntaje, ni plazos de resultados. Lo que cambia en un reporte lo deciden los burós; los resultados varían.
2. Nunca le digas al cliente qué marcar como inexacto ni qué motivo elegir, y nunca digas que el equipo decide qué disputar. Si pregunta qué marcar, explícale qué revisar (¿lo reconoce?, ¿las fechas, los montos y el estado coinciden?) y que la decisión es suya.
3. Nunca des un precio, un monto ni una cifra de dinero.
4. Usa solo los datos del caso que te damos. Si la respuesta depende de algo que no está ahí (por ejemplo cobros, cuando no te damos esos datos), di que la persona lo revisa y le escribe. No inventes fechas ni estados.
5. No des asesoría legal. Para robo de identidad, el reporte de la FTC se llena sin costo en IdentityTheft.gov.
6. Nunca escribas números de Seguro Social, números de cuenta ni datos de otra persona.
7. Escribe como la persona del equipo, en primera persona ("te ayudo", "nuestro equipo"). No firmes: la app pone su nombre. No digas que eres una IA.

Estilo: cálido, claro, frases cortas, sin tecnicismos; de 2 a 5 frases. Saluda al cliente por su nombre. Responde en el idioma del cliente (español si no se sabe).

Si te damos una respuesta aprobada del equipo que responde la pregunta, úsala como base y adáptala al caso, sin cambiar lo que dice.

Responde solo con el JSON pedido: {"reply": "..."}.`;

export interface DraftPromptInput {
  facts: DraftFacts;
  question: string;
  conversation: string[];
  savedAnswer?: SavedAnswer | null;
  /** On the second try: why the first draft was refused. */
  retryReasons?: string[];
}

/** The request's own text: the facts, the conversation, the question, and on a retry why the first try failed. */
export function draftUserMessage(input: DraftPromptInput): string {
  const { facts } = input;
  const lines: string[] = [];
  lines.push("DATOS DEL CASO (solo estos; no inventes otros):");
  lines.push(`- Nombre: ${facts.firstName}`);
  lines.push(`- Idioma del cliente: ${facts.language === "en" ? "inglés" : "español"}`);
  lines.push(`- Escribe el borrador en ${facts.language === "en" ? "INGLÉS" : "ESPAÑOL"}, el idioma del cliente.`);
  lines.push(`- Etapa: ${facts.stage}. ${facts.stageMeaning}`);
  lines.push(`- Qué sigue: ${facts.nextStep}`);
  lines.push(`- Acuerdo: ${facts.agreement}${facts.workStarts ? ` (se puede empezar el ${facts.workStarts})` : ""}`);
  lines.push(`- Documentos en archivo: ${facts.documentsOnFile.length > 0 ? facts.documentsOnFile.join(", ") : "ninguno"}`);
  if (facts.documentsMissing.length > 0) lines.push(`- Documentos que faltan: ${facts.documentsMissing.join(", ")}`);
  lines.push(
    facts.review
      ? `- Revisión del reporte: ${facts.review.answered} de ${facts.review.total} puntos respondidos; ${facts.review.markedInaccurate} marcados por el cliente como inexactos.`
      : "- Revisión del reporte: todavía no hay reporte importado.",
  );
  if (facts.rounds.length === 0) lines.push("- Rondas: ninguna todavía.");
  for (const round of facts.rounds) {
    const letters = round.letters.map((l) => `${l.to} (${l.status})`).join(", ");
    lines.push(`- Ronda ${round.number}: ${round.status}${round.mailedOn ? `, enviada el ${round.mailedOn}` : ""}${letters ? `. Cartas: ${letters}` : ""}.`);
  }
  if (facts.billing) lines.push(`- Cobros: ${facts.billing}`);
  if (facts.withheld.length > 0) lines.push(`- No tienes datos de: ${facts.withheld.join(", ")}. Si la pregunta es sobre eso, di que la persona lo revisa y le escribe.`);
  lines.push("");
  lines.push("CONVERSACIÓN RECIENTE (la más nueva al final):");
  lines.push(...(input.conversation.length > 0 ? input.conversation : ["(sin mensajes)"]));
  lines.push("");
  lines.push(`PREGUNTA QUE HAY QUE RESPONDER: ${redactSensitive(input.question).slice(0, MAX_LINE_CHARS)}`);
  if (input.savedAnswer) {
    lines.push("");
    lines.push(`RESPUESTA APROBADA DEL EQUIPO QUE SE PARECE (a la pregunta «${input.savedAnswer.question}»):`);
    lines.push(input.savedAnswer.answer);
  }
  if (input.retryReasons && input.retryReasons.length > 0) {
    lines.push("");
    lines.push("TU BORRADOR ANTERIOR NO SE PUDO MOSTRAR por esto. Escríbelo de nuevo sin esos problemas:");
    lines.push(...input.retryReasons.map((r) => `- ${r}`));
  }
  return lines.join("\n");
}

// ── Checking a draft ────────────────────────────────────────────────────

// Telling the client what to mark, in the forms a model would write it. The
// claim rules catch "te decimos qué marcar"; these catch the advice itself.
const MARKING_ADVICE: RegExp[] = [
  /(?<!\bno\s)\b(te\s+)?(recomiendo|recomendamos|sugiero|sugerimos|aconsejo|aconsejamos)\s+(que\s+)?(marc|disput)\w*/i,
  /(?<!\bno\s)\b(deber[ií]as|tienes\s+que|debes|conviene)\s+(marcar|disputar)\b/i,
  /\bm[aá]rcal[oa]s?\s+como\s+inexact\w+/i,
  /\bes(t[aá])?\s+(claramente\s+)?(inexact\w+|incorrect\w+|un\s+error)\b[^.!?]*\b(m[aá]rcal|disp[uú]tal)/i,
  /\byou\s+should\s+(mark|dispute|flag)\b/i,
  /\b(I|we)\s+(recommend|suggest)\s+(that\s+you\s+)?(mark|dispute|flag)/i,
  /\bmark\s+(it|this|that|them)\s+as\s+(inaccurate|wrong)/i,
];

const MONEY = /\$\s?\d|\b\d+(?:[.,]\d+)?\s?(d[oó]lares|dollars|usd)\b/i;

const DRAFT_WHY: Record<StaffLocale, { marking: string; money: string; ssnPhrase: string; ssn: string }> = {
  es: {
    marking: "Le dice al cliente qué marcar. Sus respuestas son solo suyas: se le explica qué revisar y que la decisión es suya.",
    money: "Menciona un monto. Los precios los explica el equipo, no un borrador.",
    ssnPhrase: "número de Seguro Social",
    ssn: "Parece un número de Seguro Social o una fecha de nacimiento.",
  },
  en: {
    marking: "It tells the client what to mark. Their answers are theirs alone: we explain what to check and that the decision is theirs.",
    money: "It mentions an amount. Prices are explained by the team, not by a draft.",
    ssnPhrase: "Social Security number",
    ssn: "It looks like a Social Security number or a date of birth.",
  },
};

/** Why a draft may not be shown, or an empty list. The reasons are in `locale` (the model's retry gets the Spanish ones). */
export function draftProblems(text: string, locale: StaffLocale = "es"): ReplyProblem[] {
  const why = DRAFT_WHY[locale];
  const problems = [...checkStaffReply(text, locale)];
  for (const pattern of MARKING_ADVICE) {
    const match = text.match(pattern);
    if (match) {
      problems.push({ phrase: match[0], why: why.marking });
      break;
    }
  }
  const money = text.match(MONEY);
  if (money) problems.push({ phrase: money[0], why: why.money });
  if (sensitiveIn(text).length > 0) problems.push({ phrase: why.ssnPhrase, why: why.ssn });
  return problems;
}

// ── Drafting ────────────────────────────────────────────────────────────

export interface DraftCall {
  system: string;
  user: string;
}

/** What the model returned: the reply, or why there is none ("not_configured", "api_error", "refusal", "invalid_json", "empty"). */
export interface DraftAnswer {
  reply: string | null;
  problem: string | null;
}

/** How a draft is written. The route passes the real one (draftModel.ts); tests pass their own, so no test reaches the network. */
export type DraftCaller = (call: DraftCall) => Promise<DraftAnswer>;

export type DraftOutcome =
  | { ok: true; draft: string; retried: boolean; savedAnswer: AnswerMatch | null }
  | {
      ok: false;
      code: "not_allowed" | "nothing_to_answer" | "not_configured" | "model_error" | "failed_rules";
      message: string;
      problems?: ReplyProblem[];
      /** The saved answer still offered, when one matches. */
      savedAnswer: AnswerMatch | null;
    };

export const NO_KEY_MESSAGE =
  "No hay borrador: el servidor no tiene la clave de Claude (ANTHROPIC_API_KEY). Escribe tu respuesta o usa una respuesta guardada.";

/** What the teammate reads when there is no draft, in the console's language. */
export const DRAFT_MESSAGES: Record<
  StaffLocale,
  { noKey: string; notAllowed: string; nothing: string; modelError: (assistant: string) => string; failedRules: (assistant: string) => string }
> = {
  es: {
    noKey: NO_KEY_MESSAGE,
    notAllowed: "Tu rol no responde a clientes, así que no hay borrador.",
    nothing: "No hay una pregunta del cliente esperando respuesta.",
    modelError: (assistant) => `${assistant} no pudo preparar un borrador ahora. Escribe tu respuesta o intenta de nuevo.`,
    failedRules: (assistant) => `${assistant} escribió dos borradores y ninguno pasó las reglas, así que no se muestra ninguno. Escribe tu respuesta.`,
  },
  en: {
    noKey: "No draft: the server doesn't have the Claude key (ANTHROPIC_API_KEY). Write your reply or use a saved answer.",
    notAllowed: "Your role doesn't reply to clients, so there's no draft.",
    nothing: "There's no client question waiting for an answer.",
    modelError: (assistant) => `${assistant} couldn't prepare a draft right now. Write your reply or try again.`,
    failedRules: (assistant) => `${assistant} wrote two drafts and neither passed the rules, so none is shown. Write your reply.`,
  },
};

export interface DraftInput {
  client: StaffClient;
  role: StaffRole | null | undefined;
  now: Date;
  /** Approved saved answers; the closest one IN THE CLIENT'S LANGUAGE is offered first and given to the model as a base. */
  savedAnswers?: readonly SavedAnswer[];
  /** The console's language, for what the teammate reads about the draft. Spanish when left out. */
  locale?: StaffLocale;
}

/**
 * A checked draft for the client's waiting question, or why there is none.
 * The model is asked once; a draft that breaks a rule is asked for again
 * once, with the reasons; a second failure gives no draft.
 */
export async function draftReply(input: DraftInput, caller: DraftCaller | null): Promise<DraftOutcome> {
  const words = DRAFT_MESSAGES[input.locale ?? "es"];
  const facts = draftFacts(input.client, input.role, input.now);
  const question = questionToAnswer(input.client);
  // Only an answer in the client's language: it goes to the client.
  const savedAnswer = question ? bestMatch(question, input.savedAnswers ?? [], undefined, clientLanguage(input.client)) : null;
  if (!facts) return { ok: false, code: "not_allowed", message: words.notAllowed, savedAnswer: null };
  if (!question) return { ok: false, code: "nothing_to_answer", message: words.nothing, savedAnswer };
  if (!caller) return { ok: false, code: "not_configured", message: words.noKey, savedAnswer };

  const base = { facts, question, conversation: conversationLines(input.client), savedAnswer: savedAnswer?.answer ?? null };
  let reasons: string[] = [];
  let lastProblems: ReplyProblem[] = [];
  let lastDraft = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await caller({ system: DRAFT_SYSTEM_PROMPT, user: draftUserMessage({ ...base, retryReasons: attempt > 0 ? reasons : undefined }) });
    if (answer.problem === "not_configured") return { ok: false, code: "not_configured", message: words.noKey, savedAnswer };
    const text = answer.reply?.trim().slice(0, MAX_REPLY_CHARS) ?? "";
    lastDraft = text;
    if (!text) {
      return { ok: false, code: "model_error", message: words.modelError(BRAND.assistant), savedAnswer };
    }
    // The model's retry is told why in Spanish, like the rest of its instructions.
    lastProblems = draftProblems(text, "es");
    if (lastProblems.length === 0) return { ok: true, draft: text, retried: attempt > 0, savedAnswer };
    reasons = lastProblems.map((p) => `«${p.phrase}»: ${p.why}`);
  }
  return {
    ok: false,
    code: "failed_rules",
    message: words.failedRules(BRAND.assistant),
    problems: input.locale && input.locale !== "es" ? draftProblems(lastDraft, input.locale) : lastProblems,
    savedAnswer,
  };
}

/**
 * The demo's stand-in for the model when the server has no key: a short,
 * plain reply in the CLIENT's language that only acknowledges the question,
 * so the demo shows a draft in the right language going through the same
 * checks. Never used with a database.
 */
export const demoDraftCaller: DraftCaller = async ({ user }) => {
  const name = user.match(/^- Nombre: (.+)$/m)?.[1]?.trim() ?? "";
  const english = /^- Idioma del cliente: inglés$/m.test(user);
  return {
    problem: null,
    reply: english
      ? `Hi ${name}, thanks for your question. I'm checking your case and I'll write back here today with the details.`
      : `Hola ${name}, gracias por tu pregunta. Estoy revisando tu caso y hoy mismo te escribo por aquí con los detalles.`,
  };
};
