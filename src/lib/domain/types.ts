// Core domain types for the dispute engine.
// Terminology mirrors the spec: the USER disputes; we provide the tool.

export type Bureau = "equifax" | "experian" | "transunion";

export type ItemCategory =
  | "tradeline"
  | "inquiry"
  | "public_record"
  | "personal_info";

/**
 * Escalation ladder per item, per spec §4.2:
 * FCRA §611 dispute → method of verification → furnisher-direct.
 */
export type EscalationStage = "dispute" | "mov" | "furnisher_direct";

export type ItemStatus = "active" | "deleted" | "changed";

export interface ReportItem {
  /** Stable dedupe key across pulls: category + bureau + normalized identity fields. */
  fingerprint: string;
  bureau: Bureau;
  category: ItemCategory;
  /** Display name: creditor, inquirer, court, or the personal-info variant itself. */
  name: string;
  /** Furnisher name/address when known — needed for furnisher-direct escalation. */
  furnisher?: { name: string; addressLines: string[] } | null;
  /** Structured fields as parsed from the monitoring partner report. */
  data: Record<string, unknown>;
  /** Heuristic: is this a negative/derogatory item worth surfacing in the item finder? */
  negative: boolean;
}

export interface NormalizedReport {
  pulledAt: string; // ISO timestamp
  source: string; // monitoring provider identifier
  items: ReportItem[];
}

export interface ItemFlag {
  fingerprint: string;
  reason: string;
  /** The accuracy attestation (Armor #2). A letter may NEVER include an un-attested item. */
  attested: boolean;
  attestedAt: string | null;
}

export type LetterTargetType = "bureau" | "secondary_bureau" | "furnisher";

export interface LetterTarget {
  type: LetterTargetType;
  /** Bureau key for primary bureaus, registry key for secondary bureaus, name for furnishers. */
  key: string;
  name: string;
  addressLines: string[];
}

export interface PlannedLetter {
  target: LetterTarget;
  category: ItemCategory;
  stage: EscalationStage | "personal_info_cleanup";
  templateKey: string;
  /** Fingerprints of the attested items included in this letter. */
  itemFingerprints: string[];
}

export interface AttackPlan {
  roundNumber: number;
  letters: PlannedLetter[];
}

export interface UserProfile {
  id: string;
  fullName: string;
  addressLines: string[];
  locale: "es" | "en";
  goal?: string | null;
}
