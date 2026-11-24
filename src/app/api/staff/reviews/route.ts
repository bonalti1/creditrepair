import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { REVIEW_MILESTONES, REVIEW_PLATFORMS } from "@/lib/reviews/reviews";
import { loadReviewPlatforms, loadReviewRequests, loadReviewSettings, savePlatform, saveReviewSettings } from "@/lib/reviews/server";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffMember, requireCapability } from "@/lib/staff/access";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";

// /equipo/resenas on the database (src/lib/reviews, migration 0029). Every
// member reads; an administrator ("reviews.manage") changes the sites, the
// milestones and the ratings typed in. Each change goes to the team's audit.
// There is no action that excludes a client from being asked, by design.

const milestones = z.object(Object.fromEntries(REVIEW_MILESTONES.map((m) => [m, z.boolean().optional()])) as Record<(typeof REVIEW_MILESTONES)[number], z.ZodOptional<z.ZodBoolean>>).strict();

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), requestsEnabled: z.boolean().optional(), milestones: milestones.optional() }).strict(),
  z
    .object({
      action: z.literal("platform"),
      key: z.enum(REVIEW_PLATFORMS),
      url: z.string().max(500).nullable().optional(),
      enabled: z.boolean().optional(),
      rating: z.number().min(1).max(5).nullable().optional(),
      reviewCount: z.number().int().min(0).max(10_000_000).nullable().optional(),
    })
    .strict(),
]);

export async function GET() {
  const db = getAdminClient();
  if (!db || !(await getServerSupabase())) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const member = await getStaffMember();
  if (!member) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  try {
    const [settings, platforms, requests] = await Promise.all([loadReviewSettings(db), loadReviewPlatforms(db), loadReviewRequests(db)]);
    return NextResponse.json({ settings, platforms, requests: requests.map(({ milestone, channel, at }) => ({ userId: "", milestone, channel, at })) });
  } catch (error) {
    await reportError(error, { where: "api/staff/reviews GET", userId: member.userId });
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-reviews", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("reviews.manage");
  if (!allowed.ok) return allowed.response;
  const by = { userId: allowed.member.userId, handle: allowed.member.handle };
  try {
    const input = parsed.data;
    if (input.action === "settings") {
      return NextResponse.json({ ok: true, settings: await saveReviewSettings(allowed.db, { requestsEnabled: input.requestsEnabled, milestones: input.milestones }, by) });
    }
    const { action: _action, ...patch } = input;
    const result = await savePlatform(allowed.db, patch, by);
    if (!result.ok) return NextResponse.json({ error: "That link cannot be saved.", code: result.code }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: "api/staff/reviews POST", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed." }, { status: 500 });
  }
}
