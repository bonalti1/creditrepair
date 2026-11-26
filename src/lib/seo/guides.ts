import { canonicalJson, sha256Hex } from "../content/hash";
import { checkText } from "../content/check";
import type { ServiceMode } from "../service/mode";
import type { Capability } from "../staff/permissions";
import { citationsIn, linksIn, plainText, safeHref, wordCount } from "./markup";
import { SEO_TEXT, type ChecklistKey, type GuideRuleKey } from "./text";
import {
  GUIDE_TICKS,
  LANGS,
  type Bilingual,
  type Guide,
  type GuideBody,
  type GuideEvent,
  type GuideSource,
  type GuideStatus,
  type GuideTick,
  type Lang,
  type PublishedGuide,
} from "./types";

// Guides: the articles the SEO department writes and publishes at
// /guias/<slug> (docs/SEO.md). One model for the screens, the demo, the
// routes and the public pages:
//
//   - checkGuide: every word through the claim rules (the same checkText every
//     content piece runs: checkMarketingCopy, checkClaimGuardrails, nothing
//     called free, no outcome words, no score talk, no price, no pressure),
//     plus the guide's own rules: legal facts need an official source, Texas
//     only, no placeholder left, safe links.
//   - guideChecklist: the SEO checklist (title, description, slug, headings,
//     links to how it works and pricing, the FAQ block, both languages,
//     sources, length, Texas).
//   - applyGuideAction: the workflow, with the capability each step needs.
//     Publishing is an administrator's (seo.publish) and only of a version
//     with no blocking issue, every required checklist item passing and the
//     person's ticks; the approval is tied to the hash of exactly what was
//     approved, and the live page shows that version until another is
//     published. The database holds the same rules (migration 0039).

export const GUIDE_LIMITS = {
  topic: 160,
  brief: 1200,
  phrase: 100,
  title: 120,
  description: 300,
  intro: 1500,
  heading: 120,
  paragraph: 2500,
  sections: 14,
  paragraphsPerSection: 8,
  faq: 8,
  faqText: 700,
  sources: 16,
  sourceLabel: 200,
  sourceCite: 120,
  url: 400,
  note: 600,
} as const;

/** Lowercase words and hyphens, 3–80 characters. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function slugProblem(slug: string): "short" | "long" | "format" | null {
  if (slug.length < 3) return "short";
  if (slug.length > 80) return "long";
  return SLUG_PATTERN.test(slug) ? null : "format";
}

/** The guides' index on the public site. */
export const GUIDES_INDEX_PATH = "/guias";

export function guidePath(slug: string): string {
  return `/guias/${slug}`;
}

/** What an approval covers: the address, both languages' words and the sources. */
export function guideContent(guide: Pick<Guide, "slug" | "body" | "sources">) {
  return { slug: guide.slug, body: guide.body, sources: guide.sources };
}

export function guideHash(guide: Pick<Guide, "slug" | "body" | "sources">): string {
  return sha256Hex(canonicalJson(guideContent(guide)));
}

/** True when the guide carries an approval of exactly what it says now. */
export function approvalHolds(guide: Guide): boolean {
  return guide.approval !== null && guide.approval.hash === guideHash(guide);
}

/** Live on the site (a published version exists), whatever the working copy is doing. */
export function isLive(guide: Pick<Guide, "published" | "status">): boolean {
  return guide.published !== null && guide.status !== "archived";
}

// ── The rules ───────────────────────────────────────────────────────────

export type Severity = "block" | "warn";

export interface GuideIssue {
  id: string;
  rule: string;
  severity: Severity;
  /** Where: "en.title", "es.sections.2.paragraphs.0", "sources.fcra-611". */
  where: string;
  lang: Lang | null;
  match: string | null;
  explain: Bilingual;
  fix: Bilingual;
}

const ruleText = (rule: GuideRuleKey) => ({
  explain: { en: SEO_TEXT.en.guideRules[rule].explain, es: SEO_TEXT.es.guideRules[rule].explain },
  fix: { en: SEO_TEXT.en.guideRules[rule].fix, es: SEO_TEXT.es.guideRules[rule].fix },
});

/**
 * A paragraph that states the law: a statute or section, a named act, a legal
 * duty ("must", "debe"), or a time limit ("30 days", "7 años"). It needs a
 * citation of the guide's sources.
 */
export const LEGAL_FACT =
  /§|\bU\.?S\.?C\.?\b|\bC\.?F\.?R\.?\b|\bFCRA\b|\bCROA\b|\bFDCPA\b|Fair Credit Reporting|Credit Repair Organizations|Finance Code|C[oó]digo de Finanzas|\blaws?\b|\bleyes?\b|\bstatutes?\b|\blegal(ly)?\b|\bmust\b|\bdeben?\b|\brequires?\b|\brequired\b|\bobliga\w*|\bexige\w*|\b\d+\s+(business\s+)?(days?|years?|months?)\b|\b\d+\s+(d[ií]as|a[nñ]os|meses)\b/i;

/** Official places a legal fact may be sourced from: statutes, regulators, government agencies. */
export const OFFICIAL_HOSTS = [
  "uscode.house.gov",
  "www.law.cornell.edu",
  "law.cornell.edu",
  "www.govinfo.gov",
  "www.ecfr.gov",
  "www.consumerfinance.gov",
  "files.consumerfinance.gov",
  "consumer.ftc.gov",
  "www.ftc.gov",
  "www.identitytheft.gov",
  "www.annualcreditreport.com",
  "statutes.capitol.texas.gov",
  "www.sos.state.tx.us",
  "www.sos.texas.gov",
  "www.texasattorneygeneral.gov",
  "occc.texas.gov",
] as const;

export function isOfficialSource(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (OFFICIAL_HOSTS as readonly string[]).includes(u.hostname);
  } catch {
    return false;
  }
}

/** Every US state but Texas (and the District of Columbia). Georgia never; the rest are not served. */
const OTHER_STATES =
  /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Haw[aá]i|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Luisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|Nueva Jersey|New Mexico|Nuevo M[eé]xico|New York|Nueva York|North Carolina|Carolina del Norte|North Dakota|Dakota del Norte|Ohio|Oklahoma|Oregon|Oreg[oó]n|Pennsylvania|Pensilvania|Rhode Island|South Carolina|Carolina del Sur|South Dakota|Dakota del Sur|Tennessee|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/;

const PLACEHOLDER = /\[(write|escribe|todo|tbd|pendiente)[^\]]*\]|lorem ipsum|\.\.\.\s*$|…\s*$/i;
const PLACEHOLDER_CAPS = /\bTODO\b|\bTBD\b|\bXXX\b/;

/** Telling the reader what to dispute or what is inaccurate: the reader decides that. */
const ADVICE = /\byou\s+should\s+dispute\b|\bdispute\s+(every|all)\s+(negative|bad)\b|\bdebes\s+disputar\b|\bdisputa\s+(todo|todas|todos)\s+(lo\s+)?(negativ|mal)/i;

function issue(rule: GuideRuleKey, severity: Severity, where: string, lang: Lang | null, match: string | null): GuideIssue {
  return { id: `${where}.${rule}`, rule, severity, where, lang, match, ...ruleText(rule) };
}

/** Every text of one language, with where it is. */
export function textsOf(body: GuideBody, lang: Lang): Array<[string, string]> {
  const out: Array<[string, string]> = [
    [`${lang}.title`, body.title],
    [`${lang}.description`, body.description],
    [`${lang}.intro`, body.intro],
  ];
  body.sections.forEach((s, i) => {
    out.push([`${lang}.sections.${i}.heading`, s.heading]);
    s.paragraphs.forEach((p, j) => out.push([`${lang}.sections.${i}.paragraphs.${j}`, p]));
  });
  body.faq.forEach((f, i) => {
    out.push([`${lang}.faq.${i}.q`, f.q]);
    out.push([`${lang}.faq.${i}.a`, f.a]);
  });
  return out;
}

/** The paragraphs a legal fact may sit in (intro, section paragraphs, FAQ answers). */
function factTexts(body: GuideBody, lang: Lang): Array<[string, string]> {
  return textsOf(body, lang).filter(([where]) => /\.intro$|\.paragraphs\.\d+$|\.faq\.\d+\.a$/.test(where));
}

/** Every issue in a guide, blocking first. `mode`: the service mode (the app's when left out). */
export function checkGuide(guide: Pick<Guide, "slug" | "body" | "sources" | "phrase">, mode?: ServiceMode): GuideIssue[] {
  const out: GuideIssue[] = [];
  const seen = new Set<string>();
  const add = (i: GuideIssue) => {
    if (!seen.has(i.id)) {
      seen.add(i.id);
      out.push(i);
    }
  };
  const sourceIds = new Set(guide.sources.map((s) => s.id));
  const cited = new Set<string>();

  for (const lang of LANGS) {
    const body = guide.body[lang];
    const texts = textsOf(body, lang);
    if (!body.title.trim() || !body.description.trim() || !body.intro.trim() || body.sections.length === 0 || body.sections.some((s) => !s.heading.trim() || s.paragraphs.every((p) => !p.trim()))) {
      add(issue("empty-language", "block", `${lang}.body`, lang, null));
    }
    for (const [where, raw] of texts) {
      if (!raw.trim()) continue;
      const text = plainText(raw);
      // The claim rules: the same check every content piece runs, on what the reader sees.
      for (const found of checkText(text, "script", lang, mode)) {
        const id = `${where}.${found.rule}`;
        if (!seen.has(id)) {
          seen.add(id);
          out.push({ id, rule: found.rule, severity: found.severity, where, lang, match: found.match, explain: found.explain, fix: found.fix });
        }
      }
      const placeholder = raw.match(PLACEHOLDER) ?? raw.match(PLACEHOLDER_CAPS);
      if (placeholder) add(issue("placeholder", "block", where, lang, placeholder[0]));
      const state = text.match(OTHER_STATES);
      if (state) {
        // Georgia never, anywhere. Another state in the title, description or a heading reads as a place we serve.
        const headline = /\.(title|description|heading)$/.test(where);
        add(issue("other-state", state[0] === "Georgia" || headline ? "block" : "warn", where, lang, state[0]));
      }
      const advice = text.match(ADVICE);
      if (advice) add(issue("advice", "block", where, lang, advice[0]));
      // A link mark whose address is not a site path or https is shown as text, and flagged.
      for (const m of raw.matchAll(/\[[^\]\n]{1,160}\]\(([^)\n]*)\)/g)) if (!safeHref(m[1] ?? "")) add(issue("unsafe-link", "block", where, lang, m[1] || m[0]));
      for (const id of citationsIn(raw)) {
        cited.add(id);
        if (!sourceIds.has(id)) add(issue("citation-unknown", "block", where, lang, `[^${id}]`));
      }
    }
    for (const [where, raw] of factTexts(body, lang)) {
      if (raw.trim() && LEGAL_FACT.test(plainText(raw)) && citationsIn(raw).length === 0) {
        add(issue("legal-unsourced", "block", where, lang, plainText(raw).match(LEGAL_FACT)?.[0] ?? null));
      }
    }
  }
  for (const lang of LANGS) {
    const phrase = guide.phrase[lang].trim();
    const state = phrase.match(OTHER_STATES);
    if (state) add(issue("other-state", "block", `${lang}.phrase`, lang, state[0]));
  }
  const slugState = guide.slug.replace(/-/g, " ").match(new RegExp(OTHER_STATES.source, "i"));
  if (slugState) add(issue("other-state", "block", "slug", null, slugState[0]));
  for (const source of guide.sources) {
    if (!/^https:\/\//.test(source.url)) add(issue("source-bad-url", "block", `sources.${source.id}`, null, source.url || null));
    else if (!isOfficialSource(source.url)) add(issue("source-unofficial", "warn", `sources.${source.id}`, null, source.url));
    if (!cited.has(source.id)) add(issue("source-unused", "warn", `sources.${source.id}`, null, source.id));
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "block" ? -1 : 1));
}

export function blockingIssues(issues: GuideIssue[]): GuideIssue[] {
  return issues.filter((i) => i.severity === "block");
}

// ── The SEO checklist ───────────────────────────────────────────────────

export interface ChecklistItem {
  key: ChecklistKey;
  pass: boolean;
  /** Required to publish; the others are advice. */
  required: boolean;
  /** What was found, per language when it differs ("en: 72 characters"). */
  found: string[];
}

const LINK_TARGETS = ["/como-funciona", "/precios"] as const;

function hasLinkTo(body: GuideBody, target: string): boolean {
  const all = [body.intro, ...body.sections.flatMap((s) => s.paragraphs), ...body.faq.map((f) => f.a)];
  return all.some((text) => linksIn(text).some((href) => href === target || href.startsWith(`${target}?`) || href.startsWith(`${target}#`)));
}

function phraseWords(phrase: string): string[] {
  const stop = new Set(["the", "a", "an", "of", "on", "in", "to", "for", "and", "how", "what", "your", "my", "el", "la", "los", "las", "de", "del", "en", "un", "una", "y", "como", "cómo", "que", "qué", "tu", "mi", "para", "por"]);
  return slugify(phrase)
    .split("-")
    .filter((w) => w.length > 2 && !stop.has(w));
}

/** The SEO checklist for a guide. `takenSlugs`: the other guides' slugs. */
export function guideChecklist(guide: Pick<Guide, "slug" | "body" | "sources" | "phrase">, takenSlugs: readonly string[] = [], issues: GuideIssue[] = checkGuide(guide)): ChecklistItem[] {
  const per = (fn: (lang: Lang) => string | null) => LANGS.map((lang) => [lang, fn(lang)] as const).filter(([, v]) => v !== null).map(([lang, v]) => `${lang}: ${v}`);
  const titleFound = per((lang) => {
    const t = guide.body[lang].title.trim();
    const words = phraseWords(guide.phrase[lang]);
    const slugTitle = slugify(t);
    const hasPhrase = words.length === 0 || words.every((w) => slugTitle.includes(w.slice(0, Math.max(4, w.length - 2))));
    if (t.length < 30 || t.length > 60) return `${t.length}`;
    return hasPhrase ? null : "phrase";
  });
  const descFound = per((lang) => {
    const n = guide.body[lang].description.trim().length;
    return n < 70 || n > 160 ? `${n}` : null;
  });
  const slugIssue = slugProblem(guide.slug);
  const slugWords = phraseWords(guide.phrase.en);
  const slugFound = [
    ...(slugIssue ? [slugIssue] : []),
    ...(takenSlugs.includes(guide.slug) ? ["taken"] : []),
    ...(slugWords.length > 0 && !slugWords.some((w) => guide.slug.includes(w.slice(0, Math.max(4, w.length - 2)))) ? ["phrase"] : []),
  ];
  const headingsFound = per((lang) => {
    const s = guide.body[lang].sections;
    if (s.length < 3) return `${s.length}`;
    return s.some((x) => !x.heading.trim() || x.heading.length > 70) ? "heading" : null;
  });
  const linksFound = per((lang) => {
    const missing = LINK_TARGETS.filter((target) => !hasLinkTo(guide.body[lang], target));
    return missing.length ? missing.join(", ") : null;
  });
  const faqFound = [
    ...per((lang) => {
      const n = guide.body[lang].faq.filter((f) => f.q.trim() && f.a.trim()).length;
      return n < 2 || n > 6 ? `${n}` : null;
    }),
    ...(guide.body.en.faq.length !== guide.body.es.faq.length ? ["count"] : []),
  ];
  const languagesFound = [
    ...(guide.body.en.sections.length !== guide.body.es.sections.length ? ["sections"] : []),
    ...issues.filter((i) => i.rule === "empty-language").map((i) => i.lang ?? ""),
  ];
  const sourceRules = new Set(["legal-unsourced", "citation-unknown", "source-bad-url"]);
  const sourcesFound = [
    ...(guide.sources.length === 0 ? ["none"] : []),
    ...[...new Set(issues.filter((i) => sourceRules.has(i.rule)).map((i) => i.rule))],
  ];
  const lengthFound = per((lang) => {
    const b = guide.body[lang];
    const n = [b.intro, ...b.sections.flatMap((s) => [s.heading, ...s.paragraphs]), ...b.faq.flatMap((f) => [f.q, f.a])].reduce((sum, t) => sum + wordCount(t), 0);
    return n < 400 || n > 2500 ? `${n}` : null;
  });
  const texasFound = [...new Set(issues.filter((i) => i.rule === "other-state" && i.severity === "block").map((i) => i.match ?? ""))];
  return [
    { key: "title", pass: titleFound.length === 0, required: true, found: titleFound },
    { key: "description", pass: descFound.length === 0, required: true, found: descFound },
    { key: "slug", pass: slugFound.filter((f) => f !== "phrase").length === 0, required: true, found: slugFound },
    { key: "headings", pass: headingsFound.length === 0, required: true, found: headingsFound },
    { key: "links", pass: linksFound.length === 0, required: true, found: linksFound },
    { key: "signup", pass: true, required: true, found: [] },
    { key: "faq", pass: faqFound.length === 0, required: true, found: faqFound },
    { key: "languages", pass: languagesFound.length === 0, required: true, found: languagesFound },
    { key: "sources", pass: sourcesFound.length === 0, required: true, found: sourcesFound },
    { key: "length", pass: lengthFound.length === 0, required: false, found: lengthFound },
    { key: "texas", pass: texasFound.length === 0, required: true, found: texasFound },
  ];
}

/** What stops publishing, in order: issues, the checklist, the person's ticks, the status. */
export function publishBlockers(guide: Guide, takenSlugs: readonly string[]): Array<{ code: string; detail: string | null }> {
  const issues = checkGuide(guide);
  const out: Array<{ code: string; detail: string | null }> = [];
  const blocking = blockingIssues(issues);
  if (blocking.length) out.push({ code: "issues", detail: String(blocking.length) });
  for (const item of guideChecklist(guide, takenSlugs, issues)) if (item.required && !item.pass) out.push({ code: `checklist.${item.key}`, detail: item.found.join("; ") || null });
  for (const tick of GUIDE_TICKS) if (!guide.checklist[tick]) out.push({ code: `tick.${tick}`, detail: null });
  if (guide.status !== "review") out.push({ code: "status", detail: guide.status });
  return out;
}

// ── The workflow ────────────────────────────────────────────────────────

export type GuidePatch = Partial<Pick<Guide, "topic" | "brief" | "phrase" | "slug" | "body" | "sources" | "checklist">>;

export type GuideAction =
  | { action: "create"; topic: string; brief?: string; phrase?: Partial<Bilingual>; slug?: string; body?: Partial<Record<Lang, Partial<GuideBody>>>; sources?: GuideSource[]; aiDraft?: boolean }
  | { action: "update"; id: string; patch: GuidePatch; aiDraft?: boolean }
  | { action: "submit"; id: string }
  | { action: "request_changes"; id: string; note: string }
  | { action: "publish"; id: string }
  | { action: "unpublish"; id: string }
  | { action: "archive"; id: string }
  | { action: "restore"; id: string };

export const GUIDE_ACTION_CAPABILITY: Record<GuideAction["action"], Capability> = {
  create: "seo.edit",
  update: "seo.edit",
  submit: "seo.edit",
  archive: "seo.edit",
  restore: "seo.edit",
  request_changes: "seo.publish",
  publish: "seo.publish",
  unpublish: "seo.publish",
};

export type GuideResult = { ok: true; guide: Guide; created: boolean; events: GuideEvent[] } | { ok: false; code: string; message: Bilingual };

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\u0000/g, "").slice(0, max);

let counter = 0;
export function newSeoId(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyBody(): GuideBody {
  return { title: "", description: "", intro: "", sections: [], faq: [] };
}

/** A body as typed or as the model sent it, trimmed to the limits. */
export function cleanBody(input: Partial<GuideBody> | undefined): GuideBody {
  const b = input ?? {};
  return {
    title: clip(b.title, GUIDE_LIMITS.title).trim(),
    description: clip(b.description, GUIDE_LIMITS.description).trim(),
    intro: clip(b.intro, GUIDE_LIMITS.intro).trim(),
    sections: (Array.isArray(b.sections) ? b.sections : []).slice(0, GUIDE_LIMITS.sections).map((s) => ({
      heading: clip(s?.heading, GUIDE_LIMITS.heading).trim(),
      paragraphs: (Array.isArray(s?.paragraphs) ? s.paragraphs : []).slice(0, GUIDE_LIMITS.paragraphsPerSection).map((p) => clip(p, GUIDE_LIMITS.paragraph).trim()),
    })),
    faq: (Array.isArray(b.faq) ? b.faq : []).slice(0, GUIDE_LIMITS.faq).map((f) => ({ q: clip(f?.q, GUIDE_LIMITS.faqText).trim(), a: clip(f?.a, GUIDE_LIMITS.faqText).trim() })),
  };
}

export function cleanSources(input: GuideSource[] | undefined): GuideSource[] {
  const seen = new Set<string>();
  return (Array.isArray(input) ? input : []).slice(0, GUIDE_LIMITS.sources).flatMap((s) => {
    const id = slugify(clip(s?.id, 40)).slice(0, 40);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: clip(s?.label, GUIDE_LIMITS.sourceLabel).trim(), cite: clip(s?.cite, GUIDE_LIMITS.sourceCite).trim(), url: clip(s?.url, GUIDE_LIMITS.url).trim() }];
  });
}

const msg = (en: string, es: string): Bilingual => ({ en, es });

/** Apply one step of the workflow. Pure: the demo, the routes and the tests share it. */
export function applyGuideAction(guides: readonly Guide[], action: GuideAction, by: string, now: Date): GuideResult {
  const at = now.toISOString();
  const event = (guideId: string, kind: GuideEvent["kind"], note: string | null = null): GuideEvent => ({ id: newSeoId("ge"), guideId, at, by, kind, note });

  if (action.action === "create") {
    const topic = clip(action.topic, GUIDE_LIMITS.topic).trim();
    if (topic.length < 3) return { ok: false, code: "topic", message: msg("Write the topic (3 characters or more).", "Escribe el tema (3 caracteres o más).") };
    const phrase = { en: clip(action.phrase?.en, GUIDE_LIMITS.phrase).trim(), es: clip(action.phrase?.es, GUIDE_LIMITS.phrase).trim() };
    let slug = slugify(action.slug || phrase.en || topic) || `guide-${Date.now().toString(36)}`;
    const taken = new Set(guides.map((g) => g.slug));
    for (let n = 2; taken.has(slug); n += 1) slug = `${slugify(action.slug || phrase.en || topic).slice(0, 76)}-${n}`;
    const guide: Guide = {
      id: newSeoId("gd"),
      slug,
      status: "draft",
      topic,
      brief: clip(action.brief, GUIDE_LIMITS.brief).trim(),
      phrase,
      body: { en: cleanBody(action.body?.en), es: cleanBody(action.body?.es) },
      sources: cleanSources(action.sources),
      checklist: {},
      aiDraft: Boolean(action.aiDraft),
      approval: null,
      published: null,
      changesNote: null,
      createdBy: by,
      createdAt: at,
      updatedAt: at,
    };
    return { ok: true, guide, created: true, events: [event(guide.id, action.aiDraft ? "drafted" : "created")] };
  }

  const guide = guides.find((g) => g.id === action.id);
  if (!guide) return { ok: false, code: "not_found", message: msg("That guide no longer exists.", "Esa guía ya no existe.") };
  const others = guides.filter((g) => g.id !== guide.id);

  switch (action.action) {
    case "update": {
      if (guide.status === "archived") return { ok: false, code: "archived", message: msg("Restore the guide before editing it.", "Restaura la guía antes de editarla.") };
      const p = action.patch;
      const slug = p.slug !== undefined ? slugify(p.slug) : guide.slug;
      if (slug !== guide.slug) {
        if (guide.published) return { ok: false, code: "slug_locked", message: msg("The address cannot change once the guide has been live: links and search results point to it.", "La dirección no cambia una vez que la guía estuvo publicada: los enlaces y los resultados apuntan a ella.") };
        if (slugProblem(slug)) return { ok: false, code: "slug", message: msg("Use 3 to 80 lowercase letters, digits and hyphens.", "Usa de 3 a 80 minúsculas, números y guiones.") };
        if (others.some((g) => g.slug === slug)) return { ok: false, code: "slug_taken", message: msg("Another guide already uses that address.", "Otra guía ya usa esa dirección.") };
      }
      const next: Guide = {
        ...guide,
        topic: p.topic !== undefined ? clip(p.topic, GUIDE_LIMITS.topic).trim() || guide.topic : guide.topic,
        brief: p.brief !== undefined ? clip(p.brief, GUIDE_LIMITS.brief).trim() : guide.brief,
        phrase: p.phrase ? { en: clip(p.phrase.en, GUIDE_LIMITS.phrase).trim(), es: clip(p.phrase.es, GUIDE_LIMITS.phrase).trim() } : guide.phrase,
        slug,
        body: p.body ? { en: cleanBody(p.body.en), es: cleanBody(p.body.es) } : guide.body,
        sources: p.sources ? cleanSources(p.sources) : guide.sources,
        checklist: p.checklist ? Object.fromEntries(GUIDE_TICKS.filter((t) => p.checklist![t]).map((t) => [t, true])) : guide.checklist,
        aiDraft: guide.aiDraft || Boolean(action.aiDraft),
        updatedAt: at,
      };
      const events = [event(guide.id, action.aiDraft ? "drafted" : "edited")];
      const changed = guideHash(next) !== guideHash(guide);
      if (changed) {
        // New words: the person's ticks were about the old ones, and any approval is gone.
        if (!p.checklist) next.checklist = {};
        if (next.approval) {
          next.approval = null;
          events.push(event(guide.id, "approval_reset"));
        }
        if (["approved", "published", "changes"].includes(next.status)) next.status = "draft";
      }
      return { ok: true, guide: next, created: false, events };
    }
    case "submit": {
      if (!["draft", "changes"].includes(guide.status)) return { ok: false, code: "status", message: msg("Only a draft can be sent for approval.", "Solo un borrador se manda a aprobación.") };
      return { ok: true, guide: { ...guide, status: "review", changesNote: null, updatedAt: at }, created: false, events: [event(guide.id, "submitted")] };
    }
    case "request_changes": {
      if (guide.status !== "review") return { ok: false, code: "status", message: msg("Only a guide waiting for approval can get changes asked.", "Solo a una guía en espera de aprobación se le piden cambios.") };
      const note = clip(action.note, GUIDE_LIMITS.note).trim();
      if (note.length < 3) return { ok: false, code: "note", message: msg("Say what to change.", "Di qué cambiar.") };
      return { ok: true, guide: { ...guide, status: "changes", changesNote: note, updatedAt: at }, created: false, events: [event(guide.id, "changes_requested", note)] };
    }
    case "publish": {
      const taken = others.filter((g) => g.status !== "archived" || g.published).map((g) => g.slug);
      const blockers = publishBlockers(guide, taken);
      if (blockers.length) return { ok: false, code: "blocked", message: msg(`It cannot be published yet: ${blockers.map((b) => b.code).join(", ")}.`, `Todavía no se puede publicar: ${blockers.map((b) => b.code).join(", ")}.`) };
      const hash = guideHash(guide);
      const published: PublishedGuide = {
        slug: guide.slug,
        body: guide.body,
        sources: guide.sources,
        hash,
        publishedAt: at,
        firstPublishedAt: guide.published?.firstPublishedAt ?? at,
        approvedBy: by,
      };
      return {
        ok: true,
        guide: { ...guide, status: "published", approval: { hash, by, at }, published, changesNote: null, updatedAt: at },
        created: false,
        events: [event(guide.id, "approved"), event(guide.id, "published", guide.slug)],
      };
    }
    case "unpublish": {
      if (!guide.published) return { ok: false, code: "not_live", message: msg("This guide is not on the site.", "Esta guía no está en el sitio.") };
      return { ok: true, guide: { ...guide, published: null, approval: null, status: "draft", updatedAt: at }, created: false, events: [event(guide.id, "unpublished")] };
    }
    case "archive": {
      if (guide.published) return { ok: false, code: "live", message: msg("Take it off the site first (only an administrator can).", "Primero quítala del sitio (solo un administrador puede).") };
      if (guide.status === "archived") return { ok: true, guide, created: false, events: [] };
      return { ok: true, guide: { ...guide, status: "archived", approval: null, updatedAt: at }, created: false, events: [event(guide.id, "archived")] };
    }
    case "restore": {
      if (guide.status !== "archived") return { ok: true, guide, created: false, events: [] };
      return { ok: true, guide: { ...guide, status: "draft", updatedAt: at }, created: false, events: [event(guide.id, "restored")] };
    }
  }
}

/** The capability one action needs on this guide (archiving a live guide is an administrator's: it takes it off the site). */
export function capabilityFor(action: GuideAction): Capability {
  return GUIDE_ACTION_CAPABILITY[action.action];
}

/** Only what is live, for the public pages and the sitemap. */
export function publishedOnly(guides: readonly Guide[]): PublishedGuide[] {
  return guides.filter(isLive).map((g) => g.published!);
}

export const STATUS_ORDER: readonly GuideStatus[] = ["review", "changes", "draft", "approved", "published", "archived"];

/** Ticks a person must make, in order. */
export const TICK_ORDER: readonly GuideTick[] = GUIDE_TICKS;
