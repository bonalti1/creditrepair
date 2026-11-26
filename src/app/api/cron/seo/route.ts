import { NextResponse } from "next/server";
import { isLive } from "@/lib/seo/guides";
import { crawlSite } from "@/lib/seo/health";
import { syncSearchConsole } from "@/lib/seo/searchConsole";
import { loadGuides, saveHealth } from "@/lib/seo/server";
import { siteUrl } from "@/lib/site/routes";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";
import { safeBeat } from "@/lib/control/heartbeat";

// The SEO department's clock (docs/n8n.md, Workflow 9): once a day, n8n (or
// Render's cron) calls it with the shared secret, like the other crons.
//
//   1. Search Console: the last 10 days with final numbers into
//      seo_search_rows (read-only from Google; nothing when not connected).
//   2. Site health: the public site crawled from its public address
//      (NEXT_PUBLIC_SITE_URL) and the result kept, for the screen and the
//      red count on the menu.
//
// Safe to run twice: rows are upserted by day, page and query, and the health
// result is replaced.

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const now = new Date();
  try {
    const search = await syncSearchConsole(db, now, { http: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }) });
    const slugs = (await loadGuides(db)).filter(isLive).map((g) => g.slug);
    const report = await crawlSite({
      origin: siteUrl(),
      guideSlugs: slugs,
      fetch: (url, init) => fetch(url, { redirect: init?.redirect ?? "follow", cache: "no-store", headers: { "user-agent": "CredaltiSiteHealth/1.0" }, signal: AbortSignal.timeout(45_000) }),
      now,
    });
    await saveHealth(db, report);
    await safeBeat(db, "seo", new Date(), { ok: true });
    return NextResponse.json({ search, health: { checkedAt: report.checkedAt, pages: report.pages, toFix: report.findings.filter((f) => f.state === "fix").length, errors: report.errors.length } });
  } catch (error) {
    await reportError(error, { where: "api/cron/seo" });
    await safeBeat(db, "seo", new Date(), { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "The SEO run stopped. The next run starts again." }, { status: 500 });
  }
}
