import { NextResponse } from "next/server";
import { safeBeat } from "@/lib/control/heartbeat";
import { runAutopilot } from "@/lib/autopilot/server";
import { callsEnabled } from "@/lib/calls/config";
import { runCallMessages } from "@/lib/calls/server";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// The autopilot's run, as one idempotent endpoint that n8n (or Render's cron)
// hits every hour with the shared secret, like /api/cron/rounds and
// /api/cron/billing (docs/AUTOPILOT.md):
//   1. notes each round ready to send for the first time (the review window
//      counts from there) and tells the client it was prepared;
//   2. if automatic sending is on, mails each round whose window is over and
//      whose client is not on hold, through src/lib/rounds/send.ts, which
//      checks every gate again;
//   3. sends the messages that are due: status messages, then the follow-up
//      reminders, under opt-out, quiet hours, the daily cap and the WhatsApp
//      24-hour rule.
//   4. when calls are turned on (NEXT_PUBLIC_CALLS_ENABLED; off by default),
//      the confirmations and reminders of booked calls (src/lib/calls), under
//      the same opt-out and quiet-hour rules, WhatsApp or email only.
// Running it twice sends nothing twice: rounds already mailed are refused by
// send.ts, and every message is claimed under its unique dedupe key first.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const now = new Date();
    const summary = await runAutopilot(db, now, { base: process.env.NEXT_PUBLIC_APP_URL });
    const calls = callsEnabled() ? await runCallMessages(db, now) : null;
    // The heartbeat for Launch readiness and Tech health (src/lib/control/heartbeat.ts).
    await safeBeat(db, "autopilot", now, { ok: true });
    return NextResponse.json(calls ? { ...summary, calls } : summary);
  } catch (error) {
    await reportError(error, { where: "api/cron/autopilot" });
    await safeBeat(db, "autopilot", new Date(), { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "The autopilot run stopped. What it already did is recorded; the next run continues." }, { status: 500 });
  }
}
