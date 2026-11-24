import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/errors";
import { runPartnerDigests, runShareRequestMessages } from "@/lib/partners/portalServer";
import { runPartnerNotices } from "@/lib/partners/sharingServer";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// Milestone notices to partners who opted in (docs/PARTNERS.md): for each
// client who shares with them, each recent milestone once, outside quiet
// hours, by WhatsApp (approved template) or email; never SMS. n8n (or any
// cron) calls it with the shared secret, like the other /api/cron routes.
// Running it twice sends nothing twice: each notice is claimed by its dedupe
// key before it is sent.
//
// The same run (migration 0033) also sends the messages of "ask to follow
// progress" requests that waited for the client's quiet hours to end, and the
// weekly summary to partners who chose it (Mondays from 9:00 on their clock,
// once per week). Hourly is enough.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const now = new Date();
    const notices = await runPartnerNotices(db, now);
    const shareRequests = await runShareRequestMessages(db, now);
    const digests = await runPartnerDigests(db, now);
    return NextResponse.json({ ...notices, shareRequests, digests });
  } catch (error) {
    await reportError(error, { where: "api/cron/partners" });
    return NextResponse.json({ error: "The run stopped. What it already sent is recorded; the next run continues." }, { status: 500 });
  }
}
