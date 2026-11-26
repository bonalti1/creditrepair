import { NextResponse } from "next/server";
import { safeBeat } from "@/lib/control/heartbeat";
import { runRetention } from "@/lib/live/server";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// The live funnel's clock (docs/n8n.md, Workflow 13; docs/LIVE-FUNNEL.md,
// "Retention"), called by n8n with the shared secret, every hour:
//
//   1. A report someone uploaded on /live is deleted, files and overview, 30
//      days after the upload if they did not sign up (their video with it).
//      A lead who signed keeps it until the team imports it into the case
//      (at most 60 more days).
//   2. A reading that did not finish (the server restarted) is tried again.
//   3. Upload tokens past their time are cleared.
//
// Safe to run twice: a deleted review is never touched again.

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const now = new Date();
  try {
    const result = await runRetention(db, now);
    await safeBeat(db, "live", new Date(), { ok: true, detail: { ...result } });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await reportError(error, { where: "api/cron/live" });
    await safeBeat(db, "live", new Date(), { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "The run stopped. What it already deleted stays deleted; the next run continues." }, { status: 500 });
  }
}
