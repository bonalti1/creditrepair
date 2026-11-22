import { createHmac } from "crypto";
import { safeEqual } from "../security/signatures";

// The unsubscribe link in every automatic email (CAN-SPAM): one click, no
// sign-in, recorded in message_opt_outs like a WhatsApp "BAJA". The link
// carries the client's id and a signature made with UNSUBSCRIBE_SECRET, so
// nobody can unsubscribe someone else by guessing an id.

const PREFIX = "credalti-unsubscribe:v1:";

export function unsubscribeToken(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(PREFIX + userId, "utf8").digest("base64url").slice(0, 32);
}

export function verifyUnsubscribeToken(userId: string, token: string, secret: string | undefined): boolean {
  if (!secret || !/^[0-9a-f-]{36}$/i.test(userId) || typeof token !== "string") return false;
  return safeEqual(token, unsubscribeToken(userId, secret));
}

/** The full link, or null when the app's address or the secret is not configured. */
export function unsubscribeUrl(userId: string, env: Record<string, string | undefined> = process.env): string | null {
  const base = env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const secret = env.UNSUBSCRIBE_SECRET;
  if (!base || !secret) return null;
  return `${base}/baja?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId, secret)}`;
}
