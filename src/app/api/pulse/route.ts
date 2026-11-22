import { NextResponse } from "next/server";
import { z } from "zod";
import { PULSE_MOMENTS, pulseCommentSchema, pulseSubmissionSchema } from "@/lib/pulse/pulse";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// "¿Cómo vamos?" (src/lib/pulse/pulse.ts, migration 0018).
//
// GET   the moments the signed-in client already answered (their own rows,
//       read through their own connection), so the question is not asked again
//       on another device.
// POST  one answer ({moment, rating, comment?}): validated here, then written
//       with the service role for the signed-in client only. The table has no
//       insert policy, so this route is the only way in. One answer per
//       moment: a second one is refused. A body with no rating ({moment,
//       comment}) adds the comment to the client's own answer, once.

export async function GET(req: Request) {
  const limited = rateLimit(req, "client-pulse", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false, answered: [] });
  const { data, error } = await supabase.from("client_pulses").select("moment").eq("user_id", user.id);
  if (error) {
    await reportError(error, { where: "api/pulse GET", userId: user.id });
    return NextResponse.json({ error: "Could not read." }, { status: 500 });
  }
  const answered = ((data as Array<{ moment: string }> | null) ?? []).map((r) => r.moment).filter((m) => (PULSE_MOMENTS as readonly string[]).includes(m));
  return NextResponse.json({ authenticated: true, answered });
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "client-pulse-write", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Not available" }, { status: 503 });

  const data = body.data as Record<string, unknown> | null;
  if (data && typeof data === "object" && !("rating" in data)) {
    const parsedComment = pulseCommentSchema.safeParse(data);
    if (!parsedComment.success) return NextResponse.json({ error: z.flattenError(parsedComment.error) }, { status: 400 });
    const { data: rows, error } = await db
      .from("client_pulses")
      .update({ comment: parsedComment.data.comment })
      .eq("user_id", user.id)
      .eq("moment", parsedComment.data.moment)
      .is("comment", null)
      .select("id");
    if (error) {
      await reportError(error, { where: "api/pulse comment", userId: user.id });
      return NextResponse.json({ error: "Could not save." }, { status: 500 });
    }
    if (!rows || rows.length === 0) return NextResponse.json({ error: "Nothing to add to", code: "no_answer" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  const parsed = pulseSubmissionSchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { moment, rating, comment, locale } = parsed.data;
  const { error } = await db.from("client_pulses").insert({ user_id: user.id, moment, rating, comment: comment ?? null, locale });
  if (error) {
    // 23505: this moment was already answered.
    if ((error as { code?: string }).code === "23505") return NextResponse.json({ error: "Already answered", code: "already_answered" }, { status: 409 });
    await reportError(error, { where: "api/pulse POST", userId: user.id });
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
