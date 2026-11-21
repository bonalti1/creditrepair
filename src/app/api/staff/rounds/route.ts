import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { sendStaffRounds } from "@/lib/staff/actions";
import { roundsBodySchema } from "@/lib/staff/api";
import { getServerSupabase } from "@/lib/supabase/server";

// The send screen's "Enviar" (and the print page's "marked as mailed"): mail
// prepared rounds (rounds.send: administrators and specialists, for clients
// whose case they see). Under full service this is the only way a letter
// leaves; the client app's approval route refuses.
//
// Each round is checked with the console's rules over what this member can
// see, then again by src/lib/rounds/send.ts against the database: the
// agreement gate, an attestation on every item, the client's and every
// furnisher's address, idempotent and safe to retry. A round that may not go
// comes back with the reason; the others go.

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-rounds", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const body = await readJsonBody(req, 64_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = roundsBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  const allowed = await requireCapability("rounds.send");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  try {
    const { outcomes } = await sendStaffRounds(db, reader, member, parsed.data);
    return NextResponse.json({ ok: true, outcomes });
  } catch (error) {
    await reportError(error, { where: "api/staff/rounds", userId: member.userId });
    return NextResponse.json({ error: "The send stopped. Letters that went out are recorded; send again to continue." }, { status: 500 });
  }
}
