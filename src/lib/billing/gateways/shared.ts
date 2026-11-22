import { sha256Hex } from "../../agreement/sha256";
import { centsToDecimal } from "../money";

// Small helpers the processor adapters share. Web Crypto only (no node:
// imports), so the modules that name the adapters can still be bundled for
// the browser; the adapters themselves only ever run on the server, where the
// secret keys are.

export type Fetch = typeof fetch;

export const amount = (cents: number): string => centsToDecimal(cents);

/** A short, stable reference for a processor field with a length limit, from our idempotency key. */
export function shortKey(key: string, length = 20): string {
  return sha256Hex(key).slice(0, length);
}

function bytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** HMAC of a message, as lowercase hex. */
export async function hmacHex(hash: "SHA-256" | "SHA-512", key: Uint8Array<ArrayBuffer> | string, message: string): Promise<string> {
  const raw = typeof key === "string" ? bytes(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, bytes(message)));
  return [...signature].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two hex strings in time that does not depend on where they differ. */
export function sameHex(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** "411111******1111" / "XXXX1111" / "****6789" → "1111". */
export function last4Of(masked: string | null | undefined): string | null {
  const digits = (masked ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** "Visa" / "visa" / "MasterCard" → "visa" / "mastercard", within the column's pattern. */
export function brandOf(value: string | null | undefined): string {
  const clean = (value ?? "").toLowerCase().replace(/[^a-z0-9_ ]/g, "").trim().slice(0, 30);
  return clean.length >= 2 ? clean : "card";
}

export async function withTimeout(fetchImpl: Fetch, url: string, init: RequestInit, ms = 20_000): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });
}
