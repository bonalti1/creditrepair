import { LOCALE_QUERY } from "../i18n/detect";
import { hreflangAlternates, localizedUrl, PRIVATE_PATHS, SITE_LOCALES, SITE_PAGES, siteUrl } from "../site/routes";
import { GUIDES_INDEX_PATH, guidePath } from "./guides";
import type { HealthCheckKey } from "./text";
import type { Bilingual, HealthFinding, HealthReport, Lang } from "./types";

// Site health: the app reads its own public pages the way a search engine
// does (over HTTP, from the route list, the published guides, robots.txt and
// the sitemap) and checks what matters for being found. Works with no keys.
// No score: each check passes or says what to fix (docs/SEO.md).
//
//   parsePage     pure: the tags a crawler reads, from one page's HTML.
//   checkPage     pure: the findings for one page.
//   checkRobots / checkSitemap / checkPrivate   pure, from their responses.
//   crawlSite     the run: fetches (injected), then the checks above.

export interface ParsedPage {
  title: string | null;
  description: string | null;
  h1: number;
  canonical: string | null;
  hreflang: Record<string, string>;
  og: Record<string, string>;
  schemaTypes: string[];
  imagesWithoutAlt: string[];
  links: string[];
  htmlLang: string | null;
  robots: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

/** The attributes of one tag: lowercase names, decoded values (a bare attribute is ""). */
export function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<\s*[a-z0-9-]+/i, "").replace(/\/?>$/, "");
  for (const m of body.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);

function schemaTypesOf(value: unknown, out: string[]): void {
  if (Array.isArray(value)) value.forEach((v) => schemaTypesOf(v, out));
  else if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const type = v["@type"];
    if (typeof type === "string") out.push(type);
    else if (Array.isArray(type)) for (const t of type) if (typeof t === "string") out.push(t);
    if (Array.isArray(v["@graph"])) schemaTypesOf(v["@graph"], out);
  }
}

export function parsePage(html: string): ParsedPage {
  // Only the document's own <head> title (an inline SVG may carry a <title> too).
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html;
  const titleMatch = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const metas = tags(html, "meta").map(attributes);
  const linkTags = tags(html, "link").map(attributes);
  const meta = (name: string) => metas.find((m) => (m.name ?? "").toLowerCase() === name)?.content ?? null;
  const og: Record<string, string> = {};
  for (const m of metas) if ((m.property ?? "").startsWith("og:") && m.content !== undefined) og[m.property!] = m.content;
  const hreflang: Record<string, string> = {};
  for (const l of linkTags) if ((l.rel ?? "").toLowerCase() === "alternate" && l.hreflang && l.href) hreflang[l.hreflang] = l.href;
  const schemaTypes: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      schemaTypesOf(JSON.parse(m[1]!), schemaTypes);
    } catch {
      schemaTypes.push("(unreadable)");
    }
  }
  const images = tags(html, "img").map(attributes);
  const body = html.replace(/<head\b[\s\S]*?<\/head>/i, "");
  return {
    title: titleMatch ? decode(titleMatch[1]!.replace(/<[^>]+>/g, "")).trim() : null,
    description: meta("description"),
    h1: (body.match(/<h1\b/gi) ?? []).length,
    canonical: linkTags.find((l) => (l.rel ?? "").toLowerCase() === "canonical")?.href ?? null,
    hreflang,
    og,
    schemaTypes,
    imagesWithoutAlt: images.filter((i) => !("alt" in i)).map((i) => i.src ?? i.srcset ?? "(img)"),
    links: tags(body, "a").map(attributes).map((a) => a.href ?? "").filter(Boolean),
    htmlLang: attributes(html.match(/<html\b[^>]*>/i)?.[0] ?? "<html>").lang ?? null,
    robots: meta("robots"),
  };
}

// ── The checks ──────────────────────────────────────────────────────────

export const TITLE_RANGE = { min: 15, max: 65 } as const;
export const DESCRIPTION_RANGE = { min: 70, max: 160 } as const;

export interface PageTarget {
  path: string;
  locale: Lang;
  kind: "site" | "faq" | "guide" | "guides";
}

/** The same address, written either way ("https://site" and "https://site/" are one URL; Next writes the root without the slash). */
export function sameUrl(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

const f = (check: HealthCheckKey, state: HealthFinding["state"], where: string, en: string, es: string): HealthFinding => ({ check, state, where, detail: { en, es } });
const label = (t: PageTarget) => `${t.path}?${LOCALE_QUERY}=${t.locale}`;

export function checkPage(target: PageTarget, status: number, page: ParsedPage | null, base: string): HealthFinding[] {
  const where = label(target);
  if (status >= 400 || !page) return [f("status", "fix", where, `The page answered ${status}.`, `La página respondió ${status}.`)];
  const out: HealthFinding[] = [f("status", "pass", where, `Answers ${status}.`, `Responde ${status}.`)];

  const title = page.title ?? "";
  if (!title) out.push(f("title", "fix", where, "No title.", "Sin título."));
  else if (title.length < TITLE_RANGE.min || title.length > TITLE_RANGE.max) out.push(f("title", "fix", where, `${title.length} characters: «${title}»`, `${title.length} caracteres: «${title}»`));
  else out.push(f("title", "pass", where, `${title.length} characters.`, `${title.length} caracteres.`));

  const description = page.description ?? "";
  if (!description) out.push(f("description", "fix", where, "No meta description.", "Sin meta descripción."));
  else if (description.length < DESCRIPTION_RANGE.min || description.length > DESCRIPTION_RANGE.max) out.push(f("description", "fix", where, `${description.length} characters.`, `${description.length} caracteres.`));
  else out.push(f("description", "pass", where, `${description.length} characters.`, `${description.length} caracteres.`));

  out.push(page.h1 === 1 ? f("h1", "pass", where, "One h1.", "Un h1.") : f("h1", "fix", where, `${page.h1} h1 headings.`, `${page.h1} encabezados h1.`));

  const canonical = localizedUrl(target.path, target.locale, base);
  out.push(sameUrl(page.canonical, canonical) ? f("canonical", "pass", where, canonical, canonical) : f("canonical", "fix", where, `Expected ${canonical}, found ${page.canonical ?? "none"}.`, `Se esperaba ${canonical}, hay ${page.canonical ?? "ninguno"}.`));

  const expected = hreflangAlternates(target.path, base);
  const wrong = Object.entries(expected).filter(([lang, url]) => !sameUrl(page.hreflang[lang], url)).map(([lang]) => lang);
  out.push(wrong.length === 0 ? f("hreflang", "pass", where, "en, es and x-default.", "en, es y x-default.") : f("hreflang", "fix", where, `Missing or wrong: ${wrong.join(", ")}.`, `Faltan o están mal: ${wrong.join(", ")}.`));

  const ogMissing = ["og:title", "og:description", "og:image", "og:url"].filter((k) => !page.og[k]);
  out.push(ogMissing.length === 0 ? f("og", "pass", where, "Title, description, image and address.", "Título, descripción, imagen y dirección.") : f("og", "fix", where, `Missing: ${ogMissing.join(", ")}.`, `Falta: ${ogMissing.join(", ")}.`));

  out.push(page.htmlLang?.toLowerCase().startsWith(target.locale) ? f("htmlLang", "pass", where, `lang="${page.htmlLang}"`, `lang="${page.htmlLang}"`) : f("htmlLang", "fix", where, `lang="${page.htmlLang ?? ""}" on a page asked in ${target.locale}.`, `lang="${page.htmlLang ?? ""}" en una página pedida en ${target.locale}.`));

  const types = new Set(page.schemaTypes);
  out.push(types.has("Organization") ? f("schemaOrg", "pass", where, "Organization data present.", "Hay datos de Organization.") : f("schemaOrg", "fix", where, "No Organization data.", "Sin datos de Organization."));
  if (target.kind === "faq") out.push(types.has("FAQPage") ? f("schemaFaq", "pass", where, "FAQPage data present.", "Hay datos de FAQPage.") : f("schemaFaq", "fix", where, "No FAQPage data.", "Sin datos de FAQPage."));
  if (target.kind === "guide") out.push(types.has("Article") ? f("schemaArticle", "pass", where, "Article data present.", "Hay datos de Article.") : f("schemaArticle", "fix", where, "No Article data.", "Sin datos de Article."));
  if (types.has("(unreadable)")) out.push(f("schemaOrg", "fix", where, "A structured data block is not valid JSON.", "Un bloque de datos estructurados no es JSON válido."));

  out.push(page.imagesWithoutAlt.length === 0 ? f("imgAlt", "pass", where, "Every image has an alt.", "Cada imagen tiene alt.") : f("imgAlt", "fix", where, `No alt: ${page.imagesWithoutAlt.slice(0, 3).join(", ")}`, `Sin alt: ${page.imagesWithoutAlt.slice(0, 3).join(", ")}`));
  return out;
}

/** A link on our own site, as a path ("/precios?lang=es"), or null (another site, mail, phone, anchor). */
export function internalPath(href: string, origins: readonly string[]): string | null {
  if (!href || href.startsWith("#") || /^(mailto|tel|sms|javascript):/i.test(href)) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href.split("#")[0] || "/";
  for (const origin of origins) if (href === origin || href.startsWith(`${origin}/`) || href.startsWith(`${origin}?`)) return (href.slice(origin.length) || "/").split("#")[0] || "/";
  return null;
}

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  sitemaps: string[];
}

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [], sitemaps: [] };
  let forAll = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") forAll = value === "*";
    else if (key === "sitemap") rules.sitemaps.push(value);
    else if (forAll && key === "allow") rules.allow.push(value);
    else if (forAll && key === "disallow") rules.disallow.push(value);
  }
  return rules;
}

/** True when robots.txt keeps crawlers out of this path. */
export function disallowed(rules: RobotsRules, path: string): boolean {
  return rules.disallow.some((d) => d && (path === d.replace(/\/$/, "") || path.startsWith(d)));
}

export function checkRobots(status: number, text: string, base: string): HealthFinding[] {
  if (status >= 400) return [f("robots", "fix", "/robots.txt", `robots.txt answered ${status}.`, `robots.txt respondió ${status}.`)];
  const rules = parseRobots(text);
  const out: HealthFinding[] = [];
  const open = rules.allow.includes("/") || !rules.disallow.includes("/");
  out.push(open ? f("robots", "pass", "/robots.txt", "The website may be crawled.", "El sitio se puede rastrear.") : f("robots", "fix", "/robots.txt", "robots.txt blocks the whole site.", "robots.txt bloquea todo el sitio."));
  const missing = PRIVATE_PATHS.filter((p) => !rules.disallow.includes(p));
  out.push(missing.length === 0 ? f("robots", "pass", "/robots.txt", `${PRIVATE_PATHS.length} private paths kept out.`, `${PRIVATE_PATHS.length} rutas privadas excluidas.`) : f("robots", "fix", "/robots.txt", `Not kept out: ${missing.join(", ")}`, `No excluidas: ${missing.join(", ")}`));
  const blockedPublic = SITE_PAGES.filter((p) => disallowed(rules, p.path)).map((p) => p.path);
  if (blockedPublic.length) out.push(f("robots", "fix", "/robots.txt", `Public pages blocked: ${blockedPublic.join(", ")}`, `Páginas públicas bloqueadas: ${blockedPublic.join(", ")}`));
  const sitemap = `${base}/sitemap.xml`;
  out.push(rules.sitemaps.includes(sitemap) ? f("robots", "pass", "/robots.txt", `Points to ${sitemap}.`, `Apunta a ${sitemap}.`) : f("robots", "fix", "/robots.txt", `Does not point to ${sitemap}.`, `No apunta a ${sitemap}.`));
  return out;
}

export function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decode(m[1]!));
}

/** The sitemap lists every public page and live guide in both languages, and nothing private. */
export function checkSitemap(status: number, xml: string, base: string, guideSlugs: readonly string[]): HealthFinding[] {
  if (status >= 400) return [f("sitemap", "fix", "/sitemap.xml", `The sitemap answered ${status}.`, `El mapa del sitio respondió ${status}.`)];
  const urls = new Set(sitemapUrls(xml));
  const expected = [
    ...SITE_PAGES.map((p) => p.path),
    ...(guideSlugs.length ? [GUIDES_INDEX_PATH, ...guideSlugs.map(guidePath)] : []),
  ].flatMap((path) => SITE_LOCALES.map((l) => localizedUrl(path, l, base)));
  const missing = expected.filter((u) => !urls.has(u));
  const out: HealthFinding[] = [
    missing.length === 0
      ? f("sitemap", "pass", "/sitemap.xml", `${expected.length} addresses, every page in both languages.`, `${expected.length} direcciones, cada página en los dos idiomas.`)
      : f("sitemap", "fix", "/sitemap.xml", `Missing: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}`, `Faltan: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}`),
  ];
  const privateListed = [...urls].filter((u) => {
    const path = u.startsWith(base) ? u.slice(base.length).split("?")[0] || "/" : null;
    return path !== null && PRIVATE_PATHS.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
  });
  out.push(privateListed.length === 0 ? f("sitemap", "pass", "/sitemap.xml", "Nothing private listed.", "Nada privado en la lista.") : f("sitemap", "fix", "/sitemap.xml", `Private pages listed: ${privateListed.join(", ")}`, `Páginas privadas en la lista: ${privateListed.join(", ")}`));
  return out;
}

/** The private routes a crawl looks at: the console, the client app and the sign-in pages. */
export const PRIVATE_SAMPLES = ["/equipo", "/equipo/seo", "/dashboard", "/login", "/registro", "/onboarding", "/socios/portal"] as const;

export function checkPrivate(path: string, status: number, robotsHeader: string | null, html: string, rules: RobotsRules | null): HealthFinding {
  const meta = status < 300 && html ? parsePage(html).robots : null;
  const noindex = /noindex/i.test(robotsHeader ?? "") || /noindex/i.test(meta ?? "");
  const kept = rules ? disallowed(rules, path) : false;
  if (noindex && kept) return f("noindex", "pass", path, "Kept out by robots.txt and marked noindex.", "Excluida en robots.txt y marcada noindex.");
  const why = [!kept ? "not in robots.txt" : null, !noindex ? "no noindex header or tag" : null].filter(Boolean).join("; ");
  const porque = [!kept ? "no está en robots.txt" : null, !noindex ? "sin encabezado ni etiqueta noindex" : null].filter(Boolean).join("; ");
  return f("noindex", "fix", path, `Could be indexed: ${why}.`, `Se podría indexar: ${porque}.`);
}

// ── The crawl ───────────────────────────────────────────────────────────

export type Fetcher = (url: string, init?: { redirect?: "follow" | "manual" }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export interface CrawlInput {
  /** Where to fetch from: the site's own origin (e.g. http://localhost:3000 or https://credalti.com). */
  origin: string;
  /** The site's public origin the pages put in their canonical links (siteUrl()). */
  base?: string;
  /** Live guides' slugs. */
  guideSlugs: readonly string[];
  fetch: Fetcher;
  now?: Date;
  /** At most this many internal links are checked (each once). */
  linkLimit?: number;
  concurrency?: number;
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Every public page the crawl reads: the site's pages and, when there are live guides, the index and each guide, in both languages. */
export function crawlTargets(guideSlugs: readonly string[]): PageTarget[] {
  const paths: Array<{ path: string; kind: PageTarget["kind"] }> = [
    ...SITE_PAGES.map((p) => ({ path: p.path, kind: (p.key === "faq" ? "faq" : "site") as PageTarget["kind"] })),
    ...(guideSlugs.length ? [{ path: GUIDES_INDEX_PATH, kind: "guides" as const }, ...guideSlugs.map((s) => ({ path: guidePath(s), kind: "guide" as const }))] : []),
  ];
  return paths.flatMap((p) => SITE_LOCALES.map((locale) => ({ ...p, locale })));
}

export async function crawlSite(input: CrawlInput): Promise<HealthReport> {
  const origin = input.origin.replace(/\/+$/, "");
  const base = (input.base ?? siteUrl()).replace(/\/+$/, "");
  const findings: HealthFinding[] = [];
  const errors: HealthReport["errors"] = [];
  const get = async (path: string, redirect: "follow" | "manual" = "follow") => {
    try {
      const res = await input.fetch(`${origin}${path}`, { redirect });
      return { status: res.status, headers: res.headers, text: await res.text() };
    } catch (error) {
      errors.push({ where: path, reason: error instanceof Error ? error.message.slice(0, 200) : "fetch failed" });
      return null;
    }
  };

  const targets = crawlTargets(input.guideSlugs);
  const pages = await pool(targets, input.concurrency ?? 4, async (target) => ({ target, res: await get(label(target)) }));
  const links = new Map<string, string>();
  for (const { target, res } of pages) {
    if (!res) continue;
    const parsed = res.status < 400 ? parsePage(res.text) : null;
    findings.push(...checkPage(target, res.status, parsed, base));
    for (const href of parsed?.links ?? []) {
      const path = internalPath(href, [origin, base]);
      if (path && !path.startsWith("/api/") && !links.has(path)) links.set(path, label(target));
    }
  }

  // Links found on the pages, each once.
  const toCheck = [...links.entries()].slice(0, input.linkLimit ?? 60);
  const linkResults = await pool(toCheck, input.concurrency ?? 4, async ([path, from]) => ({ path, from, res: await get(path) }));
  const broken = linkResults.filter((l) => l.res && l.res.status >= 400);
  findings.push(
    broken.length === 0
      ? f("links", "pass", "site", `${linkResults.length} internal links answer.`, `${linkResults.length} enlaces internos responden.`)
      : f("links", "fix", "site", broken.map((b) => `${b.path} (${b.res!.status}, on ${b.from})`).join("; "), broken.map((b) => `${b.path} (${b.res!.status}, en ${b.from})`).join("; ")),
  );

  const robots = await get("/robots.txt");
  const rules = robots && robots.status < 400 ? parseRobots(robots.text) : null;
  if (robots) findings.push(...checkRobots(robots.status, robots.text, base));
  const sitemap = await get("/sitemap.xml");
  if (sitemap) findings.push(...checkSitemap(sitemap.status, sitemap.text, base, input.guideSlugs));

  for (const path of PRIVATE_SAMPLES) {
    const res = await get(path, "manual");
    if (res) findings.push(checkPrivate(path, res.status, res.headers.get("x-robots-tag"), res.text, rules));
  }

  return { checkedAt: (input.now ?? new Date()).toISOString(), origin, pages: targets.length, findings, errors };
}

// ── Reading a report ────────────────────────────────────────────────────

export const CHECK_ORDER: readonly HealthCheckKey[] = ["status", "title", "description", "h1", "canonical", "hreflang", "og", "htmlLang", "schemaOrg", "schemaFaq", "schemaArticle", "imgAlt", "links", "robots", "sitemap", "noindex"];

export interface CheckGroup {
  check: HealthCheckKey;
  fix: HealthFinding[];
  pass: number;
}

/** One line per check, those to fix first; no score. */
export function groupFindings(report: HealthReport): CheckGroup[] {
  return CHECK_ORDER.map((check) => {
    const all = report.findings.filter((x) => x.check === check);
    return { check, fix: all.filter((x) => x.state === "fix"), pass: all.filter((x) => x.state === "pass").length };
  })
    .filter((g) => g.fix.length + g.pass > 0)
    .sort((a, b) => Number(b.fix.length > 0) - Number(a.fix.length > 0));
}

/** How many checks need a person (a check with any page to fix counts once), plus pages that could not be read. */
export function healthToFix(report: HealthReport | null): number {
  if (!report) return 0;
  return groupFindings(report).filter((g) => g.fix.length > 0).length + (report.errors.length > 0 ? 1 : 0);
}

export function findingText(finding: HealthFinding, locale: Lang): string {
  return (finding.detail as Bilingual)[locale];
}

/** Where to crawl from: the request's own origin when it is this site (or a local server), else the public site. Never anywhere else. */
export function crawlOrigin(requestUrl: string, env: Partial<Record<string, string | undefined>> = process.env): string {
  const req = new URL(requestUrl);
  const allowed = new Set([siteUrl(env), env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "")].filter(Boolean) as string[]);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(req.hostname);
  if (local || allowed.has(req.origin)) return req.origin;
  return siteUrl(env);
}
