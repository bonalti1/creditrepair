import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrustSection } from "@/components/site/sections";
import { demoCatalogue } from "@/lib/billing/catalogue";
import { planTermsHash, type PlanVersion } from "@/lib/billing/plans";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { openStates } from "@/lib/compliance/states";
import { SITE_COPY, siteStrings } from "@/lib/site/copy";
import { primaryCta } from "@/lib/site/cta";
import { demoCases } from "@/lib/site/demo";
import { factById, PRODUCT_FACTS } from "@/lib/site/facts";
import { OWNER_STORY } from "@/lib/site/owner";
import { publicPlansFrom } from "@/lib/site/plans";
import { hreflangAlternates, otherLanguageHref, PRIVATE_PATHS, SITE_PAGES, sitePath, siteUrl } from "@/lib/site/routes";
import { faqJsonLd, organizationJsonLd, siteMetadata } from "@/lib/site/seo";
import { PRESS, publishedPress, publishedReviews, REVIEWS, type Review } from "@/lib/site/socialProof";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { longSentences } from "@/lib/ux/plainLanguage";

// The public website (src/app: /, /precios, /como-funciona, /preguntas,
// /socios, /nosotros, /derechos, /privacidad, /terminos). docs/WEBSITE.md
// has the rules; these tests hold them.

const LOCALES = ["en", "es"] as const;
const BASE = "https://credalti.example";

/** The source of every page and component of the website. */
const PAGE_FILES: Record<string, string> = {
  home: "src/app/page.tsx",
  pricing: "src/app/precios/page.tsx",
  how: "src/app/como-funciona/page.tsx",
  faq: "src/app/preguntas/page.tsx",
  partners: "src/app/socios/page.tsx",
  about: "src/app/nosotros/page.tsx",
  rights: "src/app/derechos/page.tsx",
  privacy: "src/app/privacidad/page.tsx",
  terms: "src/app/terminos/page.tsx",
};
/** The website's interactive islands (client components), each in its own chunk (islands.tsx). */
const ISLAND_FILES = [
  "src/components/site/AltiDemo.tsx",
  "src/components/site/MailCameo.tsx",
  "src/components/site/HeroPhone.tsx",
  "src/components/site/AskAlti.tsx",
  "src/components/site/AskAltiLauncher.tsx",
  "src/components/site/ReportQuiz.tsx",
  "src/components/site/HowScroll.tsx",
  "src/components/site/CompareToggle.tsx",
  "src/components/site/PayTimeline.tsx",
  "src/components/site/Tools.tsx",
  "src/components/site/HomeReadyTeaser.tsx",
  "src/components/site/motion.tsx",
  "src/components/site/islands.tsx",
];
const COMPONENT_FILES = [
  "src/components/site/SiteShell.tsx",
  "src/components/site/ui.tsx",
  "src/components/site/sections.tsx",
  "src/components/site/LegalPage.tsx",
  "src/app/opengraph-image.tsx",
  ...ISLAND_FILES,
];
const ALL_SOURCES = [...Object.values(PAGE_FILES), ...COMPONENT_FILES, "src/lib/site/copy.ts", "src/lib/site/live.ts", "src/lib/site/seo.ts"];
const read = (file: string) => readFileSync(file, "utf8");
/** A file's code without its comments (the comments explain the rules, and so name what is banned). */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

describe("website copy: claim rules, in English and Spanish", () => {
  for (const locale of LOCALES) {
    it(`${locale}: every line passes the advertising rules and the base rules, under full service`, () => {
      const lines = siteStrings(locale);
      expect(lines.length).toBeGreaterThan(250);
      for (const line of lines) {
        expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
      }
    });

    it(`${locale}: the example's own words pass too (the case the example shows is built by the app's timeline)`, () => {
      const cases = demoCases(locale, new Date("2026-11-24T15:00:00Z"));
      const lines = Object.values(cases).flatMap((c) => [c.sentence, ...c.happened.flatMap((e) => [e.title, e.detail ?? ""]), ...c.next.flatMap((n) => [n.title, n.detail ?? ""])]);
      for (const line of lines.filter(Boolean)) expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
    });

    it(`${locale}: plain language, no sentence over 25 words`, () => {
      expect(longSentences(siteStrings(locale)).map((l) => `${l.words}: ${l.sentence}`)).toEqual([]);
    });

    it(`${locale}: no outcome words, no score talk, nothing called free, no money-back, no price`, () => {
      for (const line of siteStrings(locale)) {
        expect(line, line).not.toMatch(/\b(deleted|removed|fixed|approved|guaranteed)\b|\b(eliminad[oa]s?|borrad[oa]s?|arreglad[oa]s?|aprobad[oa]s?|garantizad[oa]s?)\b/i);
        expect(line, line).not.toMatch(/\+\s?\d+\s?(pts?|points?|puntos?)\b|\b\d{3}\s?(score|puntaje)|(score|puntaje)\s?(of|de)\s?\d{3}/i);
        expect(line, line).not.toMatch(/\bfree\b|gratis|gratuit/i);
        expect(line, line).not.toMatch(/money.back|refund guarantee|devoluci[oó]n de (tu|su) dinero|reembolso garantizado/i);
        // The visitor never approves or sends letters: the team mails them.
        expect(line, line).not.toMatch(/you approve|you send|t[uú] apruebas|t[uú] env[ií]as/i);
        expect(line, line).not.toMatch(/\bDIY\b|do.it.yourself|hazlo t[uú] mismo|Spanish-first|español primero/i);
      }
      // No amount anywhere in the copy, except the example item's invented balance.
      for (const line of siteStrings(locale, { withSample: false })) {
        expect(line, line).not.toMatch(/\$\s?\d|\d+\s*(dólares|dollars|usd)\b|\/\s*(mes|month)\b|\bal mes\b|\ba month\b/i);
      }
    });

    it(`${locale}: says results vary, names Alti as AI, and keeps the client's decisions with the client`, () => {
      const c = SITE_COPY[locale];
      expect(c.footer.disclaimer).toMatch(locale === "en" ? /We do not guarantee results/ : /No garantizamos resultados/);
      expect(c.footer.disclaimer).toMatch(locale === "en" ? /You can dispute errors with the bureaus yourself, at no cost/ : /Puedes disputar errores con los burós por tu cuenta, sin costo/);
      expect(c.footer.aiDisclosure).toMatch(locale === "en" ? /artificial intelligence assistant, not a person and not a lawyer/ : /asistente de inteligencia artificial: no es una persona ni un abogado/);
      expect(c.home.demo.note).toMatch(locale === "en" ? /Alti is AI/ : /Alti es IA/);
      // The chat says it is AI, not a person, in its first message and its subtitle.
      expect(c.live.ask.intro).toMatch(locale === "en" ? /AI assistant\. I'm artificial intelligence, not a person/ : /asistente con IA de Credalti\. Soy inteligencia artificial, no una persona/);
      expect(c.live.ask.subtitle).toMatch(locale === "en" ? /not a person/ : /no una persona/);
      expect(c.home.rights.points.join(" ")).toMatch(locale === "en" ? /3 business days after signing to cancel at no cost/ : /3 días hábiles después de firmar para cancelar sin costo/);
    });
  }

  it("is the same site in both languages: same number of lines, no English left in Spanish", () => {
    expect(siteStrings("en")).toHaveLength(siteStrings("es").length);
    expect(SITE_COPY.en.faq.items).toHaveLength(SITE_COPY.es.faq.items.length);
    expect(SITE_COPY.en.faq.items.length).toBeGreaterThanOrEqual(15);
    expect(SITE_COPY.en.faq.items.length).toBeLessThanOrEqual(20);
    const english = new Set(siteStrings("en"));
    for (const line of siteStrings("es")) {
      if (/[a-záéíóúñ]{4,}\s+[a-záéíóúñ]{4,}/i.test(line)) expect(english.has(line), line).toBe(false);
    }
  });

  it("names no other company, and never uses the old names", () => {
    const competitors = /credit\s*saint|santo\s*de\s*cr[eé]dito|lexington|sky\s*blue|credit\s*people|creditrepair\.com|ovation|\bNico\b/i;
    for (const file of ALL_SOURCES) {
      expect(code(file), file).not.toMatch(competitors);
      expect(read(file), file).not.toMatch(/CreditCapi|BONALTI|\bCapi\b/);
    }
    for (const locale of LOCALES) for (const line of siteStrings(locale)) expect(line).not.toMatch(competitors);
  });

  it("has no phone sales: the main action is WhatsApp or the online start; a phone shows only as support, if set", () => {
    for (const locale of LOCALES) {
      expect(primaryCta(locale, "15551234567").href).toMatch(/^https:\/\/wa\.me\//);
      expect(primaryCta(locale, null).href).toBe("/onboarding");
    }
    const shell = read("src/components/site/SiteShell.tsx");
    expect(shell).toMatch(/\{phone && <p>\{f\.support\}/);
    for (const file of ALL_SOURCES) expect(code(file), file).not.toMatch(/tel:\+?\d|\(\d{3}\)\s?\d{3}-\d{4}|call us|ll[aá]manos/i);
  });

  it("states only Texas as open, matching the state registry", () => {
    expect(openStates()).toEqual(["TX"]);
    for (const locale of LOCALES) expect(SITE_COPY[locale].footer.availability).toMatch(/Texas/);
  });
});

describe("social proof: only what is real", () => {
  const html = (reviews: Review[] = publishedReviews(), press = publishedPress()) =>
    renderToStaticMarkup(createElement(TrustSection, { locale: "en", reviews, press }));

  it("ships with no reviews and no press", () => {
    expect(REVIEWS).toEqual([]);
    expect(PRESS).toEqual([]);
  });

  it("with the data files empty, shows the honest 'we're new' block and no rating, stars, counts or logos", () => {
    for (const locale of LOCALES) {
      const out = renderToStaticMarkup(createElement(TrustSection, { locale }));
      expect(out).toContain('data-testid="trust-new"');
      expect(out).toContain(SITE_COPY[locale].home.trust.title.replace(/'/g, "&#x27;"));
      expect(out).not.toMatch(/★|☆|⭐|rating|calificaci[oó]n|\d[.,]\d\s*\/\s*5|\d+[,.]?\d*\+?\s*(reviews|reseñas)|as seen in|como se vio en|trustpilot|\bBBB\b|data-testid="press"|data-testid="reviews"/i);
    }
  });

  it("with a real review, shows its words, its source and a link to it, still with no stars", () => {
    const review: Review = {
      author: "Ana R.",
      quote: "They showed me every letter and the date it was mailed.",
      language: "en",
      source: "Google",
      url: "https://example.com/review/1",
      postedOn: "2026-12-01",
      consentOnFile: true,
    };
    const out = html([review]);
    expect(out).toContain('data-testid="reviews"');
    expect(out).toContain("They showed me every letter");
    expect(out).toContain('href="https://example.com/review/1"');
    expect(out).not.toMatch(/★|⭐|rating/i);
  });

  it("drops entries that are incomplete or have no consent on file", () => {
    expect(publishedReviews([{ author: "X", quote: "Great", consentOnFile: false }])).toEqual([]);
    expect(publishedPress([{ outlet: "Paper" }])).toEqual([]);
  });

  it("puts no rating or review in the structured data", () => {
    for (const locale of LOCALES) {
      const json = JSON.stringify([organizationJsonLd(locale, BASE), faqJsonLd(SITE_COPY[locale].faq.items)]);
      expect(json).not.toMatch(/aggregateRating|ratingValue|reviewCount|"review"|award/i);
    }
    const all = ALL_SOURCES.map(code).join("\n");
    expect(all).not.toMatch(/aggregateRating|ratingValue|reviewCount/);
  });

  it("makes no guarantee or money-back claim anywhere on the site", () => {
    for (const file of ALL_SOURCES) expect(code(file), file).not.toMatch(/money.back|90.day|90 d[ií]as/i);
  });
});

describe("the comparison: every claim on our side is a product fact", () => {
  it("each fact's source file exists and still says it", () => {
    for (const fact of PRODUCT_FACTS) {
      expect(existsSync(fact.source), `${fact.id}: ${fact.source}`).toBe(true);
      expect(read(fact.source), `${fact.id}: ${fact.evidence}`).toMatch(fact.evidence);
    }
    expect(new Set(PRODUCT_FACTS.map((f) => f.id)).size).toBe(PRODUCT_FACTS.length);
  });

  it("each row names at least one fact, the same ones in both languages, and every fact exists", () => {
    const en = SITE_COPY.en.home.compare.rows;
    const es = SITE_COPY.es.home.compare.rows;
    expect(en).toHaveLength(es.length);
    en.forEach((row, i) => {
      expect(row.facts.length, row.topic).toBeGreaterThan(0);
      expect(es[i]!.facts).toEqual(row.facts);
      for (const id of row.facts) expect(factById(id), `${row.topic}: ${id}`).toBeDefined();
    });
  });

  it("compares against 'many companies', never a named one, and says what that means", () => {
    expect(SITE_COPY.en.home.compare.them).toBe("Many companies");
    expect(SITE_COPY.es.home.compare.them).toBe("Muchas empresas");
    expect(SITE_COPY.en.home.compare.note).toMatch(/not any one company/);
    expect(read("src/lib/site/facts.ts")).toMatch(/observed on the public website/);
  });
});

describe("pricing: only attorney-approved, offered plans", () => {
  it("shows nothing from the demo's example catalogue (approved by no one)", () => {
    expect(publicPlansFrom(demoCatalogue(), "en")).toEqual([]);
  });

  it("shows an approved, active plan in the contract's own words, with the most you'll pay; never pay per delete", () => {
    const approve = (p: PlanVersion): PlanVersion => ({ ...p, status: "active", attorney: { name: "A. Lawyer", approvedOn: "2026-11-20" }, termsHash: planTermsHash(p.terms, p.name) });
    const plans = demoCatalogue().map(approve);
    for (const locale of LOCALES) {
      const shown = publicPlansFrom(plans, locale);
      expect(shown.map((p) => p.id)).not.toContain("demo-plan-per-delete");
      expect(shown.length).toBe(3);
      for (const p of shown) {
        expect(p.most).toMatch(locale === "en" ? /^Most you'll pay: \$/ : /^Lo máximo que pagará: \$/);
        expect(p.terms.length).toBeGreaterThan(0);
        for (const line of p.terms) expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
      }
    }
  });

  it("the page reads the plans from the catalogue, not from the copy", () => {
    expect(read("src/app/precios/page.tsx")).toMatch(/await publicPlans\(locale\)/);
  });
});

describe("the hero example", () => {
  const today = new Date("2026-11-24T15:00:00Z");

  it("shows the letters going out, with dates, when the visitor says something is wrong", () => {
    for (const locale of LOCALES) {
      for (const choice of ["notMine", "wrongBalance"] as const) {
        const c = demoCases(locale, today)[choice];
        expect(c.happened.some((e) => e.icon === "mail")).toBe(true);
        expect(c.happened.every((e) => e.day.length > 0)).toBe(true);
        expect(c.next.length).toBeGreaterThan(0);
      }
    }
    expect(demoCases("en", today).notMine.happened.map((e) => e.title)).toContain("Your round 1 letters were mailed");
  });

  it("mails nothing when the visitor says the item looks right", () => {
    for (const locale of LOCALES) {
      const c = demoCases(locale, today).looksRight;
      expect(c.happened.some((e) => e.icon === "mail")).toBe(false);
      expect(c.next).toEqual([]);
    }
  });

  it("is labelled an example, speaks only as Alti (labelled AI), and the robot only carries the envelope", () => {
    const demo = read("src/components/site/AltiDemo.tsx");
    expect(demo).toMatch(/copy\.label/);
    expect(demo).not.toMatch(/fetch\(|\/api\//);
    // Every one of Alti's lines carries the byline ("Alti · AI assistant"), on screen and for screen readers.
    expect(demo).toMatch(/<AltiLine byline=\{byline\}/);
    expect(demo).toMatch(/sr-only">\{byline\}: </);
    // The robot appears only in the mailing animation, which has no bubble and no byline.
    expect(demo).not.toMatch(/character="cameo"/);
    expect(read("src/components/site/MailCameo.tsx")).toMatch(/character="cameo"/);
    for (const locale of LOCALES) expect(SITE_COPY[locale].home.demo.label).toMatch(/Example|Ejemplo/);
  });
});

describe("SEO: metadata, hreflang, sitemap, robots", () => {
  it("every page has a title, a description, a canonical in its language and the hreflang pair", () => {
    for (const page of SITE_PAGES) {
      for (const locale of LOCALES) {
        const m = siteMetadata(page.key, locale, BASE);
        expect(m.title).toBeTruthy();
        expect(String(m.description).length).toBeGreaterThan(40);
        expect(JSON.stringify(m.openGraph)).toContain("/opengraph-image");
        expect(m.alternates?.canonical).toBe(`${BASE}${page.path}?lang=${locale}`);
        expect(m.alternates?.languages).toEqual({
          en: `${BASE}${page.path}?lang=en`,
          es: `${BASE}${page.path}?lang=es`,
          "x-default": `${BASE}${page.path}`,
        });
      }
      // The two languages point at each other: the same pair from either side.
      expect(siteMetadata(page.key, "en", BASE).alternates?.languages).toEqual(siteMetadata(page.key, "es", BASE).alternates?.languages);
      // Different titles per language.
      expect(SITE_COPY.en.meta[page.key].title).not.toBe(SITE_COPY.es.meta[page.key].title);
    }
  });

  it("each page file uses its own metadata", () => {
    for (const [key, file] of Object.entries(PAGE_FILES)) {
      expect(read(file), file).toContain(`siteMetadata("${key}"`);
    }
  });

  it("the sitemap lists every page in both languages, with alternates (and no guide while none is published)", async () => {
    const entries = await sitemap();
    for (const page of SITE_PAGES) {
      for (const locale of LOCALES) {
        const entry = entries.find((e) => e.url === `${siteUrl()}${page.path}?lang=${locale}`);
        expect(entry, `${page.path} ${locale}`).toBeDefined();
        expect(entry!.alternates?.languages).toEqual(hreflangAlternates(page.path));
      }
    }
    expect(entries).toHaveLength(SITE_PAGES.length * 2);
  });

  it("robots lets the website be crawled, keeps the app out, and points to the sitemap", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rule.allow).toBe("/");
    for (const path of ["/equipo", "/dashboard", "/api/", "/socios/portal", "/onboarding"]) expect(PRIVATE_PATHS).toContain(path);
    expect(rule.disallow).toEqual(PRIVATE_PATHS);
    for (const page of SITE_PAGES) expect(PRIVATE_PATHS.some((p) => page.path === p || page.path.startsWith(p))).toBe(false);
    expect(r.sitemap).toBe(`${siteUrl()}/sitemap.xml`);
  });

  it("the site URL comes from the environment, without a trailing slash", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://credalti.com/" })).toBe("https://credalti.com");
    expect(siteUrl({ NEXT_PUBLIC_APP_URL: "https://app.credalti.com" })).toBe("https://app.credalti.com");
    expect(siteUrl({})).toBe("http://localhost:3000");
  });

  it("the language switch links to the same page in the other language, and the proxy serves ?lang= on every page", () => {
    expect(otherLanguageHref("/precios", "en")).toBe("/precios?lang=es");
    expect(otherLanguageHref("/", "es")).toBe("/?lang=en");
    const proxy = read("src/proxy.ts");
    for (const page of SITE_PAGES) expect(proxy, page.path).toContain(`"${page.path}"`);
  });

  it("has an Open Graph image from the brand's own logo file, and FAQPage data from the page's own list", () => {
    const og = read("src/app/opengraph-image.tsx");
    expect(og).toContain("BRAND.logo.onDark.src");
    expect(og).toMatch(/size = \{ width: 1200, height: 630 \}/);
    expect(read("src/app/preguntas/page.tsx")).toMatch(/faqJsonLd\(f\.items\)/);
    const faq = faqJsonLd(SITE_COPY.en.faq.items) as { mainEntity: unknown[] };
    expect(faq.mainEntity).toHaveLength(SITE_COPY.en.faq.items.length);
  });
});

describe("pages: structure, accessibility, performance", () => {
  it("one h1 per page", () => {
    const hero = (file: string) => (read(file).match(/<PageHero\b/g) ?? []).length;
    const h1 = (file: string) => (read(file).match(/<h1\b/g) ?? []).length;
    for (const [key, file] of Object.entries(PAGE_FILES)) {
      const total = key === "privacy" || key === "terms" ? 1 : hero(file) + h1(file);
      expect(total, file).toBe(1);
    }
    expect(h1("src/components/site/LegalPage.tsx") + hero("src/components/site/LegalPage.tsx")).toBe(1);
    for (const file of ["src/components/site/SiteShell.tsx", "src/components/site/sections.tsx", ...ISLAND_FILES, "src/components/partners/SociosContent.tsx"]) {
      expect(h1(file), file).toBe(0);
    }
  });

  it("pages stay server components; only the listed islands run in the browser, each in its own chunk", () => {
    for (const file of [...Object.values(PAGE_FILES), ...COMPONENT_FILES]) {
      const client = read(file).startsWith('"use client"');
      expect(client, file).toBe(ISLAND_FILES.includes(file));
    }
    // Pages take the islands through islands.tsx (next/dynamic), never directly.
    const islands = read("src/components/site/islands.tsx");
    for (const name of ["HeroPhone", "ReportQuiz", "HowScroll", "CompareToggle", "Tools", "HomeReadyTeaser", "PayTimeline"]) {
      expect(islands).toContain(`export const ${name} = dynamic(() => import("./${name}"))`);
      for (const page of Object.values(PAGE_FILES)) expect(read(page), page).not.toMatch(new RegExp(`from "@/components/site/${name}"`));
    }
    // The chat's code loads only when someone opens it.
    expect(read("src/components/site/AskAltiLauncher.tsx")).toMatch(/dynamic\(\(\) => import\("\.\/AskAlti"\), \{ ssr: false \}\)/);
    // The browser-side copy imports nothing heavy.
    expect(read("src/lib/site/live.ts").match(/^import .*$/gm)).toEqual(['import { BRAND } from "../brand";', 'import type { Locale } from "../i18n/dictionaries";']);
  });

  it("loads only the hero's art eagerly, and gives every image its size", () => {
    expect((read("src/app/page.tsx").match(/\bpriority\b/g) ?? []).length).toBeGreaterThan(0);
    for (const file of ["src/app/como-funciona/page.tsx", "src/app/nosotros/page.tsx", "src/app/precios/page.tsx"]) {
      expect(read(file), file).not.toMatch(/\bpriority\b/);
    }
    const how = read("src/components/site/HowScroll.tsx");
    expect(how).toMatch(/srcSet=/);
    expect(how).toMatch(/width=\{SHOT\.width\}/);
    expect(how).toMatch(/loading="lazy"/);
    for (const name of ["welcome", "case", "review", "letters", "build"]) {
      for (const locale of LOCALES) {
        for (const scale of ["1x", "2x"]) expect(existsSync(`public/screens/site/${name}-${locale}@${scale}.webp`)).toBe(true);
      }
    }
  });

  it("draws no score visual on any site page", () => {
    for (const file of ALL_SOURCES) {
      expect(code(file), file).not.toMatch(/strokeDasharray|stroke-dasharray|conic-gradient|Gauge|ScoreRing|\bscore\s*:/);
    }
  });

  it("the rights page shows the agreement's own federal statement, and the legal placeholders say they are drafts", () => {
    expect(read("src/app/derechos/page.tsx")).toMatch(/agreementDocument\("federal_disclosure"/);
    for (const locale of LOCALES) {
      expect(SITE_COPY[locale].privacy.pending).toMatch(/attorney|abogado/);
      expect(SITE_COPY[locale].terms.pending).toMatch(/attorney|abogado/);
    }
  });

  it("invents no founder story", () => {
    expect(OWNER_STORY).toBeNull();
    expect(read("src/app/nosotros/page.tsx")).toMatch(/story-pending/);
  });

  it("every page path is in the route list once", () => {
    expect(new Set(SITE_PAGES.map((p) => p.path)).size).toBe(SITE_PAGES.length);
    expect(sitePath("pricing")).toBe("/precios");
  });
});
