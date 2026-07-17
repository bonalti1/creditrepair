import { NextResponse } from "next/server";
import { z } from "zod";
import { parseReport } from "@/lib/domain/parser";
import { diffReports, diffSummary } from "@/lib/domain/diff";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendWhatsApp } from "@/lib/integrations/whatsapp";

// Phase 1: report import (spec §4.1). Accepts the provider-agnostic normalized
// payload (monitoring partner adapters map into it), parses to structured
// entities, stores the raw snapshot, upserts canonical items, and runs the diff
// engine against the previous pull to detect deletions/changes.

const bodySchema = z.object({
  userId: z.string().uuid(),
  report: z.unknown(),
});

export async function POST(req: Request) {
  const parsedBody = bodySchema.safeParse(await req.json());
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
  }
  const { userId, report } = parsedBody.data;

  let normalized;
  try {
    normalized = parseReport(report);
  } catch (e) {
    return NextResponse.json({ error: `Unparseable report: ${(e as Error).message}` }, { status: 422 });
  }

  const db = getAdminClient();
  if (!db) {
    // No Supabase configured (local dev): return the parse result only.
    return NextResponse.json({ persisted: false, items: normalized.items });
  }

  // Load the previous pull for diffing before inserting the new one.
  const { data: prevPull } = await db
    .from("report_pulls")
    .select("id, raw")
    .eq("user_id", userId)
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: pull, error: pullError } = await db
    .from("report_pulls")
    .insert({ user_id: userId, source: normalized.source, pulled_at: normalized.pulledAt, raw: report })
    .select("id")
    .single();
  if (pullError) return NextResponse.json({ error: pullError.message }, { status: 500 });

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
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  let summary = null;
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
      const { data: profile } = await db
        .from("profiles")
        .select("phone_e164")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.phone_e164 && summary.deletedCount > 0) {
        await sendWhatsApp(profile.phone_e164, {
          kind: "items_deleted",
          deletedCount: summary.deletedCount,
          remainingCount: summary.remainingNegative,
        }).catch(() => undefined);
      }
    }
  }

  await db.from("events").insert({ user_id: userId, kind: "report_imported", payload: { pullId: pull.id, summary } });

  return NextResponse.json({ persisted: true, pullId: pull.id, itemCount: normalized.items.length, summary });
}
