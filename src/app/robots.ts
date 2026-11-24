import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, siteUrl } from "@/lib/site/routes";

// Crawl the public website; keep out of the signed-in app, the staff
// console, the partner portal, the API and one-time links (unsubscribe,
// referral redirects).


export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
