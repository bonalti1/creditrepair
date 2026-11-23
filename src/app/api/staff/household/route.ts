import { NextResponse } from "next/server";
import { z } from "zod";
import { addHouseholdMember, loadHouseholdPrimary } from "@/lib/household/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { memberCanSee } from "@/lib/staff/actions";
import { getServerSupabase } from "@/lib/supabase/server";

// "Add a household member", from the staff invite (/equipo/invitar) and Add
// client: a spouse, partner or family member of someone this member of staff
// may see. They become a prospect of their own (source 'household') with
// their own invitation; nothing of the first person's case is shared. The
// database links the two for the household discount once both have accounts
// (migration 0027). Administrators and sales (clients.add); sales only for the
// people they brought in, which the member's own connection decides.

const bodySchema = z
  .object({
    primaryId: z.string().uuid(),
    firstName: z.string().max(60),
    lastName: z.string().max(60),
    phone: z.string().max(30),
    email: z.string().max(200).nullable().optional(),
    relationship: z.enum(["spouse", "partner", "family"]),
    locale: z.enum(["en", "es"]),
  })
  .strict();

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-household", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("clients.add");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const input = parsed.data;
  try {
    if (!(await memberCanSee(reader, input.primaryId, "client"))) {
      return NextResponse.json({ error: "Not yours", message: "Este cliente no está entre los tuyos." }, { status: 404 });
    }
    const primary = await loadHouseholdPrimary(db, input.primaryId);
    if (!primary) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const result = await addHouseholdMember(db, primary, input, { kind: "staff", userId: member.userId, name: member.name });
    if (!result.ok) return NextResponse.json({ error: result.message.en, message: result.message, problems: result.problems }, { status: result.status });
    return NextResponse.json({ ok: true, prospectId: result.prospectId, householdId: result.householdId, member: result.member, primary: { firstName: primary.firstName, state: primary.state, goal: primary.goal, salesperson: primary.salesperson } });
  } catch (error) {
    await reportError(error, { where: "api/staff/household", userId: member.userId });
    return NextResponse.json({ error: "Could not save. Nothing was changed." }, { status: 500 });
  }
}
