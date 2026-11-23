import { NextResponse } from "next/server";
import { z } from "zod";
import { addHouseholdMember, loadHouseholdPrimary } from "@/lib/household/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// The client adds a household member from their onboarding (sent once they
// are signed in, by OnboardingSync). The signed-in client is always the first
// person: nobody can add a member to someone else's household. The member
// becomes a prospect of their own with their own invitation; the two never
// see each other's case (migration 0027).

const bodySchema = z
  .object({
    firstName: z.string().max(60),
    lastName: z.string().max(60),
    phone: z.string().max(30),
    email: z.string().max(200).nullable().optional(),
    relationship: z.enum(["spouse", "partner", "family"]),
    locale: z.enum(["en", "es"]),
  })
  .strict();

export async function POST(req: Request) {
  const limited = rateLimit(req, "client-household", { limit: 6, windowMs: 60_000 });
  if (limited) return limited;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  try {
    const primary = await loadHouseholdPrimary(db, user.id);
    if (!primary || primary.kind !== "user") return NextResponse.json({ error: "Profile first", code: "profile_required" }, { status: 428 });
    const result = await addHouseholdMember(db, primary, parsed.data, { kind: "client", userId: user.id, name: primary.firstName });
    if (!result.ok) return NextResponse.json({ error: result.message.en, message: result.message, problems: result.problems }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: "api/household", userId: user.id });
    return NextResponse.json({ error: "Could not save. Nothing was changed." }, { status: 500 });
  }
}
