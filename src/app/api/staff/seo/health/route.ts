import { NextResponse } from "next/server";
import { isLive } from "@/lib/seo/guides";
import { crawlOrigin, crawlSite, type Fetcher } from "@/lib/seo/health";
import { loadGuides, saveHealth } from "@/lib/seo/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffAccess, requireCapability } from "@/lib/staff/access";

// Site health (src/lib/seo/health.ts): the app reads its own public pages, as
// a search engine would, and checks them. No key needed.
//
// POST  Runs the check now. With a database: seo.view, and the result is kept
//       (seo_settings.health) for the badge and the cron. In the demo (no
//       database, open like the rest of the demo) it runs and answers, and
//       nothing is stored. It fetches only this site's own pages, from the
//       request's origin when that is this site or a local server, else the
//       public site (crawlOrigin): never an address from the request body.

export const maxDuration = 120;

const fetcher: Fetcher = (url, init) =>
  fetch(url, { redirect: init?.redirect ?? "follow", cache: "no-store", headers: { "user-agent": "CredaltiSiteHealth/1.0", "accept-language": "en" }, signal: AbortSignal.timeout(45_000) });

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-seo-health", { limit: 6, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const access = await getStaffAccess();
  if (access === "denied") return NextResponse.json({ error: "Staff only" }, { status: 403 });
  let store: ((report: Awaited<ReturnType<typeof crawlSite>>) => Promise<void>) | null = null;
  let slugs: string[] = [];
  if (access === "allowed") {
    const allowed = await requireCapability("seo.view");
    if (!allowed.ok) return allowed.response;
    slugs = (await loadGuides(allowed.db)).filter(isLive).map((g) => g.slug);
    store = (report) => saveHealth(allowed.db, report);
  }
  try {
    const report = await crawlSite({ origin: crawlOrigin(req.url), guideSlugs: slugs, fetch: fetcher });
    if (store) await store(report);
    return NextResponse.json({ report, stored: store !== null });
  } catch (error) {
    await reportError(error, { where: "api/staff/seo/health" });
    return NextResponse.json({ error: "The check stopped. Try again in a minute." }, { status: 500 });
  }
}
