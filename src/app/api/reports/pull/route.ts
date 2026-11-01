import { NextResponse } from "next/server";
import { z } from "zod";
import { getMonitoringAdapter } from "@/lib/monitoring";
import { importReportForUser } from "@/lib/domain/importReport";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveActingUser } from "@/lib/supabase/server";

// Adapter-driven pull: fetch the user's current tri-merge report from the
// monitoring partner and run it through the shared import pipeline. Also
// refreshes the stored subscription status (the attack-builder gate).

const bodySchema = z.object({ userId: z.string().uuid().optional() });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const acting = await resolveActingUser(req, parsed.data.userId);
  if (!acting) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const adapter = getMonitoringAdapter();

  const { data: sub } = await db
    .from("monitoring_subscriptions")
    .select("id, external_id")
    .eq("user_id", acting.userId)
    .maybeSingle();

  const externalId = sub?.external_id ?? acting.userId;
  const status = await adapter.getSubscriptionStatus(externalId);
  if (sub && status !== "unknown") {
    await db
      .from("monitoring_subscriptions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", sub.id);
  }

  try {
    const raw = await adapter.fetchReport(externalId);
    const result = await importReportForUser(db, acting.userId, raw);
    return NextResponse.json({ provider: adapter.key, subscriptionStatus: status, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
