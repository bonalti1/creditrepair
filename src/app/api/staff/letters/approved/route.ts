import { NextResponse } from "next/server";
import { listLetterVersions } from "@/lib/letters/versions/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { getServerSupabase } from "@/lib/supabase/server";

// The approved letter texts, for anyone who works a case (case.view:
// administrators and specialists). The console previews and prints letters
// with them, so what is read on screen is what is mailed. Read through the
// member's own connection: a specialist's policy returns approved versions only.

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-letters-approved", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("case.view");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    return NextResponse.json({ versions: await listLetterVersions(reader, { approvedOnly: true }) });
  } catch (error) {
    await reportError(error, { where: "api/staff/letters/approved", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the approved letters." }, { status: 500 });
  }
}
