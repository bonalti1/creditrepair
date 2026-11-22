// Plain language, checked. Many clients are new to credit and some read with
// effort, so the client app aims at about a 6th-grade reading level: short
// sentences, common words, and no legal term without an explanation
// ("FCRA" is "la ley de reportes de crédito").
//
// A reading-level formula is a rough tool in Spanish; sentence length is the
// part that is easy to measure and matters most. src/lib/__tests__/plainLanguage.test.ts
// runs every client-copy dictionary through longSentences and fails on any
// sentence over MAX_SENTENCE_WORDS. The agreement's legal documents (/acuerdo)
// are attorney text and are not checked.

export const MAX_SENTENCE_WORDS = 25;

/** Sample values for copy that is a function ("Te faltan 3"). */
const SAMPLE_ARGS = [3, "12 de noviembre", 2, "Equifax", 1];

/** Every string inside a copy object: nested objects, arrays, and functions called with sample values. */
export function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    try {
      return collectStrings((value as (...args: unknown[]) => unknown)(...SAMPLE_ARGS.slice(0, (value as (...a: unknown[]) => unknown).length)), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((v) => collectStrings(v, depth + 1));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap((v) => collectStrings(v, depth + 1));
  return [];
}

/** Sentences of a text: split after . ! ? (and the line breaks between list items). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function wordsIn(sentence: string): number {
  return sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The sentences longer than the limit, with their word count. */
export function longSentences(texts: readonly string[], max = MAX_SENTENCE_WORDS): Array<{ words: number; sentence: string }> {
  const out: Array<{ words: number; sentence: string }> = [];
  for (const text of texts) {
    for (const s of sentences(text)) {
      const words = wordsIn(s);
      if (words > max) out.push({ words, sentence: s });
    }
  }
  return out;
}
