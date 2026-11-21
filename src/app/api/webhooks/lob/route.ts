import { NextResponse } from "next/server";
import { recordLobEvent, supabaseMailStore } from "@/lib/mail/server";
import { parseLobEvent } from "@/lib/mail/tracking";
import { reportError } from "@/lib/observability/errors";
import { verifyLobSignature } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// Lob tracking webhook: what the post office says about each letter (mailed,
// in transit, delivered, returned…), recorded once per event and turned into
// the letter's status, tracking number and delivery or return date
// (src/lib/mail/tracking.ts has the mapping; src/lib/mail/server.ts records).
//
// Set up in the Lob dashboard (Webhooks → Create): this URL, the letter
// events (and the letter.certified ones), then copy the webhook's secret into
// LOB_WEBHOOK_SECRET.
//
// Trust: Lob signs every delivery (security/signatures.ts: verifyLobSignature).
// Without a valid, recent signature nothing is read. Without a secret
// configured, every request is refused: a status that releases or holds money
// (billing does not charge a round whose letters all came back) must never be
// set by an unsigned request.
//
// Answers: 2xx when the event is recorded, was already recorded, or is not
// about one of our letters (Lob stops retrying); 401 for a bad signature; 5xx
// when recording failed, so Lob tries again (recording is safe to repeat).

/** Real deliveries are a few kilobytes: the letter as it was, with its tracking events. */
const MAX_BODY_BYTES = 256 * 1024;

// Without a database (the demo), duplicates are caught here; with one, by the
// unique provider event id in mail_events.
const seen = new Set<string>();

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Unreadable body" }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const secret = process.env.LOB_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.LOB_API_KEY) {
      await reportError(new Error("LOB_WEBHOOK_SECRET is not set; the Lob webhook is refusing every request"), { where: "api/webhooks/lob" });
    }
    return NextResponse.json({ error: "Webhook signature verification is not configured" }, { status: 503 });
  }

  const check = verifyLobSignature({
    rawBody,
    signature: req.headers.get("lob-signature"),
    timestamp: req.headers.get("lob-signature-timestamp"),
    secret,
  });
  if (!check.ok) return NextResponse.json({ error: "Invalid signature", reason: check.reason }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = parseLobEvent(payload);
  // Signed, but not a letter event we read (an address or postcard event, a test ping): acknowledged, nothing to do.
  if (!event) return NextResponse.json({ ok: true, ignored: "not a letter event" });

  const db = getAdminClient();
  if (!db) {
    const duplicate = seen.has(event.eventId);
    if (seen.size > 5000) seen.clear();
    seen.add(event.eventId);
    return NextResponse.json({ ok: true, duplicate, stored: false });
  }

  try {
    const result = await recordLobEvent(supabaseMailStore(db), event);
    if (result.outcome === "unknown_letter" || result.outcome === "not_a_letter_event") {
      // Another environment's letter (a test key's), or one deleted since: nothing to update.
      return NextResponse.json({ ok: true, ignored: result.outcome }, { status: 202 });
    }
    return NextResponse.json({ ok: true, duplicate: result.outcome === "duplicate", status: result.status });
  } catch (error) {
    await reportError(error, { where: "api/webhooks/lob", extra: { eventId: event.eventId, eventType: event.eventType } });
    return NextResponse.json({ error: "Could not record the event" }, { status: 500 });
  }
}
