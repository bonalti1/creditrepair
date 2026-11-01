import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReport } from "./parser";
import { diffReports, diffSummary } from "./diff";
import { sendWhatsApp } from "../integrations/whatsapp";

// Shared import pipeline (spec §4.1): store raw snapshot → upsert canonical
// items → diff against previous pull → mark deletions → celebrate via WhatsApp.
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
  if (prevPull) {
    const diff = diffReports(parseReport(prevPull.raw), normalized);
    summary = diffSummary(diff);

    if (diff.deleted.length > 0) {
      const now = new Date().toISOString();
      await db
        .from("report_items")
        .update({ status: "deleted", deleted_detected_at: now })
        .eq("user_id", userId)
        .in("fingerprint", diff.deleted.map((i) => i.fingerprint));

      // Deletion celebration (spec §4.4 churn defense).
      if (summary.deletedCount > 0) {
        const { data: profile } = await db
          .from("profiles")
          .select("phone_e164")
          .eq("id", userId)
          .maybeSingle();
        if (profile?.phone_e164) {
          await sendWhatsApp(profile.phone_e164, {
            kind: "items_deleted",
            deletedCount: summary.deletedCount,
            remainingCount: summary.remainingNegative,
          }).catch(() => undefined);
        }
      }
    }
  }

  await db
    .from("events")
    .insert({ user_id: userId, kind: "report_imported", payload: { pullId: pull.id, summary } });

  return { pullId: pull.id, itemCount: normalized.items.length, summary };
}
