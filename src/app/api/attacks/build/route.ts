import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAttackPlan, type ItemHistory } from "@/lib/domain/attack";
import type { EscalationStage, ItemFlag, ReportItem } from "@/lib/domain/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveActingUser } from "@/lib/supabase/server";

// Phase 2/3: attack builder. Computes the round plan (which letters, to whom,
// at which escalation stage) from the user's active items, their attested
// flags, and their letter history. The plan is a DRAFT — nothing mails until
// the user reviews and approves it (see /api/attacks/approve).

const bodySchema = z.object({ userId: z.string().uuid().optional() });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const acting = await resolveActingUser(req, parsed.data.userId);
  if (!acting) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { userId } = acting;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  // Gate: attack builder requires an active monitoring subscription (spec §1).
  const { data: sub } = await db
    .from("monitoring_subscriptions")
    .select("status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!sub) {
    return NextResponse.json(
      { error: "Se requiere una suscripción de monitoreo activa para armar tu ataque." },
      { status: 402 },
    );
  }

  const [{ data: itemRows }, { data: flagRows }, { data: roundRows }] = await Promise.all([
    db.from("report_items").select("*").eq("user_id", userId).eq("status", "active"),
    db.from("item_flags").select("*").eq("user_id", userId).eq("attested", true),
    db.from("attack_rounds").select("round_number, status").eq("user_id", userId).order("round_number"),
  ]);

  const items: ReportItem[] = (itemRows ?? []).map((r) => ({
    fingerprint: r.fingerprint,
    bureau: r.bureau,
    category: r.category,
    name: r.name,
    furnisher: r.furnisher,
    data: r.data,
    negative: r.negative,
  }));

  const itemIdToFp = new Map((itemRows ?? []).map((r) => [r.id as string, r.fingerprint as string]));
  const flags: ItemFlag[] = (flagRows ?? []).flatMap((f) => {
    const fp = itemIdToFp.get(f.item_id);
    return fp ? [{ fingerprint: fp, reason: f.reason, attested: f.attested, attestedAt: f.attested_at }] : [];
  });

  // History: highest escalation stage already mailed per fingerprint.
  const history: ItemHistory = {};
  const { data: mailedLetterItems } = await db
    .from("letter_items")
    .select("escalation_stage, item_id, letters!inner(user_id, status)")
    .eq("letters.user_id", userId)
    .in("letters.status", ["queued", "mailed", "delivered"]);
  const rank: Record<EscalationStage, number> = { dispute: 1, mov: 2, furnisher_direct: 3 };
  for (const li of mailedLetterItems ?? []) {
    const fp = itemIdToFp.get(li.item_id);
    const stage = li.escalation_stage as EscalationStage;
    if (!fp || !(stage in rank)) continue;
    if (!history[fp] || rank[stage] > rank[history[fp]!]) history[fp] = stage;
  }

  const completedRounds = (roundRows ?? []).filter((r) => r.status !== "draft").length;
  const roundNumber = completedRounds + 1;
  const plan = buildAttackPlan({ roundNumber, items, flags, history });

  await db
    .from("attack_rounds")
    .upsert({ user_id: userId, round_number: roundNumber, status: "draft" }, { onConflict: "user_id,round_number" });

  return NextResponse.json({ plan });
}
