import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_STATES } from "@/lib/compliance/states";
import { GOALS } from "@/lib/sales/invite";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// Saves what onboarding established (goal, state, guided or not, who referred
// them) onto the signed-in customer's profile. Runs as the customer, under
// row-level security. Attribution is first-touch: once referred_by is set, a
// later link does not change it.

const bodySchema = z.object({
  goal: z.enum(GOALS.map((g) => g.key) as [string, ...string[]]).optional(),
  state: z.enum(ALL_STATES as unknown as [string, ...string[]]).optional(),
  assisted: z.boolean().optional(),
  referredBy: z.string().regex(/^[a-z0-9-]{2,30}$/).optional(),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "profile-onboarding", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { goal, state, assisted, referredBy } = parsed.data;

  const { data: existing } = await supabase
    .from("profiles")
    .select("referred_by")
    .eq("id", user.id)
    .maybeSingle();

  const update: Record<string, unknown> = { id: user.id, onboarded_at: new Date().toISOString() };
  if (goal) update.goal = goal;
  if (state) update.state = state;
  if (assisted !== undefined) update.assisted = assisted;
  if (referredBy && !existing?.referred_by) update.referred_by = referredBy;

  const { error } = await supabase.from("profiles").upsert(update, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, referredBy: existing?.referred_by ?? referredBy ?? null });
}
