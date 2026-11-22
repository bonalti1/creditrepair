// The one place the brand's names, characters, logo and icons live. Pages,
// metadata, messages and the assistant's instructions read from here, so a
// rename, or a swap of which character plays which role, is a one-file change.
//
// The company is Credalti; the name changed with the move to full service
// (the old name is in docs/BRAND.md). Two characters from the brand kit
// (docs/BRAND.md, "Characters") appear in the product:
//
// - The AI assistant is the robot, AltiBot (`assistant` below). A robot makes
//   "this is AI" obvious, and every place he speaks still says so in words.
//   The brand kit's files still call him by his first name; the owner renamed
//   him on 2026-11-22.
// - The face of the human team is Alti. He stands for the team as a whole: he
//   never signs a message, never stands in for the teammate who wrote one, and
//   is never presented as AI.
//
// The character art and the logo are locked: never edit, recolour, re-crop or
// regenerate them. The files under public/brand/ are copied unchanged from the
// kit (the robot's files were renamed, not changed).
//
// Not renamed on purpose: localStorage keys ("bonalti.*"), routes, database
// objects, the package name and `internalName`. They come from the internal
// project name, Bonalti Credit, and customers never see them.

/** One view of a character: the @1x file, the @2x file, and the @1x size in pixels. */
export interface CharacterImage {
  src: string;
  src2x: string;
  /** Width of the @1x file in pixels; the @2x file is twice as large. */
  width: number;
  height: number;
}

/** A logo file: its path and the size of its viewBox (for width/height and the aspect ratio). */
export interface LogoImage {
  src: string;
  width: number;
  height: number;
}

/**
 * The official ✓Credalti logo (approved 2026-11-21): the brand kit's vector
 * masters, copied byte for byte into public/brand/logo/. A test holds their
 * SHA-256. Only these files are the logo: never recolour, outline, stretch or
 * rearrange them, never typeset "Credalti" in a font to imitate them, and
 * never put them on the gold accent.
 */
const LOGO = {
  /** Navy wordmark, gold check: on white and light backgrounds. */
  onLight: { src: "/brand/logo/credalti-logo-navy.svg", width: 254.93, height: 70.04 },
  /** White wordmark, gold check: on navy and other dark backgrounds. */
  onDark: { src: "/brand/logo/credalti-logo-white.svg", width: 254.93, height: 70.04 },
  /** The gold check alone (square). There is no wordmark without the check. */
  check: { src: "/brand/logo/credalti-check.svg", width: 66.12, height: 66.12 },
} as const satisfies Record<string, LogoImage>;

/**
 * Clear space around the logo, as a share of its height: the kit asks for at
 * least the height of the "C", which is about 47% of the full logo's height.
 */
export const LOGO_CLEAR_SPACE = 0.47;

/**
 * The brand kit's favicon set (approved 2026-11-21), copied unchanged.
 * favicon.ico, icon.svg and apple-icon.png sit in src/app/ (Next's file
 * conventions write their <link> tags); the manifest's PNGs sit in public/.
 */
export const APP_ICONS = {
  /** The navy of the favicon tile, the manifest and the browser's theme colour. */
  themeColor: "#12213A",
  favicon: "/favicon.ico",
  manifest: "/manifest.webmanifest",
  manifestIcons: [
    { src: "/brand/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/brand/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/brand/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
} as const;

export type CharacterView = "front" | "threeQuarter" | "headFront" | "headThreeQuarter";

function art(file: string, width: number, height: number): CharacterImage {
  return {
    src: `/brand/characters/${file}@1x.webp`,
    src2x: `/brand/characters/${file}@2x.webp`,
    width,
    height,
  };
}

/** The robot, the AI assistant: the kit's robot art, copied unchanged under new file names. */
const ASSISTANT_ART: Record<CharacterView, CharacterImage> = {
  front: art("altibot_front", 363, 436),
  threeQuarter: art("altibot_three_quarter", 336, 436),
  headFront: art("altibot_head_front", 332, 213),
  headThreeQuarter: art("altibot_head_three_quarter", 304, 212),
};

/** The young man in the navy overshirt, from the brand kit's alti/ folder. */
const ALTI_ART: Record<CharacterView, CharacterImage> = {
  front: art("alti_front", 312, 768),
  threeQuarter: art("alti_three_quarter", 289, 768),
  headFront: art("alti_head_front", 127, 173),
  headThreeQuarter: art("alti_head_three_quarter", 128, 173),
};

// The display names, apart so the descriptions below can use them.
// The robot was renamed AltiBot by the owner on 2026-11-22. Change it here:
// every page, message and instruction interpolates it.
const ASSISTANT = "AltiBot";
const TEAM_MASCOT = "Alti";

export const BRAND = {
  /** Company and product name, as customers read it. */
  name: "Credalti",
  /** The official logo files (see LOGO above). */
  logo: LOGO,
  /** The AI assistant's name: the one voice in the product that is artificial intelligence. */
  assistant: ASSISTANT,
  /** The assistant's art. */
  assistantImages: ASSISTANT_ART,
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
  /** Browser-tab title of the customer app (English first; Spanish when the visitor's language is Spanish). */
  title: "Credalti — Your AI credit assistant",
  titleEs: "Credalti — Tu asistente de crédito con IA",
  /** Browser-tab title of the ad landing page. */
  startTitle: "Credalti — Talk to our team",
  startTitleEs: "Credalti — Habla con nuestro equipo",
  /** Browser-tab title of the staff console. */
  teamTitle: "Credalti — Equipo",
  /** Internal and spec name; never shown to customers. */
  internalName: "Bonalti Credit",
} as const;

export const COMPANY_NAME = BRAND.name;
export const ASSISTANT_NAME = BRAND.assistant;
export const TEAM_MASCOT_NAME = BRAND.teamMascot;

/** Every character image the brand points at, for the check that they exist. */
export const BRAND_IMAGE_PATHS: string[] = [BRAND.assistantImages, BRAND.teamMascotImages].flatMap((set) =>
  Object.values(set).flatMap((image) => [image.src, image.src2x]),
);

/** Every logo and manifest icon file under public/, for the same check. */
export const BRAND_LOGO_PATHS: string[] = [
  ...Object.values(BRAND.logo).map((logo) => logo.src),
  ...APP_ICONS.manifestIcons.map((icon) => icon.src),
];
