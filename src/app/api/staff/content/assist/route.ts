import { NextResponse } from "next/server";
import { z } from "zod";
import { ASSIST_LIMITS, writeWithAlti } from "@/lib/content/assist";
import { contentAssistCaller } from "@/lib/content/assistModel";
import { assistBodySchema } from "@/lib/content/schemas";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// Alti's writing assistant (src/lib/content/assist.ts). content.edit. With
// ANTHROPIC_API_KEY Claude writes; without it the closest pre-checked
// template does. Either way every line is checked and the result is a draft:
// nothing is saved here (the person inserts it into a piece and edits it).

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-content-assist", { limit: ASSIST_LIMITS.perMemberPerHour, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = assistBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("content.edit");
  if (!allowed.ok) return allowed.response;
  try {
    return NextResponse.json(await writeWithAlti(parsed.data, contentAssistCaller()));
  } catch (error) {
    await reportError(error, { where: "api/staff/content/assist", userId: allowed.member.userId });
    return NextResponse.json(await writeWithAlti(parsed.data, null));
  }
}
