import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffMember } from "@/lib/staff/access";
import { applyPreferencesUpdate, preferencesFromRow, preferencesToRow, preferencesUpdateSchema } from "@/lib/staff/preferences";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";

// A member's own preferences (migration 0020): the morning summary and the
// first-day checklist. Read through their own connection (they read only
// their own row); written by the server for the signed-in member and nobody
// else: there is no field for whose preferences these are.

export async function GET() {
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const member = await getStaffMember();
  if (!member) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  const { data } = await reader.from("staff_preferences").select("*").eq("user_id", member.userId).maybeSingle();
  return NextResponse.json({ preferences: preferencesFromRow(data as Record<string, unknown> | null) });
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-preferences", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = preferencesUpdateSchema.strict().safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const reader = await getServerSupabase();
  const db = getAdminClient();
  if (!reader || !db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const member = await getStaffMember();
  if (!member) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  try {
    const now = new Date();
    const { data } = await reader.from("staff_preferences").select("*").eq("user_id", member.userId).maybeSingle();
    const next = applyPreferencesUpdate(preferencesFromRow(data as Record<string, unknown> | null), parsed.data, now);
    const { error } = await db.from("staff_preferences").upsert(preferencesToRow(member.userId, next, now));
    if (error) throw new Error(`staff_preferences: ${error.message}`);
    return NextResponse.json({ ok: true, preferences: next });
  } catch (error) {
    await reportError(error, { where: "api/staff/preferences", userId: member.userId });
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }
}
