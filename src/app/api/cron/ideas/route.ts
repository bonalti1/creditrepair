import { NextResponse } from "next/server";
import { safeBeat } from "@/lib/control/heartbeat";
import { altiConnected, ideasAltiCaller } from "@/lib/ideas/altiModel";
import { runAltiIdeas } from "@/lib/ideas/server";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// Optional weekly «Ask Alti for ideas» (docs/n8n.md Workflow 8, docs/IDEAS.md):
// n8n (or any cron) calls it once a week with the shared secret, like the
// other /api/cron routes. Alti reads the business's aggregate numbers and
// leaves 3 to 5 proposals for an administrator to add to the board or
// dismiss; nothing is acted on. It asks at most once in six days (a person's
// ask counts), so calling it more often costs nothing. Without
// ANTHROPIC_API_KEY it does nothing and says so.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const now = new Date();
  if (!altiConnected()) {
    await safeBeat(db, "ideas", now, { ok: true, detail: { alti: "not_connected" } });
    return NextResponse.json({ ok: true, skipped: "not_connected", message: "ANTHROPIC_API_KEY is not set: Alti was not asked." });
  }
  try {
    const result = await runAltiIdeas(db, db, ideasAltiCaller(), { trigger: "cron" }, now);
    if (!result.ok && result.problem === "recent") {
      await safeBeat(db, "ideas", now, { ok: true, detail: { skipped: "recent" } });
      return NextResponse.json({ ok: true, skipped: "recent" });
    }
    await safeBeat(db, "ideas", now, result.ok ? { ok: true, detail: { proposed: result.proposed } } : { ok: false, error: `Alti could not propose: ${result.problem}` });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    await reportError(error, { where: "api/cron/ideas" });
    await safeBeat(db, "ideas", now, { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "The run stopped; the next one tries again." }, { status: 500 });
  }
}
