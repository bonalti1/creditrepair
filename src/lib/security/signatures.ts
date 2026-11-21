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

// ── Lob ────────────────────────────────────────────────────────────────
//
// Lob signs each webhook delivery with the webhook's own secret (shown on the
// webhook's page in the Lob dashboard). Two headers:
//   Lob-Signature-Timestamp: when Lob sent it
//   Lob-Signature: hex HMAC-SHA256, keyed with the secret, of
//                  `${timestamp}.${raw body}`
// VERIFIED (Lob's "Using webhooks" help page, as quoted in search results;
// the page itself could not be opened from the build environment): the two
// header names, HMAC-SHA256, and the signed input being the timestamp, a dot
// and the body.
// UNVERIFIED: the timestamp's unit. The HMAC is computed over the header
// exactly as received, so the unit only matters for the replay window:
// lobTimestampMs reads seconds, milliseconds or an ISO date. Confirm with a
// real delivery from the dashboard's "send test event".

/** A delivery older or newer than this is refused as a replay. 5 minutes is the tolerance usually suggested for Lob; our choice. */
export const LOB_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export type LobSignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** The timestamp header as milliseconds: Unix seconds, Unix milliseconds or an ISO date. NaN when unreadable. */
export function lobTimestampMs(header: string): number {
  const value = header.trim();
  if (/^\d{1,16}$/.test(value)) {
    const n = Number(value);
    // Before 2001 in milliseconds is not a date Lob sends; read short numbers as seconds.
    return value.length >= 12 ? n : n * 1000;
  }
  return value ? Date.parse(value) : Number.NaN;
}

export function signLobPayload(rawBody: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/**
 * Checks a Lob delivery: both headers present, a timestamp inside the replay
 * window, and a signature that matches the exact bytes received. The
 * comparison is constant-time. Check before parsing the body.
 */
export function verifyLobSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  now?: Date;
  toleranceMs?: number;
}): LobSignatureCheck {
  const { rawBody, signature, timestamp, secret } = input;
  if (!signature || !timestamp || !secret) return { ok: false, reason: "missing" };
  const presented = signature.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(presented)) return { ok: false, reason: "malformed" };
  const sentAt = lobTimestampMs(timestamp);
  if (Number.isNaN(sentAt)) return { ok: false, reason: "malformed" };
  const now = (input.now ?? new Date()).getTime();
  if (Math.abs(now - sentAt) > (input.toleranceMs ?? LOB_SIGNATURE_TOLERANCE_MS)) return { ok: false, reason: "stale" };
  const expected = signLobPayload(rawBody, timestamp.trim(), secret);
  return safeEqual(presented, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
}
