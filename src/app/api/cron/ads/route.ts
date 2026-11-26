import { NextResponse } from "next/server";
import { runAdsSync } from "@/lib/ads/server";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";
import { safeBeat } from "@/lib/control/heartbeat";

// The Ads Manager's sync (src/lib/ads/server.ts runAdsSync; docs/ADS.md and
// docs/n8n.md, Workflow 8): every few hours, n8n (or Render's cron) calls it
// with the shared secret, like the other crons. It READS the Meta ad account
// (the account, its campaigns, ad sets and ads, and the last 7 days of
// numbers; 90 on the first run) and caches them. It never changes anything in
// Meta. Without META_ADS_ACCESS_TOKEN and META_AD_ACCOUNT_ID it does nothing
// and says which variables are missing. Running it twice is harmless: the
// numbers are upserted per ad per day.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const outcome = await runAdsSync(db, new Date(), { http: fetch, env: process.env, by: "cron" });
    if (outcome.missing) {
      await safeBeat(db, "ads", new Date(), { ok: true, detail: { skipped: "not_configured" } });
      return NextResponse.json({ ok: false, skipped: "not_configured", missing: outcome.missing });
    }
    await safeBeat(db, "ads", new Date(), outcome.ok ? { ok: true } : { ok: false, error: "The Meta read failed (see the Ads Manager's sync runs)." });
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
  } catch (error) {
    await reportError(error, { where: "api/cron/ads" });
    await safeBeat(db, "ads", new Date(), { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "The ads sync stopped. The next run tries again." }, { status: 500 });
  }
}
