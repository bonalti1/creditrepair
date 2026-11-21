import { NextResponse } from "next/server";
import { loadClientReport } from "@/lib/clientCase/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// The signed-in client's newest report, their score history and the name and
// address their letters carry. Read through the client's own connection, so
// row level security shows them their rows only. Signed out (or the demo):
// { authenticated: false }, and the app shows the sample report.

export async function GET(req: Request) {
  const limited = rateLimit(req, "client-report", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false });
  try {
    return NextResponse.json({ authenticated: true, ...(await loadClientReport(supabase, user.id)) });
  } catch (error) {
    await reportError(error, { where: "api/report", userId: user.id });
    return NextResponse.json({ error: "Could not read your report." }, { status: 500 });
  }
}
