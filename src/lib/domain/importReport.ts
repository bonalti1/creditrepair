import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReport } from "./parser";
import { diffReports, diffSummary } from "./diff";
import { queueStatus } from "../autopilot/store";
import { recordReportAsProof } from "../monitoring/subscription";

// Shared import pipeline (spec §4.1): store raw snapshot → upsert canonical
// items → diff against previous pull → mark deletions → queue a factual status
// message for the client (autopilot/status.ts).
// Called from the manual import route, the adapter pull route, and the round
// cron — one code path for all three.

export interface ImportResult {
  pullId: string;
  itemCount: number;
  summary: { deletedCount: number; remainingNegative: number } | null;
}

export async function importReportForUser(
  db: SupabaseClient,
  userId: string,
  rawReport: unknown,
): Promise<ImportResult> {
  const normalized = parseReport(rawReport);

  const { data: prevPull } = await db
    .from("report_pulls")
    .select("id, raw")
    .eq("user_id", userId)
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: pull, error: pullError } = await db
    .from("report_pulls")
    .insert({ user_id: userId, source: normalized.source, pulled_at: normalized.pulledAt, raw: rawReport })
    .select("id")
    .single();
  if (pullError) throw new Error(pullError.message);

  const { error: upsertError } = await db.from("report_items").upsert(
    normalized.items.map((i) => ({
      user_id: userId,
      fingerprint: i.fingerprint,
      bureau: i.bureau,
      category: i.category,
      name: i.name,
      furnisher: i.furnisher,
      data: i.data,
      negative: i.negative,
      status: "active",
      last_seen_pull: pull.id,
    })),
    { onConflict: "user_id,fingerprint" },
  );
  if (upsertError) throw new Error(upsertError.message);

  let summary: ImportResult["summary"] = null;
  let deletedFingerprints: string[] = [];
  if (prevPull) {
    const diff = diffReports(parseReport(prevPull.raw), normalized);
    summary = diffSummary(diff);

    deletedFingerprints = diff.deleted.map((i) => i.fingerprint);
    if (diff.deleted.length > 0) {
      const now = new Date().toISOString();
      await db
        .from("report_items")
        .update({ status: "deleted", deleted_detected_at: now })
        .eq("user_id", userId)
        .in("fingerprint", diff.deleted.map((i) => i.fingerprint));
    }
  }

  // A report after an earlier one: tell the client it arrived and, only as a
  // fact, how many of the items they disputed it no longer lists. Through the
  // autopilot's outbound log, so opt-out, quiet hours and the daily cap apply
  // (autopilot/status.ts). Never a score, never a promise.
  if (prevPull) {
    await queueStatus(db, userId, { kind: "report_changes", pullId: String(pull.id), goneCount: await disputedGone(db, userId, deletedFingerprints) });
  }

  // A report that just arrived proves the monitoring subscription works.
  await recordReportAsProof(db, userId, normalized.source);

  await db
    .from("events")
    .insert({ user_id: userId, kind: "report_imported", payload: { pullId: pull.id, summary } });

  return { pullId: pull.id, itemCount: normalized.items.length, summary };
}

/** How many of these items the client had confirmed as inaccurate (attested): the ones they disputed. */
async function disputedGone(db: SupabaseClient, userId: string, fingerprints: string[]): Promise<number> {
  if (fingerprints.length === 0) return 0;
  const { data: items } = await db.from("report_items").select("id").eq("user_id", userId).in("fingerprint", fingerprints);
  const ids = ((items as Array<{ id: string }> | null) ?? []).map((i) => i.id);
  if (ids.length === 0) return 0;
  const { data: flags } = await db.from("item_flags").select("item_id").eq("user_id", userId).eq("attested", true).in("item_id", ids);
  return new Set(((flags as Array<{ item_id: string }> | null) ?? []).map((f) => f.item_id)).size;
}
