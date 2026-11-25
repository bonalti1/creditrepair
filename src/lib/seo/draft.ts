import { BRAND } from "../brand";
import { blockingIssues, checkGuide, cleanBody, cleanSources, GUIDE_LIMITS, isOfficialSource, OFFICIAL_HOSTS, slugify, type GuideIssue } from "./guides";
import { STARTER_GUIDES } from "./starters";
import type { Bilingual, GuideBody, GuideSource, Lang } from "./types";

// Alti drafts a guide (the SEO department's writing assistant): a topic, a
// brief and the search phrase become an outline and the article in English
// and Spanish, with its sources. It is always a DRAFT by an AI:
//
//   - With ANTHROPIC_API_KEY (draftModel.ts): Claude writes, told the house
//     rules (no promises, nothing called free, the reader decides, Texas
//     only), to cite an official source for every legal fact with [^id], and
//     to use only the official sites listed. The draft goes through
//     checkGuide (the claim rules and the guide's own rules); one that breaks
//     a blocking rule is written again once, with the reasons.
//   - Without a key (or when the model fails): an outline only, in both
//     languages, with the right headings, the sources that fit the topic and
//     the closing paragraph with the links; every paragraph to write is
//     marked, and the check holds the guide until a person writes it.
//
// Nothing is saved or published here: the editor puts the draft into the
// guide, a person edits it and sends it for approval, and an administrator
// publishes it.

export interface DraftRequest {
  topic: string;
  brief: string;
  phrase: Bilingual;
}

export interface DraftOutput {
  slug: string;
  outline: string[];
  body: Record<Lang, GuideBody>;
  sources: GuideSource[];
}

export interface DraftResult extends DraftOutput {
  source: "model" | "outline";
  draft: true;
  issues: GuideIssue[];
  /** Why there is no model draft, when there is none (no key, refusal, error). */
  note: string | null;
}

export type DraftCaller = (call: { system: string; user: string }) => Promise<{ output: unknown; problem: string | null }>;

export const DRAFT_LIMITS = { topic: 160, brief: 1200, perMemberPerHour: 12 } as const;

/** The sources the drafts may cite, from the starter guides (each checked by a person before publishing). */
export function sourceLibrary(): GuideSource[] {
  const seen = new Map<string, GuideSource>();
  for (const g of STARTER_GUIDES) for (const s of g.sources) if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()];
}

const TOPIC_SOURCES: Array<[RegExp, string[]]> = [
  [/disput|error|inaccura|disputa|inexact/i, ["fcra-611", "fcra-623", "ftc-disputes"]],
  [/how long|stay|years|old|obsolete|cu[aá]nto|a[nñ]os|viej/i, ["fcra-605", "cfpb-323"]],
  [/compan|repair|scam|contract|cancel|empresa|reparaci|estafa|contrato/i, ["croa-1679b", "croa-1679c", "croa-1679e", "ftc-scams"]],
  [/texas|cso|services organization|organizaci/i, ["tx-393"]],
  [/collect|cobranz|charge.?off/i, ["fcra-605", "ftc-furnishers"]],
  [/report|reporte|weekly|annual/i, ["ftc-weekly"]],
];

export function sourcesFor(request: DraftRequest): GuideSource[] {
  const text = `${request.topic} ${request.brief} ${request.phrase.en} ${request.phrase.es}`;
  const library = new Map(sourceLibrary().map((s) => [s.id, s]));
  const ids = new Set<string>();
  for (const [pattern, list] of TOPIC_SOURCES) if (pattern.test(text)) list.forEach((id) => ids.add(id));
  if (ids.size === 0) ["fcra-611", "ftc-weekly"].forEach((id) => ids.add(id));
  return [...ids].map((id) => library.get(id)!).filter(Boolean);
}

const WRITE = { en: (what: string) => `[Write: ${what}]`, es: (what: string) => `[Escribe: ${what}]` };

/** The outline without a model: headings, marked paragraphs to write, the sources that fit, and the closing paragraph. */
export function outlineDraft(request: DraftRequest): DraftOutput {
  const topic = request.topic.replace(/[<>]/g, "").trim().slice(0, DRAFT_LIMITS.topic);
  const sources = sourcesFor(request);
  const cite = sources[0] ? `[^${sources[0].id}]` : "";
  const make = (lang: Lang): GuideBody => {
    const en = lang === "en";
    const w = WRITE[lang];
    const phrase = (en ? request.phrase.en : request.phrase.es) || topic;
    return {
      title: en ? topic.slice(0, 60) : (request.phrase.es || topic).slice(0, 60),
      description: w(en ? "70 to 160 characters: what the guide answers" : "de 70 a 160 caracteres: qué responde la guía"),
      intro: w(en ? `two or three sentences on «${phrase}», for a Texan` : `dos o tres frases sobre «${phrase}», para alguien en Texas`),
      sections: [
        { heading: en ? "What it means" : "Qué significa", paragraphs: [w(en ? "the idea in plain words" : "la idea en palabras sencillas")] },
        { heading: en ? "What the law says" : "Lo que dice la ley", paragraphs: [`${w(en ? "each legal fact, with its source mark" : "cada dato legal, con su marca de fuente")} ${cite}`.trim()] },
        { heading: en ? "Step by step" : "Paso a paso", paragraphs: [w(en ? "what the reader can do, in order" : "lo que puede hacer el lector, en orden")] },
        {
          heading: en ? "On your own, or with a team" : "Por tu cuenta, o con un equipo",
          paragraphs: [
            en
              ? "Some people prefer a team to prepare and mail the letters for the items they say are wrong. If that is you, see [how Credalti works](/como-funciona) and [how our pricing works](/precios). Results vary."
              : "Algunas personas prefieren que un equipo prepare y envíe las cartas por lo que ellas dicen que está mal. Si es tu caso, mira [cómo funciona Credalti](/como-funciona) y [cómo funcionan los precios](/precios). Los resultados varían.",
          ],
        },
      ],
      faq: [
        { q: w(en ? "a question people ask" : "una pregunta que hace la gente"), a: w(en ? "a short answer, with its source" : "una respuesta corta, con su fuente") },
        { q: w(en ? "another question" : "otra pregunta"), a: w(en ? "a short answer" : "una respuesta corta") },
      ],
    };
  };
  return {
    slug: slugify(request.phrase.en || topic),
    outline: [topic, ...make("en").sections.map((s) => s.heading)],
    body: { en: make("en"), es: make("es") },
    sources,
  };
}

// ── The model's side ────────────────────────────────────────────────────

const BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "intro", "sections", "faq"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    intro: { type: "string" },
    sections: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["heading", "paragraphs"], properties: { heading: { type: "string" }, paragraphs: { type: "array", items: { type: "string" } } } },
    },
    faq: { type: "array", items: { type: "object", additionalProperties: false, required: ["q", "a"], properties: { q: { type: "string" }, a: { type: "string" } } } },
  },
} as const;

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slug", "outline", "en", "es", "sources"],
  properties: {
    slug: { type: "string" },
    outline: { type: "array", items: { type: "string" } },
    en: BODY_SCHEMA,
    es: BODY_SCHEMA,
    sources: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "label", "cite", "url"], properties: { id: { type: "string" }, label: { type: "string" }, cite: { type: "string" }, url: { type: "string" } } },
    },
  },
} as const;

export function draftSystemPrompt(): string {
  const library = sourceLibrary()
    .map((s) => `- [^${s.id}] ${s.label}${s.cite ? ` (${s.cite})` : ""}: ${s.url}`)
    .join("\n");
  return [
    `You write guides for ${BRAND.name}'s public website: plain, accurate articles about credit reports and consumer rights for people in Texas, in English and in Spanish (US Spanish, "tú").`,
    `${BRAND.name} is a full-service credit services company in Texas: the client tells the team what is wrong on their report, and the team prepares and mails the letters. It serves only Texas.`,
    "",
    "Rules (a check enforces them; a draft that breaks one is sent back):",
    "- Never promise or imply a result: nothing comes off a report, no score goes up, no approval, no timeframe for results. Say results vary and the bureaus decide.",
    "- Never write these words: free, gratis, deleted, removed, fixed, guaranteed, approved, eliminado, borrado, arreglado, aprobado, garantizado. Say 'at no cost' / 'sin costo' only of disputing on your own.",
    "- Never write 'improve/raise/fix/repair your credit or score', 'we remove/fix/delete', or a number of points. No prices, no dollar amounts, no 'per month'.",
    "- The reader decides what is inaccurate. Never tell them what to dispute. Disputing accurate information is not legal.",
    "- No pressure: no 'act now', 'don't wait', 'limited time'. End with a calm invitation.",
    "- Texas and federal law only. Never name another state as a place served; never Georgia.",
    "- Every paragraph that states the law (a statute, a section, a deadline, what someone must do) ends with a citation mark [^id] of a source on your list. No legal fact without one.",
    `- Sources: prefer the library below (use its ids). Any other source must be on an official site (${OFFICIAL_HOSTS.join(", ")}). Never invent a URL or a section number. If you are not sure of a fact, leave it out.`,
    "- Links: write [words](/path). Inside the text, link to [how it works](/como-funciona) and [pricing](/precios) where they help, in both languages.",
    "- Sentences of 25 words or fewer. Short paragraphs. Title 30 to 60 characters with the search phrase. Description 70 to 160 characters.",
    "- 4 to 6 sections, each with a heading; 3 or 4 questions at the end. The Spanish has the same sections and questions as the English, written naturally, not word for word.",
    "- Do not mention Alti or any mascot. Do not say the company is registered or bonded.",
    "",
    "Source library:",
    library,
    "",
    "Answer only with the JSON asked for. slug: lowercase English words with hyphens.",
  ].join("\n");
}

export function draftUserPrompt(request: DraftRequest, retryReasons: string[] = []): string {
  const clean = (s: string, n: number) => s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  return [
    `Topic: ${clean(request.topic, DRAFT_LIMITS.topic)}`,
    `Search phrase (English): ${clean(request.phrase.en, 100) || "(choose one)"}`,
    `Search phrase (Spanish): ${clean(request.phrase.es, 100) || "(choose one)"}`,
    `Brief: ${clean(request.brief, DRAFT_LIMITS.brief) || "(none)"}`,
    ...(retryReasons.length ? ["", "Your last draft broke these rules. Write it again without them:", ...retryReasons.map((r) => `- ${r}`)] : []),
  ].join("\n");
}

/** The model's JSON, read strictly and trimmed to the limits; null when it is not a draft. */
export function parseDraft(value: unknown): DraftOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!v.en || !v.es || typeof v.en !== "object" || typeof v.es !== "object") return null;
  const body = { en: cleanBody(v.en as Partial<GuideBody>), es: cleanBody(v.es as Partial<GuideBody>) };
  if (!body.en.title || !body.es.title || body.en.sections.length === 0 || body.es.sections.length === 0) return null;
  const sources = cleanSources((Array.isArray(v.sources) ? v.sources : []) as GuideSource[]);
  const library = new Map(sourceLibrary().map((s) => [s.id, s]));
  // A library id keeps the library's own address (never one the model wrote); others must be official.
  const kept = sources.map((s) => library.get(s.id) ?? s).filter((s) => library.has(s.id) || isOfficialSource(s.url));
  return {
    slug: slugify(typeof v.slug === "string" ? v.slug : body.en.title),
    outline: (Array.isArray(v.outline) ? v.outline : []).slice(0, 12).map((x) => String(x).slice(0, GUIDE_LIMITS.heading)),
    body,
    sources: kept,
  };
}

/** Alti's draft: the model's (checked, rewritten once) or, without one, the outline. */
export async function draftGuide(request: DraftRequest, caller: DraftCaller | null): Promise<DraftResult> {
  const outline = (note: string): DraftResult => {
    const out = outlineDraft(request);
    return { ...out, source: "outline", draft: true, issues: checkGuide({ ...out, phrase: request.phrase }), note };
  };
  if (!caller) return outline("no_key");
  let reasons: string[] = [];
  let last: DraftResult | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { output, problem } = await caller({ system: draftSystemPrompt(), user: draftUserPrompt(request, reasons) });
    const parsed = problem ? null : parseDraft(output);
    if (!parsed) return last ?? outline(problem ?? "invalid");
    const issues = checkGuide({ ...parsed, phrase: request.phrase });
    last = { ...parsed, source: "model", draft: true, issues, note: null };
    const blocking = blockingIssues(issues);
    if (blocking.length === 0) return last;
    reasons = [...new Set(blocking.map((i) => `${i.where}: ${i.explain.en}${i.match ? ` («${i.match}»)` : ""}`))].slice(0, 12);
  }
  return last!;
}
