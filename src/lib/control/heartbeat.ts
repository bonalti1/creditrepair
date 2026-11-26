import type { SupabaseClient } from "@supabase/supabase-js";

// When each scheduled job last ran (cron_heartbeats, migration 0034): every
// /api/cron route records one row per job, so the Overview's Tech health card
// and Launch readiness (src/lib/launch) can say when it last ran, when it last
// ran without an error, and the error. A heartbeat never stops a job: a
// failure to record it is swallowed.

/** The jobs that record a heartbeat: the /api/cron routes (docs/n8n.md). */
export const CRON_JOB_NAMES = ["rounds", "autopilot", "billing", "staff-digest", "leads", "content", "partners", "highlevel", "ideas", "ads", "seo", "live", "webinars"] as const;
export type CronJobName = (typeof CRON_JOB_NAMES)[number];

/** Records one run of a job. */
export async function beat(db: SupabaseClient, job: string, now: Date, outcome: { ok: boolean; error?: string; detail?: Record<string, unknown> }): Promise<void> {
  await db.from("cron_heartbeats").upsert({
    job,
    last_run_at: now.toISOString(),
    ...(outcome.ok ? { last_ok_at: now.toISOString(), last_error: null } : { last_error: (outcome.error ?? "error").slice(0, 300) }),
    detail: outcome.detail ?? {},
  });
}

/** The same, never throwing: for the end of a cron route. */
export async function safeBeat(db: SupabaseClient, job: CronJobName, now: Date, outcome: { ok: boolean; error?: string; detail?: Record<string, unknown> }): Promise<void> {
  try {
    await beat(db, job, now, outcome);
  } catch {
    // The job's own answer matters more than its heartbeat.
  }
}
