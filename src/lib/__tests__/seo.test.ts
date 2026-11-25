import { generateKeyPairSync, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuideArticle from "@/components/site/GuideArticle";
import robots from "@/app/robots";
import { aiByline } from "@/lib/brand";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { contentGaps, demoPhrases, phraseProblem, TEXAS_CITIES } from "@/lib/seo/keywords";
import { citationsIn, linksIn, plainText, safeHref, tokenize } from "@/lib/seo/markup";
import { draftGuide, outlineDraft, parseDraft, sourceLibrary, type DraftCaller } from "@/lib/seo/draft";
import {
  applyGuideAction,
  blockingIssues,
  checkGuide,
  GUIDE_ACTION_CAPABILITY,
  guideChecklist,
  guideHash,
  isOfficialSource,
  LEGAL_FACT,
  publishBlockers,
  publishedOnly,
  slugify,
  slugProblem,
  textsOf,
} from "@/lib/seo/guides";
import { checkPage, checkPrivate, checkRobots, checkSitemap, crawlOrigin, crawlSite, crawlTargets, DESCRIPTION_RANGE, groupFindings, healthToFix, internalPath, parsePage, parseRobots, PRIVATE_SAMPLES, TITLE_RANGE, type Fetcher } from "@/lib/seo/health";
import { seoNeeds } from "@/lib/seo/needs";
import { GUIDE_PAGE_COPY, guidePageStrings } from "@/lib/seo/publicCopy";
import { guideArticleJsonLd, guideBreadcrumbJsonLd, guideFaqJsonLd, guideMetadata } from "@/lib/seo/schema";
import { defaultRange, demoSearchRows, grandTotal, inRange, totalsBy, validRange } from "@/lib/seo/search";
import { searchConsoleConfig, serviceAccountAssertion } from "@/lib/seo/searchConsole";
import { sitemapEntries } from "@/lib/seo/sitemap";
import { STARTER_GUIDES, starterGuides } from "@/lib/seo/starters";
import { SEO_TEXT } from "@/lib/seo/text";
import type { Guide, PublishedGuide } from "@/lib/seo/types";
import { LANGS } from "@/lib/seo/types";
import { localizedUrl, PRIVATE_PATHS, SITE_PAGES } from "@/lib/site/routes";
import { siteMetadata } from "@/lib/site/seo";
import { can, CAPABILITY_LABELS, deniedReason, rolesThatCan } from "@/lib/staff/permissions";
import { badgeSnapshot, publishBadges, resetBadges } from "@/lib/staff/navBadges";
import { NAV_GROUPS } from "@/lib/staff/nav";
import { altiJobs } from "@/lib/staff/altiHelp";
import { longSentences } from "@/lib/ux/plainLanguage";

// The SEO department (docs/SEO.md): guides, their rules and workflow, the
// public pages' metadata and structured data, the sitemap, the site-health
// checks, Search Console, keywords and the permissions. The database's side
// is src/lib/__tests__/db/seo.test.ts.

const BASE = "https://credalti.example";
const NOW = new Date("2026-11-25T15:00:00Z");
const read = (f: string) => readFileSync(f, "utf8");
const TICKS = { sourcesOpened: true, bothLanguagesRead: true, noAdvice: true };

function published(guide: Guide): PublishedGuide {
  return { slug: guide.slug, body: guide.body, sources: guide.sources, hash: guideHash(guide), publishedAt: "2026-11-20T15:00:00.000Z", firstPublishedAt: "2026-11-01T15:00:00.000Z", approvedBy: "carmen" };
}

describe("seo: permissions", () => {
  it("administrators and specialists see and write SEO; only an administrator publishes; sales has none", () => {
    expect(rolesThatCan("seo.view")).toEqual(["admin", "specialist"]);
    expect(rolesThatCan("seo.edit")).toEqual(["admin", "specialist"]);
    expect(rolesThatCan("seo.publish")).toEqual(["admin"]);
    for (const c of ["seo.view", "seo.edit", "seo.publish"] as const) expect(can("sales", c)).toBe(false);
    expect(deniedReason("seo.publish", "en")).toBe("Only an administrator can publish guides on the website and connect Search Console.");
    expect(deniedReason("seo.publish", "es")).toMatch(/^Solo un administrador puede publicar guías/);
    expect(CAPABILITY_LABELS.en["seo.view"]).toBeTruthy();
  });

  it("publishing, unpublishing and asking for changes are an administrator's; writing is the content team's", () => {
    expect(GUIDE_ACTION_CAPABILITY.publish).toBe("seo.publish");
    expect(GUIDE_ACTION_CAPABILITY.unpublish).toBe("seo.publish");
    expect(GUIDE_ACTION_CAPABILITY.request_changes).toBe("seo.publish");
    for (const a of ["create", "update", "submit", "archive", "restore"] as const) expect(GUIDE_ACTION_CAPABILITY[a]).toBe("seo.edit");
  });

  it("sits in the Content group before Reviews, with Ask Alti's guide draft for writers only", () => {
    const content = NAV_GROUPS.find((g) => g.key === "content")!;
    expect(content.hrefs.indexOf("/equipo/seo")).toBeGreaterThan(content.hrefs.indexOf("/equipo/contenido"));
    expect(content.hrefs.indexOf("/equipo/seo")).toBeLessThan(content.hrefs.indexOf("/equipo/resenas"));
    expect(altiJobs("content", (c) => can("specialist", c)).map((j) => j.id)).toContain("seo_guide_draft");
    expect(altiJobs("content", (c) => can("sales", c))).toEqual([]);
  });
});

describe("seo: the guide's marks", () => {
  it("reads links and citations, and never turns other text into a link", () => {
    expect(tokenize("See [how it works](/como-funciona).[^fcra-611]")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "how it works", href: "/como-funciona" },
      { kind: "text", text: "." },
      { kind: "cite", id: "fcra-611" },
    ]);
    expect(tokenize("[x](javascript:alert(1))")[0]).toMatchObject({ kind: "text" });
    expect(safeHref("//evil.example/x")).toBe(false);
    expect(safeHref("http://example.com")).toBe(false);
    expect(safeHref("https://www.consumerfinance.gov/complaint/")).toBe(true);
    expect(plainText("A [link](/precios) here.[^a]")).toBe("A link here.");
    expect(linksIn("[a](/x) [b](https://ftc.gov/y)")).toEqual(["/x", "https://ftc.gov/y"]);
    expect(citationsIn("x[^a][^b-2]")).toEqual(["a", "b-2"]);
  });

  it("makes slugs of lowercase words and hyphens", () => {
    expect(slugify("Cómo disputar un error en Texas!")).toBe("como-disputar-un-error-en-texas");
    expect(slugProblem("ab")).toBe("short");
    expect(slugProblem("Bad_Slug")).toBe("format");
    expect(slugProblem("good-slug")).toBeNull();
  });
});

describe("seo: the starter guides", () => {
  const guides = starterGuides(NOW);

  it("are three to five real topics, unpublished drafts, in both languages with the same sections and questions", () => {
    expect(guides.length).toBeGreaterThanOrEqual(3);
    expect(guides.length).toBeLessThanOrEqual(5);
    expect(guides.map((g) => g.slug)).toEqual(expect.arrayContaining(["dispute-credit-report-error-texas", "texas-credit-services-organization-law", "how-long-items-stay-on-credit-report"]));
    for (const g of guides) {
      expect(g.published, g.slug).toBeNull();
      expect(g.approval).toBeNull();
      expect(["draft", "review"]).toContain(g.status);
      expect(g.body.en.sections.length).toBe(g.body.es.sections.length);
      expect(g.body.en.faq.length).toBe(g.body.es.faq.length);
    }
    expect(publishedOnly(guides)).toEqual([]);
  });

  it("pass every rule with nothing to correct, and every required item of the SEO checklist", () => {
    for (const g of guides) {
      const issues = checkGuide(g, "full_service");
      expect(issues.map((i) => `${i.severity} ${i.rule} ${i.where} ${i.match ?? ""}`), g.slug).toEqual([]);
      const failing = guideChecklist(g, []).filter((c) => !c.pass);
      expect(failing.map((c) => `${c.key}: ${c.found.join(";")}`), g.slug).toEqual([]);
    }
  });

  it("cite an official source for every legal fact, and every source is used", () => {
    for (const g of guides) {
      const ids = new Set(g.sources.map((s) => s.id));
      for (const s of g.sources) expect(isOfficialSource(s.url), `${g.slug}: ${s.url}`).toBe(true);
      const cited = new Set<string>();
      for (const lang of LANGS) {
        for (const [where, text] of textsOf(g.body[lang], lang)) {
          for (const id of citationsIn(text)) {
            expect(ids.has(id), `${g.slug} ${where}: ${id}`).toBe(true);
            cited.add(id);
          }
          if (/\.intro$|paragraphs|\.a$/.test(where) && LEGAL_FACT.test(plainText(text))) expect(citationsIn(text).length, `${g.slug} ${where}`).toBeGreaterThan(0);
        }
      }
      expect([...ids].filter((id) => !cited.has(id)), g.slug).toEqual([]);
    }
  });

  it("say only what the site may say: both claim checks, nothing free, no outcome words, no amounts, no pressure, no other state", () => {
    for (const g of guides) {
      for (const lang of LANGS) {
        for (const [where, raw] of textsOf(g.body[lang], lang)) {
          const text = plainText(raw);
          expect(checkMarketingCopy(text, "full_service"), `${g.slug} ${where}`).toEqual([]);
          expect(checkClaimGuardrails(text, "full_service"), `${g.slug} ${where}`).toEqual([]);
          expect(text, where).not.toMatch(/\bfree\b|gratis|gratuit|\b(deleted|removed|fixed|approved|guaranteed)\b|\$\s?\d|don['’]t wait|act now|no esperes/i);
          expect(text, where).not.toMatch(/Georgia|Florida|California|New York/);
        }
        expect(longSentences(textsOf(g.body[lang], lang).map(([, t]) => plainText(t))), `${g.slug} ${lang}`).toEqual([]);
      }
      for (const s of g.sources) expect(checkMarketingCopy(s.label, "full_service"), s.label).toEqual([]);
    }
  });

  it("state the deadlines the law sets, with their sections", () => {
    const dispute = STARTER_GUIDES.find((g) => g.slug === "dispute-credit-report-error-texas")!;
    const en = JSON.stringify(dispute.body.en);
    expect(en).toMatch(/within 30 days of receiving your dispute\.\[\^fcra-611\]/);
    expect(en).toMatch(/up to 15 days/);
    expect(en).toMatch(/Within 5 business days, the bureau must pass your dispute/);
    const howLong = STARTER_GUIDES.find((g) => g.slug === "how-long-items-stay-on-credit-report")!;
    expect(JSON.stringify(howLong.body.en)).toMatch(/seven years start 180 days after/);
    expect(howLong.sources.find((s) => s.id === "fcra-605")!.cite).toBe("15 U.S.C. § 1681c (FCRA § 605)");
    const texas = STARTER_GUIDES.find((g) => g.slug === "texas-credit-services-organization-law")!;
    expect(texas.sources.find((s) => s.id === "tx-393")!.url).toBe("https://statutes.capitol.texas.gov/Docs/FI/htm/FI.393.htm");
  });
});

describe("seo: the rules catch what they must", () => {
  const base = starterGuides(NOW)[0]!;
  const withIntro = (en: string): Guide => ({ ...base, body: { ...base.body, en: { ...base.body.en, intro: en } } });
  const rules = (g: Guide) => blockingIssues(checkGuide(g, "full_service")).map((i) => i.rule);

  it("blocks promises, free, outcome words and pressure", () => {
    expect(rules(withIntro("We remove negative items for free. Act now."))).toEqual(expect.arrayContaining(["diy-positioning", "no-free", "no-pressure"]));
    expect(rules(withIntro("Your collection will be removed."))).toContain("no-outcome-words");
  });

  it("blocks a legal fact with no source, an unknown citation, an unsafe link and text left to write", () => {
    expect(rules(withIntro("The bureau must answer within 30 days."))).toContain("legal-unsourced");
    expect(rules(withIntro("Some context.[^nope]"))).toContain("citation-unknown");
    expect(rules(withIntro("See [this](javascript:alert(1)) page."))).toContain("unsafe-link");
    expect(rules(withIntro("[Write: the intro]"))).toContain("placeholder");
  });

  it("Texas only: another state in a title blocks, Georgia blocks anywhere", () => {
    const titled: Guide = { ...base, body: { ...base.body, en: { ...base.body.en, title: "How to Dispute a Credit Report Error in Florida" } } };
    expect(rules(titled)).toContain("other-state");
    expect(rules(withIntro("People in Georgia ask this too."))).toContain("other-state");
    expect(rules({ ...base, slug: "credit-repair-georgia" })).toContain("other-state");
  });

  it("the checklist asks for the links to how it works and pricing, and the FAQ block", () => {
    const noLinks: Guide = { ...base, body: { en: { ...base.body.en, sections: base.body.en.sections.map((s) => ({ ...s, paragraphs: s.paragraphs.map(plainText) })), faq: [] }, es: base.body.es } };
    const items = guideChecklist(noLinks, []);
    expect(items.find((c) => c.key === "links")!.pass).toBe(false);
    expect(items.find((c) => c.key === "faq")!.pass).toBe(false);
    expect(items.find((c) => c.key === "slug")!.pass).toBe(true);
    expect(guideChecklist(base, [base.slug]).find((c) => c.key === "slug")!.pass).toBe(false);
  });
});

describe("seo: the workflow", () => {
  const start = (): Guide[] => starterGuides(NOW).map((g) => ({ ...g, status: "draft" }));

  it("draft → review → published, only with the person's ticks; the approval is the hash of exactly what was published", () => {
    let guides = start();
    const id = guides[0]!.id;
    const step = (action: Parameters<typeof applyGuideAction>[1]) => {
      const r = applyGuideAction(guides, action, "carmen", NOW);
      if (r.ok) guides = guides.map((g) => (g.id === r.guide.id ? r.guide : g));
      return r;
    };
    expect(step({ action: "publish", id }).ok).toBe(false);
    expect(step({ action: "submit", id }).ok).toBe(true);
    const blocked = step({ action: "publish", id });
    expect(blocked.ok).toBe(false);
    expect(publishBlockers(guides[0]!, []).map((b) => b.code)).toEqual(["tick.sourcesOpened", "tick.bothLanguagesRead", "tick.noAdvice"]);
    expect(step({ action: "update", id, patch: { checklist: TICKS } }).ok).toBe(true);
    expect(guides[0]!.status).toBe("review");
    const done = step({ action: "publish", id });
    expect(done.ok).toBe(true);
    const g = guides[0]!;
    expect(g.status).toBe("published");
    expect(g.published!.hash).toBe(guideHash(g));
    expect(g.approval!.hash).toBe(guideHash(g));
    expect(publishedOnly(guides).map((p) => p.slug)).toEqual([g.slug]);

    // An edit: back to draft, the approval and the ticks gone, the published version unchanged and still live.
    const body = structuredClone(g.body);
    body.es.intro = `${body.es.intro} Guarda copias.`;
    expect(step({ action: "update", id, patch: { body } }).ok).toBe(true);
    expect(guides[0]!.status).toBe("draft");
    expect(guides[0]!.approval).toBeNull();
    expect(guides[0]!.checklist).toEqual({});
    expect(guides[0]!.published!.body.es.intro).toBe(g.body.es.intro);
    expect(publishedOnly(guides)).toHaveLength(1);
    // The address is locked while it is live; archiving needs it off the site first.
    expect(step({ action: "update", id, patch: { slug: "moved" } })).toMatchObject({ ok: false, code: "slug_locked" });
    expect(step({ action: "archive", id })).toMatchObject({ ok: false, code: "live" });
    expect(step({ action: "unpublish", id }).ok).toBe(true);
    expect(publishedOnly(guides)).toEqual([]);
    expect(step({ action: "archive", id }).ok).toBe(true);
    expect(publishedOnly(guides)).toEqual([]);
  });

  it("changes asked need a note; slugs stay unique", () => {
    const guides = start();
    const id = guides[0]!.id;
    const inReview = applyGuideAction(guides, { action: "submit", id }, "marta", NOW);
    expect(inReview.ok).toBe(true);
    const list = guides.map((g) => (g.id === id && inReview.ok ? inReview.guide : g));
    expect(applyGuideAction(list, { action: "request_changes", id, note: "" }, "carmen", NOW).ok).toBe(false);
    expect(applyGuideAction(list, { action: "request_changes", id, note: "Shorter intro, please." }, "carmen", NOW)).toMatchObject({ ok: true, guide: { status: "changes", changesNote: "Shorter intro, please." } });
    expect(applyGuideAction(guides, { action: "update", id, patch: { slug: guides[1]!.slug } }, "marta", NOW)).toMatchObject({ ok: false, code: "slug_taken" });
    const created = applyGuideAction(guides, { action: "create", topic: "x y z", slug: guides[0]!.slug }, "marta", NOW);
    expect(created.ok && created.guide.slug).toBe(`${guides[0]!.slug}-2`);
  });
});

describe("seo: the public article (metadata, structured data, page)", () => {
  const guide = starterGuides(NOW)[0]!;
  const live = published(guide);

  it("has a title, a description, a canonical in its language, hreflang en/es/x-default and an Open Graph article", () => {
    for (const locale of LANGS) {
      const m = guideMetadata(live, locale, BASE);
      expect(m.alternates?.canonical).toBe(`${BASE}/guias/${live.slug}?lang=${locale}`);
      expect(m.alternates?.languages).toEqual({ en: `${BASE}/guias/${live.slug}?lang=en`, es: `${BASE}/guias/${live.slug}?lang=es`, "x-default": `${BASE}/guias/${live.slug}` });
      expect(JSON.stringify(m.openGraph)).toContain('"type":"article"');
      expect(JSON.stringify(m.openGraph)).toContain("/opengraph-image");
      expect(String(m.description).length).toBeGreaterThanOrEqual(70);
    }
  });

  it("has Article data with its dates, publisher and sources, FAQ data and breadcrumbs, and no rating", () => {
    const a = guideArticleJsonLd(live, "es", BASE) as Record<string, unknown>;
    expect(a["@type"]).toBe("Article");
    expect(a.headline).toBe(guide.body.es.title);
    expect(a.inLanguage).toBe("es-US");
    expect(a.datePublished).toBe(live.firstPublishedAt);
    expect(a.dateModified).toBe(live.publishedAt);
    expect(a.mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": `${BASE}/guias/${live.slug}?lang=es` });
    expect(a.citation).toEqual(live.sources.map((s) => s.url));
    const faq = guideFaqJsonLd(live, "en") as { mainEntity: Array<{ acceptedAnswer: { text: string } }> };
    expect(faq.mainEntity).toHaveLength(guide.body.en.faq.length);
    for (const q of faq.mainEntity) expect(q.acceptedAnswer.text).not.toMatch(/\[\^/);
    expect((guideBreadcrumbJsonLd(live, "en", BASE) as { itemListElement: unknown[] }).itemListElement).toHaveLength(3);
    expect(JSON.stringify([a, faq])).not.toMatch(/aggregateRating|ratingValue|reviewCount/);
  });

  it("renders one h1, Alti labelled as the AI assistant, the soft way to start, links, sources and no robot", () => {
    for (const locale of LANGS) {
      const html = renderToStaticMarkup(createElement(GuideArticle, { guide: live, locale }));
      expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
      expect(html).toContain(aiByline(locale));
      expect(aiByline("en")).toBe("Alti · AI assistant");
      expect(html).toContain('href="/como-funciona"');
      expect(html).toContain('href="/precios"');
      expect(html).toContain(`id="source-${live.sources[0]!.id}"`);
      expect(html).toContain(GUIDE_PAGE_COPY[locale].ctaTitle.replace(/'/g, "&#x27;"));
      expect(html).not.toMatch(/altibot_|\[\^/);
      expect(parsePage(`<html lang="${locale}"><head></head><body>${html}</body></html>`).imagesWithoutAlt).toEqual([]);
    }
  });

  it("the words around a guide follow the site's rules", () => {
    for (const locale of LANGS) {
      for (const line of guidePageStrings(locale)) {
        expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
        expect(line).not.toMatch(/\bfree\b|gratis|\b(deleted|removed|fixed|approved|guaranteed)\b/i);
      }
      expect(longSentences(guidePageStrings(locale))).toEqual([]);
    }
    expect(guidePageStrings("en")).toHaveLength(guidePageStrings("es").length);
  });

  it("the public page reads only the published version, through the database's public function", () => {
    const page = read("src/app/guias/[slug]/page.tsx");
    expect(page).toMatch(/publishedGuide\(slug\)/);
    expect(page).toMatch(/notFound\(\)/);
    expect(page).toMatch(/guideArticleJsonLd/);
    expect(read("src/lib/seo/server.ts")).toMatch(/rpc\("seo_published_guide", \{ p_slug: slug \}\)/);
    expect(read("src/proxy.ts")).toContain('"/guias/:path*"');
  });
});

describe("seo: the sitemap lists published guides only", () => {
  const guides = starterGuides(NOW);

  it("lists the site's pages alone while nothing is published", () => {
    expect(sitemapEntries(publishedOnly(guides), BASE)).toHaveLength(SITE_PAGES.length * 2);
  });

  it("adds the guides' index and each published guide in both languages, never a draft or an archived one", () => {
    const live = [published(guides[0]!)];
    const urls = sitemapEntries(live, BASE).map((e) => e.url);
    expect(urls).toContain(`${BASE}/guias?lang=en`);
    expect(urls).toContain(`${BASE}/guias/${guides[0]!.slug}?lang=es`);
    expect(urls.filter((u) => u.includes("/guias/"))).toHaveLength(2);
    for (const draft of guides.slice(1)) expect(urls.some((u) => u.includes(draft.slug))).toBe(false);
    const archived: Guide = { ...guides[0]!, status: "archived", published: published(guides[0]!) };
    expect(publishedOnly([archived])).toEqual([]);
  });
});

// ── Site health ─────────────────────────────────────────────────────────

/** A page the way Next renders one, with what a crawler reads. */
function pageHtml(path: string, locale: "en" | "es", opts: { title?: string; description?: string; h1?: number; schema?: string[]; img?: string; links?: string[]; canonical?: string } = {}) {
  const url = localizedUrl(path, locale, BASE);
  const schema = (opts.schema ?? ["Organization"]).map((t) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": t })}</script>`).join("");
  return `<!DOCTYPE html><html lang="${locale}"><head><title>${opts.title ?? "Credit services in English and Spanish | Credalti"}</title>
<meta name="description" content="${opts.description ?? "You tell us what is wrong on your report; our team prepares and mails the letters. Results vary."}"/>
<link rel="canonical" href="${opts.canonical ?? url}"/><link rel="alternate" hrefLang="en" href="${localizedUrl(path, "en", BASE)}"/><link rel="alternate" hrefLang="es" href="${localizedUrl(path, "es", BASE)}"/><link rel="alternate" hrefLang="x-default" href="${BASE}${path}"/>
<meta property="og:title" content="t"/><meta property="og:description" content="d"/><meta property="og:url" content="${url}"/><meta property="og:image" content="${BASE}/opengraph-image"/></head>
<body><svg><title>icon</title></svg>${"<h1>Title</h1>".repeat(opts.h1 ?? 1)}${opts.img ?? '<img src="/a.webp" alt=""/>'}${(opts.links ?? ["/precios", "https://wa.me/1", "#top", "mailto:a@b.c"]).map((l) => `<a href="${l}">x</a>`).join("")}${schema}</body></html>`;
}

describe("seo: site health, page by page", () => {
  it("reads the tags a crawler reads (and ignores an icon's own <title>)", () => {
    const p = parsePage(pageHtml("/precios", "es", { schema: ["Organization", "FAQPage"] }));
    expect(p.title).toBe("Credit services in English and Spanish | Credalti");
    expect(p.description).toMatch(/^You tell us/);
    expect(p.h1).toBe(1);
    expect(p.canonical).toBe(`${BASE}/precios?lang=es`);
    expect(p.hreflang).toEqual({ en: `${BASE}/precios?lang=en`, es: `${BASE}/precios?lang=es`, "x-default": `${BASE}/precios` });
    expect(p.schemaTypes).toEqual(["Organization", "FAQPage"]);
    expect(p.htmlLang).toBe("es");
    expect(p.imagesWithoutAlt).toEqual([]);
    expect(p.links).toEqual(["/precios", "https://wa.me/1", "#top", "mailto:a@b.c"]);
  });

  it("passes a good page and says what to fix on a bad one, with no score", () => {
    const good = checkPage({ path: "/precios", locale: "en", kind: "site" }, 200, parsePage(pageHtml("/precios", "en")), BASE);
    expect(good.filter((f) => f.state === "fix")).toEqual([]);
    const bad = checkPage(
      { path: "/preguntas", locale: "en", kind: "faq" },
      200,
      parsePage(pageHtml("/preguntas", "en", { title: "Short", description: "Too short.", h1: 2, schema: [], img: '<img src="/x.png">', canonical: `${BASE}/preguntas` })),
      BASE,
    );
    expect(bad.filter((f) => f.state === "fix").map((f) => f.check).sort()).toEqual(["canonical", "description", "h1", "imgAlt", "schemaFaq", "schemaOrg", "title"].sort());
    expect(checkPage({ path: "/x", locale: "en", kind: "guide" }, 404, null, BASE)).toMatchObject([{ check: "status", state: "fix" }]);
    const article = checkPage({ path: "/guias/a", locale: "es", kind: "guide" }, 200, parsePage(pageHtml("/guias/a", "es")), BASE);
    expect(article.find((f) => f.check === "schemaArticle")!.state).toBe("fix");
    for (const f of [...good, ...bad]) expect(JSON.stringify(f)).not.toMatch(/score|puntaje|%/i);
  });

  it("reads the root written with or without its slash as one address (Next writes it without)", () => {
    const html = pageHtml("/", "en").replace(`href="${BASE}/"`, `href="${BASE}"`);
    expect(html).toContain(`hrefLang="x-default" href="${BASE}"`);
    const found = checkPage({ path: "/", locale: "en", kind: "site" }, 200, parsePage(html), BASE);
    expect(found.find((x) => x.check === "hreflang")!.state).toBe("pass");
  });

  it("knows our own links from others", () => {
    expect(internalPath("/precios?lang=es#x", [BASE])).toBe("/precios?lang=es");
    expect(internalPath(`${BASE}/como-funciona`, [BASE])).toBe("/como-funciona");
    expect(internalPath("https://wa.me/1", [BASE])).toBeNull();
    expect(internalPath("//evil.example", [BASE])).toBeNull();
    expect(internalPath("mailto:a@b.c", [BASE])).toBeNull();
  });

  it("the real robots.txt passes: the site open, every private path out, the sitemap named", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    const text = [`User-Agent: *`, `Allow: ${rule.allow}`, ...(rule.disallow as string[]).map((d) => `Disallow: ${d}`), "", `Host: ${r.host}`, `Sitemap: ${r.sitemap}`].join("\n");
    const base = String(r.sitemap).replace(/\/sitemap\.xml$/, "");
    expect(checkRobots(200, text, base).filter((f) => f.state === "fix")).toEqual([]);
    expect(checkRobots(200, "User-Agent: *\nDisallow: /", base).some((f) => f.state === "fix")).toBe(true);
    for (const path of PRIVATE_SAMPLES) expect(parseRobots(text).disallow.some((d) => path === d.replace(/\/$/, "") || path.startsWith(d)), path).toBe(true);
  });

  it("the real sitemap passes, and a missing page or a private one is caught", () => {
    const live = [published(starterGuides(NOW)[0]!)];
    const xml = (entries: ReturnType<typeof sitemapEntries>) => `<urlset>${entries.map((e) => `<url><loc>${e.url}</loc></url>`).join("")}</urlset>`;
    expect(checkSitemap(200, xml(sitemapEntries(live, BASE)), BASE, live.map((g) => g.slug)).filter((f) => f.state === "fix")).toEqual([]);
    expect(checkSitemap(200, xml(sitemapEntries([], BASE)), BASE, live.map((g) => g.slug))[0]!.state).toBe("fix");
    const withPrivate = `${xml(sitemapEntries([], BASE))}<url><loc>${BASE}/equipo</loc></url>`;
    expect(checkSitemap(200, withPrivate, BASE, []).some((f) => f.state === "fix")).toBe(true);
  });

  it("a private page passes only when robots.txt keeps it out and it says noindex", () => {
    const rules = parseRobots(PRIVATE_PATHS.map((p) => `Disallow: ${p}`).join("\n").replace(/^/, "User-Agent: *\n"));
    expect(checkPrivate("/equipo", 200, "noindex, nofollow", "", rules).state).toBe("pass");
    expect(checkPrivate("/equipo", 200, null, '<html><head><meta name="robots" content="noindex, nofollow"/></head></html>', rules).state).toBe("pass");
    expect(checkPrivate("/equipo", 200, null, "<html></html>", rules).state).toBe("fix");
    expect(checkPrivate("/precios", 200, "noindex", "", rules).state).toBe("fix");
  });

  it("the private pages say noindex: next.config.mjs sets it for exactly the paths robots.txt keeps out, and the console's layout too", async () => {
    const config = (await import("../../../next.config.mjs")) as { NOINDEX_PATHS: string[]; default: { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> } };
    expect(config.NOINDEX_PATHS).toEqual(PRIVATE_PATHS);
    const headers = await config.default.headers();
    expect(headers.find((h) => h.source === "/equipo/:path*")!.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
    expect(headers.some((h) => h.source === "/precios" || h.source.startsWith("/guias"))).toBe(false);
    expect(read("src/app/equipo/layout.tsx")).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(read("src/proxy.ts")).toMatch(/X-Robots-Tag/);
  });

  it("every site page's own title and description are in range, in both languages", () => {
    for (const page of SITE_PAGES) {
      for (const locale of LANGS) {
        const m = siteMetadata(page.key, locale, BASE);
        const title = (m.title as { absolute: string }).absolute;
        expect(title.length, `${page.path} ${locale}: ${title}`).toBeGreaterThanOrEqual(TITLE_RANGE.min);
        expect(title.length, `${page.path} ${locale}: ${title}`).toBeLessThanOrEqual(TITLE_RANGE.max);
        const d = String(m.description);
        expect(d.length, `${page.path} ${locale}: ${d}`).toBeGreaterThanOrEqual(DESCRIPTION_RANGE.min);
        expect(d.length, `${page.path} ${locale}: ${d}`).toBeLessThanOrEqual(DESCRIPTION_RANGE.max);
      }
    }
  });
});

describe("seo: the crawl", () => {
  /** A fake site: the real route list, robots and sitemap; one broken link. */
  const site: Fetcher = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname;
    const locale = (u.searchParams.get("lang") ?? "en") as "en" | "es";
    const ok = (body: string, headers: Record<string, string> = {}) => ({ status: 200, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => body });
    if (path === "/robots.txt") return ok(`User-Agent: *\nAllow: /\n${PRIVATE_PATHS.map((p) => `Disallow: ${p}`).join("\n")}\nSitemap: ${BASE}/sitemap.xml`);
    if (path === "/sitemap.xml") return ok(`<urlset>${sitemapEntries([], BASE).map((e) => `<url><loc>${e.url}</loc></url>`).join("")}</urlset>`);
    if ((PRIVATE_SAMPLES as readonly string[]).includes(path)) return { status: init?.redirect === "manual" ? 307 : 200, headers: { get: (n: string) => (n.toLowerCase() === "x-robots-tag" ? "noindex, nofollow" : null) }, text: async () => "" };
    if (path === "/broken") return { status: 404, headers: { get: () => null }, text: async () => "" };
    if (SITE_PAGES.some((p) => p.path === path)) return ok(pageHtml(path, locale, { schema: path === "/preguntas" ? ["Organization", "FAQPage"] : ["Organization"], links: ["/precios", "/broken", "/onboarding"] }));
    return ok("<html></html>");
  };

  it("reads every page in both languages and reports only what is wrong", async () => {
    const report = await crawlSite({ origin: "http://localhost:3000", base: BASE, guideSlugs: [], fetch: site, now: NOW });
    expect(report.pages).toBe(SITE_PAGES.length * 2);
    expect(report.errors).toEqual([]);
    const groups = groupFindings(report);
    expect(groups.filter((g) => g.fix.length > 0).map((g) => g.check)).toEqual(["links"]);
    expect(groups.find((g) => g.check === "links")!.fix[0]!.detail.en).toMatch(/\/broken \(404/);
    expect(healthToFix(report)).toBe(1);
    expect(groups.find((g) => g.check === "noindex")!.pass).toBe(PRIVATE_SAMPLES.length);
  });

  it("includes the published guides and their index", () => {
    const targets = crawlTargets(["a-guide"]);
    expect(targets.filter((t) => t.kind === "guide").map((t) => `${t.path}?${t.locale}`)).toEqual(["/guias/a-guide?en", "/guias/a-guide?es"]);
    expect(targets.some((t) => t.kind === "guides")).toBe(true);
  });

  it("only ever crawls this site: the request's origin when local or ours, else the public address", () => {
    const env = { NEXT_PUBLIC_SITE_URL: "https://credalti.com" };
    expect(crawlOrigin("http://localhost:3123/api/staff/seo/health", env)).toBe("http://localhost:3123");
    expect(crawlOrigin("https://credalti.com/api/staff/seo/health", env)).toBe("https://credalti.com");
    expect(crawlOrigin("https://evil.example/api/staff/seo/health", env)).toBe("https://credalti.com");
  });
});

describe("seo: Search Console", () => {
  it("is not connected without its variables, and connects by service account or OAuth", () => {
    expect(searchConsoleConfig({})).toBeNull();
    expect(searchConsoleConfig({ GOOGLE_SEARCH_CONSOLE_SITE: "sc-domain:credalti.com" })).toBeNull();
    expect(searchConsoleConfig({ GOOGLE_SEARCH_CONSOLE_SITE: "not a property", GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "a", GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "b", GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: "c" })).toBeNull();
    expect(searchConsoleConfig({ GOOGLE_SEARCH_CONSOLE_SITE: "https://credalti.com/", GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "a", GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "b", GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: "c" })?.mode).toBe("oauth");
  });

  it("signs the service account's request with RS256, asking read-only access", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
    const config = searchConsoleConfig({ GOOGLE_SEARCH_CONSOLE_SITE: "sc-domain:credalti.com", GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL: "seo@project.iam.gserviceaccount.com", GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY: pem });
    expect(config?.mode).toBe("service_account");
    const jwt = serviceAccountAssertion(config as Extract<typeof config, { mode: "service_account" }> & object, NOW);
    const [header, claims, signature] = jwt.split(".");
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${claims}`);
    expect(verify.verify(publicKey, Buffer.from(signature!.replace(/-/g, "+").replace(/_/g, "/"), "base64"))).toBe(true);
    const c = JSON.parse(Buffer.from(claims!, "base64").toString()) as Record<string, unknown>;
    expect(c).toMatchObject({ iss: "seo@project.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token" });
  });

  it("adds clicks and impressions and weights the position by impressions", () => {
    const rows = [
      { day: "2026-11-01", page: "p1", query: "q", clicks: 2, impressions: 10, position: 4 },
      { day: "2026-11-02", page: "p1", query: "q", clicks: 1, impressions: 30, position: 8 },
      { day: "2026-11-02", page: "p2", query: "r", clicks: 0, impressions: 0, position: 0 },
    ];
    const [q] = totalsBy(rows, "query");
    expect(q).toEqual({ key: "q", clicks: 3, impressions: 40, ctr: 3 / 40, position: 7 });
    expect(totalsBy(rows, "query")[1]).toMatchObject({ key: "r", ctr: null, position: null });
    expect(grandTotal(rows)).toMatchObject({ clicks: 3, impressions: 40 });
    expect(inRange(rows, { from: "2026-11-02", to: "2026-11-02" })).toHaveLength(2);
  });

  it("ranges end two days ago (Google's delay), and a bad range is refused", () => {
    expect(defaultRange(NOW, 7)).toEqual({ from: "2026-11-17", to: "2026-11-23" });
    expect(validRange("2026-11-10", "2026-11-01")).toBeNull();
    expect(validRange("2020-01-01", "2026-11-01")).toBeNull();
    expect(validRange("x", "y")).toBeNull();
  });

  it("the demo's sample numbers are fixed, and shown only in the demo, labelled sample", () => {
    expect(demoSearchRows(NOW)).toEqual(demoSearchRows(NOW));
    const store = read("src/lib/seo/store.ts");
    expect(store).toMatch(/if \(!live\) \{\s*const rows = inRange\(demoSearchRows/);
    expect(read("src/app/api/staff/seo/route.ts")).not.toMatch(/demoSearchRows/);
    expect(read("src/app/equipo/seo/busqueda/page.tsx")).toMatch(/data-testid="connect-card"/);
  });

  it("the cron checks the shared secret, like the others", () => {
    expect(read("src/app/api/cron/seo/route.ts")).toMatch(/hasSharedSecret\(req, process\.env\.N8N_WEBHOOK_SECRET\)/);
    expect(read("docs/n8n.md")).toMatch(/\/api\/cron\/seo/);
  });
});

describe("seo: keywords and ideas", () => {
  const phrases = demoPhrases(NOW);
  it("Texas only, never Georgia; one of each", () => {
    expect(phraseProblem({ phrase: "credit repair miami", lang: "en", city: "Miami", targetPath: null }, [], [])).toBe("city");
    expect(phraseProblem({ phrase: "credit repair atlanta", lang: "en", city: null, targetPath: null }, [], [])).toBe("other_place");
    expect(phraseProblem({ phrase: "credit repair georgia", lang: "en", city: null, targetPath: null }, [], [])).toBe("other_place");
    expect(phraseProblem({ phrase: "credit repair houston", lang: "en", city: "Houston", targetPath: null }, phrases, [])).toBe("duplicate");
    expect(phraseProblem({ phrase: "credit repair el paso", lang: "en", city: "El Paso", targetPath: "/nowhere" }, phrases, ["/"])).toBe("target");
    expect(phraseProblem({ phrase: "credit repair el paso", lang: "en", city: "El Paso", targetPath: "/" }, phrases, ["/"])).toBeNull();
  });

  it("the database holds the same Texas cities", () => {
    const sql = read("supabase/migrations/0039_seo.sql");
    for (const city of TEXAS_CITIES) expect(sql, city).toContain(`'${city}'`);
  });

  it("content gaps: phrases with no page, searches no phrase covers, and topics no guide covers, each a brief", () => {
    const gaps = contentGaps({ phrases, guides: starterGuides(NOW), byQuery: [{ key: "credit repair cost texas", clicks: 0, impressions: 120, ctr: 0, position: 14 }] });
    expect(gaps.some((g) => g.kind === "phrase_no_page" && g.brief.topic === "credit repair san antonio")).toBe(true);
    expect(gaps.some((g) => g.kind === "query_no_phrase" && g.brief.topic === "credit repair cost texas")).toBe(true);
    expect(gaps.some((g) => g.kind === "starter")).toBe(true);
    // Without Search Console no search is ever made up.
    expect(contentGaps({ phrases, guides: [], byQuery: null }).some((g) => g.kind === "query_no_phrase" || g.kind === "phrase_low_rank")).toBe(false);
    for (const g of gaps) for (const l of LANGS) expect(g.text[l]).toBeTruthy();
  });
});

describe("seo: Alti's drafts", () => {
  const request = { topic: "How to dispute an error on your credit report in Texas", brief: "", phrase: { en: "dispute credit report error texas", es: "disputar error reporte de crédito texas" } };

  it("without a key: an outline in both languages, with sources that fit, held until a person writes it", async () => {
    const res = await draftGuide(request, null);
    expect(res).toMatchObject({ source: "outline", draft: true, note: "no_key" });
    expect(res.body.en.sections.length).toBe(res.body.es.sections.length);
    expect(res.sources.map((s) => s.id)).toContain("fcra-611");
    expect(blockingIssues(res.issues).some((i) => i.rule === "placeholder")).toBe(true);
    expect(outlineDraft(request).body.en.sections.at(-1)!.paragraphs[0]).toMatch(/\(\/como-funciona\).*\(\/precios\)/);
  });

  it("with a model: checked, written again once with the reasons when it breaks a rule", async () => {
    const good = STARTER_GUIDES[0]!;
    const bad = { ...good.body.en, intro: "We remove errors for free." };
    const calls: string[] = [];
    const caller: DraftCaller = async ({ user }) => {
      calls.push(user);
      return { output: { slug: good.slug, outline: ["a"], en: calls.length === 1 ? bad : good.body.en, es: good.body.es, sources: good.sources }, problem: null };
    };
    const res = await draftGuide(request, caller);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/broke these rules/);
    expect(res.source).toBe("model");
    expect(blockingIssues(res.issues)).toEqual([]);
  });

  it("keeps the library's own addresses and drops sources that are not official", () => {
    const parsed = parseDraft({
      slug: "x",
      outline: [],
      en: STARTER_GUIDES[0]!.body.en,
      es: STARTER_GUIDES[0]!.body.es,
      sources: [
        { id: "fcra-611", label: "FCRA", cite: "", url: "https://made-up.example/fcra" },
        { id: "blog", label: "A blog", cite: "", url: "https://someblog.example/post" },
        { id: "ecfr", label: "Reg V", cite: "", url: "https://www.ecfr.gov/current/title-12" },
      ],
    });
    expect(parsed!.sources.map((s) => [s.id, s.url])).toEqual([
      ["fcra-611", sourceLibrary().find((s) => s.id === "fcra-611")!.url],
      ["ecfr", "https://www.ecfr.gov/current/title-12"],
    ]);
    expect(parseDraft({ en: {}, es: {} })).toBeNull();
  });

  it("a refusal or an error falls back to the outline", async () => {
    expect((await draftGuide(request, async () => ({ output: null, problem: "refusal" }))).source).toBe("outline");
  });
});

describe("seo: what needs a person (the red count)", () => {
  it("counts guides to approve (publishers), guides sent back (writers) and checks to fix", () => {
    const guides = starterGuides(NOW);
    const health = { checkedAt: NOW.toISOString(), origin: BASE, pages: 1, findings: [{ check: "title", state: "fix" as const, where: "/", detail: { en: "x", es: "x" } }, { check: "title", state: "fix" as const, where: "/precios", detail: { en: "x", es: "x" } }], errors: [] };
    expect(seoNeeds({ guides, health, canPublish: true, canEdit: true })).toEqual({ review: 1, changes: 0, health: 1, total: 2 });
    expect(seoNeeds({ guides, health: null, canPublish: false, canEdit: true }).total).toBe(0);
  });

  it("adds to the Content group's circle, on top of the Overview's own count", () => {
    resetBadges();
    publishBadges("overview", { content: 2 });
    publishBadges("seo", { content: 3 });
    expect(badgeSnapshot().content).toBe(5);
    publishBadges("seo", {});
    expect(badgeSnapshot().content).toBe(2);
    resetBadges();
    publishBadges("seo", { content: 1 });
    expect(badgeSnapshot().content).toBe(1);
    resetBadges();
  });

  it("the shell reads it from the server's numbers-only view", () => {
    expect(read("src/components/staff/BadgeProbe.tsx")).toMatch(/\/api\/staff\/seo\?view=needs/);
  });
});

describe("seo: the console's words", () => {
  it("every rule and check explains itself in both languages", () => {
    expect(Object.keys(SEO_TEXT.en.health).sort()).toEqual(Object.keys(SEO_TEXT.es.health).sort());
    for (const g of groupFindings({ checkedAt: "", origin: "", pages: 0, findings: [], errors: [] })) expect(SEO_TEXT.en.health[g.check]).toBeTruthy();
  });
});
