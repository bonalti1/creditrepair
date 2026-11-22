import { NextResponse } from "next/server";
import { deliverOutbox, queueStageEvents } from "@/lib/highlevel/server";
import { stageWebhookUrl } from "@/lib/highlevel/stages";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// The HighLevel stage sync, as one idempotent endpoint that n8n (or any cron)
// hits every 15 minutes to an hour with the shared secret, like
// /api/cron/rounds and /api/cron/billing:
//   1. queue each person's recent stage events (invited, signed the agreement,
//      cancelled in the window, documents complete, first round mailed,
//      paused for a payment, ended the service) in integration_outbox, once
//      each (the dedupe key);
//   2. send what is due to HIGHLEVEL_INBOUND_WEBHOOK_URL (or SALES_WEBHOOK_URL),
//      retrying failures with backoff.
// Running it twice sends nothing twice. What an event carries is in
// src/lib/highlevel/stages.ts (stagePayload): no credit data, no amounts.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const now = new Date();
  try {
    const queued = await queueStageEvents(db, now);
    const url = stageWebhookUrl();
    if (!url) {
      // Events wait in the outbox; they go out once a destination is set (within the lookback window).
      return NextResponse.json({ queued, delivery: null, message: "HIGHLEVEL_INBOUND_WEBHOOK_URL (or SALES_WEBHOOK_URL) is not set: nothing was sent." });
    }
    const delivery = await deliverOutbox(db, url, now);
    return NextResponse.json({ queued, delivery });
  } catch (error) {
    await reportError(error, { where: "api/cron/highlevel" });
    return NextResponse.json({ error: "Sync failed; it will run again." }, { status: 500 });
  }
}
