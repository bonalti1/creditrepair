import { createHmac, timingSafeEqual } from "crypto";

// Shared-secret and webhook-signature checks. Comparisons are constant-time so
// response timing does not leak how much of a secret was guessed.

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** True when the request carries the expected shared secret in `header`. */
export function hasSharedSecret(req: Request, secret: string | undefined, header = "x-webhook-secret"): boolean {
  if (!secret) return false;
  const presented = req.headers.get(header);
  return presented !== null && safeEqual(presented, secret);
}

/**
 * Meta signs every webhook delivery: `X-Hub-Signature-256: sha256=<hex HMAC of
 * the raw body, keyed with the app secret>`. The signature must be checked
 * against the exact bytes received, before JSON parsing.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(signatureHeader.toLowerCase(), expected);
}

export function signMetaPayload(rawBody: string, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
}
