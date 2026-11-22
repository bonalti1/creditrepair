import type { BureauLetterSummary, IntakeKind, IntakeRecord, IntakeStatus } from "./types";

// intake_documents rows (migration 0016) → IntakeRecord. Pure: used by the
// staff console's mapping (staff/fromRows.ts) and the client routes.

type Row = Record<string, unknown>;

const KINDS: readonly IntakeKind[] = ["credit_report", "government_id", "proof_of_address", "bureau_letter"];
const STATUSES: readonly IntakeStatus[] = ["accepted", "needs_person", "read", "failed"];

/** One intake_documents row as the console and the client app read it. Never the report reading itself. */
export function intakeRecordFromRow(row: Row): IntakeRecord | null {
  const kind = String(row.kind) as IntakeKind;
  const status = String(row.status) as IntakeStatus;
  if (!KINDS.includes(kind) || !STATUSES.includes(status)) return null;
  const result = (row.result ?? null) as { letter?: BureauLetterSummary | null } | null;
  return {
    id: String(row.id),
    kind,
    at: new Date(String(row.created_at)).toISOString(),
    status,
    simulated: row.simulated === true,
    reasons: Array.isArray(row.reasons) ? (row.reasons as unknown[]).map(String) : [],
    ...(kind === "bureau_letter" ? { letter: result?.letter ?? null } : {}),
    costUsd: Number(row.cost_usd ?? 0),
  };
}

