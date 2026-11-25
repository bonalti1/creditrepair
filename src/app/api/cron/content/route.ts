import { NextResponse } from "next/server";
import { safeBeat } from "@/lib/control/heartbeat";
import { runContentPublishing } from "@/lib/content/publish/run";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// The content scheduler (src/lib/content/publish/run.ts): every 5 to 15
// minutes, n8n (or Render's cron) calls it with the shared secret, like
// /api/cron/autopilot. It posts what is due under every gate (publishing is
// off by default, so with nothing turned on it posts nothing), retries
// temporary errors with backoff, fails the rest with the reason and an alert,
// and reads the numbers of recent posts. Running it twice posts nothing twice:
// each schedule is claimed before its provider is called.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const result = await runContentPublishing(db, new Date(), { http: fetch, env: process.env });
    await safeBeat(db, "content", new Date(), { ok: true });
    return NextResponse.json(result);
  } catch (error) {
    await reportError(error, { where: "api/cron/content" });
    await safeBeat(db, "content", new Date(), { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "The content run stopped. What it already did is recorded; the next run continues." }, { status: 500 });
  }
}
