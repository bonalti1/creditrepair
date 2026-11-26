import { SITE_PAGES } from "../site/routes";
import { guidePath } from "./guides";
import { GUIDE_TOPICS } from "./starters";
import { SEO_TEXT } from "./text";
import type { Bilingual, Guide, Lang, SearchTotals, TrackedPhrase } from "./types";

// The phrases the site wants to be found for (English and Spanish, statewide
// or for a Texas city), each tied to the page meant to answer it, with its
// Search Console position when connected; and «content gaps»: what no page
// answers yet, each one a brief for a new guide. Texas only: a city outside
// Texas is refused here and by the database (migration 0039).

/** Texas cities a phrase may name (the database holds the same list). */
export const TEXAS_CITIES = [
  "Houston",
  "San Antonio",
  "Dallas",
  "Austin",
  "Fort Worth",
  "El Paso",
  "Arlington",
  "Corpus Christi",
  "Plano",
  "Laredo",
  "Lubbock",
  "Irving",
  "Garland",
  "Frisco",
  "McKinney",
  "Amarillo",
  "Grand Prairie",
  "Brownsville",
  "Killeen",
  "Pasadena",
  "McAllen",
  "Mesquite",
  "Denton",
  "Waco",
  "Midland",
  "Odessa",
  "Beaumont",
  "Round Rock",
  "Edinburg",
  "Harlingen",
  "Mission",
  "Pharr",
  "Tyler",
  "College Station",
  "Abilene",
  "San Angelo",
  "Wichita Falls",
  "Sugar Land",
  "Pearland",
  "Conroe",
  "Katy",
  "Baytown",
  "Richardson",
  "Carrollton",
  "Lewisville",
  "Allen",
] as const;

export const PHRASE_LIMIT = 100;

/** The pages a phrase may point at: the site's pages and the guides (live or not yet). */
export function targetOptions(guides: readonly Guide[]): Array<{ path: string; label: string }> {
  return [
    ...SITE_PAGES.filter((p) => p.key !== "privacy" && p.key !== "terms").map((p) => ({ path: p.path, label: p.path })),
    ...guides.filter((g) => g.status !== "archived").map((g) => ({ path: guidePath(g.slug), label: g.body.en.title || g.topic })),
  ];
}

const OTHER_PLACES = /\b(Georgia|Atlanta|Florida|Miami|California|Los Angeles|New York|Arizona|Phoenix|Illinois|Chicago|Oklahoma|Louisiana|New Mexico|Nuevo M[eé]xico|Nueva York)\b/i;

export type PhraseProblem = "short" | "long" | "city" | "other_place" | "duplicate" | "target";

/** What is wrong with a phrase before it is saved, or null. */
export function phraseProblem(input: { phrase: string; lang: Lang; city: string | null; targetPath: string | null }, existing: readonly TrackedPhrase[], targets: readonly string[]): PhraseProblem | null {
  const phrase = input.phrase.replace(/\s+/g, " ").trim();
  if (phrase.length < 3) return "short";
  if (phrase.length > PHRASE_LIMIT) return "long";
  if (input.city && !(TEXAS_CITIES as readonly string[]).includes(input.city)) return "city";
  if (OTHER_PLACES.test(phrase)) return "other_place";
  if (existing.some((p) => p.phrase.toLowerCase() === phrase.toLowerCase() && p.lang === input.lang && (p.city ?? null) === (input.city ?? null))) return "duplicate";
  if (input.targetPath && !targets.includes(input.targetPath)) return "target";
  return null;
}

export const PHRASE_PROBLEM_TEXT: Record<PhraseProblem, Bilingual> = {
  short: { en: "Write a phrase of 3 characters or more.", es: "Escribe una frase de 3 caracteres o más." },
  long: { en: `Keep it under ${PHRASE_LIMIT} characters.`, es: `Que tenga menos de ${PHRASE_LIMIT} caracteres.` },
  city: { en: "Choose a Texas city from the list. Credalti serves only Texas.", es: "Elige una ciudad de Texas de la lista. Credalti atiende solo en Texas." },
  other_place: { en: "It names a place outside Texas. Credalti serves only Texas, and never Georgia.", es: "Nombra un lugar fuera de Texas. Credalti atiende solo en Texas, y nunca en Georgia." },
  duplicate: { en: "That phrase is already tracked.", es: "Esa frase ya se sigue." },
  target: { en: "Choose a page of the site or a guide.", es: "Elige una página del sitio o una guía." },
};

/** A phrase's Search Console numbers: the query that matches it exactly (spaces and case aside). */
export function phraseStats(phrase: TrackedPhrase, byQuery: readonly SearchTotals[]): SearchTotals | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return byQuery.find((q) => norm(q.key) === norm(phrase.phrase)) ?? null;
}

export interface Gap {
  id: string;
  kind: "phrase_no_page" | "phrase_low_rank" | "query_no_phrase" | "starter";
  text: Bilingual;
  /** The brief this gap becomes: a new guide's topic, phrase and brief. */
  brief: { topic: string; phrase: Bilingual; brief: string };
}

const both = (fn: (l: "en" | "es") => string): Bilingual => ({ en: fn("en"), es: fn("es") });

/**
 * What no page answers well yet, best first: tracked phrases with no page,
 * phrases that rank past the first page, searches people already make that
 * no phrase covers, and the topic list. Searches come only from Search
 * Console (never invented).
 */
export function contentGaps(input: { phrases: readonly TrackedPhrase[]; guides: readonly Guide[]; byQuery: readonly SearchTotals[] | null }): Gap[] {
  const out: Gap[] = [];
  const covered = (text: string) => {
    const t = text.toLowerCase();
    return input.guides.some((g) => g.status !== "archived" && [g.topic, g.phrase.en, g.phrase.es, g.body.en.title, g.body.es.title].some((x) => x && x.toLowerCase() === t));
  };
  const brief = (phrase: string, lang: Lang) => ({
    topic: phrase,
    phrase: lang === "en" ? { en: phrase, es: "" } : { en: "", es: phrase },
    brief: lang === "en" ? `Answer the search «${phrase}» for a Texan, with a source for every legal fact.` : `Responde la búsqueda «${phrase}» para alguien en Texas, con fuente para cada dato legal.`,
  });
  for (const p of input.phrases) {
    if (!p.targetPath && !covered(p.phrase)) out.push({ id: `nopage:${p.id}`, kind: "phrase_no_page", text: both((l) => SEO_TEXT[l].gaps.phraseNoPage(p.phrase)), brief: brief(p.phrase, p.lang) });
    else if (input.byQuery) {
      const stats = phraseStats(p, input.byQuery);
      if (stats?.position && stats.position > 10) out.push({ id: `rank:${p.id}`, kind: "phrase_low_rank", text: both((l) => SEO_TEXT[l].gaps.phraseLowRank(p.phrase, stats.position!)), brief: brief(p.phrase, p.lang) });
    }
  }
  if (input.byQuery) {
    const tracked = new Set(input.phrases.map((p) => p.phrase.toLowerCase().trim()));
    for (const q of [...input.byQuery].sort((a, b) => b.impressions - a.impressions).slice(0, 50)) {
      if (q.impressions < 20 || tracked.has(q.key.toLowerCase().trim()) || OTHER_PLACES.test(q.key)) continue;
      const lang: Lang = /[áéíóúñ¿]|\b(como|cómo|que|qué|reporte|credito|crédito|para|de)\b/i.test(q.key) ? "es" : "en";
      out.push({ id: `query:${q.key}`, kind: "query_no_phrase", text: both((l) => SEO_TEXT[l].gaps.queryNoPhrase(q.key, q.impressions)), brief: brief(q.key, lang) });
      if (out.filter((g) => g.kind === "query_no_phrase").length >= 8) break;
    }
  }
  for (const t of GUIDE_TOPICS) {
    if (covered(t.topic) || covered(t.phrase.en)) continue;
    out.push({ id: `starter:${t.phrase.en}`, kind: "starter", text: both((l) => SEO_TEXT[l].gaps.starter(t.topic)), brief: { topic: t.topic, phrase: t.phrase, brief: `A plain guide for Texans: ${t.topic}. Every legal fact with an official source.` } });
  }
  return out;
}

/** Demo phrases: what a Texas credit services company would track, in both languages. */
export function demoPhrases(now: Date): TrackedPhrase[] {
  const at = now.toISOString();
  const p = (id: string, phrase: string, lang: Lang, city: string | null, targetPath: string | null, note = ""): TrackedPhrase => ({ id, phrase, lang, city, targetPath, note, createdBy: "carmen", createdAt: at });
  return [
    p("kw_demo1", "credit repair houston", "en", "Houston", "/", "The main city search."),
    p("kw_demo2", "reparación de crédito en houston", "es", "Houston", "/"),
    p("kw_demo3", "how to dispute an error on your credit report in texas", "en", null, "/guias/dispute-credit-report-error-texas"),
    p("kw_demo4", "credit services organization texas law", "en", null, "/guias/texas-credit-services-organization-law"),
    p("kw_demo5", "how long do collections stay on credit report", "en", null, "/guias/how-long-items-stay-on-credit-report"),
    p("kw_demo6", "credit repair san antonio", "en", "San Antonio", null, "No page yet."),
    p("kw_demo7", "cómo leer mi reporte de crédito", "es", null, null),
    p("kw_demo8", "credit repair cost", "en", null, "/precios"),
  ];
}
