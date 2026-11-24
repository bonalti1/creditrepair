import { NextResponse } from "next/server";
import { loadOpenStates } from "@/lib/compliance/stateOpenings";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";

// The states Credalti takes people from now, for the signup's state step and
// the invite page. Public: only the two-letter codes of opened states.

export async function GET(req: Request) {
  const limited = rateLimit(req, "open-states", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  return NextResponse.json({ opened: await loadOpenStates(getAdminClient()) });
}
