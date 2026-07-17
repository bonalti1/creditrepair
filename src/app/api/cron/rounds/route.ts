import { NextResponse } from "next/server";
import { getMonitoringAdapter } from "@/lib/monitoring";
import { importReportForUser } from "@/lib/domain/importReport";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendWhatsApp } from "@/lib/integrations/whatsapp";

// The ~40-day round loop (spec §4.4), as one idempotent endpoint that n8n (or
// any cron) hits hourly with the shared secret:
//   find mailed rounds past next_round_due_at → re-pull via the monitoring
//   adapter → import + diff (deletion celebration fires inside the import
//   pipeline) → mark the round complete → day-40 re-engagement message with a
//   deep link into the next step.

export async function POST(req: Request) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const { data: dueRounds, error } = await db
    .from("attack_rounds")
    .select("id, user_id, round_number")
    .eq("status", "mailed")
    .lte("next_round_due_at", new Date().toISOString())
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const adapter = getMonitoringAdapter();
  const processed: Array<{ userId: string; round: number; ok: boolean; error?: string }> = [];

  for (const round of dueRounds ?? []) {
    try {
      const { data: sub } = await db
        .from("monitoring_subscriptions")
        .select("external_id")
        .eq("user_id", round.user_id)
        .maybeSingle();

      const raw = await adapter.fetchReport(sub?.external_id ?? round.user_id);
      const result = await importReportForUser(db, round.user_id, raw);

      await db.from("attack_rounds").update({ status: "complete" }).eq("id", round.id);

      const { data: profile } = await db
        .from("profiles")
        .select("phone_e164")
        .eq("id", round.user_id)
        .maybeSingle();
      if (profile?.phone_e164) {
        await sendWhatsApp(profile.phone_e164, {
          kind: "day40_reengage",
          deletedCount: result.summary?.deletedCount ?? 0,
          remainingCount: result.summary?.remainingNegative ?? 0,
        }).catch(() => undefined);
      }

      await db.from("events").insert({
        user_id: round.user_id,
        kind: "round_completed",
        payload: { roundNumber: round.round_number, summary: result.summary },
      });
      processed.push({ userId: round.user_id, round: round.round_number, ok: true });
    } catch (e) {
      processed.push({
        userId: round.user_id,
        round: round.round_number,
        ok: false,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({ due: dueRounds?.length ?? 0, processed });
}
