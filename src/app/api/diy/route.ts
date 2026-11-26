import { NextResponse } from "next/server";
import { z } from "zod";
import { createMailRequest, loadDiyRound, recordClientMailed } from "@/lib/diy/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// Credalti DIY, the signed-in client's own round (docs/SERVICE-OPTIONS.md):
//
//   GET                         the prepared letters (to print), the open
//                               "Mail them for me" request and the fee per letter.
//   POST {action: "mailed"}     "I mailed them" on a date.
//   POST {action: "mail_for_me"} "Mail them for me", with the total the client
//                               saw and accepted.
//
// The client's own record only (the session's account). The database checks
// every write again (migration 0042).

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mailed"), roundNumber: z.number().int().positive(), mailedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({
    action: z.literal("mail_for_me"),
    roundNumber: z.number().int().positive(),
    letterIds: z.array(z.string().uuid()).max(40).optional(),
    acceptedTotalCents: z.number().int().positive(),
  }),
]);

export async function GET() {
  const user = await getSessionUser();
  const db = getAdminClient();
  if (!user || !db) return NextResponse.json({ authenticated: false, round: null });
  try {
    return NextResponse.json({ authenticated: true, round: await loadDiyRound(db, user.id) });
  } catch (error) {
    await reportError(error, { where: "api/diy:get", userId: user.id });
    return NextResponse.json({ error: "Could not read your letters." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "diy", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  try {
    const result =
      parsed.data.action === "mailed"
        ? await recordClientMailed(db, user.id, parsed.data.roundNumber, parsed.data.mailedOn)
        : await createMailRequest(db, user.id, {
            roundNumber: parsed.data.roundNumber,
            letterIds: parsed.data.letterIds,
            acceptedTotalCents: parsed.data.acceptedTotalCents,
            ip: clientIp(req),
            userAgent: req.headers.get("user-agent"),
          });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, ...result.value, round: await loadDiyRound(db, user.id) });
  } catch (error) {
    await reportError(error, { where: "api/diy:post", userId: user.id });
    return NextResponse.json({ error: "Could not save that. Nothing changed; please try again." }, { status: 500 });
  }
}
