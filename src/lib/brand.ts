// The one place the brand's names and characters live. Pages, metadata,
// messages and the assistant's instructions read from here, so a rename, or a
// swap of which character plays which role, is a one-file change.
//
// The company is Credalti; the name changed with the move to full service
// (the old name is in docs/BRAND.md). Two characters from the brand kit
// (docs/BRAND.md, "Characters") appear in the product:
//
// - The AI assistant is BONALTI, the robot. A robot makes "this is AI"
//   obvious, and every place he speaks still says so in words.
// - The face of the human team is Alti. He stands for the team as a whole: he
//   never signs a message, never stands in for the teammate who wrote one, and
//   is never presented as AI.
//
// The character art is locked: never edit, recolour, re-crop or regenerate it.
// The files under public/brand/characters/ are copied unchanged from the kit.
//
// Not renamed on purpose: localStorage keys ("bonalti.*"), routes, database
// objects and the package name. They are internal and customers never see
// them (the robot's public name happens to share the word; the keys predate it).

/** One view of a character: the @1x file, the @2x file, and the @1x size in pixels. */
export interface CharacterImage {
  src: string;
  src2x: string;
  /** Width of the @1x file in pixels; the @2x file is twice as large. */
  width: number;
  height: number;
}

export type CharacterView = "front" | "threeQuarter" | "headFront" | "headThreeQuarter";

function art(file: string, width: number, height: number): CharacterImage {
  return {
    src: `/brand/characters/${file}@1x.webp`,
    src2x: `/brand/characters/${file}@2x.webp`,
    width,
    height,
  };
}

/** The robot, from the brand kit's bonalti/ folder. */
const BONALTI_ART: Record<CharacterView, CharacterImage> = {
  front: art("bonalti_front", 363, 436),
  threeQuarter: art("bonalti_three_quarter", 336, 436),
  headFront: art("bonalti_head_front", 332, 213),
  headThreeQuarter: art("bonalti_head_three_quarter", 304, 212),
};

/** The young man in the navy overshirt, from the brand kit's alti/ folder. */
const ALTI_ART: Record<CharacterView, CharacterImage> = {
  front: art("alti_front", 312, 768),
  threeQuarter: art("alti_three_quarter", 289, 768),
  headFront: art("alti_head_front", 127, 173),
  headThreeQuarter: art("alti_head_three_quarter", 128, 173),
};

// The display names, apart so the descriptions below can use them.
// The kit styles the robot's name in capitals; the owner may prefer "Bonalti".
// Change it here: no copy, style or check depends on its casing.
const ASSISTANT = "BONALTI";
const TEAM_MASCOT = "Alti";

export const BRAND = {
  /** Company and product name, as customers read it. */
  name: "Credalti",
  /** The wordmark's two halves: the first is navy (white on dark), the second gold. */
  wordmark: ["Cred", "alti"],
  /** The AI assistant's name: the one voice in the product that is artificial intelligence. */
  assistant: ASSISTANT,
  /** The assistant's art. */
  assistantImages: BONALTI_ART,
  /** Image description of the assistant, for screen readers. */
  assistantAlt: {
    es: `${ASSISTANT}, tu asistente con inteligencia artificial`,
    en: `${ASSISTANT}, your artificial intelligence assistant`,
  },
  /** The character that stands for the human team. Never an author, never AI. */
  teamMascot: TEAM_MASCOT,
  /** The team character's art. */
  teamMascotImages: ALTI_ART,
  /** Image description of the team character, for screen readers. */
  teamMascotAlt: {
    es: `${TEAM_MASCOT}, que representa a nuestro equipo de personas`,
    en: `${TEAM_MASCOT}, who stands for our team of people`,
  },
  /** Browser-tab title of the customer app. */
  title: "Credalti — Tu asistente de crédito con IA",
  /** Browser-tab title of the ad landing page. */
  startTitle: "Credalti — Habla con nuestro equipo",
  /** Browser-tab title of the staff console. */
  teamTitle: "Credalti — Equipo",
  /** Internal and spec name; never shown to customers. */
  internalName: "Bonalti Credit",
} as const;

export const COMPANY_NAME = BRAND.name;
export const ASSISTANT_NAME = BRAND.assistant;
export const TEAM_MASCOT_NAME = BRAND.teamMascot;

/** Every image file the brand points at, for the check that they exist. */
export const BRAND_IMAGE_PATHS: string[] = [BRAND.assistantImages, BRAND.teamMascotImages].flatMap((set) =>
  Object.values(set).flatMap((image) => [image.src, image.src2x]),
);
