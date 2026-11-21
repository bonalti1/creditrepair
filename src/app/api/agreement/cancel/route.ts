import { NextResponse } from "next/server";
import { z } from "zod";
import { canCancelWithoutPenalty } from "@/lib/agreement/gate";
import { agreementFromRow } from "@/lib/agreement/record";
import { AGREEMENT_TABLE, loadAgreementRow, notifyTeam } from "@/lib/agreement/server";
import { BRAND } from "@/lib/brand";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// The client cancels.
//
// Inside the window (until the end of the 3rd business day after signing) the
// cancellation is immediate and unconditional: it is recorded, and from that
// moment the gate refuses every letter (src/lib/agreement/gate.ts). No reason
// is required and nothing can refuse it.
//
// After the window the same button is a request to end the service: it is
// recorded, the gate holds further letters, and the team is told so a person
// confirms it with the client.
//
// Which of the two it is, is decided here from the recorded deadline and the
// server's clock. Unlike signing, cancelling does not depend on the agreement
// text being approved: a right to cancel is never switched off.

const bodySchema = z.object({
  reason: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "agreement-cancel", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await readJsonBody(req, 3_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const reason = parsed.data.reason?.trim() || null;

  try {
    const current = await loadAgreementRow(db, user.id);
    if (!current?.signed_at) {
      return NextResponse.json({ error: "There is no signed agreement to cancel.", code: "not_signed" }, { status: 409 });
    }
    const agreement = agreementFromRow(current);
    // Cancelling twice is not an error: the first cancellation stands.
    if (agreement.cancelledAt) return NextResponse.json({ ok: true, outcome: "cancelled", agreement });

    const now = new Date();
    if (canCancelWithoutPenalty(agreement, now)) {
      const { data: row, error } = await db
        .from(AGREEMENT_TABLE)
        .update({ cancelled_at: now.toISOString(), cancelled_within_window: true, cancellation_reason: reason })
        .eq("id", current.id as string)
        .is("cancelled_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      await db.from("events").insert({ user_id: user.id, kind: "agreement_cancelled", payload: { withinWindow: true } });
      await notifyTeam(`${BRAND.name}: un cliente canceló su acuerdo dentro del plazo de 3 días hábiles. No se le cobra ni se le envía nada. Cuenta: ${user.id}`);
      return NextResponse.json({
        ok: true,
        outcome: "cancelled",
        agreement: agreementFromRow((row as Record<string, unknown> | null) ?? { ...current, cancelled_at: now.toISOString(), cancelled_within_window: true }),
      });
    }

    // After the window: a request for a person to handle. Asking again keeps the first request's time.
    if (agreement.serviceEndRequestedAt) return NextResponse.json({ ok: true, outcome: "end_requested", agreement });
    const { data: row, error } = await db
      .from(AGREEMENT_TABLE)
      .update({ service_end_requested_at: now.toISOString(), service_end_reason: reason })
      .eq("id", current.id as string)
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "update returned no row");
    await db.from("events").insert({ user_id: user.id, kind: "service_end_requested", payload: {} });
    await notifyTeam(`${BRAND.name}: un cliente pidió terminar el servicio. No se envían más cartas hasta que alguien del equipo lo confirme con el cliente. Cuenta: ${user.id}`);
    return NextResponse.json({ ok: true, outcome: "end_requested", agreement: agreementFromRow(row as Record<string, unknown>) });
  } catch (error) {
    await reportError(error, { where: "api/agreement/cancel", userId: user.id });
    return NextResponse.json({ error: "Could not record it. Please try again, or write to the team." }, { status: 500 });
  }
}
