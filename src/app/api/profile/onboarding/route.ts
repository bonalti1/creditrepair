import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_STATES, stateStatus } from "@/lib/compliance/states";
import { loadOpenStates } from "@/lib/compliance/stateOpenings";
import { GOALS } from "@/lib/sales/invite";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { convertProspect } from "@/lib/staff/server";
import { creditPartner, referralCodeFromCookie } from "@/lib/partners/attribution";
import { getAdminClient } from "@/lib/supabase/admin";
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
  partnerCode: z.string().regex(/^[a-z0-9-]{3,30}$/).optional(),
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

  // A state we have not opened (/equipo/estados, migration 0030) is not signed up: the screen offers the
  // waitlist instead (compliance/states.ts). Checked here too, whatever the screen showed.
  if (state) {
    const status = stateStatus(state, await loadOpenStates(getAdminClient()));
    if (status !== "open") return NextResponse.json({ error: "We are not taking clients in this state yet.", code: status === "blocked" ? "state_blocked" : "state_not_open" }, { status: 409 });
  }

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

  // Someone sales added by hand now has an account: they become this client,
  // matched by the phone Supabase Auth verified (never one from the request).
  const db = getAdminClient();
  if (db) {
    const phone = user.phone ? `+${user.phone.replace(/^\+/, "")}` : null;
    await convertProspect(db, user.id, phone).catch(() => false);
    // A referral partner (migration 0017): from the invitation link, else the /r/<code> cookie.
    // First touch, approved partners only, written with the service role (the client cannot set it).
    const code = parsed.data.partnerCode ?? referralCodeFromCookie(req.headers.get("cookie"));
    if (code) await creditPartner(db, user.id, code).catch(() => false);
  }
  return NextResponse.json({ ok: true, referredBy: existing?.referred_by ?? referredBy ?? null });
}
