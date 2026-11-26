import { NextResponse } from "next/server";
import { z } from "zod";
import { DRAFT_LIMITS, draftGuide } from "@/lib/seo/draft";
import { seoDraftCaller } from "@/lib/seo/draftModel";
import { draftBodySchema } from "@/lib/seo/schemas";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// Alti drafts a guide (src/lib/seo/draft.ts). seo.edit. With ANTHROPIC_API_KEY
// Claude writes the outline and the article in English and Spanish, checked
// and rewritten once if it breaks a rule; without it, an outline to fill in.
// Nothing is saved here: the editor puts the draft into the guide.

export const maxDuration = 180;

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-seo-draft", { limit: DRAFT_LIMITS.perMemberPerHour, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 6_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = draftBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("seo.edit");
  if (!allowed.ok) return allowed.response;
  try {
    return NextResponse.json(await draftGuide(parsed.data, seoDraftCaller()));
  } catch (error) {
    await reportError(error, { where: "api/staff/seo/draft", userId: allowed.member.userId });
    return NextResponse.json(await draftGuide(parsed.data, null));
  }
}
