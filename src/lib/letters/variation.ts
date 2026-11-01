import Anthropic from "@anthropic-ai/sdk";

// Per-letter wording variation via Claude (spec §4.2) — e-OSCAR template-detection
// countermeasure, duplicating the Dispute Beast approach. The variation must
// preserve meaning, legal citations, and the item list EXACTLY; only phrasing,
// sentence order, and connective wording may change. Falls back to the template
// verbatim when no API key is configured.

const VARIATION_SYSTEM_PROMPT = `You rewrite consumer credit dispute letters so that no two letters share identical template phrasing, while preserving meaning exactly.

Hard rules:
- Keep every factual detail, every listed item line (lines starting with "-"), every legal citation, the header block (name, addresses, date), and the signature block byte-for-byte unchanged.
- Only vary the prose paragraphs: word choice, sentence order, tone (always plain, firm, first-person consumer voice).
- Never add claims, promises, threats, or new legal assertions. Never remove a request the letter makes.
- Output ONLY the rewritten letter text, nothing else.`;

export async function varyLetterWording(letterBody: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return letterBody;

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
  return text.length > 0 ? text : letterBody;
}
