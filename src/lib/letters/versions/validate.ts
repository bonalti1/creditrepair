import { ASSISTANT_NAME, BRAND, CAMEO_NAME } from "../../brand";
import { checkClaimGuardrails } from "../../compliance/guardrails";
import { ENCLOSED_SENTENCE } from "../parts";
import { TEMPLATES } from "../templates";
import { allowedChips, bodyParagraphs, builtinSource, CHIPS, isChipKey, requiredChips, TOKEN, tokensIn, type LetterSource } from "./source";

// What a new version of a letter must pass before it can be saved, and so
// before it can go to the attorney or be mailed. Checked in the browser as the
// owner types (the editor) and again on the server when it is saved.
//
// Errors stop the save. Warnings are shown and the save goes ahead: they point
// at something the attorney should look at.

export interface SourceProblem {
  /** Stable id, for tests and for the screen. */
  code: string;
  /** One plain sentence, in Spanish. */
  message: string;
}

export interface SourceCheck {
  ok: boolean;
  errors: SourceProblem[];
  warnings: SourceProblem[];
}

export const SUBJECT_MAX = 200;
export const BODY_MAX = 20_000;

/** Names that never appear in a client's letter (the same rule as the letter tests). */
const COMPANY_NAMES = new RegExp(`\\b${escapeRe(BRAND.name)}\\b|\\b${escapeRe(ASSISTANT_NAME)}\\b|\\b${escapeRe(CAMEO_NAME)}\\b|${escapeRe(BRAND.internalName)}|\\bon behalf of\\b`, "i");
const SPANISH = /[¿¡ñáéíóúü]/i;
const CITATION = /§\s*[\w.()-]+|\d+\s+U\.S\.C\.|\d+\s+C\.F\.R\.|Section\s+\d+[A-Za-z]?(?:\([A-Za-z0-9]+\))*/g;

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The text with every chip taken out: what the guardrails and the language checks read. */
function freeText(source: LetterSource): string {
  return `${source.subject}\n${source.body}`.replace(TOKEN, " ");
}

export function validateLetterSource(templateKey: string, source: LetterSource): SourceCheck {
  const errors: SourceProblem[] = [];
  const warnings: SourceProblem[] = [];
  const error = (code: string, message: string) => errors.push({ code, message });
  const warn = (code: string, message: string) => warnings.push({ code, message });

  if (!TEMPLATES[templateKey]) {
    error("unknown_template", "Esa carta no existe en la biblioteca.");
    return { ok: false, errors, warnings };
  }

  // The "Re:" line.
  const subject = source.subject;
  if (subject.trim().length === 0) error("subject_empty", "Falta el asunto (la línea «Re:»).");
  if (subject.length > SUBJECT_MAX) error("subject_long", `El asunto es muy largo: máximo ${SUBJECT_MAX} caracteres.`);
  if (/\n/.test(subject.trim())) error("subject_lines", "El asunto va en una sola línea.");
  if (tokensIn(subject).length > 0) error("subject_chip", "El asunto no lleva fichas: escríbelo como texto.");

  // The body and its chips.
  const body = source.body;
  if (bodyParagraphs(body).length === 0) error("body_empty", "La carta no tiene texto.");
  if (body.length > BODY_MAX) error("body_long", `La carta es muy larga: máximo ${BODY_MAX.toLocaleString("es-MX")} caracteres.`);

  const tokens = tokensIn(body);
  const unknown = [...new Set(tokens.filter((t) => !isChipKey(t)))];
  for (const token of unknown) error("chip_unknown", `La ficha {${token}} no existe. Usa solo las fichas de la lista.`);
  const withoutTokens = body.replace(TOKEN, "");
  if (/[{}]/.test(withoutTokens)) error("brace", "Hay una llave «{» o «}» suelta. Las fichas se insertan con los botones; no se escriben a mano.");

  const allowed = new Set<string>(allowedChips(templateKey));
  for (const token of new Set(tokens.filter(isChipKey))) {
    if (!allowed.has(token)) error("chip_not_here", `Esta carta no usa la ficha «${CHIPS[token].label}» ({${token}}): su versión incluida no la tiene.`);
  }
  for (const key of requiredChips(templateKey)) {
    const count = tokens.filter((t) => t === key).length;
    if (count === 0) error("chip_missing", `Falta la ficha «${CHIPS[key].label}» ({${key}}). Lo que el cliente declaró tiene que quedar en la carta.`);
  }
  for (const key of ["partidas", "detalles"] as const) {
    if (tokens.filter((t) => t === key).length > 1) error("chip_twice", `La ficha «${CHIPS[key].label}» va una sola vez.`);
  }

  const paragraphs = bodyParagraphs(body);
  for (const paragraph of paragraphs) {
    const inside = tokensIn(paragraph);
    if (inside.includes("partidas") && paragraph !== "{partidas}") {
      error("items_alone", "La lista de partidas va sola en su párrafo, con una línea en blanco antes y después.");
    }
    if (inside.includes("detalles") && inside.includes("sin_detalles")) {
      error("details_both", "Un mismo párrafo no puede llevar «Palabras del cliente» y «Solo si no escribió nada».");
    }
    for (const line of paragraph.split("\n")) {
      if (line.trimStart().startsWith("- ")) {
        error("dash_line", "Una línea que empieza con «- » se confunde con la lista de partidas. Escríbela como frase.");
        break;
      }
    }
  }

  // What the client's letter may say.
  const text = freeText(source);
  for (const violation of checkClaimGuardrails(text)) {
    error("guardrail", `Promete o insinúa un resultado: «${violation.match}». Una carta pide; no promete ni asegura nada.`);
  }
  if (COMPANY_NAMES.test(text)) {
    error("company_named", `La carta es del cliente y va en su nombre: no menciona a ${BRAND.name}, a ${ASSISTANT_NAME}, a ${CAMEO_NAME} ni dice «on behalf of».`);
  }
  if (SPANISH.test(text)) error("not_english", "Las cartas se envían en inglés: quita los acentos, la ñ y los signos ¿ ¡.");
  if (!/\bI\b|\bmy\b|\bme\b/i.test(body.replace(TOKEN, " "))) error("first_person", "La carta va en primera persona, con la voz del cliente (I, my).");
  if (/to whom it may concern|\bsincerely\b|^\s*re:/im.test(text)) {
    error("frame", "El saludo, la línea «Re:» y la firma se agregan solos: no los escribas en el texto.");
  }

  // Worth the attorney's attention, not a reason to refuse.
  const builtin = builtinSource(templateKey);
  const enclosesFreely = /\benclos/i.test(body.replace(TOKEN, " ").split(ENCLOSED_SENTENCE).join(""));
  if (enclosesFreely && !/\benclos/i.test(builtin.body.replace(TOKEN, " "))) {
    warn("enclosure_claim", "El texto dice que algo va adjunto fuera de la ficha «Frase de adjuntos». Una carta solo menciona lo que de verdad va en el sobre.");
  }
  const before = new Set(`${builtin.subject}\n${builtin.body}`.match(CITATION) ?? []);
  const after = `${subject}\n${body}`;
  const dropped = [...before].filter((citation) => !after.includes(citation));
  if (dropped.length > 0) warn("citation_dropped", `Se quitó una cita legal de la versión incluida: ${dropped.join("; ")}.`);

  return { ok: errors.length === 0, errors, warnings };
}
