import { buildAttackPlan } from "../domain/attack";
import type { AttackPlan, ItemFlag, ReportItem } from "../domain/types";

// The customer's plan for this session, built one way for every screen that
// shows it (the chat, the letters page, the rounds page), so the letters they
// read, approve and later track are always the same letters.

export interface SessionPlan {
  /** Confirmed decisions about items on the current report. */
  attestedFlags: ItemFlag[];
  /** 1 when a personal-info item was confirmed (cleanup goes first), otherwise 2. */
  roundNumber: number;
  plan: AttackPlan;
}

export function sessionPlan(
  items: ReportItem[],
  flags: Readonly<Record<string, { state: string; reason?: string; attestedAt?: string } | undefined>>,
): SessionPlan {
  const attestedFlags: ItemFlag[] = [];
  for (const item of items) {
    const f = flags[item.fingerprint];
    // Only a decision the customer confirmed, with its timestamp, can reach a letter.
    if (f && f.state === "attested" && f.attestedAt) {
      attestedFlags.push({ fingerprint: item.fingerprint, reason: f.reason ?? "", attested: true, attestedAt: f.attestedAt });
    }
  }
  const confirmed = new Set(attestedFlags.map((f) => f.fingerprint));
  const hasPersonalInfo = items.some((i) => i.category === "personal_info" && confirmed.has(i.fingerprint));
  // Round 1 handles personal-info cleanup; with none confirmed, go straight to
  // the round-2 dispute plan so the round is not empty.
  const roundNumber = hasPersonalInfo ? 1 : 2;
  return { attestedFlags, roundNumber, plan: buildAttackPlan({ roundNumber, items, flags: attestedFlags, history: {} }) };
}
