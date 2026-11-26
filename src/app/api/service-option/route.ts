import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { loadClientOption, recordOptionChoice } from "@/lib/service/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// The signed-in client's service option (migration 0042,
// docs/SERVICE-OPTIONS.md): Credalti Complete or Credalti DIY.
//
//   GET   what applies now, what they chose, what they signed, and whether a
//         switch waits for their signature.
//   POST  {option, via}: record a choice. Before signing it is their option;
//         after signing, choosing the other one starts a switch, finished by
//         signing that option's agreement at /acuerdo (the signature
//         supersedes the old agreement; until then nothing changes).
//
// The client's own choice only: nobody else can set it, and no option is
// ever pre-selected or pushed. Written with the service role.

const bodySchema = z.object({
  option: z.enum(["full_service", "diy"]),
  via: z.enum(["signup_chat", "invitation", "onboarding", "app"]).default("app"),
});

export async function GET() {
  const user = await getSessionUser();
  const db = getAdminClient();
  if (!user || !db) return NextResponse.json({ authenticated: false });
  try {
    return NextResponse.json({ authenticated: true, ...(await loadClientOption(db, user.id)) });
  } catch (error) {
    await reportError(error, { where: "api/service-option:get", userId: user.id });
    return NextResponse.json({ error: "Could not read your option." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "service-option", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ authenticated: false, error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const body = await readJsonBody(req, 1_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  try {
    const result = await recordOptionChoice(db, user.id, parsed.data.option, parsed.data.via);
    if (!result.ok) throw new Error(result.error);
    return NextResponse.json({ authenticated: true, ok: true, ...result.state });
  } catch (error) {
    await reportError(error, { where: "api/service-option:post", userId: user.id });
    return NextResponse.json({ error: "Could not save your choice. Please try again." }, { status: 500 });
  }
}
