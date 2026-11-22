import { buildAttackPlan } from "../domain/attack";
import { dataChecks, letterFacts } from "../domain/checks";
import type { AttackPlan, ItemFlag, PlannedLetter, ReportItem } from "../domain/types";
import type { DisputeReasonCode } from "../letters/reasons";
import { isDisputeReasonCode } from "./disputeReason";

// The customer's plan for this session, built one way for every screen that
// shows it (the chat, the letters page, the rounds page), so the letters they
// read, approve and later track are always the same letters.

export interface SessionPlan {
  /** Confirmed decisions about items on the current report. */
  attestedFlags: ItemFlag[];
  /** 1 when a personal-info item was confirmed (cleanup goes first), otherwise 2. */
  roundNumber: number;
  plan: AttackPlan;
  /** Confirmed items that are inside this round's letters. */
  inRound: ReportItem[];
  /**
   * Confirmed items that are NOT in this round's letters. Round 1 mails only
   * personal-information corrections, so a confirmed account, inquiry or public
   * record waits here for the next round. Empty when the first round is round 2.
   */
  waiting: ReportItem[];
  /**
   * The standard reason the customer gave for each confirmed item, by
   * fingerprint: what the letters print after the item. An item confirmed
   * before reasons existed has no entry and is listed with no reason.
   */
  itemReasons: Record<string, DisputeReasonCode>;
  /**
   * The facts from the report each confirmed item's letter line carries: only
   * those the customer chose to include, for the reason they picked
   * (domain/checks.ts: letterFacts). Empty without the report's date.
   */
  itemDetails: Record<string, string>;
}

/** The report items one letter covers, in report order. A file request covers none. */
export function letterItems(letter: PlannedLetter, items: ReportItem[]): ReportItem[] {
  const covered = new Set(letter.itemFingerprints);
  return items.filter((i) => covered.has(i.fingerprint));
}

export function sessionPlan(
  items: ReportItem[],
  flags: Readonly<Record<string, { state: string; reason?: string; reasonCode?: string; attestedAt?: string; checkIds?: string[] } | undefined>>,
  /** The report's date (NormalizedReport.pulledAt): the data checks are measured against it. */
  reportDate?: string,
): SessionPlan {
  const attestedFlags: ItemFlag[] = [];
  const itemReasons: Record<string, DisputeReasonCode> = {};
  for (const item of items) {
    const f = flags[item.fingerprint];
    // Only a decision the customer confirmed, with its timestamp, can reach a letter.
    if (f && f.state === "attested" && f.attestedAt) {
      attestedFlags.push({ fingerprint: item.fingerprint, reason: f.reason ?? "", attested: true, attestedAt: f.attestedAt });
      if (isDisputeReasonCode(f.reasonCode)) itemReasons[item.fingerprint] = f.reasonCode;
    }
  }
  const confirmed = new Set(attestedFlags.map((f) => f.fingerprint));
  const hasPersonalInfo = items.some((i) => i.category === "personal_info" && confirmed.has(i.fingerprint));
  // Round 1 handles personal-info cleanup; with none confirmed, go straight to
  // the round-2 dispute plan so the round is not empty.
  const roundNumber = hasPersonalInfo ? 1 : 2;
  const plan = buildAttackPlan({ roundNumber, items, flags: attestedFlags, history: {} });
  // Split what the customer confirmed by where it is: in these letters, or not yet.
  const mailed = new Set(plan.letters.flatMap((l) => l.itemFingerprints));
  const confirmedItems = items.filter((i) => confirmed.has(i.fingerprint));
  return {
    attestedFlags,
    roundNumber,
    plan,
    inRound: confirmedItems.filter((i) => mailed.has(i.fingerprint)),
    waiting: confirmedItems.filter((i) => !mailed.has(i.fingerprint)),
    itemReasons,
    itemDetails: reportDate ? letterFacts(dataChecks(items, reportDate), flags) : {},
  };
}
