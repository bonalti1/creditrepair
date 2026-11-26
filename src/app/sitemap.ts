import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/seo/sitemap";
import { listPublishedGuides } from "@/lib/seo/server";

// The public website's pages, each in both languages, with hreflang
// alternates, and the published guides (src/lib/seo/sitemap.ts). The app
// (/dashboard…), the staff console and the partner portal are not listed:
// they need a sign-in.

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries(await listPublishedGuides());
}
