import { buildAttackPlan, type ItemHistory } from "../domain/attack";
import type { AttackPlan, EscalationStage, ItemFlag, ReportItem } from "../domain/types";
import type { DisputeReasonCode } from "../letters/reasons";
import { itemReasonsFrom } from "../ux/disputeReason";
import { dataChecks, letterFacts } from "../domain/checks";

// The next round of letters, worked out from database rows. Pure: the same
// rows give the same plan wherever it runs, so the staff console's "ready"
// round (staff/fromRows.ts) and the send itself (rounds/send.ts) always agree
// about which letters a round holds, while the send rebuilds it on the server
// from its own reads and never takes a plan from the browser.
//
// Only items the client confirmed as inaccurate, with the attestation logged,
// can enter a letter: buildAttackPlan enforces it, and the send checks it
// again against the plan's contents.

type Row = Record<string, unknown>;

/** Letter statuses that mean the letter left (or was handed to the mail service). */
export const SENT_LETTER_STATUSES = ["queued", "mailed", "delivered"] as const;
/** Round statuses that mean the round was mailed. */
export const MAILED_ROUND_STATUSES = ["mailed", "complete"] as const;

const STAGE_RANK: Record<EscalationStage, number> = { dispute: 1, mov: 2, furnisher_direct: 3 };

/** One letter of a round, the same whatever attempt wrote it: recipient and template. */
export function letterKey(targetType: string, targetKey: string, templateKey: string): string {
  return `${targetType}|${targetKey}|${templateKey}`;
}

/** A report_items row as the engine's item. */
export function itemFromRow(row: Row): ReportItem {
  return {
    fingerprint: String(row.fingerprint),
    bureau: row.bureau as ReportItem["bureau"],
    category: row.category as ReportItem["category"],
    name: String(row.name ?? ""),
    furnisher: (row.furnisher as ReportItem["furnisher"]) ?? null,
    data: (row.data as Record<string, unknown>) ?? {},
    negative: Boolean(row.negative),
  };
}

/**
 * The confirmed answers as the engine reads them: an item_flags row counts
 * only when it is attested, with its time and the attestation text on record.
 * Also the reason code of each one, for the letter lines.
 */
export function attestedFlagsFromRows(
  flagRows: readonly Row[],
  itemIdToFp: ReadonlyMap<string, string>,
): { flags: ItemFlag[]; itemReasons: Record<string, DisputeReasonCode> } {
  const flags: ItemFlag[] = [];
  const reasons: Record<string, { reasonCode: string | null }> = {};
  for (const f of flagRows) {
    const fp = itemIdToFp.get(String(f.item_id));
    if (!fp) continue;
    const attested = f.attested === true && typeof f.attested_at === "string" && Boolean(f.attestation_text);
    flags.push({ fingerprint: fp, reason: String(f.reason ?? ""), attested, attestedAt: attested ? (f.attested_at as string) : null });
    if (attested) reasons[fp] = { reasonCode: (f.reason_code as string | null) ?? null };
  }
  return { flags, itemReasons: itemReasonsFrom(reasons) };
}

/**
 * The report facts each confirmed item's letter line carries
 * (LetterContext.itemDetails): only the data checks the client chose to
 * include (item_flags.check_ids, migration 0021) that are still on the report
 * and relate to the reason the client picked. Recomputed here from the
 * report's own rows; nothing written by a browser is printed.
 * `reportDate` is the report's date (report_pulls.pulled_at).
 */
export function itemDetailsFromRows(
  items: readonly ReportItem[],
  flagRows: readonly Row[],
  itemIdToFp: ReadonlyMap<string, string>,
  reportDate: string,
): Record<string, string> {
  const answers: Record<string, { state: string; reasonCode: string | null; attestedAt: string | null; checkIds: string[] }> = {};
  for (const f of flagRows) {
    const fp = itemIdToFp.get(String(f.item_id));
    if (!fp) continue;
    const attested = f.attested === true && typeof f.attested_at === "string" && Boolean(f.attestation_text);
    if (!attested) continue;
    answers[fp] = {
      state: "attested",
      reasonCode: (f.reason_code as string | null) ?? null,
      attestedAt: f.attested_at as string,
      checkIds: Array.isArray(f.check_ids) ? (f.check_ids as unknown[]).filter((id): id is string => typeof id === "string") : [],
    };
  }
  return letterFacts(dataChecks(items, reportDate), answers);
}

/**
 * The highest stage already mailed per item, from earlier rounds' letters.
 * Letters of `excludeRoundId` (the round being sent, on a retry) do not count:
 * they must not push their own items up the ladder.
 */
export function historyFromRows(
  letterRows: readonly Row[],
  letterItemRows: readonly Row[],
  itemIdToFp: ReadonlyMap<string, string>,
  excludeRoundId: string | null = null,
): ItemHistory {
  const sent = new Set(
    letterRows
      .filter((l) => (SENT_LETTER_STATUSES as readonly string[]).includes(String(l.status)) && (excludeRoundId === null || l.round_id !== excludeRoundId))
      .map((l) => String(l.id)),
  );
  const history: ItemHistory = {};
  for (const li of letterItemRows) {
    if (!sent.has(String(li.letter_id))) continue;
    const fp = itemIdToFp.get(String(li.item_id));
    const stage = li.escalation_stage as EscalationStage;
    if (!fp || !(stage in STAGE_RANK)) continue;
    if (!history[fp] || STAGE_RANK[stage] > STAGE_RANK[history[fp]!]) history[fp] = stage;
  }
  return history;
}

/**
 * The number of the round that comes next, or null while the newest mailed
 * round still waits for the bureaus' answers.
 *
 * The first round is round 1 (personal-information corrections) when the
 * client confirmed one, otherwise round 2: the same rule the client app shows
 * (ux/sessionPlan.ts), so the client and the team call it by one number. After
 * that, one more than the newest mailed round, once that round is answered
 * (status "complete": a newer report came in).
 */
export function nextRoundNumber(
  roundRows: ReadonlyArray<{ round_number: unknown; status: unknown }>,
  hasConfirmedPersonalInfo: boolean,
): number | null {
  const mailed = roundRows.filter((r) => (MAILED_ROUND_STATUSES as readonly string[]).includes(String(r.status)));
  if (mailed.length === 0) return hasConfirmedPersonalInfo ? 1 : 2;
  const newest = mailed.reduce((a, b) => (Number(b.round_number) > Number(a.round_number) ? b : a));
  return newest.status === "complete" ? Number(newest.round_number) + 1 : null;
}

export interface RoundPlanInput {
  itemRows: readonly Row[];
  flagRows: readonly Row[];
  roundRows: readonly Row[];
  letterRows: readonly Row[];
  letterItemRows: readonly Row[];
  /** The report's date (report_pulls.pulled_at), for the data checks. Without it the plan carries no report facts. */
  reportDate?: string | null;
}

export interface NextRoundPlan {
  roundNumber: number;
  /** The attack_rounds row already made for it (a draft, or a send that stopped part way); null when none. */
  roundId: string | null;
  plan: AttackPlan;
  items: ReportItem[];
  itemReasons: Record<string, DisputeReasonCode>;
  /** The report facts the client chose to include, by fingerprint (itemDetailsFromRows). */
  itemDetails: Record<string, string>;
  /** Fingerprints the client confirmed, with the attestation on record. */
  attested: Set<string>;
}

/**
 * The next round from the client's rows: its number, its letters and the
 * items they cover. Null when no round comes next yet. Active report items only.
 */
export function planNextRound(input: RoundPlanInput): NextRoundPlan | null {
  const active = input.itemRows.filter((r) => r.status === undefined || r.status === "active");
  const itemIdToFp = new Map(active.map((r) => [String(r.id), String(r.fingerprint)]));
  const items = active.map(itemFromRow);
  const { flags, itemReasons } = attestedFlagsFromRows(input.flagRows, itemIdToFp);
  const attested = new Set(flags.filter((f) => f.attested && f.attestedAt).map((f) => f.fingerprint));
  const hasPersonalInfo = items.some((i) => i.category === "personal_info" && attested.has(i.fingerprint));
  const roundNumber = nextRoundNumber(input.roundRows as Array<{ round_number: unknown; status: unknown }>, hasPersonalInfo);
  if (roundNumber === null) return null;
  const existing = input.roundRows.find((r) => Number(r.round_number) === roundNumber && r.status === "draft");
  const roundId = existing ? String(existing.id) : null;
  const history = historyFromRows(input.letterRows, input.letterItemRows, itemIdToFp, roundId);
  const plan = buildAttackPlan({ roundNumber, items, flags, history });
  const itemDetails = input.reportDate ? itemDetailsFromRows(items, input.flagRows, itemIdToFp, input.reportDate) : {};
  return { roundNumber, roundId, plan, items, itemReasons, itemDetails, attested };
}
