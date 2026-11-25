import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

// Web push for staff phone alerts (docs/CONTROL.md, "Phone alerts"). Server only.
//
// VAPID (RFC 8292): the server signs a short JWT (ES256) with its private key;
// the browser subscribed with the matching public key. Keys come from the
// environment; without them nothing is pushed and the alerts screen says so
// (the in-app list still works):
//
//   VAPID_PUBLIC_KEY   base64url, the 65-byte uncompressed P-256 point
//   VAPID_PRIVATE_KEY  base64url, the 32-byte private scalar
//   VAPID_SUBJECT      "mailto:owner@…" or an https URL (who to contact about the pushes)
//
// `npx tsx -e "import('./src/lib/push/webPush.ts').then(m => console.log(m.generateVapidKeys()))"` makes a pair.
//
// The push carries NO payload (a "tickle"): the phone wakes the service worker
// (public/staff-sw.js), which asks this app for the member's new alerts with
// their own session. So no message encryption is needed, and nothing about a
// lead or a client passes through the push service. Only the push services of
// the major browsers are accepted as endpoints, so a stored subscription can
// never make this server call an arbitrary address.

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const b64url = (buf: Buffer): string => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string): Buffer => Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** The VAPID keys from the environment, or null when any is missing or malformed. */
export function pushConfig(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey || !privateKey || !/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(subject)) return null;
  const pub = fromB64url(publicKey);
  const priv = fromB64url(privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return null;
  return { publicKey, privateKey, subject };
}

/** A new key pair, for the owner's setup. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { d: string };
  const pub = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  return { publicKey: b64url(Buffer.concat([Buffer.from([4]), fromB64url(pub.x), fromB64url(pub.y)])), privateKey: jwk.d };
}

/** The signed VAPID token for one push service (its origin), valid 12 hours. */
export function vapidJwt(audience: string, config: PushConfig, now: Date = new Date()): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: config.subject })));
  const pub = fromB64url(config.publicKey);
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: config.privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }, format: "jwk" });
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(signature)}`;
}

const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

/** Only a browser vendor's push service, over https. */
export function allowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

export interface PushOutcome {
  ok: boolean;
  status: number;
  /** The subscription is gone (404/410): stop using it. */
  gone: boolean;
}

/** Wake one subscribed browser. No payload. */
export async function sendTickle(endpoint: string, config: PushConfig, fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<PushOutcome> {
  if (!allowedEndpoint(endpoint)) return { ok: false, status: 0, gone: true };
  const url = new URL(endpoint);
  try {
    const res = await fetcher(endpoint, {
      method: "POST",
      headers: { TTL: "600", Urgency: "high", Authorization: `vapid t=${vapidJwt(`${url.protocol}//${url.host}`, config, now)}, k=${config.publicKey}`, "Content-Length": "0" },
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}
