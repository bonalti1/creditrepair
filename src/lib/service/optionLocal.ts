import { readStoredAgreement } from "../ux/agreementLocal";
import { effectiveOption, optionOfTerms, parseServiceOption, type ServiceOption } from "./options";

// The client's option as this device remembers it. In the demo (signed out)
// this is the only copy; signed in, the server's record is the truth
// (GET /api/service-option) and is mirrored here so every screen and the
// journey engine can read it without waiting for the network.
//
// Plain functions, no React.

export const OPTION_STORAGE_KEY = "credalti.serviceOption.v1";
/** A choice made before sign-in (an invitation link, the website): sent to the account once, by OnboardingSync. */
export const OPTION_PENDING_KEY = "credalti.serviceOption.pending";
/** Set when a DIY client was shown an upgrade offer, by moment key, so each moment offers it at most once. */
export const UPGRADE_SHOWN_KEY = "credalti.upgradeOffered.v1";

export interface StoredOption {
  chosen: ServiceOption | null;
  /** The option of the signed agreement in force, as last seen. */
  signed: ServiceOption | null;
}

export function readStoredOption(): StoredOption {
  if (typeof window === "undefined") return { chosen: null, signed: null };
  let chosen: ServiceOption | null = null;
  let signed: ServiceOption | null = null;
  try {
    const raw = window.localStorage.getItem(OPTION_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { chosen?: unknown; signed?: unknown }) : null;
    chosen = parseServiceOption(parsed?.chosen);
    signed = parseServiceOption(parsed?.signed);
  } catch {
    // unreadable: nothing chosen
  }
  // The demo's signed agreement says which option it was signed for.
  const agreement = readStoredAgreement();
  if (agreement?.signedAt && !agreement.cancelledAt) signed = optionOfTerms(agreement.terms);
  return { chosen, signed };
}

/** The option that applies on this device: the signed agreement's, else the chosen one, else Complete. */
export function readEffectiveOption(): ServiceOption {
  const stored = readStoredOption();
  return effectiveOption({ signedOption: stored.signed, chosenOption: stored.chosen });
}

export function writeStoredOption(next: StoredOption): void {
  try {
    window.localStorage.setItem(OPTION_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("credalti:service-option"));
  } catch {
    // storage unavailable: lasts for this visit only
  }
}

/** True the first time a moment is asked about on this device; false after. */
export function firstTimeFor(moment: string): boolean {
  try {
    const raw = window.localStorage.getItem(UPGRADE_SHOWN_KEY);
    const seen = raw ? (JSON.parse(raw) as string[]) : [];
    if (seen.includes(moment)) return false;
    window.localStorage.setItem(UPGRADE_SHOWN_KEY, JSON.stringify([...seen, moment].slice(-50)));
    return true;
  } catch {
    return false;
  }
}
