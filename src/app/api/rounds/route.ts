import { NextResponse } from "next/server";
import { loadClientRound } from "@/lib/clientCase/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// The signed-in client's newest mailed round: when it went, the items it
// covers, and where each letter is (letters.mail_*, migration 0013). Read
// through the client's own connection ("own letters read"). Nothing here is
// written: the team mails the rounds (POST /api/staff/rounds).

export async function GET(req: Request) {
  const limited = rateLimit(req, "client-rounds", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false, round: null });
  try {
    return NextResponse.json({ authenticated: true, ...(await loadClientRound(supabase, user.id)) });
  } catch (error) {
    await reportError(error, { where: "api/rounds", userId: user.id });
    return NextResponse.json({ error: "Could not read your rounds." }, { status: 500 });
  }
}
