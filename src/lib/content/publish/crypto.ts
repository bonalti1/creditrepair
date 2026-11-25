import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Tokens at rest: AES-256-GCM with a key from the environment
// (CONTENT_TOKEN_KEY: 32 bytes, base64 or hex). The repository had no
// encryption helper before this; it is kept here, small, for the content
// connections only. A stored value is "v1.<iv>.<tag>.<ciphertext>" (base64url):
// the version lets the key be rotated later. Tokens are decrypted only on the
// server, for one provider call, and never returned to a browser.
//
// The same key signs the OAuth "state" (HMAC-SHA256), binding a connection
// attempt to the administrator who started it, the provider and a time limit.

export function tokenKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.CONTENT_TOKEN_KEY?.trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

const b64u = (buf: Buffer) => buf.toString("base64url");

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${b64u(iv)}.${b64u(cipher.getAuthTag())}.${b64u(data)}`;
}

/** The token, or null when the value was not made with this key or was changed. */
export function decryptToken(stored: string, key: Buffer): string | null {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1]!, "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export interface OAuthState {
  provider: string;
  userId: string;
  nonce: string;
  /** Epoch ms. */
  expires: number;
}

export function signState(state: OAuthState, key: Buffer): string {
  const body = b64u(Buffer.from(JSON.stringify(state)));
  const sig = b64u(createHmac("sha256", key).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(value: string, key: Buffer, now: number = Date.now()): OAuthState | null {
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (typeof state.expires !== "number" || state.expires < now) return null;
    return state;
  } catch {
    return null;
  }
}

export function newNonce(): string {
  return b64u(randomBytes(18));
}
