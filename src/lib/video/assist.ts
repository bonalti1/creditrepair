import { BRAND } from "../brand";
import { assistSystemPrompt, closestTemplate, type AssistCaller } from "../content/assist";
import { checkText, ruleText } from "../content/check";
import type { CopyField } from "../content/types";
import type { VideoIssue } from "./check";
import { newVideoId } from "./timeline";
import { VIDEO_LIMITS, type Shot, type VideoBrief, type VideoLang } from "./types";

// Alti drafts a script and a shot list from a brief, the content assistant's
// way (src/lib/content/assist.ts): with ANTHROPIC_API_KEY Claude writes (the
// content assistant's cached rules plus this format), a draft that breaks a
// blocking rule is written again once with the reasons; without the key, or
// on any failure, the closest pre-checked template and the brief's own words
// make the draft. Either way every line goes through the same check as every
// piece, and it is a draft by Alti (AI): nothing is saved until a person puts
// it in the plan, and the video's own check runs again before approval.

export interface VideoAssistRequest {
  brief: Pick<VideoBrief, "title" | "goal" | "hook" | "script" | "format">;
  language: VideoLang;
}

export interface VideoAssistOutput {
  hook: string;
  script: string;
  shots: Array<Omit<Shot, "id">>;
  postCaption: string;
  cta: string;
}

export interface VideoAssistResult extends Omit<VideoAssistOutput, "shots"> {
  shots: Shot[];
  source: "model" | "templates";
  draft: true;
  issues: VideoIssue[];
  /** Why there is no model draft (no key, refusal, API error), when there is none. */
  note: string | null;
}

export const VIDEO_ASSIST_LIMITS = { perMemberPerHour: 30, fieldMax: 4000 } as const;

const FIELD: Record<string, CopyField> = { hook: "hook", script: "script", postCaption: "caption", cta: "cta", shot: "onScreen" };

/** Every line of a draft through the same check a piece runs; the post's words say results vary. */
export function checkVideoDraft(output: VideoAssistOutput, lang: VideoLang): VideoIssue[] {
  const issues: VideoIssue[] = [];
  const seen = new Set<string>();
  const lines: Array<[string, string, string | null]> = [
    ["hook", output.hook, null],
    ["script", output.script, null],
    ["postCaption", output.postCaption, null],
    ["cta", output.cta, null],
    ...output.shots.map((s, i) => ["shot", s.onScreen, String(i)] as [string, string, string | null]),
  ];
  for (const [field, text, item] of lines) {
    if (!text.trim()) continue;
    for (const found of checkText(text, FIELD[field]!, lang)) {
      const id = `${field}.${item ?? "all"}.${found.rule}`;
      if (seen.has(id)) continue;
      seen.add(id);
      issues.push({ id, rule: found.rule, severity: found.severity, field: field === "shot" ? "overlay" : (field as VideoIssue["field"]), itemId: item, match: found.match, explain: found.explain, fix: found.fix });
    }
  }
  const vary = lang === "es" ? /resultados\s+(pueden\s+)?var[ií]a/i : /results\s+(may\s+)?vary/i;
  if (output.postCaption.trim() && !vary.test(output.postCaption)) {
    issues.push({ id: "postCaption.all.results-vary", rule: "results-vary", severity: "block", field: "postCaption", itemId: null, match: null, ...ruleText("results-vary") });
  }
  return issues;
}

const SHOT_IDEAS: Record<VideoLang, string[]> = {
  en: [
    "A team member talking to the camera, close up",
    "The app on a phone: the steps with checkmarks (never a score)",
    "Hands preparing and mailing an envelope",
    "A Texas street or the office, a few seconds of calm b-roll",
    "Two people at a table going over a printed report (no numbers in view)",
  ],
  es: [
    "Una persona del equipo hablando a la cámara, de cerca",
    "La app en un teléfono: los pasos con checks (nunca un puntaje)",
    "Manos preparando y enviando un sobre",
    "Una calle de Texas o la oficina, unos segundos de imagen tranquila",
    "Dos personas en una mesa revisando un reporte impreso (sin números a la vista)",
  ],
};

/** Sentences of a script, for one shot each. */
export function sentencesOf(script: string): string[] {
  return script
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** About how long a sentence takes to say: 2.5 words a second, from 2 to 8 seconds. */
export function spokenSeconds(sentence: string): number {
  const words = sentence.split(/\s+/).filter(Boolean).length;
  return Math.min(8, Math.max(2, Math.round((words / 2.5) * 2) / 2));
}

/** The few words shown big: the first six words of the sentence. */
function shortLine(sentence: string): string {
  const words = sentence.replace(/[.!?]+$/, "").split(/\s+/);
  return words.length <= 6 ? words.join(" ") : `${words.slice(0, 6).join(" ")}…`;
}

/** The draft without a model: the brief's words, or the closest pre-checked template's. */
export function templateVideoDraft(request: VideoAssistRequest): VideoAssistOutput {
  const lang = request.language;
  const template = closestTemplate({ topic: [request.brief.title, request.brief.goal, request.brief.hook].join(" "), type: "short_video", audience: lang === "es" ? "hispanic" : "consumers" });
  const hook = request.brief.hook.trim() || template.copy.hook[lang];
  const script = request.brief.script.trim() || template.copy.script[lang] || template.copy.caption[lang];
  const ideas = SHOT_IDEAS[lang];
  const sentences = sentencesOf(script).slice(0, 10);
  const shots: Array<Omit<Shot, "id">> = [{ seconds: 3, shot: ideas[0]!, onScreen: shortLine(hook) }];
  sentences.forEach((sentence, i) => {
    if (i === 0 && sentence === hook) return;
    shots.push({ seconds: spokenSeconds(sentence), shot: ideas[(i + 1) % ideas.length]!, onScreen: shortLine(sentence) });
  });
  const cta = template.copy.cta[lang] || (lang === "es" ? "Empezar mi revisión" : "Start my review");
  shots.push({ seconds: 3, shot: lang === "es" ? "Tarjeta final: el logo sobre azul marino y la llamada a la acción" : "End card: the logo on navy and the call to action", onScreen: cta });
  return { hook, script, shots, postCaption: template.copy.caption[lang], cta };
}

export const VIDEO_ASSIST_SCHEMA = {
  type: "object",
  properties: {
    hook: { type: "string", description: "The first 3 seconds, under 12 words." },
    script: { type: "string", description: "The spoken script, 15 to 45 seconds, at most 110 words." },
    shots: {
      type: "array",
      description: "The shot list in order: 3 to 10 shots.",
      items: {
        type: "object",
        properties: { seconds: { type: "number" }, shot: { type: "string" }, onScreen: { type: "string" } },
        required: ["seconds", "shot", "onScreen"],
        additionalProperties: false,
      },
    },
    postCaption: { type: "string", description: "The words posted with the video, at most 60 words, ending with the results-vary line." },
    cta: { type: "string", description: "2 to 4 words." },
  },
  required: ["hook", "script", "shots", "postCaption", "cta"],
  additionalProperties: false,
} as const;

/** The content assistant's fixed rules, plus what a shot list is. The same for every request, so it is cached. */
export function videoSystemPrompt(): string {
  return `${assistSystemPrompt()}

For the Video Studio you also plan short videos (Reels, TikTok, YouTube Shorts and video ads) from a brief, in ONE language (the one asked), not both:
- The hook, the spoken script, a shot list (what the camera sees, how long, the few words shown big on screen), the words posted with the video and a call to action.
- Shots are things the team can film themselves: a person talking to the camera, the app on a phone (checkmarks only, never a score), hands mailing an envelope, Texas streets, the office. Never stock footage of money, scores, dials, approvals or celebrations of a result.
- Credalti works in Texas only: never name another state, and never Georgia.
- If ${BRAND.assistant} appears, he is an overlay with his label "${BRAND.assistant} · ${BRAND.aiLabel.en}" / "${BRAND.assistant} · ${BRAND.aiLabel.es}"; never a person on camera.
- The posted words end with "Results vary." / "Los resultados varían."`;
}

export function videoUserPrompt(request: VideoAssistRequest, problems: string[] = []): string {
  const clean = (text: string, max: number) => text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  const lines = [
    `Language: ${request.language === "es" ? "Spanish" : "English"}`,
    `Format: ${request.brief.format.replace(/_/g, " ")}`,
    `Title: ${clean(request.brief.title, 120)}`,
    request.brief.goal ? `Goal: ${clean(request.brief.goal, 300)}` : "",
    request.brief.hook ? `The brief's hook: ${clean(request.brief.hook, 200)}` : "",
    request.brief.script ? `The brief's script or notes: ${clean(request.brief.script, 2000)}` : "",
  ].filter(Boolean);
  if (problems.length > 0) lines.push(`Your previous draft broke these rules; write it again without them: ${problems.join("; ")}`);
  return lines.join("\n");
}

/** The model's JSON, read strictly: anything missing or too long is refused. */
export function parseVideoAssistOutput(value: unknown): VideoAssistOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown, max: number) => (typeof x === "string" && x.length <= max ? x.trim() : null);
  const hook = str(v.hook, 200);
  const script = str(v.script, VIDEO_ASSIST_LIMITS.fieldMax);
  const postCaption = str(v.postCaption, 2200);
  const cta = str(v.cta, 60);
  const shots = Array.isArray(v.shots)
    ? v.shots.flatMap((s) => {
        const o = s as Record<string, unknown>;
        const shot = str(o?.shot, 300);
        const onScreen = str(o?.onScreen, VIDEO_LIMITS.textMax);
        const seconds = Number(o?.seconds);
        return shot !== null && onScreen !== null && Number.isFinite(seconds) ? [{ seconds: Math.min(30, Math.max(1, seconds)), shot, onScreen }] : [];
      })
    : [];
  if (hook === null || script === null || postCaption === null || cta === null || shots.length === 0) return null;
  return { hook, script, shots: shots.slice(0, 12), postCaption, cta };
}

const withIds = (output: VideoAssistOutput): Omit<VideoAssistResult, "source" | "draft" | "issues" | "note"> => ({ ...output, shots: output.shots.map((s) => ({ ...s, id: newVideoId("sh") })) });

/** The whole assistant: a model draft when a caller is given (rewritten once on a blocking rule), else the template draft. */
export async function draftVideoPlan(request: VideoAssistRequest, caller: AssistCaller | null): Promise<VideoAssistResult> {
  const fromTemplates = (note: string | null): VideoAssistResult => {
    const output = templateVideoDraft(request);
    return { ...withIds(output), source: "templates", draft: true, issues: checkVideoDraft(output, request.language), note };
  };
  if (!caller) return fromTemplates("not_configured");
  const system = videoSystemPrompt();
  let problems: string[] = [];
  let last: VideoAssistOutput | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await caller({ system, user: videoUserPrompt(request, problems) });
    if (answer.problem) return fromTemplates(answer.problem);
    const output = parseVideoAssistOutput(answer.output);
    if (!output) return fromTemplates("invalid_output");
    last = output;
    const blocking = checkVideoDraft(output, request.language).filter((i) => i.severity === "block");
    if (blocking.length === 0) break;
    problems = [...new Set(blocking.map((i) => `${i.rule}${i.match ? ` ("${i.match}")` : ""}`))];
  }
  return { ...withIds(last!), source: "model", draft: true, issues: checkVideoDraft(last!, request.language), note: null };
}
