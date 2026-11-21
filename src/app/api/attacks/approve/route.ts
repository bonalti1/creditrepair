import { NextResponse } from "next/server";
import { z } from "zod";
import { sendRound } from "@/lib/rounds/send";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveActingUser } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { isFullService } from "@/lib/service/mode";

// The DIY moment (spec §4.2, legally load-bearing), kept for self-serve: the
// USER reviews the round and presses the button. Only then are letters
// rendered, printed and mailed.
//
// Under full service (the business today) this route refuses: letters leave
// only from the staff console's send (POST /api/staff/rounds). Both go through
// the same code, src/lib/rounds/send.ts, which checks on the server, before
// anything is mailed, the agreement gate, every item's logged attestation
// (Armor #2), the client's address and the furnisher address book, and which
// a retry can repeat without mailing a letter twice.

const bodySchema = z.object({
  userId: z.string().uuid().optional(),
  roundNumber: z.number().int().positive(),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "attacks-approve", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  // Full service: the team sends the letters; the client approves nothing.
  if (isFullService) {
    return NextResponse.json(
      { error: "Your team prepares and mails your letters. There is nothing to approve here.", code: "full_service_team_sends" },
      { status: 409 },
    );
  }

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { roundNumber } = parsed.data;

  const acting = await resolveActingUser(req, parsed.data.userId);
  if (!acting) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { userId } = acting;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  try {
    const result = await sendRound(db, {
      userId,
      roundNumber,
      sender: { kind: "client" },
      // Self-serve has no service agreement; full service never reaches this line.
      requireAgreement: isFullService,
    });
    if (!result.ok) {
      const { status, ok: _ok, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json({ approved: true, letters: result.letters, nextRoundDueAt: result.nextRoundDueAt });
  } catch (error) {
    await reportError(error, { where: "api/attacks/approve", userId });
    return NextResponse.json({ error: "Could not send the round. Nothing was lost; please try again." }, { status: 500 });
  }
}
