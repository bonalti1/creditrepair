import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { MAX_LEAD_BYTES, parseHighLevelLead } from "@/lib/highlevel/lead";
import { receiveLead } from "@/lib/leads/server";
import { reportError } from "@/lib/observability/errors";
import { REFERRAL_CODE } from "@/lib/partners/rules";
import { rateLimit } from "@/lib/security/rateLimit";
import { safeEqual } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";
import { loadOpenStates } from "@/lib/compliance/stateOpenings";
import { stateStatus } from "@/lib/compliance/states";

// A lead from a HighLevel workflow (docs/HIGHLEVEL.md). HighLevel captures the
// lead (ad, form, funnel); this endpoint hands it to the app as a prospect, with
// its source, so sales can invite them from /equipo.
//
// Trust. HighLevel's workflow "Custom Webhook" action sends the headers we
// configure on it, so the workflow carries a shared secret, checked here in
// constant time, in either of two headers:
//   x-credalti-secret: <HIGHLEVEL_WEBHOOK_SECRET>
//   Authorization: Bearer <HIGHLEVEL_WEBHOOK_SECRET>
// VERIFIED (HighLevel help center, "Workflow Action - Custom webhook", as
// quoted in search results; the page itself could not be opened from the build
// environment): the action takes custom headers and an Authorization option
// (Bearer, API key, Basic).
// UNVERIFIED: any signature from HighLevel itself. HighLevel signs the
// webhooks of Marketplace apps (X-GHL-Signature, Ed25519; the older
// X-WH-Signature, RSA) but nothing we found says a workflow action is signed,
// so no HighLevel signature is checked here. The shared secret is the check.
// Without HIGHLEVEL_WEBHOOK_SECRET the endpoint refuses everything (fails closed).
//
// What it does, in order: rate limit → secret → body size → JSON → drop any
// SSN or date-of-birth field (its name is logged, its value never) → validate
// → dedupe the exact delivery (webhook_receipts) → create or update the
// prospect (leads/server.ts: same contact or same phone updates) → 200.

const SECRET_HEADER = "x-credalti-secret";

function authorized(req: Request, secret: string): boolean {
  const header = req.headers.get(SECRET_HEADER);
  if (header !== null && safeEqual(header, secret)) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") && safeEqual(auth.slice(7), secret);
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "webhook-highlevel", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const secret = process.env.HIGHLEVEL_WEBHOOK_SECRET;
  if (!secret) {
    await reportError(new Error("HIGHLEVEL_WEBHOOK_SECRET is not set; the HighLevel webhook refuses every delivery"), { where: "api/webhooks/highlevel" });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (!authorized(req, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_LEAD_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const raw = await req.text().catch(() => null);
  if (raw === null) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  if (Buffer.byteLength(raw, "utf8") > MAX_LEAD_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = new Date();
  const parsed = parseHighLevelLead(body, now);
  if (parsed.dropped.length > 0) {
    // The form or the workflow is sending something we never accept. Names only.
    await reportError(new Error(`HighLevel sent fields that are never stored and were dropped: ${parsed.dropped.join(", ")}`), {
      where: "api/webhooks/highlevel:dropped-fields",
    });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const deliveryKey = createHash("sha256").update(raw, "utf8").digest("hex");
  try {
    const { data: seen } = await db
      .from("webhook_receipts")
      .select("outcome, prospect_id")
      .eq("source", "highlevel")
      .eq("delivery_key", deliveryKey)
      .maybeSingle();
    if (seen) return NextResponse.json({ ok: true, duplicate: true, outcome: seen.outcome, prospectId: seen.prospect_id ?? null });

    if (!parsed.ok) {
      await db.from("webhook_receipts").insert({ source: "highlevel", delivery_key: deliveryKey, outcome: "rejected", dropped_fields: parsed.dropped });
      return NextResponse.json({ error: "Invalid lead", problems: parsed.problems, dropped: parsed.dropped }, { status: 422 });
    }

    const { lead } = parsed;
    // A lead from a state we have not opened (/equipo/estados) goes on the waitlist, not to sales: no
    // prospect, no invitation (compliance/states.ts). HighLevel sees "waitlisted".
    if (stateStatus(lead.state, await loadOpenStates(db)) !== "open") {
      const { error: waitError } = await db.from("waitlist").insert({ email: lead.email, phone_e164: lead.phone, state: lead.state, locale: "en", source: "highlevel" });
      if (waitError) throw new Error(`waitlist: ${waitError.message}`);
      await db
        .from("webhook_receipts")
        .upsert({ source: "highlevel", delivery_key: deliveryKey, outcome: "waitlisted", prospect_id: null, dropped_fields: parsed.dropped }, { onConflict: "source,delivery_key", ignoreDuplicates: true });
      return NextResponse.json({ ok: true, outcome: "waitlisted", prospectId: null, dropped: parsed.dropped });
    }
    let partner: { id: string; salesperson: string | null } | null = null;
    if (lead.partnerCode && REFERRAL_CODE.test(lead.partnerCode)) {
      const { data } = await db.from("partners").select("id, salesperson").eq("referral_code", lead.partnerCode).eq("status", "approved").maybeSingle();
      if (data) partner = { id: String(data.id), salesperson: (data.salesperson as string | null) ?? null };
    }
    const result = await receiveLead(
      db,
      {
        source: "highlevel",
        firstName: lead.firstName,
        lastName: lead.lastName,
        phone: lead.phone,
        email: lead.email,
        state: lead.state,
        goal: lead.goal,
        contactId: lead.contactId,
        campaign: lead.campaign,
        utm: lead.utm,
        ad: lead.ad,
        consentText: lead.consentText!,
        consentAt: lead.consentAt!,
        salespersonHint: lead.assignedTo,
        partner,
      },
      now,
    );
    const prospectId = result.outcome === "existing_client" ? null : result.prospectId;
    // A concurrent redelivery may have written the receipt first: the unique key keeps one.
    await db
      .from("webhook_receipts")
      .upsert(
        { source: "highlevel", delivery_key: deliveryKey, outcome: result.outcome, prospect_id: prospectId, dropped_fields: parsed.dropped },
        { onConflict: "source,delivery_key", ignoreDuplicates: true },
      );
    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      prospectId,
      ...(result.outcome === "existing_client" ? {} : { salesperson: result.salesperson }),
      dropped: parsed.dropped,
    });
  } catch (error) {
    await reportError(error, { where: "api/webhooks/highlevel" });
    return NextResponse.json({ error: "Could not save the lead. Please retry." }, { status: 500 });
  }
}
