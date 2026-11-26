import { NextResponse } from "next/server";
import { z } from "zod";
import { sendRound } from "@/lib/rounds/send";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveActingUser } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { clientOption } from "@/lib/service/server";

// Credalti DIY's "Prepare my letters" (docs/SERVICE-OPTIONS.md): the CLIENT
// asks, and the letters are rendered from the approved texts and saved for
// them to print and mail. Nothing is mailed here: "I mailed them" and "Mail
// them for me" are their own steps (POST /api/diy, actions "mailed" and "mail_for_me").
//
// Under Credalti Complete (full service) this route refuses: letters leave
// only from the staff console's send (POST /api/staff/rounds). Both go through
// the same code, src/lib/rounds/send.ts, which checks on the server, before
// anything is written, the agreement gate (the 3-business-day window over),
// every item's logged attestation (Armor #2), the client's address and the
// furnisher address book, and that every letter has an attorney-approved text.

const bodySchema = z.object({
  userId: z.string().uuid().optional(),
  roundNumber: z.number().int().positive(),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "attacks-approve", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

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

  // Credalti Complete: the team sends the letters; the client approves nothing.
  const isFullService = (await clientOption(db, userId)) === "full_service";
  if (isFullService) {
    return NextResponse.json(
      { error: "Your team prepares and mails your letters. There is nothing to approve here.", code: "full_service_team_sends" },
      { status: 409 },
    );
  }

  try {
    const result = await sendRound(db, {
      userId,
      roundNumber,
      sender: { kind: "client" },
      via: "prepare",
      // Credalti DIY has its agreement too: nothing is prepared inside the cancellation window.
      requireAgreement: true,
    });
    if (!result.ok) {
      const { status, ok: _ok, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json({ prepared: true, letters: result.letters });
  } catch (error) {
    await reportError(error, { where: "api/attacks/approve", userId });
    return NextResponse.json({ error: "Could not prepare your letters. Nothing was lost; please try again." }, { status: 500 });
  }
}
