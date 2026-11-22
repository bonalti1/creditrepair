import type { ItemCategory, LetterTarget, ReportItem, UserProfile } from "../../domain/types";
import { ENCLOSED_SENTENCE, itemLines, letter, type LetterContext } from "../parts";
import { letterPrintsReasons, TEMPLATES } from "../templates";

// A letter as text the owner can edit: the "Re:" line (subject) and the body,
// with the parts that change per client written as chips: {partidas},
// {detalles}, …
//
// The header (the client's name and address, the date, the recipient), the
// salutation ("To Whom It May Concern:") and the signature are not part of the
// text: every letter gets them the same way, from parts.ts, so an edit can
// never drop the client's name or the enclosure list.
//
// Version 1 of every letter is the one in code (templates.ts and the
// *Templates.ts files). builtinSource() reads it back as text by rendering the
// template with marked-up sample values, so the editor starts from exactly
// what is mailed today; a test checks that renderSource() of that text prints
// the same letter, character for character, as the template does.
//
// Paragraphs are separated by a blank line. Two chips decide whether a whole
// paragraph is printed:
//   - a paragraph with {detalles} is printed only when the client gave their
//     own words (it is left out otherwise, as detailsParagraph() does);
//   - a paragraph with {sin_detalles} is printed only when the client gave
//     none (the fallback some letters have).

export interface LetterSource {
  /** The text after "Re: ". One line, no chips. */
  subject: string;
  /** Paragraphs separated by a blank line, with chips. */
  body: string;
}

export type ChipKey = "partidas" | "detalles" | "sin_detalles" | "frase_adjuntos" | "nombre" | "destinatario";

export interface ChipInfo {
  key: ChipKey;
  /** Short label on the chip, in Spanish. */
  label: string;
  /** One line for the editor's help. */
  help: string;
  /** For the attorney's packet (English): how the chip reads where it sits. */
  attorneyLabel: string;
  /** A chip that may be added to any letter. The others only where version 1 has them. */
  optional: boolean;
}

export const CHIPS: Record<ChipKey, ChipInfo> = {
  partidas: {
    key: "partidas",
    label: "Lista de partidas",
    help: "Las cuentas o datos que el cliente marcó, una por línea, cada una con el motivo que el cliente eligió y, si el cliente decidió incluirlos, los datos de su reporte que tienen que ver con ese motivo. Va sola en su párrafo.",
    attorneyLabel: "[the items the client disputed, one per line, each followed by the reason the client chose and, only where the client chose to include them, the facts from the client's own report that relate to that reason]",
    optional: false,
  },
  detalles: {
    key: "detalles",
    label: "Palabras del cliente",
    help: "Lo que el cliente escribió con sus propias palabras. El párrafo que la tiene se imprime solo si el cliente escribió algo.",
    attorneyLabel: "[the client's own words]",
    optional: false,
  },
  sin_detalles: {
    key: "sin_detalles",
    label: "Solo si no escribió nada",
    help: "Marca un párrafo que se imprime solo cuando el cliente no escribió nada. No imprime texto.",
    attorneyLabel: "[printed only when the client gave no words of their own:]",
    optional: false,
  },
  frase_adjuntos: {
    key: "frase_adjuntos",
    label: "Frase de adjuntos",
    help: `Imprime «${ENCLOSED_SENTENCE}» solo cuando la carta lleva documentos adjuntos.`,
    attorneyLabel: `[only when documents are enclosed: "${ENCLOSED_SENTENCE}"]`,
    optional: true,
  },
  nombre: {
    key: "nombre",
    label: "Nombre del cliente",
    help: "El nombre completo del cliente, como aparece en su cuenta.",
    attorneyLabel: "[the client's full name]",
    optional: true,
  },
  destinatario: {
    key: "destinatario",
    label: "Destinatario",
    help: "El nombre del buró o de la empresa a la que va la carta.",
    attorneyLabel: "[the recipient's name]",
    optional: true,
  },
};

/** Each chip's label and help for a staff member whose console is in English (the attorney's text stays attorneyLabel). */
export const CHIP_TEXT_EN: Record<ChipKey, { label: string; help: string }> = {
  partidas: {
    label: "Item list",
    help: "The accounts or details the client marked, one per line, each with the reason the client chose and, if the client chose to include them, the details from their report that relate to that reason. Goes alone in its paragraph.",
  },
  detalles: {
    label: "Client's words",
    help: "What the client wrote in their own words. The paragraph that has it prints only if the client wrote something.",
  },
  sin_detalles: {
    label: "Only if they wrote nothing",
    help: "Marks a paragraph that prints only when the client wrote nothing. Prints no text.",
  },
  frase_adjuntos: {
    label: "Enclosures sentence",
    help: `Prints “${ENCLOSED_SENTENCE}” only when the letter has enclosed documents.`,
  },
  nombre: { label: "Client's name", help: "The client's full name, as it shows on their account." },
  destinatario: { label: "Recipient", help: "The name of the bureau or the company the letter goes to." },
};

/** A chip's label and help in the member's language. */
export function chipText(key: ChipKey, locale: "en" | "es"): { label: string; help: string } {
  return locale === "es" ? { label: CHIPS[key].label, help: CHIPS[key].help } : CHIP_TEXT_EN[key];
}

export const CHIP_KEYS = Object.keys(CHIPS) as ChipKey[];

export function isChipKey(value: string): value is ChipKey {
  return (CHIP_KEYS as string[]).includes(value);
}

/** Every {token} in a text, known or not, in order. */
export const TOKEN = /\{([^{}\s]*)\}/g;

export function tokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]!);
}

/** The known chips a text uses, each once, in the order of CHIP_KEYS. */
export function chipsUsed(source: LetterSource): ChipKey[] {
  const used = new Set(tokensIn(`${source.subject}\n${source.body}`));
  return CHIP_KEYS.filter((key) => used.has(key));
}

/** The paragraphs of a body: split on blank lines, trimmed, empty ones dropped. */
export function bodyParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** A source with its line endings and blank lines made regular: what is stored and hashed. */
export function normalizeSource(source: LetterSource): LetterSource {
  return {
    subject: source.subject.replace(/\s+/g, " ").trim(),
    body: bodyParagraphs(source.body)
      .map((p) =>
        p
          .split("\n")
          .map((line) => line.replace(/[ \t]+$/g, ""))
          .join("\n"),
      )
      .join("\n\n"),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────

/**
 * The letter this text prints for one client: the same header, salutation and
 * signature as every template (parts.ts letter()), and the body with each chip
 * filled in. Throws on an unknown chip: a version is validated before it is
 * saved, so that would be a bug.
 */
export function renderSource(templateKey: string, source: LetterSource, ctx: LetterContext): string {
  const details = ctx.details?.trim() ?? "";
  const enclosed = Boolean(ctx.enclosures && ctx.enclosures.length > 0);
  const value = (key: string): string => {
    switch (key) {
      case "partidas":
        return letterPrintsReasons(templateKey) ? itemLines(ctx.items, ctx.itemReasons, ctx.itemDetails) : itemLines(ctx.items);
      case "detalles":
        return details;
      case "sin_detalles":
        return "";
      case "frase_adjuntos":
        return enclosed ? ENCLOSED_SENTENCE : "";
      case "nombre":
        return ctx.user.fullName;
      case "destinatario":
        return ctx.target.name;
      default:
        throw new Error(`Unknown chip {${key}} in letter ${templateKey}`);
    }
  };
  // A chip that prints nothing takes one space next to it with it, so no double space is left.
  const fill = (text: string) =>
    text.replace(/( ?)\{([^{}\s]*)\}( ?)/g, (_, before: string, key: string, after: string) => {
      const filled = value(key);
      if (filled === "") return before && after ? " " : "";
      return `${before}${filled}${after}`;
    });

  const paragraphs: string[] = [];
  for (const paragraph of bodyParagraphs(source.body)) {
    const keys = tokensIn(paragraph);
    if (keys.includes("detalles") && !details) continue;
    if (keys.includes("sin_detalles") && details) continue;
    paragraphs.push(fill(paragraph));
  }
  return letter(ctx, fill(source.subject), ...paragraphs);
}

// ── Version 1: the text in code ─────────────────────────────────────────

// Marked-up sample values. U+2063 (invisible separator) never occurs in a template.
const MARK = "⁣";
const ITEMS_MARK = `${MARK}ITEMS${MARK}`;
const DETAILS_MARK = `${MARK}DETAILS${MARK}`;
const NAME_MARK = `${MARK}NAME${MARK}`;
const TARGET_MARK = `${MARK}TARGET${MARK}`;
const SALUTATION = "To Whom It May Concern:";

function probeContext(withDetails: boolean): LetterContext {
  const user: UserProfile = { id: "probe", fullName: NAME_MARK, addressLines: ["1 Probe Street", "Austin, TX 78701"], locale: "en" };
  const target: LetterTarget = { type: "bureau", key: "probe", name: TARGET_MARK, addressLines: ["P.O. Box 1", "Atlanta, GA 30301"] };
  const item: ReportItem = { fingerprint: "probe", bureau: "equifax", category: "tradeline" as ItemCategory, name: ITEMS_MARK, data: {}, negative: true };
  return {
    user,
    target,
    items: [item],
    date: "2026-01-15T12:00:00.000Z",
    roundNumber: 1,
    enclosures: ["Probe enclosure"],
    ...(withDetails ? { details: DETAILS_MARK } : {}),
  };
}

/** A rendered letter's "Re:" text and its body paragraphs, or null when it does not have the usual shape. */
export function splitLetter(text: string): { subject: string; paragraphs: string[] } | null {
  const lines = text.split("\n");
  const re = lines.findIndex((l) => l.startsWith("Re: "));
  if (re === -1) return null;
  const afterRe = lines.slice(re + 1).join("\n");
  const start = afterRe.indexOf(`${SALUTATION}\n\n`);
  const end = afterRe.lastIndexOf("\n\nSincerely,");
  if (start === -1 || end === -1 || end < start) return null;
  const body = afterRe.slice(start + SALUTATION.length + 2, end);
  return { subject: lines[re]!.slice(4), paragraphs: body.split("\n\n") };
}

function chipify(paragraph: string): string {
  if (paragraph === `- ${ITEMS_MARK}`) return "{partidas}";
  if (paragraph === ENCLOSED_SENTENCE) return "{frase_adjuntos}";
  return paragraph.split(DETAILS_MARK).join("{detalles}").split(NAME_MARK).join("{nombre}").split(TARGET_MARK).join("{destinatario}");
}

const builtinCache = new Map<string, LetterSource>();

/**
 * Version 1 of a letter as editable text, read from the template in code.
 * Throws for an unknown key, or for a template whose shape it cannot read
 * (a test runs it over every template).
 */
export function builtinSource(templateKey: string): LetterSource {
  const cached = builtinCache.get(templateKey);
  if (cached) return cached;
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown letter template: ${templateKey}`);

  const withDetails = splitLetter(template(probeContext(true)));
  const without = splitLetter(template(probeContext(false)));
  if (!withDetails || !without) throw new Error(`Letter ${templateKey} does not have the usual shape`);

  // Walk both renders together. They differ only where the client's own words
  // go: a paragraph left out without them, or replaced by a fallback.
  const out: string[] = [];
  const a = withDetails.paragraphs;
  const b = without.paragraphs;
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    const paragraph = a[i]!;
    if (!paragraph.includes(DETAILS_MARK)) {
      if (b[j] !== paragraph) throw new Error(`Letter ${templateKey}: cannot read paragraph ${i + 1}`);
      out.push(chipify(paragraph));
      j++;
      continue;
    }
    out.push(chipify(paragraph));
    // Without the client's words: either nothing in its place, or a fallback paragraph.
    if (b[j] !== undefined && b[j] !== a[i + 1] && !b[j]!.includes(MARK)) {
      out.push(`{sin_detalles} ${chipify(b[j]!)}`);
      j++;
    }
  }
  if (j !== b.length) throw new Error(`Letter ${templateKey}: paragraphs left over`);
  const source = normalizeSource({ subject: withDetails.subject, body: out.join("\n\n") });
  builtinCache.set(templateKey, source);
  return source;
}

/** The chips version 1 of a letter uses: the ones an edit must keep. */
export function requiredChips(templateKey: string): ChipKey[] {
  return chipsUsed(builtinSource(templateKey)).filter((key) => !CHIPS[key].optional);
}

/** The chips an edit of this letter may use. */
export function allowedChips(templateKey: string): ChipKey[] {
  const builtin = new Set(chipsUsed(builtinSource(templateKey)));
  return CHIP_KEYS.filter((key) => CHIPS[key].optional || builtin.has(key));
}
