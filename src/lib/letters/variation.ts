import Anthropic from "@anthropic-ai/sdk";
import { reportError } from "../observability/errors";

// Per-letter wording variation via Claude (spec §4.2) — e-OSCAR template-detection
// countermeasure, duplicating the Dispute Beast approach. The variation must
// preserve meaning, legal citations, and the item list EXACTLY; only phrasing,
// sentence order, and connective wording may change. Falls back to the template
// verbatim when no API key is configured, when the model call fails, or when
// the rewrite fails the checks in variationProblems().

const VARIATION_SYSTEM_PROMPT = `You rewrite consumer credit dispute letters so that no two letters share identical template phrasing, while preserving meaning exactly.

Hard rules:
- Keep every factual detail, every listed item line (lines starting with "-"), every legal citation, the header block (name, addresses, date), and the signature block byte-for-byte unchanged.
- Only vary the prose paragraphs: word choice, sentence order, tone (always plain, firm, first-person consumer voice).
- Never add claims, promises, threats, or new legal assertions. Never remove a request the letter makes.
- Output ONLY the rewritten letter text, nothing else.`;

const CITATION = /§\s*[\w.()-]+|\d+\s+U\.S\.C\.|Section\s+\d+[A-Za-z]?(?:\([A-Za-z0-9]+\))*/g;

const lines = (text: string) => text.split("\n").map((l) => l.trimEnd());
const itemLines = (text: string) => lines(text).filter((l) => l.startsWith("- "));

/**
 * The rewrite is only allowed to change prose. This is checked, not trusted:
 * the letter that mails must list exactly the items the user attested, address
 * exactly the same recipient, cite the same law and carry the same signature.
 * Returns the reasons a rewrite is unacceptable (empty = acceptable).
 */
export function variationProblems(original: string, varied: string): string[] {
  const problems: string[] = [];

  // Item and enclosure lines: same lines, same order, nothing added or dropped.
  const before = itemLines(original);
  const after = itemLines(varied);
  if (before.length !== after.length || before.some((l, i) => l !== after[i])) {
    problems.push("item lines changed");
  }

  // Header block (sender, date, recipient): everything above the "Re:" line.
  const head = (text: string) => {
    const all = lines(text);
    const re = all.findIndex((l) => l.startsWith("Re:"));
    return re === -1 ? null : all.slice(0, re).join("\n").trim();
  };
  const originalHead = head(original);
  if (originalHead !== null && head(varied) !== originalHead) problems.push("header block changed");

  // Signature block: from "Sincerely," to the end.
  const tail = (text: string) => {
    const at = text.lastIndexOf("Sincerely,");
    return at === -1 ? null : text.slice(at).trim();
  };
  const originalTail = tail(original);
  if (originalTail !== null && tail(varied) !== originalTail) problems.push("signature block changed");

  // Every legal citation in the template must survive.
  for (const citation of new Set(original.match(CITATION) ?? [])) {
    if (!varied.includes(citation)) problems.push(`citation missing: ${citation}`);
  }

  // A rewrite that is far shorter or longer has dropped or invented content.
  const ratio = varied.length / Math.max(1, original.length);
  if (ratio < 0.6 || ratio > 1.6) problems.push("length changed too much");

  return problems;
}

/**
 * AI rewording is OFF by default, pending the attorney: its purpose was to keep
 * letters from looking like a template, which under full service could read as
 * hiding that Credalti prepared them (see letters/fonts.ts). Until cleared,
 * letters go out exactly as the reviewed template renders them.
 * LETTER_AI_REWORDING=1 turns it back on.
 */
export function rewordingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LETTER_AI_REWORDING === "1";
}

export async function varyLetterWording(letterBody: string): Promise<string> {
  if (!rewordingEnabled()) return letterBody;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return letterBody;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system: VARIATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Rewrite this letter:\n\n${letterBody}` }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text.length === 0) return letterBody;

    const problems = variationProblems(letterBody, text);
    if (problems.length > 0) {
      await reportError(new Error(`Letter variation rejected: ${problems.join("; ")}`), { where: "letters/variation" });
      return letterBody;
    }
    return text;
  } catch (error) {
    // Wording variation is an enhancement; the verbatim template is always a valid letter.
    await reportError(error, { where: "letters/variation" });
    return letterBody;
  }
}
