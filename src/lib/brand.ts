// The one place the brand's names, characters, logo and icons live. Pages,
// metadata, messages and the assistant's instructions read from here, so a
// rename, or a swap of which character plays which role, starts in this file.
//
// The company is Credalti; the name changed with the move to full service
// (the old name is in docs/BRAND.md). One character from the brand kit
// appears in the product (docs/BRAND.md, "Characters"):
//
// - Alti (`assistant` below), the young man in the navy overshirt, is the AI
//   assistant: the one who talks to clients and visitors (the app's chat, the
//   website's "Ask Alti", WhatsApp replies, the coach). The owner made him
//   the one who answers on 2026-11-24. Because he looks like a person, every
//   message he writes is labelled as AI next to his name ("Alti · AI
//   assistant", `aiByline`), and his first message says he is an AI assistant
//   (California B&P Code §17940 et seq., Utah Code title 13 ch. 77, Maine 10
//   M.R.S. §1500-DD, FTC Act §5; docs/BRAND.md).
// - The kit's robot, AltiBot (`cameo` below), is a small supporting cameo
//   (owner, 2026-11-24: "we can show AltiBot, but very little"): only in the
//   website's letter-mailing animation and once on the About page, beside
//   Alti. He never speaks and never authors a message; a test holds the files
//   that may name or show him. Everywhere else, what the system does on its
//   own is said plainly ("Your letters were mailed"; the console says "The
//   system" / "El sistema").
// - A real teammate's message always carries that person's own name ("Ana ·
//   Credalti team", `teamByline`), never Alti's and never a character.
//
// The character art and the logo are locked: never edit, recolour, re-crop or
// regenerate them. The files under public/brand/ are copied unchanged from the
// kit.
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

/** The robot, the small cameo (mailing animation, About page): the kit's robot art, copied unchanged under new file names. */
const CAMEO_ART: Record<CharacterView, CharacterImage> = {
  front: art("altibot_front", 363, 436),
  threeQuarter: art("altibot_three_quarter", 336, 436),
  headFront: art("altibot_head_front", 332, 213),
  headThreeQuarter: art("altibot_head_three_quarter", 304, 212),
};

/** The young man in the navy overshirt, from the brand kit's alti/ folder: the AI assistant. */
const ASSISTANT_ART: Record<CharacterView, CharacterImage> = {
  front: art("alti_front", 312, 768),
  threeQuarter: art("alti_three_quarter", 289, 768),
  headFront: art("alti_head_front", 127, 173),
  headThreeQuarter: art("alti_head_three_quarter", 128, 173),
};

// The display name, apart so the descriptions below can use it. Change it
// here: every page, message and instruction interpolates it.
const ASSISTANT = "Alti";
// The robot, renamed AltiBot by the owner on 2026-11-22; a cameo since 2026-11-24.
const CAMEO = "AltiBot";

/** The words that say "this is AI" beside the assistant's name, on every message he writes. */
const AI_LABEL = { en: "AI assistant", es: "Asistente con IA" } as const;

export const BRAND = {
  /** Company and product name, as customers read it. */
  name: "Credalti",
  /** The official logo files (see LOGO above). */
  logo: LOGO,
  /** The AI assistant's name: the one voice in the product that talks, and it is artificial intelligence. */
  assistant: ASSISTANT,
  /** The assistant's art (Alti). */
  assistantImages: ASSISTANT_ART,
  /** Image description of the assistant, for screen readers: always says AI, never a person. */
  assistantAlt: {
    es: `${ASSISTANT}, tu asistente con inteligencia artificial (no es una persona)`,
    en: `${ASSISTANT}, your artificial intelligence assistant (not a person)`,
  },
  /** "AI assistant" / "Asistente con IA": shown beside the assistant's name on every message. */
  aiLabel: AI_LABEL,
  /**
   * The robot's name: a small cameo only (the website's mailing animation and
   * the About page). Never a speaker, never a message author.
   */
  cameo: CAMEO,
  /** The cameo's art (the robot). */
  cameoImages: CAMEO_ART,
  /** Image description of the cameo, for screen readers. */
  cameoAlt: {
    es: `${CAMEO}, un pequeño robot que lleva el sobre`,
    en: `${CAMEO}, a small robot carrying the envelope`,
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
/** The cameo's name, for the checks that keep it out of letters and messages. */
export const CAMEO_NAME = BRAND.cameo;

export type BrandLocale = "es" | "en";

/** "Alti · AI assistant" / "Alti · Asistente con IA": the label on every message the assistant writes, and on the chat's header. */
export function aiByline(locale: BrandLocale): string {
  return `${ASSISTANT} · ${AI_LABEL[locale]}`;
}

/** "Ana · Credalti team" / "Ana · equipo Credalti": the label on a message a real teammate wrote. Never the assistant's name. */
export function teamByline(firstName: string, locale: BrandLocale): string {
  const team = locale === "es" ? `equipo ${BRAND.name}` : `${BRAND.name} team`;
  return firstName ? `${firstName} · ${team}` : locale === "es" ? `Una persona del equipo ${BRAND.name}` : `A person on the ${BRAND.name} team`;
}

/** Every character image the brand points at, for the check that they exist. */
export const BRAND_IMAGE_PATHS: string[] = [BRAND.assistantImages, BRAND.cameoImages].flatMap((set) =>
  Object.values(set).flatMap((image) => [image.src, image.src2x]),
);

/** Every logo and manifest icon file under public/, for the same check. */
export const BRAND_LOGO_PATHS: string[] = [
  ...Object.values(BRAND.logo).map((logo) => logo.src),
  ...APP_ICONS.manifestIcons.map((icon) => icon.src),
];
