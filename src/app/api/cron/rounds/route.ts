import { NextResponse } from "next/server";
import { safeBeat } from "@/lib/control/heartbeat";
import { getMonitoringAdapter } from "@/lib/monitoring";
import { importReportForUser } from "@/lib/domain/importReport";
import { getAdminClient } from "@/lib/supabase/admin";
import { hasSharedSecret } from "@/lib/security/signatures";
import { workMayStart } from "@/lib/agreement/gate";
import { loadAgreement } from "@/lib/agreement/server";

import { nextRoundDueFromRows } from "@/lib/rounds/timing";

// The round loop (spec §4.4), as one idempotent endpoint that n8n (or any
// cron) hits hourly with the shared secret:
//   find mailed rounds past next_round_due_at → re-pull via the monitoring
//   adapter → import + diff (the import pipeline queues the client's factual
//   status message) → mark the round complete.
// next_round_due_at is the evidence-based date (src/lib/rounds/timing.ts;
// kept by the triggers of migration 0028): 30 days from the bureaus' receipt
// (certified delivery scan, else mailing + 5 days), plus 5 for the answer, at
// most 45 days from mailing unless the window ends later. Before pulling, the
// rule is worked out again from the letters themselves, so a stale stored date
// can never pull before the legal window has ended.

export async function POST(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
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
  if (error) {
    await safeBeat(db, "rounds", new Date(), { ok: false, error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const adapter = getMonitoringAdapter();
  const processed: Array<{ userId: string; round: number; ok: boolean; error?: string }> = [];

  for (const round of dueRounds ?? []) {
    try {
      // The same rule, from the letters as they are now: never before the 30 days from receipt.
      const [{ data: roundRow }, { data: letterRows }] = await Promise.all([
        db.from("attack_rounds").select("mailed_at").eq("id", round.id).maybeSingle(),
        db.from("letters").select("id, mail_class, mail_status, mailed_at, delivered_at").eq("round_id", round.id),
      ]);
      const due = nextRoundDueFromRows((roundRow as Record<string, unknown> | null)?.mailed_at, (letterRows as Array<Record<string, unknown>> | null) ?? []);
      if (!due || Date.parse(due.dueAt) > Date.now()) {
        if (due) await db.from("attack_rounds").update({ next_round_due_at: due.dueAt }).eq("id", round.id);
        processed.push({ userId: round.user_id, round: round.round_number, ok: false, error: "not_due_yet" });
        continue;
      }
      // Either option: a client who cancelled, or asked to end the service, gets
      // no more work done, and that includes pulling their report again. The
      // round stays as it is for a person to close.
      {
        const gate = workMayStart(await loadAgreement(db, round.user_id), new Date());
        if (!gate.allowed) {
          processed.push({ userId: round.user_id, round: round.round_number, ok: false, error: `agreement_${gate.code}` });
          continue;
        }
      }

      const { data: sub } = await db
        .from("monitoring_subscriptions")
        .select("external_id")
        .eq("user_id", round.user_id)
        .maybeSingle();

      const raw = await adapter.fetchReport(sub?.external_id ?? round.user_id);
      const result = await importReportForUser(db, round.user_id, raw);

      await db.from("attack_rounds").update({ status: "complete" }).eq("id", round.id);

      // The client hears about the new report from the import itself: a factual
      // status message through the autopilot's outbound log (opt-out, quiet
      // hours, daily cap), sent by /api/cron/autopilot.

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

  // The heartbeat for Launch readiness and Tech health (src/lib/control/heartbeat.ts).
  await safeBeat(db, "rounds", new Date(), { ok: true, detail: { due: dueRounds?.length ?? 0, done: processed.filter((p) => p.ok).length } });
  return NextResponse.json({ due: dueRounds?.length ?? 0, processed });
}
