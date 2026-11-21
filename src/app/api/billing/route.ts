import { NextResponse } from "next/server";
import type { ClientBillingPayload } from "@/lib/billing/api";
import { getPaymentGateway } from "@/lib/billing/gateway";
import { paymentAuthorizationApproved } from "@/lib/billing/readiness";
import { loadBilling } from "@/lib/billing/server";
import { reportError } from "@/lib/observability/errors";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// The signed-in client's billing, for "Mis pagos": the payment method on file
// (brand and last four digits, never a token), each charge with the round it
// paid for, refunds, and what the rule needs to say what happens next.
//
// Runs as the client through the cookie-bound connection, so row level
// security applies: a client reads their own rows and nothing else (migration
// 0011). In the demo (no database) it answers "not signed in", like the other
// stores' endpoints, and the screen falls back to this device's storage.

export async function GET() {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false });

  try {
    const loaded = await loadBilling(supabase, user.id);
    // The team's pause note is theirs: the client learns only that billing is paused.
    const admin = getAdminClient();
    let paused: string | null = null;
    if (admin) {
      const { data } = await admin.from("billing_pauses").select("created_at").eq("user_id", user.id).is("lifted_at", null).limit(1);
      paused = (data?.[0]?.created_at as string | undefined) ?? null;
    }
    const resolution = getPaymentGateway();
    const live = resolution.configured && resolution.gateway.live;
    const payload: ClientBillingPayload = {
      authenticated: true,
      agreement: loaded.agreement
        ? {
            disclosureAcknowledgedAt: loaded.agreement.disclosureAcknowledgedAt,
            signedAt: loaded.agreement.signedAt,
            cancellationDeadline: loaded.agreement.cancellationDeadline,
            cancelledAt: loaded.agreement.cancelledAt,
            serviceEndRequestedAt: loaded.agreement.serviceEndRequestedAt,
          }
        : null,
      signedMonthlyFee: loaded.context.signedMonthlyFee,
      authorizationTerms: loaded.authorizationTerms,
      rounds: loaded.context.rounds,
      account: { ...loaded.context.account, pause: paused ? { at: new Date(paused).toISOString(), by: "", reason: "" } : null },
      processor: {
        configured: resolution.configured,
        live,
        // Real money needs an approved authorization text; the demo processor does not.
        canAddMethod: resolution.configured && (!live || paymentAuthorizationApproved()),
      },
    };
    return NextResponse.json(payload);
  } catch (error) {
    await reportError(error, { where: "api/billing", userId: user.id });
    return NextResponse.json({ error: "Could not load billing" }, { status: 500 });
  }
}
