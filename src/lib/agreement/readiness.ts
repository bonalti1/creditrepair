import { AGREEMENT_VERSION } from "./documents";
import { STATUTE_TEXTS } from "./statutes";
import { missingTerms, resolveTerms, TERM_ENV, type ResolvedTerms, type TermKey, type TermsSource } from "./terms";

// Can a real client sign today?
//
// Only when all three are true:
//   1. every business term is filled in (terms.ts), so the contract shows no
//      placeholder;
//   2. every passage copied from a statute has been compared word for word
//      with the official source and marked verified (statutes.ts); and
//   3. an attorney approved THIS version of the text, which the owner records
//      by setting NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION to the version string.
//      Any change to the text changes the version, so an approval never
//      carries over to text the attorney did not read.
//
// The demo (no database configured) is the one exception: there the agreement
// can be signed for demonstration, on this device only, under a banner that
// says it is a draft. With a real database and readiness false, signing is
// refused by the server (409) and the client is shown a calm waiting screen.
// Unreviewed contract text must never be signed by a real customer.

export type AgreementMode =
  /** Reviewed and complete: real clients can sign. */
  | "ready"
  /** Demo without a database: signing is a demonstration, marked as a draft. */
  | "demo_draft"
  /** A real database, but the text is not approved or the terms are incomplete: nobody can sign. */
  | "blocked";

export interface AgreementReadiness {
  /** True only when the terms are complete, the statutory text is verified and this version is approved. */
  ready: boolean;
  mode: AgreementMode;
  /** True when no database is configured. */
  demo: boolean;
  version: string;
  termsComplete: boolean;
  /** Required terms still unset, with the variable that sets each. */
  missing: Array<{ key: TermKey; env: string }>;
  /** Citations of statutory passages not yet compared with the official source. Empty when all are verified. */
  unverifiedStatutes: string[];
  /** True when the approved version recorded by the owner is this version. */
  approved: boolean;
  /** What the owner recorded, or null. */
  approvedVersion: string | null;
  /** Whether the signing screen may accept a signature at all (ready, or the demo). */
  canSign: boolean;
}

export interface ReadinessInput {
  terms?: ResolvedTerms;
  approvedVersion?: string | null;
  demo?: boolean;
  /** Defaults to what statutes.ts says today. */
  unverifiedStatutes?: string[];
}

/** Statutory passages in statutes.ts still marked as not verified. */
export function unverifiedStatuteCitations(): string[] {
  return Object.values(STATUTE_TEXTS)
    .filter((text) => !text.verified)
    .map((text) => text.citation);
}

// Static reads, so the browser bundle carries them.
const APPROVED_VERSION = process.env.NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION;
const HAS_DATABASE = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** The same demo test the rest of the app uses: no Supabase settings, no database. */
export function isDemoMode(): boolean {
  return !HAS_DATABASE;
}

export function agreementReadiness(input: ReadinessInput = {}): AgreementReadiness {
  const terms = input.terms ?? resolveTerms();
  const approvedVersion = (input.approvedVersion === undefined ? APPROVED_VERSION : input.approvedVersion)?.trim() || null;
  const demo = input.demo ?? isDemoMode();

  const missing = missingTerms(terms).map((key) => ({ key, env: TERM_ENV[key] }));
  const termsComplete = missing.length === 0;
  const approved = approvedVersion === AGREEMENT_VERSION;
  const unverifiedStatutes = input.unverifiedStatutes ?? unverifiedStatuteCitations();
  const ready = termsComplete && approved && unverifiedStatutes.length === 0;
  const mode: AgreementMode = ready ? "ready" : demo ? "demo_draft" : "blocked";

  return {
    ready,
    mode,
    demo,
    version: AGREEMENT_VERSION,
    termsComplete,
    missing,
    unverifiedStatutes,
    approved,
    approvedVersion,
    canSign: mode !== "blocked",
  };
}

/** For tests and scripts: readiness from explicit settings instead of the environment. */
export function readinessFrom(
  source: TermsSource,
  approvedVersion: string | null,
  demo: boolean,
  unverifiedStatutes?: string[],
): AgreementReadiness {
  return agreementReadiness({ terms: resolveTerms(source), approvedVersion, demo, unverifiedStatutes });
}
