import type { LetterTarget, ReportItem, UserProfile } from "../domain/types";

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
}

export type LetterTemplate = (ctx: LetterContext) => string;

export function itemLines(items: ReportItem[]): string {
  return items
    .map((i) => {
      const d = i.data as Record<string, unknown>;
      const detail = [d.accountNumberMasked, d.date, d.status].filter(Boolean).join(" · ");
      return `- ${i.name}${detail ? ` (${detail})` : ""}`;
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
  return ctx.enclosures && ctx.enclosures.length > 0 ? "I have enclosed the documents listed at the end of this letter." : "";
}

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
