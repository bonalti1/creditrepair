import type { SupabaseClient } from "@supabase/supabase-js";
import type { FurnisherGapRecord } from "./furnishers";
import type { FurnisherGap } from "./gaps";

// The shared list of companies whose dispute address is missing
// (furnisher_gaps, migration 0022), kept by the autopilot run: a company is
// recorded the first time any client's round waits on it (that moment never
// changes: the queue's clock counts from it), seen again on each run, and
// resolved when no round waits on it any more. Service role only.

type Row = Record<string, unknown>;

export function gapFromRow(row: Row): FurnisherGapRecord {
  const iso = (v: unknown) => (typeof v === "string" ? new Date(v).toISOString() : null);
  return {
    normalizedName: String(row.normalized_name),
    company: String(row.company),
    firstSeenAt: iso(row.first_seen_at) ?? "",
    lastSeenAt: iso(row.last_seen_at) ?? "",
    resolvedAt: iso(row.resolved_at),
  };
}

/** The recorded gaps; none on a database without migration 0022. */
export async function loadFurnisherGaps(db: SupabaseClient): Promise<FurnisherGapRecord[]> {
  const { data, error } = await db.from("furnisher_gaps").select("*");
  if (error) return [];
  return ((data as Row[] | null) ?? []).map(gapFromRow);
}

/** Record what the run sees now. Returns how many companies were seen missing for the first time. */
export async function recordFurnisherGaps(db: SupabaseClient, gaps: readonly FurnisherGap[], now: Date): Promise<number> {
  const recorded = await loadFurnisherGaps(db);
  const at = now.toISOString();
  let fresh = 0;
  for (const gap of gaps) {
    const existing = recorded.find((r) => r.normalizedName === gap.normalizedName);
    if (!existing) {
      const { error } = await db.from("furnisher_gaps").insert({
        normalized_name: gap.normalizedName,
        company: gap.company,
        first_seen_at: at,
        last_seen_at: at,
        waiting_clients: gap.waiting.length,
      });
      if (!error) fresh += 1;
      continue;
    }
    await db
      .from("furnisher_gaps")
      .update({ last_seen_at: at, waiting_clients: gap.waiting.length, resolved_at: null })
      .eq("normalized_name", gap.normalizedName);
  }
  // No round waits on it any more: the address was added (or the rounds went another way).
  for (const record of recorded) {
    if (record.resolvedAt || gaps.some((g) => g.normalizedName === record.normalizedName)) continue;
    await db.from("furnisher_gaps").update({ resolved_at: at, waiting_clients: 0 }).eq("normalized_name", record.normalizedName);
  }
  return fresh;
}
