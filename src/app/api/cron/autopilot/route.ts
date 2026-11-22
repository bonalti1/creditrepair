import { NextResponse } from "next/server";
import { runAutopilot } from "@/lib/autopilot/server";
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
// Running it twice sends nothing twice: rounds already mailed are refused by
// send.ts, and every message is claimed under its unique dedupe key first.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    return NextResponse.json(await runAutopilot(db, new Date(), { base: process.env.NEXT_PUBLIC_APP_URL }));
  } catch (error) {
    await reportError(error, { where: "api/cron/autopilot" });
    return NextResponse.json({ error: "The autopilot run stopped. What it already did is recorded; the next run continues." }, { status: 500 });
  }
}
