import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMarketingCopy, type GuardrailViolation } from "../../src/lib/compliance/guardrails";

// A "spot" is one ad, described as data: what is said, what each shot shows,
// where the captions go. Everything brand-related comes from brand/lock.json,
// so two spots made months apart share the same Capi, look, captions and end card.

export const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface Shot {
  id: string;
  /** Clip filename inside the clips folder. */
  file: string;
  /** Seconds to generate. */
  seconds: number;
  /** Trim points inside the generated clip. */
  in: number;
  out: number;
  /** Which locked reference still the shot starts from. */
  reference: "closeup" | "wide";
  framing: string;
  action: string[];
  audio: string;
}

export interface Caption {
  /** Caption text; <b>…</b> marks the words shown in gold. */
  html: string;
  /** Seconds on the final timeline. */
  from: number;
  to: number;
}

export interface Spot {
  id: string;
  title: string;
  format: "9:16" | "16:9";
  lines: Array<{ speaker: string; text: string }>;
  shots: Shot[];
  captions: Caption[];
}

export interface Lock {
  character: { name: string; look: string; wardrobe: string; scale: string; manner: string; never: string[] };
  references: Record<"closeup" | "wide", { file: string; higgsfieldJobId: string }>;
  look: string;
  models: {
    still: { id: string; quality: string; resolution: string; creditsEach: number };
    video: { id: string; mode: string; resolution: string; creditsPerSecond: number };
  };
  voice: { status: string; direction: string };
  captions: { font: string; sizePx: number; color: string; highlight: string; stroke: string; centerY: Record<string, number> };
  endCard: { seconds: number; tagline: string; legal: string };
}

export const SIZES = { "9:16": [1080, 1920], "16:9": [1920, 1080] } as const;

export function loadLock(): Lock {
  return JSON.parse(readFileSync(join(CONTENT_DIR, "brand", "lock.json"), "utf8")) as Lock;
}

export function loadSpot(idOrPath: string): Spot {
  const path = idOrPath.endsWith(".json") ? idOrPath : join(CONTENT_DIR, "spots", `${idOrPath}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Spot;
}

export function listSpots(): Spot[] {
  return readdirSync(join(CONTENT_DIR, "spots"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => loadSpot(join(CONTENT_DIR, "spots", f)));
}

export const stripTags = (html: string) => html.replace(/<[^>]+>/g, "");

/** Every piece of text a viewer hears or reads in the finished ad. */
export function spotTexts(spot: Spot, lock: Lock): Array<{ where: string; text: string }> {
  return [
    ...spot.lines.map((l, i) => ({ where: `line ${i + 1} (${l.speaker})`, text: l.text })),
    { where: "all lines together", text: spot.lines.map((l) => l.text).join(" ") },
    ...spot.captions.map((c, i) => ({ where: `caption ${i + 1}`, text: stripTags(c.html) })),
    { where: "all captions together", text: spot.captions.map((c) => stripTags(c.html)).join(" ") },
    { where: "end card tagline", text: stripTags(lock.endCard.tagline) },
    { where: "end card legal line", text: lock.endCard.legal },
  ];
}

export interface SpotProblem {
  where: string;
  problem: string;
}

/**
 * The gate. An ad may not be generated, assembled or published unless this
 * returns an empty list: claim rules on every word, plus basic consistency.
 */
export function checkSpot(spot: Spot, lock: Lock): SpotProblem[] {
  const problems: SpotProblem[] = [];

  for (const { where, text } of spotTexts(spot, lock)) {
    for (const v of checkMarketingCopy(text) as GuardrailViolation[]) {
      problems.push({ where, problem: `claim rule "${v.rule}" matched "${v.match}"` });
    }
  }

  // Captions must say what is spoken, nothing else.
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9ñ ]/g, "").replace(/\s+/g, " ").trim();
  const spoken = norm(spot.lines.map((l) => l.text).join(" "));
  const captioned = norm(spot.captions.map((c) => stripTags(c.html)).join(" "));
  if (spot.captions.length > 0 && spoken !== captioned) {
    problems.push({ where: "captions", problem: "captions do not match the spoken lines word for word" });
  }

  // Every spoken line must be in a shot's directions, or the model will improvise.
  const directions = norm(spot.shots.flatMap((s) => s.action).join(" "));
  for (const [i, line] of spot.lines.entries()) {
    if (!directions.includes(norm(line.text))) {
      problems.push({ where: `line ${i + 1}`, problem: "not found verbatim in any shot's action" });
    }
  }

  const total = timelineSeconds(spot, lock);
  let previousEnd = 0;
  for (const [i, c] of spot.captions.entries()) {
    if (!(c.from < c.to)) problems.push({ where: `caption ${i + 1}`, problem: "ends before it starts" });
    if (c.from < previousEnd) problems.push({ where: `caption ${i + 1}`, problem: "overlaps the previous caption" });
    if (c.to > total - lock.endCard.seconds) problems.push({ where: `caption ${i + 1}`, problem: "runs into the end card" });
    previousEnd = c.to;
  }
  for (const shot of spot.shots) {
    if (!(shot.in >= 0 && shot.in < shot.out && shot.out <= shot.seconds)) {
      problems.push({ where: `shot ${shot.id}`, problem: "trim points fall outside the clip" });
    }
  }
  return problems;
}

export function timelineSeconds(spot: Spot, lock: Lock): number {
  return spot.shots.reduce((sum, s) => sum + (s.out - s.in), 0) + lock.endCard.seconds;
}

/** Credits for one clean pass: one still and one clip per shot. */
export function estimateCredits(spot: Spot, lock: Lock): number {
  const video = spot.shots.reduce((sum, s) => sum + s.seconds * lock.models.video.creditsPerSecond, 0);
  return video + spot.shots.length * lock.models.still.creditsEach;
}

const NEVER = (lock: Lock) =>
  `Not: ${lock.character.never.join("; ")}. No subtitles, no captions, no on-screen text, no logos.`;

/** The generation requests for a spot, with the locked character and look written in. */
export function buildPrompts(spot: Spot, lock: Lock) {
  const c = lock.character;
  return spot.shots.map((shot) => ({
    shot: shot.id,
    still: {
      model: lock.models.still.id,
      aspect_ratio: spot.format,
      quality: lock.models.still.quality,
      resolution: lock.models.still.resolution,
      reference: lock.references[shot.reference],
      prompt: [
        `${lock.look} Vertical or horizontal framing as set by the aspect ratio (${spot.format}).`,
        shot.framing,
        `Capi is the capybara mechanic from the reference image, unchanged. ${c.look} ${c.wardrobe} ${c.scale}`,
        "Keep faces out of the top 15 percent and the bottom 30 percent of the frame.",
        NEVER(lock),
      ].join("\n\n"),
    },
    video: {
      model: lock.models.video.id,
      mode: lock.models.video.mode,
      aspect_ratio: spot.format,
      resolution: lock.models.video.resolution,
      duration: shot.seconds,
      prompt: [
        `${lock.look} The camera does not move or zoom. Keep every character, the setting and the lighting exactly as in the first frame.`,
        `Capi is a real animal with realistic fur and natural, subtle movement; his eyes stay open, bright and alert. ${c.manner}`,
        shot.action.join("\n\n"),
        `When Capi speaks: ${lock.voice.direction}`,
        `Audio: ${shot.audio}`,
        NEVER(lock),
      ].join("\n\n"),
    },
  }));
}
