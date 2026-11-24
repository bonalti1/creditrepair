import type { MetadataRoute } from "next";
import { hreflangAlternates, localizedUrl, SITE_LOCALES, SITE_PAGES, siteUrl } from "@/lib/site/routes";

// The public website's pages, each in both languages, with hreflang
// alternates (src/lib/site/routes.ts). The app (/dashboard…), the staff
// console and the partner portal are not listed: they need a sign-in.

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return SITE_PAGES.flatMap((page) =>
    SITE_LOCALES.map((locale) => ({
      url: localizedUrl(page.path, locale, base),
      changeFrequency: "monthly" as const,
      priority: page.key === "home" ? 1 : page.key === "privacy" || page.key === "terms" ? 0.3 : 0.7,
      alternates: { languages: hreflangAlternates(page.path, base) },
    })),
  );
}
