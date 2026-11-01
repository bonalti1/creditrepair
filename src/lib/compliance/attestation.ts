// Armor #2 (spec §3): per-item accuracy attestation. Logged with timestamp.
// This exact text is what the user checks; it is stored verbatim alongside the
// timestamp so the record shows what was attested, not just that a box was ticked.

export const ATTESTATION_TEXT = {
  es: "Creo que este elemento es inexacto, no verificable o está desactualizado.",
  en: "I believe this item is inaccurate, unverifiable, or outdated.",
} as const;

export const ATTESTATION_VERSION = "v1";

export interface AttestationRecord {
  fingerprint: string;
  text: string;
  version: string;
  attestedAt: string;
}

export function buildAttestationRecord(fingerprint: string, locale: "es" | "en"): AttestationRecord {
  return {
    fingerprint,
    text: ATTESTATION_TEXT[locale],
    version: ATTESTATION_VERSION,
    attestedAt: new Date().toISOString(),
  };
}
