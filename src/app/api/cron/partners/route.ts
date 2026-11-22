import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/errors";
import { runPartnerNotices } from "@/lib/partners/sharingServer";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// Milestone notices to partners who opted in (docs/PARTNERS.md): for each
// client who shares with them, each recent milestone once, outside quiet
// hours, by WhatsApp (approved template) or email; never SMS. n8n (or any
// cron) calls it with the shared secret, like the other /api/cron routes.
// Running it twice sends nothing twice: each notice is claimed by its dedupe
// key before it is sent.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    return NextResponse.json(await runPartnerNotices(db, new Date()));
  } catch (error) {
    await reportError(error, { where: "api/cron/partners" });
    return NextResponse.json({ error: "The run stopped. What it already sent is recorded; the next run continues." }, { status: 500 });
  }
}
