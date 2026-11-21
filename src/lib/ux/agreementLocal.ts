import { normalizeAgreement, type AgreementState } from "../agreement/record";

// The agreement as this device remembers it. In the demo (signed out) this is
// the only copy. Signed in, the server's record is the truth and is mirrored
// here, so every screen can read where the agreement stands without waiting
// for the network (see agreementStore.ts).
//
// Plain functions, no React: the journey engine reads from here too.

export const AGREEMENT_STORAGE_KEY = "bonalti.agreement.v1";

/** The stored agreement, or null: on the server, in a test, or when nothing is stored. */
export function readStoredAgreement(): AgreementState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AGREEMENT_STORAGE_KEY);
    return raw ? normalizeAgreement(JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeStoredAgreement(agreement: AgreementState | null): void {
  try {
    if (agreement) window.localStorage.setItem(AGREEMENT_STORAGE_KEY, JSON.stringify(agreement));
    else window.localStorage.removeItem(AGREEMENT_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode): the record stays in memory for this visit.
  }
}
