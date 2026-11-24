import { NextResponse } from "next/server";
import { z } from "zod";
import { loadStateOpenings, saveStateOpening } from "@/lib/compliance/stateOpenings";
import { ALL_STATES } from "@/lib/compliance/states";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffMember, requireCapability } from "@/lib/staff/access";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";

// /equipo/estados on the database (migration 0030): every member reads; an
// administrator ("states.manage") opens or closes a state, with the
// attorney's review on record (states.ts: openingProblems).

const bodySchema = z
  .object({
    state: z.enum(ALL_STATES as unknown as [string, ...string[]]),
    opened: z.boolean(),
    attorneyName: z.string().max(120).nullable().optional(),
    attorneyReviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    registrationRef: z.string().max(120).nullable().optional(),
    bondConfirmed: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

export async function GET() {
  const db = getAdminClient();
  if (!db || !(await getServerSupabase())) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const member = await getStaffMember();
  if (!member) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  try {
    return NextResponse.json({ openings: await loadStateOpenings(db) });
  } catch (error) {
    await reportError(error, { where: "api/staff/states GET", userId: member.userId });
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-states", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 3_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("states.manage");
  if (!allowed.ok) return allowed.response;
  try {
    const result = await saveStateOpening(allowed.db, parsed.data, { userId: allowed.member.userId, handle: allowed.member.handle });
    if (!result.ok) return NextResponse.json({ error: "This state cannot be opened yet.", problems: result.problems }, { status: 422 });
    return NextResponse.json({ ok: true, opening: result.opening });
  } catch (error) {
    await reportError(error, { where: "api/staff/states POST", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed." }, { status: 500 });
  }
}
