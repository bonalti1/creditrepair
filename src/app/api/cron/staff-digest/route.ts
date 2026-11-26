import { NextResponse } from "next/server";
import { safeBeat } from "@/lib/control/heartbeat";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { runStaffDigests } from "@/lib/staff/digestServer";
import { getAdminClient } from "@/lib/supabase/admin";

// The morning summary to each member of the team who asked for it
// (src/lib/staff/digest.ts, docs/STAFF.md), as one idempotent endpoint that
// n8n (or any cron) hits every 15 minutes with the shared secret, like the
// other /api/cron routes. Each member gets it once per day on their own clock,
// at or after the time they chose and outside quiet hours, by WhatsApp or
// email; never SMS. Running it twice sends nothing twice (one row per member
// per day, claimed before sending).

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const result = await runStaffDigests(db, new Date(), { base: process.env.NEXT_PUBLIC_APP_URL });
    await safeBeat(db, "staff-digest", new Date(), { ok: true });
    return NextResponse.json(result);
  } catch (error) {
    await reportError(error, { where: "api/cron/staff-digest" });
    await safeBeat(db, "staff-digest", new Date(), { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "The run stopped. What it already sent is recorded; the next run continues." }, { status: 500 });
  }
}
