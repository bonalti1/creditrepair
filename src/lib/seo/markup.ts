// The two marks a guide's paragraph may carry, and nothing else (no HTML):
//
//   [the words](/como-funciona)   a link: a site path, or an https:// address
//   [^fcra-611]                   a citation of one of the guide's sources
//
// Everything else is text. The public page renders the tokens as React
// elements, so nothing a writer (or Alti) types can become markup.

export type Token =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "cite"; id: string };

const MARK = /\[\^([a-z0-9-]{1,40})\]|\[([^\]\n]{1,160})\]\(([^)\s]{1,300})\)/g;

/** A link target the page may render: a site path (no "//") or an https address. */
export function safeHref(href: string): boolean {
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?=&%#]*$/.test(href)) return true;
  return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s<>"']*)?$/i.test(href);
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    if (match[1]) out.push({ kind: "cite", id: match[1] });
    else if (match[2] && match[3] && safeHref(match[3])) out.push({ kind: "link", text: match[2], href: match[3] });
    else out.push({ kind: "text", text: match[0] });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The words a reader sees: links as their words, citations dropped. */
export function plainText(text: string): string {
  return tokenize(text)
    .map((t) => (t.kind === "text" ? t.text : t.kind === "link" ? t.text : ""))
    .join("")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function linksIn(text: string): string[] {
  return tokenize(text).flatMap((t) => (t.kind === "link" ? [t.href] : []));
}

export function citationsIn(text: string): string[] {
  return tokenize(text).flatMap((t) => (t.kind === "cite" ? [t.id] : []));
}

/** Words in a text, for counts. */
export function wordCount(text: string): number {
  return plainText(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
