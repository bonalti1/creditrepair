import { NextResponse } from "next/server";
import { safeBeat } from "@/lib/control/heartbeat";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";
import { runWebinarReminders } from "@/lib/webinars/server";

// The webinars' clock (docs/n8n.md, Workflow 13): every 10 minutes, n8n (or
// Render's cron) calls it with the shared secret. It sends the reminders that
// are due (src/lib/webinars/reminders.ts): 1 week, 1 day and 1 hour before,
// "we're live now", the replay, and the follow-ups on day 2 and day 5, by
// WhatsApp or email (never SMS), outside quiet hours (9 p.m.–8 a.m. Texas),
// never to a number that opted out, each once (claimed under its dedupe key
// before it is sent). Safe to run twice, or two at once.

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const summary = await runWebinarReminders(db, new Date());
    await safeBeat(db, "webinars", new Date(), { ok: true, detail: { ...summary } });
    return NextResponse.json(summary);
  } catch (error) {
    await reportError(error, { where: "api/cron/webinars" });
    await safeBeat(db, "webinars", new Date(), { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "The reminders run stopped. The next run starts again." }, { status: 500 });
  }
}
