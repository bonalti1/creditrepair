import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { draftReviewReply, REVIEW_TEXT_MAX } from "@/lib/reviews/reply";
import { REVIEW_PLATFORMS } from "@/lib/reviews/reviews";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { callDraftModel } from "@/lib/staff/draftModel";
import { isDemoMode } from "@/lib/supabase/config";

// Alti's draft of a public reply to a review a teammate pasted
// (src/lib/reviews/reply.ts). Nothing is posted from here: a person reads,
// edits and posts it on the platform. The review's text goes to the model and
// nowhere else; nothing is stored. Without ANTHROPIC_API_KEY: the safe
// fallback reply, said so.

const bodySchema = z
  .object({
    review: z.string().trim().min(3).max(REVIEW_TEXT_MAX),
    stars: z.number().int().min(1).max(5).nullable().optional(),
    reviewerName: z.string().max(80).nullable().optional(),
    platform: z.enum(REVIEW_PLATFORMS),
    locale: z.enum(["es", "en"]),
  })
  .strict();

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-review-reply", { limit: 20, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 6_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  if (!isDemoMode()) {
    const allowed = await requireCapability("clients.reply");
    if (!allowed.ok) return allowed.response;
  }
  try {
    const caller = process.env.ANTHROPIC_API_KEY ? callDraftModel : null;
    const outcome = await draftReviewReply(
      { review: parsed.data.review, stars: parsed.data.stars ?? null, reviewerName: parsed.data.reviewerName ?? null, platform: parsed.data.platform, locale: parsed.data.locale },
      caller,
    );
    return NextResponse.json({ ...outcome, configured: Boolean(caller) });
  } catch (error) {
    await reportError(error, { where: "api/staff/reviews/reply" });
    return NextResponse.json({ error: "Could not prepare the draft." }, { status: 500 });
  }
}
