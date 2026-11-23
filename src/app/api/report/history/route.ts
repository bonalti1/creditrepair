import { NextResponse } from "next/server";
import { z } from "zod";
import { loadClientReportById, loadClientReportHistory } from "@/lib/clientCase/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// "My reports": every report in the signed-in client's file, newest first,
// with what each one changed (GET), or one of them read again (GET ?id=), for
// the printable audit. Through the client's own connection, so row level
// security shows them their own reports only. Never the stored JSON: the raw
// import is for the team. Signed out (the demo): { authenticated: false }.

const idSchema = z.string().uuid();

export async function GET(req: Request) {
  const limited = rateLimit(req, "client-report-history", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false });
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id !== null) {
      if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      const report = await loadClientReportById(supabase, user.id, id);
      return report ? NextResponse.json({ authenticated: true, report }) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ authenticated: true, entries: await loadClientReportHistory(supabase, user.id) });
  } catch (error) {
    await reportError(error, { where: "api/report/history", userId: user.id });
    return NextResponse.json({ error: "Could not read your reports." }, { status: 500 });
  }
}
