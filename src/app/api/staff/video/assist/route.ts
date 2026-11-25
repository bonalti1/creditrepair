import { NextResponse } from "next/server";
import { z } from "zod";
import { contentAssistCaller } from "@/lib/content/assistModel";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { draftVideoPlan, VIDEO_ASSIST_LIMITS, VIDEO_ASSIST_SCHEMA } from "@/lib/video/assist";
import { videoAssistBodySchema } from "@/lib/video/schemas";

// Alti drafts a script and a shot list from a brief (src/lib/video/assist.ts).
// content.edit. With ANTHROPIC_API_KEY Claude writes; without it the brief's
// words and the closest pre-checked template do. Every line is checked and
// the result is a draft: nothing is saved here.

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-video-assist", { limit: VIDEO_ASSIST_LIMITS.perMemberPerHour, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = videoAssistBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("content.edit");
  if (!allowed.ok) return allowed.response;
  try {
    return NextResponse.json(await draftVideoPlan(parsed.data, contentAssistCaller(VIDEO_ASSIST_SCHEMA)));
  } catch (error) {
    await reportError(error, { where: "api/staff/video/assist", userId: allowed.member.userId });
    return NextResponse.json(await draftVideoPlan(parsed.data, null));
  }
}
