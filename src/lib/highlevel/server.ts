import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStaffClients } from "../staff/load";
import { clientStageEvents, MAX_ATTEMPTS, nextAttemptAt, postStage, stagePayload, type Sender, type StageEvent } from "./stages";

// The HighLevel stage sync, on the database (service role). Two steps, both
// safe to run again at any time:
//
//   queueStageEvents   derive each person's recent stage events from the
//                      records (stages.ts clientStageEvents) and add the new
//                      ones to integration_outbox. The unique dedupe_key makes
//                      "add" a no-op for an event already queued.
//   deliverOutbox      send what is due. Each event is first CLAIMED (attempts
//                      + 1, pushed out by a lease) with a conditional update,
//                      so two runs at the same moment never both send it; a
//                      success records sent_at and the event is never touched
//                      again; a failure is retried with backoff, then given up.

/** While one run is sending an event, other runs leave it alone this long. */
const LEASE_MS = 2 * 60_000;

type Row = Record<string, unknown>;

export async function queueStageEvents(db: SupabaseClient, now: Date, clients?: Awaited<ReturnType<typeof loadStaffClients>>): Promise<number> {
  const people = clients ?? (await loadStaffClients(db));
  const events: StageEvent[] = people.flatMap((client) => clientStageEvents(client, now));
  if (events.length === 0) return 0;
  const { data: existing, error } = await db
    .from("integration_outbox")
    .select("dedupe_key")
    .in(
      "dedupe_key",
      events.map((e) => e.dedupeKey),
    );
  if (error) throw new Error(`integration_outbox: ${error.message}`);
  const known = new Set(((existing ?? []) as Row[]).map((r) => String(r.dedupe_key)));
  const fresh = events.filter((e) => !known.has(e.dedupeKey));
  if (fresh.length === 0) return 0;
  const { error: insertError } = await db.from("integration_outbox").upsert(
    fresh.map((e) => ({ dedupe_key: e.dedupeKey, stage: e.stage, payload: stagePayload(e), next_attempt_at: now.toISOString() })),
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
  if (insertError) throw new Error(`integration_outbox insert: ${insertError.message}`);
  return fresh.length;
}

export interface DeliveryReport {
  due: number;
  sent: number;
  failed: number;
  gaveUp: number;
  skipped: number;
}

export async function deliverOutbox(db: SupabaseClient, url: string, now: Date, send: Sender = postStage, limit = 50): Promise<DeliveryReport> {
  const report: DeliveryReport = { due: 0, sent: 0, failed: 0, gaveUp: 0, skipped: 0 };
  const { data, error } = await db
    .from("integration_outbox")
    .select("id, payload, attempts, next_attempt_at")
    .is("sent_at", null)
    .is("gave_up_at", null)
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`integration_outbox: ${error.message}`);
  const due = (data ?? []) as Row[];
  report.due = due.length;
  for (const row of due) {
    const attempts = Number(row.attempts) + 1;
    // Claim it: only the run whose update matches the attempts it read wins.
    const { data: claimed } = await db
      .from("integration_outbox")
      .update({ attempts, next_attempt_at: new Date(now.getTime() + LEASE_MS).toISOString() })
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .is("sent_at", null)
      .select("id");
    if (!claimed || (claimed as Row[]).length !== 1) {
      report.skipped += 1;
      continue;
    }
    const result = await send(url, row.payload as Parameters<Sender>[1]);
    if (result.ok) {
      await db.from("integration_outbox").update({ sent_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
      report.sent += 1;
    } else if (attempts >= MAX_ATTEMPTS) {
      await db.from("integration_outbox").update({ gave_up_at: now.toISOString(), last_error: (result.error ?? "failed").slice(0, 300) }).eq("id", row.id);
      report.gaveUp += 1;
    } else {
      await db
        .from("integration_outbox")
        .update({ next_attempt_at: nextAttemptAt(attempts, now).toISOString(), last_error: (result.error ?? "failed").slice(0, 300) })
        .eq("id", row.id);
      report.failed += 1;
    }
  }
  return report;
}
