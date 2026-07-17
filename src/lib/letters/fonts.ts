// Print/handwritten font rotation (spec §4.2) — the second half of the e-OSCAR
// template-detection countermeasure. Each letter gets a font picked by hashing
// its id, so the same letter always renders the same way (idempotent re-renders)
// but letters across users/rounds vary.

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

export function pickFont(letterId: string): LetterFont {
  let hash = 0;
  for (let i = 0; i < letterId.length; i++) hash = (hash * 31 + letterId.charCodeAt(i)) >>> 0;
  return FONT_ROTATION[hash % FONT_ROTATION.length];
}
