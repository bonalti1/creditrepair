import type { AgreementLocale } from "./documents";
import type { AgreementRecord } from "./gate";
import type { ResolvedTerms } from "./terms";

// One client's agreement as the app holds it: the gate's five timestamps plus
// the record of what was signed. The same shape comes from the database
// (service_agreements, migration 0010) and from the demo's local storage.

export interface AgreementState extends AgreementRecord {
  /** AGREEMENT_VERSION of the text that was acknowledged and signed. */
  version: string | null;
  /** The language the documents were shown in when signed. */
  locale: AgreementLocale | null;
  /** The full legal name the client typed as their signature. */
  signerName: string | null;
  /** SHA-256 of exactly what was on screen when signed (documents.ts). */
  documentHash: string | null;
  /** True when the cancellation happened inside the window. */
  cancelledWithinWindow: boolean | null;
  cancellationReason: string | null;
  serviceEndReason: string | null;
  /** The business terms as they were shown in the contract. */
  terms: ResolvedTerms | null;
}

export const EMPTY_AGREEMENT: AgreementState = {
  disclosureAcknowledgedAt: null,
  signedAt: null,
  cancellationDeadline: null,
  cancelledAt: null,
  serviceEndRequestedAt: null,
  version: null,
  locale: null,
  signerName: null,
  documentHash: null,
  cancelledWithinWindow: null,
  cancellationReason: null,
  serviceEndReason: null,
  terms: null,
};

const isoOrNull = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** A row of public.service_agreements as the app's record. */
export function agreementFromRow(row: Record<string, unknown>): AgreementState {
  return {
    disclosureAcknowledgedAt: isoOrNull(row.disclosure_acknowledged_at),
    signedAt: isoOrNull(row.signed_at),
    cancellationDeadline: isoOrNull(row.cancellation_deadline),
    cancelledAt: isoOrNull(row.cancelled_at),
    serviceEndRequestedAt: isoOrNull(row.service_end_requested_at),
    version: textOrNull(row.document_version),
    locale: row.locale === "es" || row.locale === "en" ? row.locale : row.disclosure_locale === "en" ? "en" : row.disclosure_locale === "es" ? "es" : null,
    signerName: textOrNull(row.signer_name),
    documentHash: textOrNull(row.document_hash),
    cancelledWithinWindow: typeof row.cancelled_within_window === "boolean" ? row.cancelled_within_window : null,
    cancellationReason: textOrNull(row.cancellation_reason),
    serviceEndReason: textOrNull(row.service_end_reason),
    terms: row.terms && typeof row.terms === "object" ? (row.terms as ResolvedTerms) : null,
  };
}

/**
 * A record read back from the browser's storage. Anything that is not a
 * record is dropped; a field of the wrong type becomes "not set".
 */
export function normalizeAgreement(raw: unknown): AgreementState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const state: AgreementState = {
    disclosureAcknowledgedAt: isoOrNull(v.disclosureAcknowledgedAt),
    signedAt: isoOrNull(v.signedAt),
    cancellationDeadline: isoOrNull(v.cancellationDeadline),
    cancelledAt: isoOrNull(v.cancelledAt),
    serviceEndRequestedAt: isoOrNull(v.serviceEndRequestedAt),
    version: textOrNull(v.version),
    locale: v.locale === "es" || v.locale === "en" ? v.locale : null,
    signerName: textOrNull(v.signerName),
    documentHash: textOrNull(v.documentHash),
    cancelledWithinWindow: typeof v.cancelledWithinWindow === "boolean" ? v.cancelledWithinWindow : null,
    cancellationReason: textOrNull(v.cancellationReason),
    serviceEndReason: textOrNull(v.serviceEndReason),
    terms: v.terms && typeof v.terms === "object" ? (v.terms as ResolvedTerms) : null,
  };
  // A signature without the acknowledgement that must come before it is not a record this app wrote.
  if (state.signedAt && !state.disclosureAcknowledgedAt) return null;
  return state.disclosureAcknowledgedAt ? state : null;
}
