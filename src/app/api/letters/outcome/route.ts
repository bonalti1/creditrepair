import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// Letter outcome tracking: what did the bureau/furnisher actually do with each
// item? Feeds two things: (1) escalation grounded in a recorded "verified"
// response rather than guesswork, and (2) honest per-round result screens.
// RLS scopes every write to the signed-in user's own letters.

const bodySchema = z.object({
  letterId: z.string().uuid(),
  itemId: z.string().uuid(),
  outcome: z.enum(["deleted", "corrected", "verified", "no_response"]),
  notes: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { letterId, itemId, outcome, notes } = parsed.data;

  const { error, count } = await supabase
    .from("letter_items")
    .update(
      { outcome, outcome_at: new Date().toISOString(), outcome_notes: notes ?? null },
      { count: "exact" },
    )
    .eq("letter_id", letterId)
    .eq("item_id", itemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Letter item not found" }, { status: 404 });

  // A recorded deletion also retires the item itself.
  if (outcome === "deleted") {
    await supabase
      .from("report_items")
      .update({ status: "deleted", deleted_detected_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("user_id", user.id);
  }

  return NextResponse.json({ ok: true });
}
