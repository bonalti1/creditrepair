import type { MetadataRoute } from "next";
import { hreflangAlternates, localizedUrl, SITE_LOCALES, SITE_PAGES, siteUrl } from "../site/routes";
import { GUIDES_INDEX_PATH, guidePath } from "./guides";
import type { PublishedGuide } from "./types";

// What src/app/sitemap.ts lists: the site's pages in both languages, and,
// once at least one guide is published, the guides' index and each published
// guide (only what is live: drafts, guides waiting for approval and archived
// ones never appear, because only published versions are passed in).

export function sitemapEntries(guides: readonly PublishedGuide[], base: string = siteUrl()): MetadataRoute.Sitemap {
  const pages = SITE_PAGES.flatMap((page) =>
    SITE_LOCALES.map((locale) => ({
      url: localizedUrl(page.path, locale, base),
      changeFrequency: "monthly" as const,
      priority: page.key === "home" ? 1 : page.key === "privacy" || page.key === "terms" ? 0.3 : 0.7,
      alternates: { languages: hreflangAlternates(page.path, base) },
    })),
  );
  if (guides.length === 0) return pages;
  const index = SITE_LOCALES.map((locale) => ({
    url: localizedUrl(GUIDES_INDEX_PATH, locale, base),
    changeFrequency: "weekly" as const,
    priority: 0.6,
    alternates: { languages: hreflangAlternates(GUIDES_INDEX_PATH, base) },
  }));
  const articles = guides.flatMap((g) =>
    SITE_LOCALES.map((locale) => ({
      url: localizedUrl(guidePath(g.slug), locale, base),
      lastModified: g.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
      alternates: { languages: hreflangAlternates(guidePath(g.slug), base) },
    })),
  );
  return [...pages, ...index, ...articles];
}
