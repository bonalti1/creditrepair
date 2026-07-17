import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendWhatsApp } from "@/lib/integrations/whatsapp";

// n8n webhook (spec §6): pull scheduling, WhatsApp flows, round triggers.
// n8n cron queries rounds where next_round_due_at has passed, triggers the
// monitoring re-pull, then calls this endpoint with the diff summary to run
// the day-40 re-engagement (spec §4.4).

const bodySchema = z.object({
  action: z.enum(["day40_reengage", "attack_ready"]),
  userId: z.string().uuid(),
  deletedCount: z.number().int().nonnegative().optional(),
  remainingCount: z.number().int().nonnegative().optional(),
  roundNumber: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action, userId, deletedCount = 0, remainingCount = 0, roundNumber = 1 } = parsed.data;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const { data: profile } = await db.from("profiles").select("phone_e164").eq("id", userId).maybeSingle();
  if (!profile?.phone_e164) return NextResponse.json({ sent: false, reason: "no phone on profile" });

  const result = await sendWhatsApp(
    profile.phone_e164,
    action === "day40_reengage"
      ? { kind: "day40_reengage", deletedCount, remainingCount }
      : { kind: "attack_ready", roundNumber },
  );

  await db.from("events").insert({ user_id: userId, kind: `n8n_${action}`, payload: parsed.data });
  return NextResponse.json(result);
}
