// Letter fonts.
//
// OFF BY DEFAULT, pending the attorney. The original spec rotated print and
// handwritten-looking fonts so letters would not look like a template. Under
// full service Credalti prepares and mails the letters, and making them look
// hand-made could read as hiding who prepared them (furnishers may decline
// disputes prepared by a credit repair organization, 12 C.F.R.
// 1022.43(b)(2)). Until the attorney clears it, every letter uses one plain
// print font. LETTER_FONT_ROTATION=1 turns the rotation back on.
// When on, each letter's font is picked by hashing its id, so a re-render is
// identical.

export interface LetterFont {
  family: string;
  kind: "print" | "handwritten";
  sizePt: number;
}

export const FONT_ROTATION: LetterFont[] = [
  { family: "Georgia", kind: "print", sizePt: 11 },
  { family: "Times New Roman", kind: "print", sizePt: 12 },
  { family: "Garamond", kind: "print", sizePt: 12 },
  { family: "Book Antiqua", kind: "print", sizePt: 11 },
  { family: "Caveat", kind: "handwritten", sizePt: 13 },
  { family: "Homemade Apple", kind: "handwritten", sizePt: 12 },
  { family: "Shadows Into Light", kind: "handwritten", sizePt: 13 },
];

export const DEFAULT_LETTER_FONT: LetterFont = FONT_ROTATION[1];

export function fontRotationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LETTER_FONT_ROTATION === "1";
}

export function pickFont(letterId: string, env: Record<string, string | undefined> = process.env): LetterFont {
  if (!fontRotationEnabled(env)) return DEFAULT_LETTER_FONT;
  let hash = 0;
  for (let i = 0; i < letterId.length; i++) hash = (hash * 31 + letterId.charCodeAt(i)) >>> 0;
  return FONT_ROTATION[hash % FONT_ROTATION.length];
}
