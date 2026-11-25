import { BRAND } from "../brand";
import { checkText, ruleText, type ContentIssue } from "../content/check";
import type { Bilingual, CopyField } from "../content/types";

// Ad copy drafts by Alti (the AI assistant), for Meta ads (docs/ADS.md, "Ad
// copy with Alti"). The content writing assistant's pattern
// (src/lib/content/assist.ts): with ANTHROPIC_API_KEY Claude writes as Alti
// (copyModel.ts); without it the closest pre-checked template is the base,
// with the angle in the hooks. Either way, every line goes through the same
// check every content piece runs (checkText: the claim guardrails,
// checkMarketingCopy, nothing "free", no score talk, no price, no pressure,
// Alti never a person) plus the credit-repair ad checklist below, and the
// result is a DRAFT: nothing is posted or sent to Meta. A person sends it to
// Content (as a piece, through the normal review and approval) or to Video
// Studio (as a brief).
//
// The credit-repair ad checklist (Meta's Special Ad Category for credit, and
// Meta's personal-attributes rule):
//   - the campaign declares the Special Ad Category (a person checks it in
//     Ads Manager; the report flags campaigns that do not);
//   - the words assume nothing about who reads them: no age, gender or ZIP
//     code ("over 50", "moms", "in 78701"), since those audiences cannot be
//     targeted and must not be implied;
//   - the words never assert the reader's finances ("your bad credit",
//     "¿tienes deudas?"): Meta refuses ads that do;
//   - no promised result, never "free", no before/after and no score;
//   - results vary, in each language;
//   - no price and no pressure.

export const AD_FORMATS = ["video", "image", "carousel"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];
export const AD_GOALS = ["whatsapp", "website", "form"] as const;
export type AdGoal = (typeof AD_GOALS)[number];
export const AD_LANGUAGES = ["en", "es", "both"] as const;
export type AdLanguage = (typeof AD_LANGUAGES)[number];

/** Meta's call-to-action buttons a draft may use. */
export const AD_CTAS = ["WHATSAPP_MESSAGE", "LEARN_MORE", "SIGN_UP", "CONTACT_US"] as const;
export type AdCta = (typeof AD_CTAS)[number];

export interface AdCopyRequest {
  /** What the ad is about, in the team's words. */
  angle: string;
  format: AdFormat;
  goal: AdGoal;
  language: AdLanguage;
  /** A winner to learn from: its headline and primary text are given to Alti as an example. */
  example?: { headline: string; body: string } | null;
}

export interface AdCopyOutput {
  /** Three hooks: the first words of a video, or the first line of the text. */
  hooks: Bilingual[];
  primaryText: Bilingual;
  headline: Bilingual;
  description: Bilingual;
  /** Spoken, for a video; empty for a picture. */
  script: Bilingual;
  /** The few words shown big on screen. */
  onScreen: Bilingual;
  cta: AdCta;
}

export type AdCheckKey = "special_category" | "no_targeting" | "no_personal_attributes" | "no_promises" | "no_free" | "no_scores" | "results_vary" | "no_price_pressure" | "visual";

export interface AdCheckItem {
  key: AdCheckKey;
  /** "auto": the words were checked by code; "person": someone checks it in Ads Manager or the visual. */
  mode: "auto" | "person";
  ok: boolean | null;
}

export interface AdCopyResult extends AdCopyOutput {
  source: "model" | "templates";
  /** Always true: Alti (AI) wrote it, and a person must read and edit it. */
  draft: true;
  language: AdLanguage;
  format: AdFormat;
  goal: AdGoal;
  issues: ContentIssue[];
  checklist: AdCheckItem[];
  /** Why there is no model draft (no key, refusal, API error), when there is none. */
  note: string | null;
}

export type AdCopyCaller = (call: { system: string; user: string }) => Promise<{ output: unknown; problem: string | null }>;

export const AD_COPY_LIMITS = { angleMax: 300, perMemberPerHour: 30 } as const;

// ── The ad-only rules ───────────────────────────────────────────────────

const AD_RULE_TEXT: Record<string, { explain: Bilingual; fix: Bilingual }> = {
  "ad-targeting": {
    explain: {
      en: "It speaks to an age, a gender or a place smaller than the state (\"over 50\", \"moms\", \"78701\"). Credit ads run in Meta's Special Ad Category, where those cannot be targeted or implied.",
      es: "Le habla a una edad, un género o un lugar más chico que el estado (\"mayores de 50\", \"mamás\", \"78701\"). Los anuncios de crédito van en la Categoría Especial de Meta, donde eso no se puede segmentar ni insinuar.",
    },
    fix: { en: "Speak to anyone in Texas. Talk about the process, not about who the reader is.", es: "Háblale a cualquiera en Texas. Habla del proceso, no de quién es quien lee." },
  },
  "ad-personal-attribute": {
    explain: {
      en: "It tells the reader something about their own finances (\"your bad credit\", \"are you in debt?\"). Meta refuses ads that assert a personal attribute.",
      es: "Le dice a quien lee algo sobre sus propias finanzas (\"tu mal crédito\", \"¿tienes deudas?\"). Meta rechaza los anuncios que afirman algo personal.",
    },
    fix: { en: "Talk about credit reports in general: \"Errors on a credit report can be disputed.\"", es: "Habla de los reportes en general: \"Los errores en un reporte de crédito se pueden disputar.\"" },
  },
};

export function adRuleText(rule: string): { explain: Bilingual; fix: Bilingual } {
  return AD_RULE_TEXT[rule] ?? ruleText(rule);
}

const TARGETING =
  /\b(over|under)\s+\d{2}\b|\b\d{2}\s*(\+|or\s+older|and\s+(up|older))|\b(seniors?|retirees?|millennials?|gen\s?z|boomers?|moms?|mothers|dads?|fathers|women|men|ladies|guys|single\s+(moms?|dads?|mothers|fathers))\b|\b(mayores|menores)\s+de\s+\d{2}\b|\b(jubilad[oa]s|mam[aá]s|pap[aá]s|madres|padres|mujeres|hombres|señoras|señores|j[oó]venes)\b|\b7[5-9]\d{3}\b|\b(zip\s*code|c[oó]digo\s+postal)\b/i;
const PERSONAL =
  /\b(your|ur)\s+(bad|poor|low|terrible|damaged)\s+(credit|score)|\b(do|does)\s+you\s+have\s+(bad|poor|low)\s+credit|\bare\s+you\s+(in\s+debt|broke|behind\s+on)|\byou\s+have\s+(bad|poor|low)\s+credit|\btu\s+(mal|p[eé]simo|bajo)\s+(cr[eé]dito|puntaje)|\btienes\s+(mal\s+cr[eé]dito|deudas|cr[eé]dito\s+malo)|\b(est[aá]s|andas)\s+(endeudad[oa]|en\s+deudas)/i;

function adIssue(rule: string, field: CopyField, lang: "en" | "es", match: string): ContentIssue {
  const text = adRuleText(rule);
  return { id: `${field}.${lang}.${rule}`, rule, severity: "block", field, lang, match, explain: text.explain, fix: text.fix };
}

/** One ad text through the content check and the ad-only rules. */
export function checkAdText(text: string, field: CopyField, lang: "en" | "es"): ContentIssue[] {
  const out = checkText(text, field, lang);
  const t = text.match(TARGETING);
  if (t) out.push(adIssue("ad-targeting", field, lang, t[0]));
  const p = text.match(PERSONAL);
  if (p) out.push(adIssue("ad-personal-attribute", field, lang, p[0]));
  return out;
}

const RESULTS_VARY = { en: /results\s+(may\s+)?vary/i, es: /resultados\s+(pueden\s+)?var[ií]a/i } as const;
const ALTI = new RegExp(`\\b${BRAND.assistant}\\b`);
const AI_WORDS = /\bAI\b|\bIA\b|artificial intelligence|inteligencia artificial/i;

export const languagesOfAd = (language: AdLanguage): Array<"en" | "es"> => (language === "both" ? ["en", "es"] : [language]);

/** Every line of a draft, in the languages it is written in, blocking issues first. */
export function checkAdDraft(output: AdCopyOutput, language: AdLanguage): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const seen = new Set<string>();
  const add = (i: ContentIssue, prefix: string) => {
    const id = `${prefix}.${i.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    issues.push({ ...i, id });
  };
  for (const lang of languagesOfAd(language)) {
    const lines: Array<[string, CopyField, string]> = [
      ...output.hooks.map((h, i) => [`hook${i}`, "hook", h[lang]] as [string, CopyField, string]),
      ["primaryText", "caption", output.primaryText[lang]],
      ["headline", "hook", output.headline[lang]],
      ["description", "onScreen", output.description[lang]],
      ["script", "script", output.script[lang]],
      ["onScreen", "onScreen", output.onScreen[lang]],
    ];
    for (const [key, field, text] of lines) {
      if (!text?.trim()) continue;
      for (const found of checkAdText(text, field, lang)) add(found, key);
    }
    // In the primary text: the one part of an ad Meta always shows (the description is often cut).
    if (!RESULTS_VARY[lang].test(output.primaryText[lang])) {
      add({ id: `caption.${lang}.results-vary`, rule: "results-vary", severity: "block", field: "caption", lang, match: null, ...ruleText("results-vary") }, "primaryText");
    }
    const all = [output.primaryText, output.headline, output.description, output.script, output.onScreen, ...output.hooks].map((b) => b[lang]).join("\n");
    if (ALTI.test(all) && !AI_WORDS.test(all)) add({ id: `piece.${lang}.alti-label`, rule: "alti-label", severity: "block", field: "piece", lang, match: null, ...ruleText("alti-label") }, "draft");
    if (!output.primaryText[lang]?.trim() || !output.headline[lang]?.trim()) {
      add({ id: `piece.${lang}.empty`, rule: "empty", severity: "block", field: "piece", lang, match: null, ...ruleText("empty") }, "draft");
    }
  }
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "block" ? -1 : 1));
}

/** The credit-repair ad checklist, from the issues: what the code checked, and what a person still checks. */
export function adChecklist(issues: readonly ContentIssue[]): AdCheckItem[] {
  const clear = (...rules: string[]) => !issues.some((i) => i.severity === "block" && rules.includes(i.rule));
  return [
    { key: "special_category", mode: "person", ok: null },
    { key: "no_targeting", mode: "auto", ok: clear("ad-targeting") },
    { key: "no_personal_attributes", mode: "auto", ok: clear("ad-personal-attribute") },
    { key: "no_promises", mode: "auto", ok: clear("no-guaranteed-deletions", "no-points-in-days", "no-accurate-removal", "diy-positioning", "client-decides", "no-outcome-promise", "no-approval-claims", "no-outcome-words", "no-real-estate-bait") },
    { key: "no_free", mode: "auto", ok: clear("no-free") },
    { key: "no_scores", mode: "auto", ok: clear("no-score-visuals") },
    { key: "results_vary", mode: "auto", ok: clear("results-vary") },
    { key: "no_price_pressure", mode: "auto", ok: clear("no-price", "no-pressure", "no-money-back") },
    { key: "visual", mode: "person", ok: null },
  ];
}

// ── Without a model: pre-checked templates ──────────────────────────────

interface AdTemplate {
  id: string;
  theme: RegExp;
  hooks: Bilingual[];
  primaryText: Bilingual;
  headline: Bilingual;
  description: Bilingual;
  script: Bilingual;
  onScreen: Bilingual;
}

export const AD_TEMPLATES: readonly AdTemplate[] = [
  {
    id: "rights",
    theme: /\b(right|rights|law|fcra|derecho|derechos|ley)\b/i,
    hooks: [
      { en: "You can dispute what is wrong on a credit report.", es: "Puedes disputar lo que está mal en un reporte de crédito." },
      { en: "The law gives you a way to question an error.", es: "La ley te da una forma de cuestionar un error." },
    ],
    primaryText: {
      en: "Federal law lets anyone dispute errors on a credit report. You tell us what is wrong; our team prepares and mails the letters, and you see every step in the app. Results vary.",
      es: "La ley federal permite disputar errores en un reporte de crédito. Tú nos dices qué está mal; nuestro equipo prepara y envía las cartas, y ves cada paso en la app. Los resultados varían.",
    },
    headline: { en: "Your credit report rights", es: "Tus derechos sobre tu reporte" },
    description: { en: "In English or Spanish. Results vary.", es: "En inglés o en español. Los resultados varían." },
    script: {
      en: "Did you know you can dispute an error on a credit report? You tell us what is wrong. We prepare the letters and mail them. You follow every step in the app. Results vary.",
      es: "¿Sabías que puedes disputar un error en un reporte de crédito? Tú nos dices qué está mal. Preparamos las cartas y las enviamos. Sigues cada paso en la app. Los resultados varían.",
    },
    onScreen: { en: "You tell us what's wrong", es: "Tú nos dices qué está mal" },
  },
  {
    id: "process",
    theme: /\b(how|works|steps|process|letters?|mail|c[oó]mo|pasos|proceso|cartas?)\b/i,
    hooks: [
      { en: "This is how a dispute letter gets made.", es: "Así se prepara una carta de disputa." },
      { en: "Three steps, all in one app.", es: "Tres pasos, todo en una app." },
    ],
    primaryText: {
      en: "Start a short chat, tell us what is wrong on your report, and our team prepares and mails the letters for you. Every step shows in the app. Results vary.",
      es: "Empieza un chat corto, dinos qué está mal en tu reporte y nuestro equipo prepara y envía las cartas por ti. Cada paso se ve en la app. Los resultados varían.",
    },
    headline: { en: "How it works", es: "Cómo funciona" },
    description: { en: "Every step in the app. Results vary.", es: "Cada paso en la app. Los resultados varían." },
    script: {
      en: "Step one: a short chat. Step two: you tell us what is wrong. Step three: we prepare and mail the letters. You see it all in the app. Results vary.",
      es: "Paso uno: un chat corto. Paso dos: nos dices qué está mal. Paso tres: preparamos y enviamos las cartas. Todo lo ves en la app. Los resultados varían.",
    },
    onScreen: { en: "Chat · You choose · We mail", es: "Chat · Tú eliges · Enviamos" },
  },
  {
    id: "language",
    theme: /\b(spanish|english|language|idioma|espa[nñ]ol|ingl[eé]s|hispan\w*|latin\w*)\b/i,
    hooks: [
      { en: "Credit help in English or Spanish.", es: "Ayuda con tu reporte en inglés o en español." },
      { en: "Ask your questions in the language you prefer.", es: "Haz tus preguntas en el idioma que prefieras." },
    ],
    primaryText: {
      en: "Questions about a credit report? Our Texas team answers in English or Spanish, and the app shows every letter we prepare and mail for you. Results vary.",
      es: "¿Preguntas sobre un reporte de crédito? Nuestro equipo en Texas responde en inglés o en español, y la app muestra cada carta que preparamos y enviamos por ti. Los resultados varían.",
    },
    headline: { en: "In English or Spanish", es: "En inglés o en español" },
    description: { en: "A Texas team. Results vary.", es: "Un equipo en Texas. Los resultados varían." },
    script: {
      en: "Credit reports are confusing in any language. Ask us in English or Spanish. You tell us what is wrong, and we prepare and mail the letters. Results vary.",
      es: "Los reportes de crédito confunden en cualquier idioma. Pregúntanos en español o en inglés. Tú nos dices qué está mal y preparamos y enviamos las cartas. Los resultados varían.",
    },
    onScreen: { en: "Your language, every step", es: "Tu idioma, cada paso" },
  },
  {
    id: "myths",
    theme: /./,
    hooks: [
      { en: "Myth or fact: checking your own report hurts it?", es: "¿Mito o verdad: revisar tu propio reporte lo afecta?" },
      { en: "Three things people get wrong about credit reports.", es: "Tres cosas que casi todos creen de los reportes de crédito." },
    ],
    primaryText: {
      en: "Checking your own credit report does not hurt it, and errors on it can be disputed. Ask us anything; we explain it in plain words. Results vary.",
      es: "Revisar tu propio reporte no lo afecta, y los errores se pueden disputar. Pregúntanos lo que quieras; te lo explicamos con palabras sencillas. Los resultados varían.",
    },
    headline: { en: "Myth or fact?", es: "¿Mito o verdad?" },
    description: { en: "Plain answers. Results vary.", es: "Respuestas claras. Los resultados varían." },
    script: {
      en: "Myth: checking your own credit report lowers it. Fact: it doesn't. Another fact: errors on a report can be disputed. Ask us how. Results vary.",
      es: "Mito: revisar tu propio reporte lo baja. Verdad: no lo afecta. Otra verdad: los errores se pueden disputar. Pregúntanos cómo. Los resultados varían.",
    },
    onScreen: { en: "Myth or fact?", es: "¿Mito o verdad?" },
  },
];

const ctaFor = (goal: AdGoal): AdCta => (goal === "whatsapp" ? "WHATSAPP_MESSAGE" : goal === "form" ? "SIGN_UP" : "LEARN_MORE");
const clean = (text: string) => text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

export function closestAdTemplate(angle: string): AdTemplate {
  return AD_TEMPLATES.find((t) => t.theme.test(angle)) ?? AD_TEMPLATES[AD_TEMPLATES.length - 1]!;
}

/** A draft with no model: the closest template, the angle as a third hook, the goal's button. */
export function templateAdDraft(request: AdCopyRequest): AdCopyOutput {
  const t = closestAdTemplate(request.angle);
  const topic = clean(request.angle).slice(0, 80).replace(/[.?!]+$/, "");
  const hooks = [...t.hooks];
  // The angle is in the team's words (one language): the Spanish hook stays Spanish, for a person to adapt.
  if (topic) hooks.push({ en: `${topic}: a plain answer.`, es: "Una respuesta clara, en tu idioma." });
  const picture = request.format !== "video";
  return {
    hooks,
    primaryText: t.primaryText,
    headline: t.headline,
    description: t.description,
    script: picture ? { en: "", es: "" } : t.script,
    onScreen: t.onScreen,
    cta: ctaFor(request.goal),
  };
}

// ── With a model ────────────────────────────────────────────────────────

const BI = { type: "object", properties: { en: { type: "string" }, es: { type: "string" } }, required: ["en", "es"], additionalProperties: false } as const;

export const AD_COPY_SCHEMA = {
  type: "object",
  properties: {
    hooks: { type: "array", description: "Three hooks, each in English and Spanish.", items: BI },
    primaryText: BI,
    headline: BI,
    description: BI,
    script: BI,
    onScreen: BI,
    cta: { type: "string", enum: [...AD_CTAS] },
  },
  required: ["hooks", "primaryText", "headline", "description", "script", "onScreen", "cta"],
  additionalProperties: false,
} as const;

export function parseAdCopy(value: unknown): AdCopyOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const bi = (x: unknown, max: number): Bilingual | null => {
    if (!x || typeof x !== "object") return null;
    const { en, es } = x as Record<string, unknown>;
    if (typeof en !== "string" || typeof es !== "string" || en.length > max || es.length > max) return null;
    return { en: en.trim(), es: es.trim() };
  };
  const hooks = Array.isArray(v.hooks) ? v.hooks.map((h) => bi(h, 200)).filter((h): h is Bilingual => h !== null) : [];
  const primaryText = bi(v.primaryText, 1200);
  const headline = bi(v.headline, 80);
  const description = bi(v.description, 120);
  const script = bi(v.script, 1500);
  const onScreen = bi(v.onScreen, 200);
  const cta = (AD_CTAS as readonly string[]).includes(String(v.cta)) ? (v.cta as AdCta) : null;
  if (hooks.length < 1 || !primaryText || !headline || !description || !script || !onScreen || !cta) return null;
  return { hooks: hooks.slice(0, 5), primaryText, headline, description, script, onScreen, cta };
}

/** The fixed instructions, cached: the same for every request. */
export function adCopySystemPrompt(): string {
  const example = AD_TEMPLATES[0]!;
  return `You are ${BRAND.assistant}, ${BRAND.name}'s AI writing assistant for its own marketing team. You draft Meta (Facebook and Instagram) ad copy. A person on the team edits your draft, it goes through review and an administrator approves it; you never publish anything and nothing you write reaches Meta by itself.

${BRAND.name} is a credit services company in Texas (only Texas). The client says what is inaccurate on their credit report; the team prepares and mails the dispute letters and shows every step in the app. English first, Spanish too.

These ads run in Meta's Special Ad Category for credit (financial products and services). Rules you never break (code checks every draft and rejects it):
- Never promise or suggest a result: nothing about items coming off a report, scores going up, points, dates, approvals, loans, cars or houses. The bureaus and lenders decide. The primary text ends with "Results vary." / "Los resultados varían."
- Never mention a credit score, points, numbers on a gauge, or before and after.
- Never call anything free ("free", "gratis"). Never write a price or an amount. No money-back guarantee.
- No pressure: no "act now", "limited time", "last chance", "solo hoy", "no esperes".
- Never assume who reads the ad: no age, gender, family role, ethnicity or ZIP code ("over 50", "moms", "Latinos", "78701").
- Never assert the reader's finances: not "your bad credit", "do you have bad credit?", "are you in debt?", "tu mal crédito", "¿tienes deudas?". Talk about credit reports in general.
- The client decides what is inaccurate: say "you tell us what is wrong". Process words only: prepare, mail, send, review, explain. Never "we fix", "we remove", "we clean", "eliminamos", "reparamos", "limpiamos".
- If you mention ${BRAND.assistant}, say he is an AI assistant ("${BRAND.assistant} · ${BRAND.aiLabel.en}" / "${BRAND.assistant} · ${BRAND.aiLabel.es}"). No other character speaks.

How you write:
- Short sentences, plain words. Warm, clear, never salesy. English and Spanish say the same thing; write the Spanish, don't translate word for word (neutral Latin American Spanish, "tú").
- Hooks: three, under 12 words each. Headline: under 40 characters. Description: under 60 characters. Primary text: at most 50 words a language.
- Script: for a 15 to 30 second video, spoken, at most 80 words a language; empty strings for a picture ad. On-screen text: a few words.

Example (${example.id}):
Headline: ${example.headline.en} / ${example.headline.es}
Primary text: ${example.primaryText.en} / ${example.primaryText.es}`;
}

export function adCopyUserPrompt(request: AdCopyRequest, problems: string[] = []): string {
  const lines = [
    `Angle: ${clean(request.angle).slice(0, AD_COPY_LIMITS.angleMax)}`,
    `Format: ${request.format}`,
    `Where the ad sends people: ${request.goal === "whatsapp" ? "a WhatsApp chat with the team (button: WHATSAPP_MESSAGE)" : request.goal === "form" ? "a short Meta lead form (button: SIGN_UP)" : "the website's chat signup (button: LEARN_MORE)"}`,
    `Languages: ${request.language === "both" ? "English and Spanish" : request.language === "es" ? "Spanish (fill English too, same meaning)" : "English (fill Spanish too, same meaning)"}`,
  ];
  if (request.example) lines.push(`A current winner, to learn from (do not copy it): headline "${clean(request.example.headline).slice(0, 120)}", text "${clean(request.example.body).slice(0, 400)}"`);
  if (problems.length > 0) lines.push(`Your previous draft broke these rules; write it again without them: ${problems.join("; ")}`);
  return lines.join("\n");
}

/** The whole assistant: a model draft when a caller is given (rewritten once if it breaks a blocking rule), else the template draft. */
export async function draftAdCopy(request: AdCopyRequest, caller: AdCopyCaller | null): Promise<AdCopyResult> {
  const finish = (output: AdCopyOutput, source: AdCopyResult["source"], note: string | null): AdCopyResult => {
    const issues = checkAdDraft(output, request.language);
    return { ...output, source, draft: true, language: request.language, format: request.format, goal: request.goal, issues, checklist: adChecklist(issues), note };
  };
  if (!caller) return finish(templateAdDraft(request), "templates", "not_configured");
  const system = adCopySystemPrompt();
  let problems: string[] = [];
  let last: AdCopyOutput | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await caller({ system, user: adCopyUserPrompt(request, problems) });
    if (answer.problem) return finish(templateAdDraft(request), "templates", answer.problem);
    const output = parseAdCopy(answer.output);
    if (!output) return finish(templateAdDraft(request), "templates", "invalid_output");
    last = request.format === "video" ? output : { ...output, script: { en: "", es: "" } };
    const blocking = checkAdDraft(last, request.language).filter((i) => i.severity === "block");
    if (blocking.length === 0) break;
    problems = [...new Set(blocking.map((i) => `${i.rule}${i.match ? ` ("${i.match}")` : ""}`))];
  }
  return finish(last!, "model", null);
}
