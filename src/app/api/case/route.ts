import { NextResponse } from "next/server";
import { loadClientCaseFacts } from "@/lib/case/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// "Mi caso" for the signed-in client: the facts of their own case (agreement,
// documents, reports, review, rounds and mail, answers, charges), read through
// the client's own connection so row level security shows them their rows
// only. Read-only. Signed out (or the demo): { authenticated: false }.

export async function GET(req: Request) {
  const limited = rateLimit(req, "client-case", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false });
  try {
    return NextResponse.json({ authenticated: true, facts: await loadClientCaseFacts(supabase, user.id) });
  } catch (error) {
    await reportError(error, { where: "api/case", userId: user.id });
    return NextResponse.json({ error: "Could not read your case." }, { status: 500 });
  }
}
