import { NextResponse } from "next/server";
import { sweepAlerts } from "@/lib/control/alertsServer";
import { beat } from "@/lib/control/server";
import { runLeadAutopilot } from "@/lib/leads/autopilotServer";
import { assignWaitingLeads } from "@/lib/leads/inboxServer";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// The lead inbox's clock (docs/CONTROL.md), hit every 2 to 5 minutes by n8n
// (or any cron) with the shared secret, like the other /api/cron routes:
//   1. leads nobody has yet go to the next salesperson in turn;
//   2. the lead autopilot (does nothing while its switch is off, the default);
//   3. the staff alerts sweep (nobody is alerted until they turn a topic on);
//   4. a heartbeat, for the Overview's Tech health card.
// Safe to run twice: every message and every alert is claimed once.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const now = new Date();
  try {
    const assigned = await assignWaitingLeads(db, now);
    const autopilot = await runLeadAutopilot(db, now, { appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "" });
    const alerts = await sweepAlerts(db, now);
    const detail = { assigned, autopilot: { enabled: autopilot.enabled, sent: autopilot.sent, handedOff: autopilot.handedOff.length }, alerts };
    await beat(db, "leads", now, { ok: true, detail });
    return NextResponse.json({ ok: true, ...detail });
  } catch (error) {
    await reportError(error, { where: "api/cron/leads" });
    await beat(db, "leads", now, { ok: false, error: error instanceof Error ? error.message : "error" }).catch(() => undefined);
    return NextResponse.json({ error: "The run stopped. What it already did is recorded; the next run continues." }, { status: 500 });
  }
}
