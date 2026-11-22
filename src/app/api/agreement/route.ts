import { NextResponse } from "next/server";
import { agreementReadiness } from "@/lib/agreement/readiness";
import { resolveTerms, withPlan } from "@/lib/agreement/terms";
import { offeredSnapshot } from "@/lib/billing/planStore";
import { getAdminClient } from "@/lib/supabase/admin";
import { agreementFromRow } from "@/lib/agreement/record";
import { AGREEMENT_TABLE } from "@/lib/agreement/server";
import { reportError } from "@/lib/observability/errors";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// The signed-in client's agreement, for the /acuerdo screens. Runs as the
// client through the cookie-bound client, so row-level security applies: a
// client reads their own rows and nothing else (migration 0010).
// In the demo (no database) it answers "not signed in", like the other stores'
// endpoints, and the screens fall back to this device's storage.

export async function GET() {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false, agreement: null });

  const [{ data: row, error }, { data: profile }] = await Promise.all([
    supabase
      .from(AGREEMENT_TABLE)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (error) {
    await reportError(new Error(error.message), { where: "api/agreement", userId: user.id });
    return NextResponse.json({ error: "Could not load the agreement" }, { status: 500 });
  }

  // The plan the client would sign (read with the service role: the catalogue is not the client's to read).
  const admin = getAdminClient();
  const plan = admin ? await offeredSnapshot(admin, user.id).catch(() => null) : null;
  const readiness = agreementReadiness({ terms: withPlan(resolveTerms(), plan) });
  return NextResponse.json({
    plan,
    authenticated: true,
    agreement: row ? agreementFromRow(row as Record<string, unknown>) : null,
    profileName: (profile?.full_name as string | undefined) || null,
    readiness: { mode: readiness.mode, canSign: readiness.canSign, version: readiness.version },
  });
}
