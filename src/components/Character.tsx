"use client";

import { BRAND, type AssistantPose, type CharacterImage, type CharacterView } from "@/lib/brand";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";

// The brand's characters (src/lib/brand.ts; owner's decisions of 2026-11-24,
// docs/BRAND.md):
//
//   "assistant"  Alti, the AI assistant and the only voice. Use him where the
//                assistant speaks or explains, always with the AI label in
//                words beside him ("Alti · AI assistant"). Never beside a
//                message a real teammate wrote (that message carries the
//                teammate's own name), never on "talk to a person" (he is not
//                a person), and never beside what the system did on its own
//                (that is said in plain words, with an icon).
//   "cameo"      The robot, a small cameo in exactly two places: the
//                website's letter-mailing animation and the About page. Never
//                in a chat, never as an author (a test holds the list).
//
// Motion: `motion="idle"` (a slow bob) or "wave" (a short greeting sway) moves
// the whole picture with CSS transforms only (globals.css, .char-idle and
// .char-wave), never redrawing the art, and nothing moves for people who ask
// for reduced motion.
//
// Alti also has six poses (`pose="wave"`, "phone", "thumbsUp", "thinking",
// "envelope", "celebrate") and a short waving loop (`AltiWaveLoop`).
//
// The art is shown as delivered, only scaled (docs/BRAND.md).
// It is served as the kit's own @1x/@2x WebP files through srcSet, so a phone
// with a retina screen gets the @2x file and nothing is re-encoded (next/image
// would re-compress the art). Width and height are always set, so the layout
// does not move when an image arrives.

export type Character = "assistant" | "cameo";

export type CharacterMotion = "none" | "idle" | "wave";

const MOTION_CLASS: Record<CharacterMotion, string> = { none: "", idle: "char-idle", wave: "char-wave" };

function imagesOf(character: Character) {
  return character === "cameo" ? BRAND.cameoImages : BRAND.assistantImages;
}

function altOf(character: Character, locale: "es" | "en"): string {
  return (character === "cameo" ? BRAND.cameoAlt : BRAND.assistantAlt)[locale];
}

function srcSetOf(image: CharacterImage): string {
  return `${image.src} 1x, ${image.src2x} 2x`;
}

/**
 * A round avatar: the character's head on a navy or ivory circle. A wide head
 * (the robot's) is shown whole inside the circle; a tall one (Alti's head and collar) fills
 * it from the hair down, like a portrait.
 */
export function CharacterAvatar({
  character,
  size = 40,
  view = "headFront",
  tone,
  ring = false,
  decorative = false,
  className = "",
}: {
  character: Character;
  /** Diameter in px. */
  size?: number;
  view?: Extract<CharacterView, "headFront" | "headThreeQuarter">;
  /** The circle's colour. Default: ivory. */
  tone?: "navy" | "ivory";
  /** A thin gold ring around the circle. */
  ring?: boolean;
  /** True when the character's name is already written right beside it. */
  decorative?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();
  const image = imagesOf(character)[view];
  const circle = (tone ?? "ivory") === "navy" ? "bg-blue-800" : "bg-amber-50";
  const wide = image.width >= image.height;
  // Wide: the whole head, centred, with a margin. Tall: a portrait from the hair down.
  const shown = wide ? 0.84 : 0.94;
  const style = wide
    ? { width: `${shown * 100}%`, left: `${((1 - shown) / 2) * 100}%`, top: `${(1 - (shown * image.height) / image.width) / 2 * 100}%` }
    : { width: `${shown * 100}%`, left: `${((1 - shown) / 2) * 100}%`, top: "9%" };

  return (
    <span
      className={`relative block shrink-0 overflow-hidden rounded-full ${circle} ${
        ring ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white" : ""
      } ${className}`}
      style={{ width: size, height: size }}
      data-character={character}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        srcSet={srcSetOf(image)}
        width={image.width}
        height={image.height}
        alt={decorative ? "" : altOf(character, locale)}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute h-auto max-w-none select-none"
        style={style}
      />
    </span>
  );
}

/**
 * The whole character, standing. Give it a height; the width follows the art.
 * `priority` loads it at once, for the one figure at the top of the landing page.
 */
export function CharacterFigure({
  character,
  view = "front",
  pose,
  height,
  heightClassName,
  priority = false,
  decorative = false,
  motion = "none",
  className = "",
}: {
  character: Character;
  view?: Extract<CharacterView, "front" | "threeQuarter">;
  /** One of Alti's poses instead of a view (the assistant only; AltiBot has none). */
  pose?: AssistantPose;
  /** Subtle motion of the whole picture (transforms only). */
  motion?: CharacterMotion;
  /** Displayed height in px (CSS); the width keeps the art's proportions. */
  height: number;
  /**
   * Tailwind height classes that replace `height` on screen, for a figure
   * that changes size with the screen (e.g. "h-56 lg:h-96"). `height` still
   * sets the reserved shape.
   */
  heightClassName?: string;
  priority?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();
  const image = pose && character === "assistant" ? BRAND.assistantPoses[pose] : imagesOf(character)[view];
  const width = Math.round((height * image.width) / image.height);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.src}
      srcSet={srcSetOf(image)}
      width={width}
      height={height}
      alt={decorative ? "" : altOf(character, locale)}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding={priority ? "sync" : "async"}
      draggable={false}
      className={`block shrink-0 select-none ${heightClassName ? `${heightClassName} w-auto` : "h-auto"} ${MOTION_CLASS[motion]} ${className}`}
      style={heightClassName ? { aspectRatio: `${image.width} / ${image.height}` } : { width, aspectRatio: `${image.width} / ${image.height}` }}
      data-character={character}
    />
  );
}

/** The waving loop's frame size in px (the file is drawn at this size; shown at half for retina). */
const WAVE_LOOP = { src: "/brand/characters/alti_wave_loop.webp", still: "/brand/characters/alti_wave_loop_still.webp", width: 309, height: 640 };

/**
 * Alti waving hello, a 4-second loop (an animated WebP with a transparent
 * background, so it sits on any navy). The first frame (30 KB) shows at
 * once; the loop (about 1.2 MB) loads after the page and swaps in, so it never
 * slows the first paint. People who ask for reduced motion keep the still.
 * Give it a display height; the width follows.
 */
export function AltiWaveLoop({
  height,
  heightClassName,
  priority = false,
  decorative = false,
  className = "",
}: {
  height: number;
  heightClassName?: string;
  priority?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();
  const [src, setSrc] = useState(WAVE_LOOP.still);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let live = true;
    const loop = new window.Image();
    loop.onload = () => {
      if (live) setSrc(WAVE_LOOP.src);
    };
    loop.src = WAVE_LOOP.src;
    return () => {
      live = false;
    };
  }, []);
  const width = Math.round((height * WAVE_LOOP.width) / WAVE_LOOP.height);
  const ratio = `${WAVE_LOOP.width} / ${WAVE_LOOP.height}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={width}
      height={height}
      alt={decorative ? "" : altOf("assistant", locale)}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      draggable={false}
      className={`block shrink-0 select-none ${heightClassName ? `${heightClassName} w-auto` : "h-auto"} ${className}`}
      style={heightClassName ? { aspectRatio: ratio } : { width, aspectRatio: ratio }}
      data-character="assistant"
      data-loop={src === WAVE_LOOP.src ? "on" : "off"}
    />
  );
}
