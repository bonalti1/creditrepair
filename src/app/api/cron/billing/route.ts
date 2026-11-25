import { NextResponse } from "next/server";
import { safeBeat } from "@/lib/control/heartbeat";
import { getPaymentGateway } from "@/lib/billing/gateway";
import { billingCandidates, runBillingForUser, type UserBillingSummary } from "@/lib/billing/server";
import { reportError } from "@/lib/observability/errors";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// The billing run, as one idempotent endpoint that n8n (or any cron) hits
// hourly with the shared secret, like /api/cron/rounds.
//
// It is the ONLY place a charge is ever created. For each client with
// something to look at it:
//   1. retries a declined charge whose retry date has come (the same charge);
//   2. asks the rule whether a mailed round may be charged
//      (src/lib/billing/rules.ts: chargeEligibility);
//   3. if so, creates the charge ROW first, so the database trigger is the
//      final judge (migration 0011), and only then asks the processor, with an
//      idempotency key made from the charge's id and the attempt number;
//   4. records the answer, schedules the next retry, tells the client and,
//      when only a person can settle it, the team.
//
// Running it twice in a row charges nobody twice: a round with a charge is no
// longer a candidate, and a repeated attempt carries the same idempotency key.
//
// With no processor configured it does nothing and says so (503). It never
// records a charge it did not make.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolution = getPaymentGateway();
  const db = getAdminClient();
  if (!resolution.configured) {
    // The clock is working even with nothing to charge: the heartbeat says so (Launch readiness lists the processor apart).
    if (db) await safeBeat(db, "billing", new Date(), { ok: true, detail: { gateway: "not_configured" } });
    return NextResponse.json({ error: resolution.message, code: "gateway_not_configured", charged: 0 }, { status: 503 });
  }
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const now = new Date();
  let candidates: string[];
  try {
    candidates = await billingCandidates(db, now);
  } catch (error) {
    await reportError(error, { where: "api/cron/billing" });
    await safeBeat(db, "billing", now, { ok: false, error: error instanceof Error ? error.message : "error" });
    return NextResponse.json({ error: "Could not read what is due. Nothing was charged." }, { status: 500 });
  }

  const processed: UserBillingSummary[] = [];
  const failed: Array<{ userId: string; error: string }> = [];
  for (const userId of candidates) {
    try {
      processed.push(await runBillingForUser(db, resolution.gateway, userId, now));
    } catch (error) {
      // One client's failure must not stop the run for the others.
      await reportError(error, { where: "api/cron/billing", userId });
      failed.push({ userId, error: (error as Error).message.slice(0, 200) });
    }
  }

  await safeBeat(db, "billing", now, failed.length === 0 ? { ok: true, detail: { looked: candidates.length } } : { ok: false, error: `${failed.length} client(s) could not be billed this run` });
  return NextResponse.json({
    gateway: resolution.gateway.name,
    live: resolution.gateway.live,
    looked: candidates.length,
    paid: processed.reduce((n, p) => n + p.paid, 0),
    declined: processed.reduce((n, p) => n + p.declined + p.exhausted, 0),
    needsPerson: processed.filter((p) => p.needsPerson).map((p) => p.userId),
    processed,
    failed,
  });
}
