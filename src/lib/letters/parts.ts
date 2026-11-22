import type { LetterTarget, ReportItem, UserProfile } from "../domain/types";
import { getDisputeReason } from "./reasons";

// The shared pieces every letter is built from: the context a template receives,
// the header block, the item lines and the signature. The wording checks in
// variation.ts depend on this shape: a header above a "Re:" line, item lines
// that start with "- ", and a signature that starts at "Sincerely,".

export interface LetterContext {
  user: UserProfile;
  target: LetterTarget;
  items: ReportItem[];
  date: string; // ISO date the letter is generated
  roundNumber: number;
  /** Enclosure labels (e.g. "Copy of government-issued ID") appended after the signature. */
  enclosures?: string[];
  /**
   * The consumer's own explanation, in their own words: what is wrong and what
   * the correct information is (or, for a consumer statement, the statement
   * itself). Library templates that support it print it as its own paragraph.
   * It is never generated or guessed; a letter without it simply omits the paragraph.
   */
  details?: string;
  /**
   * The standard reason the consumer picked for each item (reasons.ts), by item
   * fingerprint. A letter that disputes accuracy prints the reason's sentence
   * at the end of that item's line (not every letter does: see
   * TEMPLATES_WITHOUT_REASONS in templates.ts). An item with no entry, or with
   * a code that is not in the catalogue, is listed with no reason, exactly as
   * before reasons existed. Nobody but the consumer chooses a reason.
   */
  itemReasons?: ItemReasons;
}

/** Item fingerprint → dispute reason code. */
export type ItemReasons = Readonly<Record<string, string | undefined>>;

export type LetterTemplate = (ctx: LetterContext) => string;

/**
 * One "- " line per item. With `reasons`, an item the consumer gave a standard
 * reason for ends with that reason's sentence, on the same line, so the line is
 * still one item line for the wording checks:
 *   - Midland Credit Management (****8821 · collection): This account is not mine; …
 * Every template passes `ctx.itemReasons`; templates.ts decides which letters
 * receive them (see TEMPLATES_WITHOUT_REASONS).
 */
export function itemLines(items: ReportItem[], reasons?: ItemReasons): string {
  return items
    .map((i) => {
      const d = i.data as Record<string, unknown>;
      const detail = [d.accountNumberMasked, d.date, d.status].filter(Boolean).join(" · ");
      const line = `- ${i.name}${detail ? ` (${detail})` : ""}`;
      const code = reasons?.[i.fingerprint];
      const reason = code ? getDisputeReason(code) : undefined;
      return reason ? `${line}: ${reason.sentence}` : line;
    })
    .join("\n");
}

export function header(ctx: LetterContext): string {
  return [
    ctx.user.fullName,
    ...ctx.user.addressLines,
    "",
    new Date(ctx.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    "",
    ctx.target.name,
    ...ctx.target.addressLines,
    "",
  ].join("\n");
}

export function signature(ctx: LetterContext): string {
  let sig = `\nSincerely,\n\n${ctx.user.fullName}`;
  if (ctx.enclosures && ctx.enclosures.length > 0) {
    sig += `\n\nEnclosures:\n${ctx.enclosures.map((e) => `- ${e}`).join("\n")}`;
  }
  return sig;
}

/** The consumer's own explanation as a paragraph, or nothing when none was given. */
export function detailsParagraph(ctx: LetterContext, lead: string): string {
  const details = ctx.details?.trim();
  return details ? `${lead} ${details}` : "";
}

/**
 * A sentence pointing at the enclosure list, printed only when something is
 * actually enclosed: a letter never says a document is attached when it is not.
 * It does not say what the documents show, because the template cannot know.
 */
export function enclosedSentence(ctx: LetterContext): string {
  return ctx.enclosures && ctx.enclosures.length > 0 ? ENCLOSED_SENTENCE : "";
}

/** The sentence enclosedSentence prints. The letter editor shows it as the {frase_adjuntos} chip. */
export const ENCLOSED_SENTENCE = "I have enclosed the documents listed at the end of this letter.";

/** Joins paragraphs with a blank line, dropping any that are empty. */
export function paragraphs(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
}

/** A complete letter: header, "Re:" line, salutation, body, signature. */
export function letter(ctx: LetterContext, subject: string, ...body: string[]): string {
  return `${header(ctx)}Re: ${subject}\n\nTo Whom It May Concern:\n\n${paragraphs(...body)}\n${signature(ctx)}`;
}
