import { createHmac } from "crypto";
import { safeEqual } from "../security/signatures";

// The unsubscribe link in every webinar reminder email (CAN-SPAM). A
// registrant may have no account, so the link carries the REGISTRATION's id,
// signed with UNSUBSCRIBE_SECRET (the same secret as the clients' link,
// autopilot/unsubscribe.ts). One tap on /webinar/baja records it on the
// registration and as an opt-out of the number (message_opt_outs), like a
// WhatsApp "BAJA": no automatic message of any kind goes to that number after.

const PREFIX = "credalti-webinar-unsubscribe:v1:";

export function webinarUnsubscribeToken(registrationId: string, secret: string): string {
  return createHmac("sha256", secret).update(PREFIX + registrationId, "utf8").digest("base64url").slice(0, 32);
}

export function verifyWebinarUnsubscribe(registrationId: string, token: string, secret: string | undefined): boolean {
  if (!secret || !/^[0-9a-f-]{36}$/i.test(registrationId) || typeof token !== "string") return false;
  return safeEqual(token, webinarUnsubscribeToken(registrationId, secret));
}

export function webinarUnsubscribeUrl(registrationId: string, env: Record<string, string | undefined> = process.env, locale?: "es" | "en"): string | null {
  const base = env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const secret = env.UNSUBSCRIBE_SECRET;
  if (!base || !secret) return null;
  return `${base}/webinar/baja?r=${encodeURIComponent(registrationId)}&t=${webinarUnsubscribeToken(registrationId, secret)}${locale ? `&lang=${locale}` : ""}`;
}
