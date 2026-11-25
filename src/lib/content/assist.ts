import { BRAND } from "../brand";
import { checkText, ruleText, type ContentIssue } from "./check";
import { CONTENT_TEMPLATES, type ContentTemplate } from "./templates";
import { THEMES, type Audience, type Bilingual, type ContentType, type CopyField, type Theme } from "./types";

// Alti's writing assistant for the content team: a topic becomes hook ideas,
// a short-video script with on-screen text, a caption and a call to action,
// in English and Spanish, in the brand's voice and inside the claim rules.
//
// Two ways to write, one way to check:
//   - With ANTHROPIC_API_KEY (assistModel.ts): Claude writes as Alti, with the
//     rules below in a cached system prompt and JSON out. A draft that breaks
//     a blocking rule is written again once, with the reasons.
//   - Without it: the closest pre-checked template (templates.ts) is the
//     base, with the topic in the hooks. A normal state, not an error.
// Every output, either way, goes through checkText (the same check every
// piece runs) and is marked as a draft by Alti, an AI: it is never approved
// or published as it comes; a person edits, submits, and an administrator
// approves.

export interface AssistRequest {
  topic: string;
  type: ContentType;
  audience: Audience;
  theme?: Theme | null;
}

export interface AssistOutput {
  hooks: Bilingual[];
  onScreen: Bilingual;
  script: Bilingual;
  caption: Bilingual;
  cta: Bilingual;
}

export interface AssistResult extends AssistOutput {
  /** "model": Claude wrote it; "templates": built from a pre-checked template (no key, or the model failed). */
  source: "model" | "templates";
  /** Always true: Alti (AI) wrote it, and a person must read and edit it. */
  draft: true;
  /** The template it started from, when it did. */
  templateId: string | null;
  /** The same check every piece runs, on every line, in both languages. */
  issues: ContentIssue[];
  /** Why there is no model draft (no key, refusal, API error), when there is none. */
  note: string | null;
}

export type AssistCaller = (call: { system: string; user: string }) => Promise<{ output: unknown; problem: string | null }>;

export const ASSIST_LIMITS = { topicMax: 300, perMemberPerHour: 30 } as const;

const THEME_WORDS: Record<Theme, RegExp> = {
  rights: /\b(right|rights|fcra|law|derecho|derechos|ley)\b/i,
  myths: /\b(myth|myths|mito|mitos|true|false|verdad)\b/i,
  disputes: /\b(dispute|letter|letters|disputa|carta|cartas|bureau|bur[oó])\b/i,
  process: /\b(how|works|steps|process|c[oó]mo|pasos|proceso)\b/i,
  itin: /\b(itin|spanish|espa[nñ]ol|hispan\w*|latin\w*|inmigra\w*)\b/i,
  partners: /\b(realtor|lender|loan officer|partner|agente|prestamista|socio|socios)\b/i,
  aftercare: /\b(build|building|after|habits?|construir|despu[eé]s|h[aá]bitos?)\b/i,
  team: /\b(alti|assistant|asistente|team|equipo)\b/i,
};

/** The theme a topic is about, from its words; the request's theme wins when given. */
export function themeFor(request: AssistRequest): Theme {
  if (request.theme && THEMES.includes(request.theme)) return request.theme;
  if (request.audience === "partners") return "partners";
  if (request.audience === "hispanic" && THEME_WORDS.itin.test(request.topic)) return "itin";
  return THEMES.find((theme) => THEME_WORDS[theme].test(request.topic)) ?? "myths";
}

/** The template to start from: same audience and theme first, then theme, then type. */
export function closestTemplate(request: AssistRequest): ContentTemplate {
  const theme = themeFor(request);
  return (
    CONTENT_TEMPLATES.find((t) => t.theme === theme && t.audience === request.audience) ??
    CONTENT_TEMPLATES.find((t) => t.theme === theme) ??
    CONTENT_TEMPLATES.find((t) => t.type === request.type) ??
    CONTENT_TEMPLATES[0]!
  );
}

const clean = (text: string) => text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

/** The drafts without a model: the closest template, with the topic in two extra hooks. */
export function templateDraft(request: AssistRequest): AssistOutput & { templateId: string } {
  const template = closestTemplate(request);
  const topic = clean(request.topic).slice(0, 80).replace(/[.?!]+$/, "");
  const hooks: Bilingual[] = [template.copy.hook];
  if (topic) {
    hooks.push({ en: `${topic}: what most people don't know.`, es: `${topic}: lo que casi nadie sabe.` });
    // Mid-sentence, the topic starts in lowercase (unless it starts with an acronym such as FCRA or ITIN).
    const inner = /^[A-Z][A-Z]/.test(topic) ? topic : topic.charAt(0).toLowerCase() + topic.slice(1);
    hooks.push({ en: `A quick, honest answer about ${inner}.`, es: `Una respuesta rápida y honesta sobre ${inner}.` });
  }
  return {
    templateId: template.id,
    hooks,
    onScreen: template.copy.onScreen,
    script: template.copy.script.en ? template.copy.script : template.copy.caption,
    caption: template.copy.caption,
    cta: template.copy.cta,
  };
}

const FIELD_OF: Record<keyof AssistOutput, CopyField> = { hooks: "hook", onScreen: "onScreen", script: "script", caption: "caption", cta: "cta" };

/** Every line of a draft through the same check a piece runs. */
export function checkDraft(output: AssistOutput): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const seen = new Set<string>();
  const lines: Array<[keyof AssistOutput, Bilingual, number]> = [
    ...output.hooks.map((hook, i) => ["hooks", hook, i] as [keyof AssistOutput, Bilingual, number]),
    ["onScreen", output.onScreen, 0],
    ["script", output.script, 0],
    ["caption", output.caption, 0],
    ["cta", output.cta, 0],
  ];
  for (const [key, text, index] of lines) {
    for (const lang of ["en", "es"] as const) {
      if (!text[lang]) continue;
      for (const found of checkText(text[lang], FIELD_OF[key], lang)) {
        const id = `${key}${key === "hooks" ? index : ""}.${found.id}`;
        if (!seen.has(id)) {
          seen.add(id);
          issues.push({ ...found, id });
        }
      }
    }
  }
  // The caption says results vary in each language (a piece's check asks the same of the whole piece).
  if (output.caption.en && !/results\s+(may\s+)?vary/i.test(`${output.caption.en} ${output.onScreen.en}`)) {
    issues.push({ id: "caption.en.results-vary", rule: "results-vary", severity: "block", field: "caption", lang: "en", match: null, ...ruleText("results-vary") });
  }
  if (output.caption.es && !/resultados\s+(pueden\s+)?var[ií]a/i.test(`${output.caption.es} ${output.onScreen.es}`)) {
    issues.push({ id: "caption.es.results-vary", rule: "results-vary", severity: "block", field: "caption", lang: "es", match: null, ...ruleText("results-vary") });
  }
  return issues;
}

/** The model's JSON, read strictly: anything missing or too long is refused. */
export function parseAssistOutput(value: unknown): AssistOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const bi = (x: unknown, max: number): Bilingual | null => {
    if (!x || typeof x !== "object") return null;
    const { en, es } = x as Record<string, unknown>;
    if (typeof en !== "string" || typeof es !== "string") return null;
    if (en.length > max || es.length > max) return null;
    return { en: en.trim(), es: es.trim() };
  };
  const hooks = Array.isArray(v.hooks) ? v.hooks.map((h) => bi(h, 200)).filter((h): h is Bilingual => h !== null) : [];
  const onScreen = bi(v.onScreen, 400);
  const script = bi(v.script, 3000);
  const caption = bi(v.caption, 2200);
  const cta = bi(v.cta, 60);
  if (hooks.length < 1 || !onScreen || !script || !caption || !cta) return null;
  return { hooks: hooks.slice(0, 5), onScreen, script, caption, cta };
}

export const ASSIST_SCHEMA = {
  type: "object",
  properties: {
    hooks: {
      type: "array",
      description: "Three hook ideas for the first 3 seconds, each in English and Spanish.",
      items: { type: "object", properties: { en: { type: "string" }, es: { type: "string" } }, required: ["en", "es"], additionalProperties: false },
    },
    onScreen: { type: "object", properties: { en: { type: "string" }, es: { type: "string" } }, required: ["en", "es"], additionalProperties: false },
    script: { type: "object", properties: { en: { type: "string" }, es: { type: "string" } }, required: ["en", "es"], additionalProperties: false },
    caption: { type: "object", properties: { en: { type: "string" }, es: { type: "string" } }, required: ["en", "es"], additionalProperties: false },
    cta: { type: "object", properties: { en: { type: "string" }, es: { type: "string" } }, required: ["en", "es"], additionalProperties: false },
  },
  required: ["hooks", "onScreen", "script", "caption", "cta"],
  additionalProperties: false,
} as const;

/** The fixed instructions: the same for every request, so they are cached. */
export function assistSystemPrompt(): string {
  const examples = CONTENT_TEMPLATES.slice(0, 3)
    .map((t) => `Example (${t.title.en}):\nHook: ${t.copy.hook.en} / ${t.copy.hook.es}\nCaption: ${t.copy.caption.en} / ${t.copy.caption.es}`)
    .join("\n\n");
  return `You are ${BRAND.assistant}, ${BRAND.name}'s AI writing assistant for its own marketing team. You draft social media copy (Instagram, TikTok, Facebook, YouTube, WhatsApp) and partner material. A person on the team edits your draft and an administrator approves it; you never publish anything.

${BRAND.name} is a credit services company in Texas. The client says what is inaccurate on their credit report; the team prepares and mails the dispute letters and shows every step in the app. English first, Spanish too; the Hispanic market matters, but not only it.

Rules you never break (the drafts are checked by code and rejected if they do):
- Never promise or suggest a result: nothing about items coming off a report, scores going up, points, dates, approvals or "real results". The bureaus and lenders decide. Every caption ends with "Results vary." / "Los resultados varían."
- Never show or describe a credit score, points, dials, gauges or before/after.
- Never call anything free ("free", "gratis"). Never write a price or an amount. No money-back guarantee.
- No pressure: no "act now", "limited time", "last chance", "solo hoy".
- The client decides what is inaccurate. Never say the team picks what to dispute or disputes everything negative. Say "you tell us what is wrong".
- Process words only: prepare, mail, send, review, explain. Never "we fix", "we remove", "we clean", "eliminamos", "reparamos", "limpiamos".
- If you mention ${BRAND.assistant}, say he is an AI assistant ("${BRAND.assistant} · ${BRAND.aiLabel.en}" / "${BRAND.assistant} · ${BRAND.aiLabel.es}"), never a person. Never mention ${BRAND.cameo}.
- If credit monitoring is mentioned, add that ${BRAND.name} earns a commission from the monitoring service. For realtors and lenders, add that the partner program pays no referral fees.
- No humour about debt, mistakes, income, language, immigrant background or literacy.

How you write:
- Short sentences, plain words, at most 20 words a sentence. Warm, clear, a little wry; never salesy.
- English and Spanish say the same thing, with the same numbers. Write the Spanish, don't translate word for word (neutral Latin American Spanish, "tú").
- Hooks: three ideas, under 12 words each, for the first 3 seconds.
- Script: for a 15 to 30 second video, spoken, at most 90 words a language. On-screen text: the few words shown big.
- Caption: at most 60 words a language, ending with "Results vary." / "Los resultados varían."
- Call to action: 2 to 4 words, e.g. "Start my review" / "Empezar mi revisión".

${examples}`;
}

/** The request, in the user turn (it changes every time; the system prompt does not). */
export function assistUserPrompt(request: AssistRequest, problems: string[] = []): string {
  const lines = [
    `Topic: ${clean(request.topic).slice(0, ASSIST_LIMITS.topicMax)}`,
    `Format: ${request.type.replace(/_/g, " ")}`,
    `Audience: ${request.audience === "hispanic" ? "Hispanic consumers (Spanish matters most, English still required)" : request.audience === "partners" ? "realtors and loan officers" : "consumers"}`,
    `Theme: ${themeFor(request)}`,
  ];
  if (problems.length > 0) lines.push(`Your previous draft broke these rules; write it again without them: ${problems.join("; ")}`);
  return lines.join("\n");
}

/**
 * The whole assistant: a model draft when a caller is given (rewritten once
 * if it breaks a blocking rule), else the template draft. Always checked,
 * always a draft.
 */
export async function writeWithAlti(request: AssistRequest, caller: AssistCaller | null): Promise<AssistResult> {
  const fromTemplates = (note: string | null): AssistResult => {
    const { templateId, ...output } = templateDraft(request);
    return { ...output, source: "templates", draft: true, templateId, issues: checkDraft(output), note };
  };
  if (!caller) return fromTemplates("not_configured");
  const system = assistSystemPrompt();
  let problems: string[] = [];
  let last: AssistOutput | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await caller({ system, user: assistUserPrompt(request, problems) });
    if (answer.problem) return fromTemplates(answer.problem);
    const output = parseAssistOutput(answer.output);
    if (!output) return fromTemplates("invalid_output");
    last = output;
    const blocking = checkDraft(output).filter((i) => i.severity === "block");
    if (blocking.length === 0) break;
    problems = [...new Set(blocking.map((i) => `${i.rule}${i.match ? ` ("${i.match}")` : ""}`))];
  }
  return { ...last!, source: "model", draft: true, templateId: null, issues: checkDraft(last!), note: null };
}
