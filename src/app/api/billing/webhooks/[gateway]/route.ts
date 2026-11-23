import { NextResponse } from "next/server";
import { getPaymentGateway } from "@/lib/billing/gateway";
import { applyGatewayEvent } from "@/lib/billing/webhooks";
import { reportError } from "@/lib/observability/errors";
import { getAdminClient } from "@/lib/supabase/admin";

// The payment processor's webhooks: settlement, ACH returns, chargebacks.
// POST /api/billing/webhooks/nmi or /api/billing/webhooks/authorize_net.
//
// The body is read raw and the signature checked by the configured adapter
// (gateways/*.ts) before anything is read from it; an unsigned or wrongly
// signed request changes nothing (401). Each event is applied once
// (gateway_events). A webhook never creates a charge: it can only record a
// return (the charge goes back to the dunning schedule) or a chargeback.

export async function POST(req: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const name = (await params).gateway;
  const resolution = getPaymentGateway();
  if (!resolution.configured || resolution.gateway.name !== name || !resolution.gateway.parseWebhook) {
    return NextResponse.json({ error: "No webhook is configured for this processor." }, { status: 404 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const rawBody = await req.text();
  if (rawBody.length > 200_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const parsed = await resolution.gateway.parseWebhook({ rawBody, headers: req.headers });
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: parsed.reason === "bad_signature" ? 401 : 400 });
  try {
    const outcomes = [];
    for (const event of parsed.events) outcomes.push(await applyGatewayEvent(db, name, event));
    return NextResponse.json({ ok: true, outcomes });
  } catch (error) {
    await reportError(error, { where: "api/billing/webhooks", extra: { gateway: name } });
    // A 500 makes the processor send it again; the event id keeps it from being applied twice.
    return NextResponse.json({ error: "Could not apply the event." }, { status: 500 });
  }
}
