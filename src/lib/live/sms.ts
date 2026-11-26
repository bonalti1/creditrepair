import { createHmac } from "crypto";
import { assertClaimGuardrails } from "../compliance/guardrails";
import { safeEqual } from "../security/signatures";

// The live funnel's SMS channel (Twilio). OFF by default, and the ONE place in
// the app that may send a text message other than a login code.
//
// Why it is narrow: US carriers and Twilio list credit repair among the
// restricted or forbidden categories for business texting, so an A2P 10DLC
// campaign for it may be rejected (docs/LIVE-FUNNEL.md, "SMS"). The owner says
// texting these leads is cleared with his attorney; WhatsApp stays the
// default. So this file sends only:
//
//   - "keyword_reply": the one automatic reply to a person who texted the
//     keyword to our number themselves;
//   - "video_link":    the private link to their video, to a person who
//     texted the keyword or ticked the SMS consent on /live;
//
// and only when SMS_FUNNEL_ENABLED is on and Twilio is configured. Every text
// passes the claim rules and carries the STOP line. Client follow-ups, the
// autopilot, reminders and everything else keep the "never SMS" rule
// (autopilot/channels.ts): nothing there imports this file, and a test holds it.

export type SmsPurpose = "keyword_reply" | "video_link";

export interface SmsConsent {
  /** They texted the keyword to our number. */
  texted: boolean;
  /** They ticked the SMS consent on /live (live_leads.consent_sms_at). */
  formConsent: boolean;
}

/** The switch: SMS_FUNNEL_ENABLED=on (or true / 1). Anything else is off. */
export function smsFunnelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(on|true|1|yes)$/i.test((env.SMS_FUNNEL_ENABLED ?? "").trim());
}

/** On, and Twilio has what it needs. */
export function smsFunnelReady(env: Record<string, string | undefined> = process.env): boolean {
  return smsFunnelEnabled(env) && Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
}

/** Whether this purpose may go to this person by SMS at all. */
export function smsAllowed(purpose: SmsPurpose, consent: SmsConsent): boolean {
  if (purpose === "keyword_reply") return consent.texted;
  return consent.texted || consent.formConsent;
}

export class SmsRefused extends Error {}

/** Sends one funnel text. Refuses (throws SmsRefused) when off, not allowed, or the words break a rule; no-ops without Twilio keys. */
export async function sendFunnelSms(
  toE164: string,
  body: string,
  input: { purpose: SmsPurpose; consent: SmsConsent },
  env: Record<string, string | undefined> = process.env,
): Promise<{ sent: boolean; sid: string | null }> {
  if (!smsFunnelEnabled(env)) throw new SmsRefused("sms: the SMS funnel channel is off (SMS_FUNNEL_ENABLED)");
  if (!smsAllowed(input.purpose, input.consent)) throw new SmsRefused(`sms: no consent for ${input.purpose}`);
  if (!/^\+1[2-9]\d{9}$/.test(toE164)) throw new SmsRefused("sms: only US numbers");
  if (!/\bSTOP\b/.test(body)) throw new SmsRefused("sms: every text carries the STOP line");
  if (body.length > 640) throw new SmsRefused("sms: too long");
  assertClaimGuardrails(body, `sms:${input.purpose}`);
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { sent: false, sid: null };
  const form = new URLSearchParams({ To: toE164, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Twilio error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json().catch(() => ({}))) as { sid?: string };
  return { sent: true, sid: data.sid ?? null };
}

/**
 * Twilio signs each webhook: X-Twilio-Signature = base64(HMAC-SHA1(auth
 * token, the full URL Twilio called + every POST parameter, sorted by name,
 * as name + value)). Checked in constant time.
 */
export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null, authToken: string): boolean {
  if (!signature) return false;
  return safeEqual(twilioSignature(url, params, authToken), signature);
}

/** An empty TwiML answer: we reply through the API (so every text is checked and recorded), never in the webhook's answer. */
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
