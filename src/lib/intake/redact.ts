// What never leaves for the AI, and what must never come back from it.
//
// A monitoring report prints the client's Social Security number (often
// masked, sometimes not) and their date of birth. Neither is needed to read
// the accounts, and neither may be sent to the AI vendor or stored from its
// answer.
//
//   Text and saved pages: SSN-like numbers and the value after a date-of-birth
//   label are replaced with [REDACTED] here, before anything is sent.
//   PDFs and photos cannot be edited without a PDF library (none is
//   installed, on purpose): the instructions tell the model to ignore them and
//   never write them, and findSensitive() checks every string of the answer.
//   An answer with anything SSN- or birth-date-like in it is thrown away whole.

export const REDACTED = "[REDACTED]";

// 123-45-6789, 123 45 6789, 123.45.6789, and the masked forms XXX-XX-6789 / ***-**-6789.
const SSN_DASHED = /(?<![\w*•])(?:\d{3}|[xX*•]{3})[-\s.](?:\d{2}|[xX*•]{2})[-\s.]\d{4}(?!\d)/g;
// Nine digits in a row with nothing around them.
const NINE_DIGITS = /(?<![\d-])\d{9}(?![\d-])/g;
// "SSN: …", "Social Security Number …", "Seguro Social: …" up to the end of the line.
const SSN_LABEL = /\b(SSN|S\.S\.N\.|Social Security(?: Number| No\.?| #)?|Seguro Social|N[uú]mero de Seguro Social)\b\s*[:#]?\s*[^\n<]{0,40}/gi;
// "Date of Birth: 01/02/1980", "DOB 1980", "Year of Birth: 1980", "Fecha de nacimiento: …".
const DOB_LABEL = /\b(Date of Birth|Birth ?Date|Year of Birth|DOB|D\.O\.B\.|Fecha de nacimiento|A[nñ]o de nacimiento)\b\s*[:#]?\s*[^\n<]{0,40}/gi;

/** The text with SSN-like numbers and birth dates replaced. For text and HTML only. */
export function redactSensitive(text: string): string {
  return text
    .replace(SSN_LABEL, (_m, label: string) => `${label}: ${REDACTED}`)
    .replace(DOB_LABEL, (_m, label: string) => `${label}: ${REDACTED}`)
    .replace(SSN_DASHED, REDACTED)
    .replace(NINE_DIGITS, REDACTED);
}

/** Anything in one string that looks like an SSN (full or partly masked) or a birth date by its label. */
export function sensitiveIn(text: string): string[] {
  const found: string[] = [];
  if (new RegExp(SSN_DASHED.source).test(text)) found.push("ssn");
  else if (new RegExp(NINE_DIGITS.source).test(text)) found.push("ssn");
  if (/\b(SSN|Social Security|Seguro Social)\b/i.test(text)) found.push("ssn_label");
  if (/\b(Date of Birth|Birth ?Date|Year of Birth|DOB|D\.O\.B\.|Fecha de nacimiento)\b/i.test(text)) found.push("dob");
  return found;
}

/**
 * Every string anywhere in a model answer, checked. Returns the JSON paths
 * of the strings that look sensitive, with what was found; empty when clean.
 * Keys are checked too: a model could invent a field named "ssn".
 */
export function findSensitive(value: unknown, path = "$"): Array<{ path: string; kind: string }> {
  if (typeof value === "string") return sensitiveIn(value).map((kind) => ({ path, kind }));
  if (Array.isArray(value)) return value.flatMap((entry, index) => findSensitive(entry, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => [
      ...(/ssn|social.?security|birth|dob/i.test(key) ? [{ path: `${path}.${key}`, kind: "sensitive_field" }] : []),
      ...findSensitive(entry, `${path}.${key}`),
    ]);
  }
  return [];
}

// ── Saved pages → text ──────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", bull: "•", middot: "·" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * The readable text of a saved report page: scripts, styles, images and
 * markup gone, table cells kept apart with " | " and rows on their own lines.
 * A saved page is mostly markup; its text is a fraction of the tokens.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|header|footer|ul|ol|thead|tbody|caption)\s*>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim())
    .filter((line) => line.length > 0 && line !== "|")
    .join("\n");
}

/** Whitespace-insensitive, case-insensitive text for "does this quote appear in the page?". */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[\s|]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}
