import { z } from "zod";
import { BRAND } from "../brand";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { checkStaffReply, MAX_REPLY_CHARS, type ReplyProblem } from "./conversation";
import type { StaffRole } from "./types";

// "Respuestas guardadas": a small library of approved answers to the
// questions clients keep asking.
//
// How an answer gets in: after a teammate sends a reply, "Guardar como
// respuesta" offers it to the library. An administrator's goes in approved;
// a specialist's goes in as a proposal an administrator approves, edits or
// deletes. Nothing else writes it.
//
// What uses it:
//   - the console: a waiting question shows the best matching approved answer
//     first, before AltiBot's draft (bestMatch), and the queue says so;
//   - AltiBot, the client's chat (/api/coach): an approved answer that
//     matches a new question closely may answer it directly
//     (libraryReplyFor), and only after the claim rules pass again. Anything
//     else goes on exactly as before, to the model and, when it cannot answer,
//     to a person. That is how the "needs a person" list keeps shrinking.
//
// Similarity is deliberately simple: the question's meaningful words, without
// accents, plural endings or common Spanish and English words, compared as
// sets. No embeddings, no model call: a match is explainable by the words the
// two questions share, which the screen shows.

export const ANSWER_STATUSES = ["proposed", "approved"] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export interface SavedAnswer {
  id: string;
  /** A client's question this answers, as a client would write it. What new questions are compared with. */
  question: string;
  /** The answer, as it is sent. General: no names, amounts or a client's details. */
  answer: string;
  status: AnswerStatus;
  /** Handle of who proposed it. */
  createdBy: string;
  createdAt: string;
  /** Handle of the administrator who approved it; null while proposed. */
  approvedBy: string | null;
  approvedAt: string | null;
  updatedAt: string;
}

export const MAX_QUESTION_CHARS = 500;

/** What the save and edit actions accept. */
export const answerInputSchema = z.object({
  question: z.string().trim().min(8, "Escribe la pregunta del cliente.").max(MAX_QUESTION_CHARS),
  answer: z.string().trim().min(20, "La respuesta es muy corta.").max(MAX_REPLY_CHARS),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

/** The body of POST /api/staff/answers. */
export const answerActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), question: z.string(), answer: z.string(), clientFirstName: z.string().max(80).optional() }),
  z.object({ action: z.literal("edit"), id: z.string().uuid(), question: z.string(), answer: z.string() }),
  z.object({ action: z.literal("approve"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
]);
export type AnswerAction = z.infer<typeof answerActionSchema>;

// ── Who may do what ─────────────────────────────────────────────────────

/** Saving a reply to the library: whoever may answer clients. An administrator's goes in approved. */
export function statusOnSave(role: StaffRole): AnswerStatus | null {
  if (role === "admin") return "approved";
  if (role === "specialist") return "proposed";
  return null;
}

/** Approve, edit or delete: an administrator. A specialist may edit or withdraw only their own proposal. */
export function mayChange(role: StaffRole, handle: string, answer: Pick<SavedAnswer, "status" | "createdBy">, action: "edit" | "approve" | "delete"): boolean {
  if (role === "admin") return true;
  if (role !== "specialist" || action === "approve") return false;
  return answer.status === "proposed" && answer.createdBy === handle;
}

// ── What a saved answer may say ─────────────────────────────────────────

const PRIVATE_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\$\s?\d|\d+\s?(d[oó]lares|dollars|usd)\b/i, why: "Lleva un monto. Una respuesta guardada no menciona precios ni cantidades." },
  { pattern: /\b\d{3}[-\s.]?\d{2}[-\s.]?\d{4}\b/, why: "Parece un número de Seguro Social o de cuenta." },
  { pattern: /\b\d{5,}\b/, why: "Lleva un número largo (de cuenta, teléfono o caso)." },
  { pattern: /[^@\s]+@[^@\s]+\.[a-z]{2,}/i, why: "Lleva un correo electrónico." },
  { pattern: /\+?\d[\d\s().-]{8,}\d/, why: "Parece un número de teléfono." },
];

/**
 * Why an answer cannot go into the library, or an empty list. The claim rules
 * staff replies pass, plus: nothing that belongs to one client (their first
 * name, an amount, a long number, an email or a phone).
 */
export function answerProblems(input: { question: string; answer: string }, clientFirstName?: string | null): ReplyProblem[] {
  const problems = [...checkStaffReply(input.answer)];
  for (const { pattern, why } of PRIVATE_PATTERNS) {
    const match = input.answer.match(pattern);
    if (match) problems.push({ phrase: match[0], why });
  }
  const name = clientFirstName?.trim();
  if (name && name.length >= 2) {
    const match = input.answer.match(new RegExp(`\\b${escapeRegExp(name)}\\b`, "i"));
    if (match) problems.push({ phrase: match[0], why: "Lleva el nombre del cliente. Quítalo para que sirva a todos." });
  }
  return problems;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Similarity ──────────────────────────────────────────────────────────

const STOPWORDS = new Set(
  (
    "a al algo alguien ante antes aqui asi aun como con cual cuales de del desde donde dos e el ella ellos en entre era es esa ese eso esta este esto estoy fue ha hay hace hola la las le les lo los mas me mi mis muy nada ni no nos o otra otro para pero poco por porque puedo puede que quiero se sea ser si sin sobre son su sus tambien tan te tengo tiene tienen todo tu tus un una uno unos unas usted ya yo " +
    "about an and are as at be by can do does for from have how i if in is it me my of on or so that the this to was we what when where which who why will with you your"
  ).split(" "),
);

/** "¿Cuándo salen mis cartas?" → {"cuand", "salen", "carta"}: meaningful words, folded. */
export function keyWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
  return new Set(words);
}

const VERB_ENDINGS = ["iendo", "ieron", "ando", "aron", "aran", "eran", "amos", "emos", "imos", "ado", "ido", "ada", "ida", "ar", "er", "ir", "an", "en", "o", "a", "e"];

/** A light stem: plural endings and the most common verb endings, so "cartas" meets "carta" and "salen" meets "sale". */
function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  // The first ending that leaves at least four letters: "cuando" stays "cuand", "tardan" becomes "tard".
  const ending = VERB_ENDINGS.find((e) => w.length > 5 && w.endsWith(e) && w.length - e.length >= 4);
  return ending ? w.slice(0, -ending.length) : w;
}

/**
 * How alike two questions are, 0 to 1: the words they share over the words of
 * the shorter one, damped when they share only one word.
 */
export function similarity(a: string, b: string): { score: number; shared: string[]; overlap: number } {
  const x = keyWords(a);
  const y = keyWords(b);
  if (x.size === 0 || y.size === 0) return { score: 0, shared: [], overlap: 0 };
  const shared = [...x].filter((w) => y.has(w));
  const base = shared.length / Math.min(x.size, y.size);
  const union = new Set([...x, ...y]).size;
  const overlap = shared.length / union;
  // The overlap of the shorter one, balanced with the overlap of both, so a one-word question does not match everything.
  const score = shared.length < 2 ? Math.min(base, overlap) : (base + overlap) / 2;
  return { score: Math.round(score * 100) / 100, shared, overlap: Math.round(overlap * 100) / 100 };
}

/** Score at which the console suggests a saved answer first. */
export const SUGGEST_MIN_SCORE = 0.4;
/**
 * For AltiBot to answer a client with it by itself, stricter, because nobody
 * reads it first: the words the two questions share must be most of the words
 * of BOTH (shared ÷ all), not just of the shorter one. "¿Las cartas salen por
 * correo certificado?" shares "cartas" and "salen" with "¿Cuándo salen mis
 * cartas?": a suggestion for a person, never an answer by itself.
 */
export const ALTIBOT_MIN_OVERLAP = 0.6;
/** And the words the two questions must share at least, for AltiBot. */
export const ALTIBOT_MIN_SHARED = 2;

export interface AnswerMatch {
  answer: SavedAnswer;
  score: number;
  /** Shared words over all the words of both questions. */
  overlap: number;
  shared: string[];
}

/** The closest approved answer to a question, if it is close enough to suggest. */
export function bestMatch(question: string, answers: readonly SavedAnswer[], minScore = SUGGEST_MIN_SCORE): AnswerMatch | null {
  let best: AnswerMatch | null = null;
  for (const answer of answers) {
    if (answer.status !== "approved") continue;
    const { score, shared, overlap } = similarity(question, answer.question);
    if (score >= minScore && (!best || score > best.score)) best = { answer, score, shared, overlap };
  }
  return best;
}

/**
 * What AltiBot may send a client by itself from the library, or null (then
 * the question goes on as before: to the model, and to a person when the
 * model cannot answer). Only an answer an administrator approved, only a
 * close match, and only if the claim rules pass again at the moment it is
 * used: an answer approved before a rule existed is not sent.
 */
export function libraryReplyFor(question: string, answers: readonly SavedAnswer[]): AnswerMatch | null {
  const match = bestMatch(question, answers);
  if (!match || match.shared.length < ALTIBOT_MIN_SHARED || match.overlap < ALTIBOT_MIN_OVERLAP) return null;
  if (match.answer.status !== "approved" || !match.answer.approvedBy) return null;
  if (checkClaimGuardrails(match.answer.answer).length > 0) return null;
  if (answerProblems(match.answer).length > 0) return null;
  return match;
}

/** How AltiBot sends a library answer: marked as the team's approved answer, and still the AI's message. */
export function libraryReplyText(match: AnswerMatch): string {
  return `${match.answer.answer}\n\n(Respuesta aprobada por el equipo de ${BRAND.name}. Si necesitas algo más, pide hablar con una persona.)`;
}

// ── Rows ────────────────────────────────────────────────────────────────

/** A row of public.saved_answers (migration 0020) as a SavedAnswer; null when malformed. */
export function answerFromRow(row: Record<string, unknown>): SavedAnswer | null {
  const status = ANSWER_STATUSES.find((s) => s === row.status);
  if (!status || typeof row.id !== "string" || typeof row.question !== "string" || typeof row.answer !== "string") return null;
  const iso = (v: unknown) => (typeof v === "string" ? new Date(v).toISOString() : null);
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    status,
    createdBy: typeof row.created_by_name === "string" ? row.created_by_name : "equipo",
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    approvedBy: typeof row.approved_by_name === "string" ? row.approved_by_name : null,
    approvedAt: iso(row.approved_at),
    updatedAt: iso(row.updated_at) ?? iso(row.created_at) ?? new Date(0).toISOString(),
  };
}

// ── The demo's library ──────────────────────────────────────────────────

const DEMO_AT = "2026-11-01T15:00:00.000Z";

const demo = (id: string, question: string, answer: string, status: AnswerStatus = "approved", by = "carmen"): SavedAnswer => ({
  id,
  question,
  answer,
  status,
  createdBy: by,
  createdAt: DEMO_AT,
  approvedBy: status === "approved" ? "carmen" : null,
  approvedAt: status === "approved" ? DEMO_AT : null,
  updatedAt: DEMO_AT,
});

/** Invented, for the demo: what a few weeks of answering would leave behind. Every one passes answerProblems (tested). */
export const DEMO_SAVED_ANSWERS: readonly SavedAnswer[] = [
  demo(
    "00000000-0000-4000-a000-000000000001",
    "¿Cuándo salen mis cartas?",
    "Tus cartas salen en cuanto terminas la revisión de tu reporte y pasan los 3 días hábiles de tu periodo de cancelación. Nuestro equipo las prepara y las envía por correo; en la app ves cada carta y cuándo salió. Tú no tienes que enviar nada.",
  ),
  demo(
    "00000000-0000-4000-a000-000000000002",
    "¿Cuánto tardan los burós en responder a mis cartas?",
    "Los burós tienen unos 30 días para responder a cada carta desde que la reciben. Cuando pasa ese tiempo, revisamos tu reporte nuevo y en la app te mostramos qué cambió. Lo que cambia en un reporte lo deciden los burós y los resultados varían.",
  ),
  demo(
    "00000000-0000-4000-a000-000000000003",
    "¿Qué puntos debo marcar como inexactos?",
    `Esa decisión es solo tuya. Te ayuda revisar cada punto así: ¿lo reconoces?, ¿las fechas, los montos y el estado coinciden con lo que sabes? Si crees que algo no es correcto, márcalo y elige el motivo. Si es correcto, déjalo así. ${BRAND.assistant} te explica qué significa cada punto.`,
  ),
  demo(
    "00000000-0000-4000-a000-000000000004",
    "¿Por qué pago el monitoreo aparte?",
    "El monitoreo de crédito es una suscripción aparte que le pagas al servicio de monitoreo, no a nosotros. Con él vemos tu reporte de los 3 burós y lo revisamos en cada ronda. El plan de nuestro servicio está escrito en tu acuerdo y nunca se cobra un trabajo antes de hacerlo.",
  ),
  demo(
    "00000000-0000-4000-a000-000000000005",
    "¿Tengo que mandar algo por correo yo?",
    "No. Nuestro equipo prepara tus cartas y las envía por correo. Tú revisas tu reporte en la app y nos dices qué crees que es inexacto; después puedes leer cada carta y ver cómo va.",
  ),
  demo(
    "00000000-0000-4000-a000-000000000006",
    "¿Puedo activar el monitoreo con mi ITIN?",
    "Gracias por preguntar. Lo estamos confirmando con el servicio de monitoreo y te escribimos aquí mismo en cuanto lo sepamos.",
    "proposed",
    "marta",
  ),
];
