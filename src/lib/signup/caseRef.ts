// The case reference of a chat signup (/registro): "CR-7KQ4M". Shown to the
// person from the first screen and stored with the signup
// (signup_cases.case_ref, migration 0032), so anyone on the team can find it
// when the person quotes it on WhatsApp or on a call.
//
// Five characters from an alphabet with no look-alikes: no 0/O, no 1/I/L,
// no U/V (read aloud or typed from a phone, they get mixed up). 29^5 is about
// 20 million references; the server retries on the rare collision.

export const CASE_REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTWXYZ";
export const CASE_REF_LENGTH = 5;
export const CASE_REF_PREFIX = "CR-";

const PATTERN = new RegExp(`^${CASE_REF_PREFIX}[${CASE_REF_ALPHABET}]{${CASE_REF_LENGTH}}$`);

/** A fresh reference. `random` gives bytes (crypto by default; tests pass their own). */
export function newCaseRef(random: (n: number) => Uint8Array = randomBytes): string {
  let out = "";
  // Rejection sampling keeps every character equally likely (256 is not a multiple of 29).
  const limit = 256 - (256 % CASE_REF_ALPHABET.length);
  while (out.length < CASE_REF_LENGTH) {
    for (const byte of random(CASE_REF_LENGTH * 2)) {
      if (byte >= limit) continue;
      out += CASE_REF_ALPHABET[byte % CASE_REF_ALPHABET.length];
      if (out.length === CASE_REF_LENGTH) break;
    }
  }
  return `${CASE_REF_PREFIX}${out}`;
}

/** True for a well-formed reference. */
export function isCaseRef(value: unknown): value is string {
  return typeof value === "string" && PATTERN.test(value);
}

/**
 * What someone typed or read out ("cr 7kq4m", "CR-7KQ4M ", "7kq4m") as the
 * reference, or null. Look-alikes are read as the character they stand for
 * (O → 0 is not in the alphabet, so an "O" is refused rather than guessed).
 */
export function normalizeCaseRef(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  const bare = compact.length === CASE_REF_LENGTH + 2 && compact.startsWith("CR") ? compact.slice(2) : compact;
  const ref = `${CASE_REF_PREFIX}${bare}`;
  return isCaseRef(ref) ? ref : null;
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** A resume token for the device (hex, 32 bytes). Only its SHA-256 is stored. */
export function newResumeToken(random: (n: number) => Uint8Array = randomBytes): string {
  return Array.from(random(32), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isResumeToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
