import { parseOptKeyword } from "@/lib/autopilot/optout";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { EMPTY_TWIML, smsFunnelEnabled, verifyTwilioSignature } from "@/lib/live/sms";
import { ensureFunnelLead, KEYWORD_SENDERS, keywordOf, replyToKeyword } from "@/lib/live/server";

// Inbound text messages (Twilio), for the live funnel only (docs/LIVE-FUNNEL.md,
// "SMS"). OFF by default: without SMS_FUNNEL_ENABLED nothing here is done and
// nothing is sent. When on:
//
//   - Twilio's signature is checked (X-Twilio-Signature, with TWILIO_AUTH_TOKEN,
//     against the public URL Twilio calls: NEXT_PUBLIC_APP_URL + this path);
//   - STOP / START (and BAJA / ALTA…) are recorded (live_sms_opt_outs). Twilio
//     answers STOP itself on a 10DLC number, so we send nothing back;
//   - a text that IS a funnel keyword, from a number with no account, gets the
//     one automatic reply with the /live link (once per person and keyword in
//     the window, quiet hours as on WhatsApp);
//   - anything else, and anything from a client, gets nothing automatic. Client
//     follow-ups never go by SMS.
//
// The answer is always an empty TwiML document: our reply goes through the API
// (live/sms.ts), so its words are checked and recorded like every other.

const twiml = () => new Response(EMPTY_TWIML, { status: 200, headers: { "content-type": "text/xml" } });

function e164(value: string): string | null {
  const digits = value.replace(/[^\d]/g, "");
  if (/^1[2-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^[2-9]\d{9}$/.test(digits)) return `+1${digits}`;
  return null;
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "webhook-sms", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  if (!smsFunnelEnabled()) return twiml();
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    await reportError(new Error("SMS_FUNNEL_ENABLED is on but TWILIO_AUTH_TOKEN is not set; inbound texts are refused"), { where: "api/webhooks/sms" });
    return new Response("Not configured", { status: 503 });
  }
  const raw = await req.text().catch(() => "");
  if (raw.length > 20_000) return new Response("Payload too large", { status: 413 });
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const url = base ? `${base}/api/webhooks/sms` : req.url;
  if (!verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"), token)) return new Response("Invalid signature", { status: 401 });

  const phone = e164(params.From ?? "");
  const text = (params.Body ?? "").slice(0, 500);
  const sid = (params.MessageSid ?? params.SmsSid ?? "").slice(0, 80);
  const db = getAdminClient();
  if (!phone || !db) return twiml();
  try {
    const opt = parseOptKeyword(text);
    if (opt) {
      await db.from("live_sms_opt_outs").insert({ phone_e164: phone, kind: opt.kind, keyword: opt.keyword.slice(0, 20) });
      return twiml();
    }
    const match = keywordOf(text);
    if (!match) return twiml();
    const { data: profile } = await db.from("profiles").select("id").eq("phone_e164", phone).maybeSingle();
    if (profile) return twiml();
    const now = new Date();
    await ensureFunnelLead(db, { phone, channel: "sms", origin: { tag: "webinar", platform: "sms", keyword: match.keyword.word, campaign: match.campaign, src: "sms" }, locale: match.keyword.locale, now });
    await replyToKeyword(
      db,
      { channel: "sms", phone, match, inboundRef: sid || `${phone}:${now.toISOString()}`, inboundAt: now.toISOString(), isClient: false, savedLocale: null, appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "", now },
      KEYWORD_SENDERS.sms,
    );
  } catch (error) {
    await reportError(error, { where: "api/webhooks/sms" });
  }
  return twiml();
}
