import type { RoundRef } from "../staff/data";
import { sendableRound, sendBlockReason } from "../staff/stage";
import { fullName, type StaffClient } from "../staff/types";
import type { FurnisherEntry } from "./furnishers";
import { roundMailPlan, type MailClassChoices, type RoundMailPlan } from "./sendPlan";
import type { MailClass } from "./types";

// The send screen's batch: the rounds a link names, split into those that go
// out now and those held back (with why), and what the ones that go will
// cost. The screen lays this out; the send itself (StaffData.markRoundsSent)
// applies the same rules again.

export interface HeldRound {
  ref: RoundRef;
  clientName: string | null;
  reason: string;
  /** The plan, when the round is prepared and held only by its letters (an address missing). */
  plan: RoundMailPlan | null;
  /** True when the round already went out (a link opened again after sending). */
  alreadySent?: boolean;
}

export interface SendBatch {
  ready: RoundMailPlan[];
  held: HeldRound[];
  letters: number;
  /** Letters per class, over the rounds that go. */
  byClass: Record<MailClass, number>;
  totalMills: number;
  /** Address checks before mailing, over the rounds that go (sendPlan.ts: verifications), and their most cost. */
  verifications: number;
  verificationMills: number;
}

export function buildSendBatch(
  clients: StaffClient[],
  refs: RoundRef[],
  now: Date,
  furnishers: readonly FurnisherEntry[],
  choices?: MailClassChoices,
): SendBatch {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const ready: RoundMailPlan[] = [];
  const held: HeldRound[] = [];
  for (const ref of refs) {
    const client = byId.get(ref.clientId);
    if (!client) {
      held.push({ ref, clientName: null, reason: "No encontramos a este cliente.", plan: null });
      continue;
    }
    const round = client.rounds.find((r) => r.number === ref.roundNumber);
    if (!round || round.status !== "ready") {
      const reason = !round
        ? `No tiene una ronda ${ref.roundNumber}.`
        : round.status === "draft"
          ? "La ronda todavía está en preparación."
          : "Esta ronda ya se envió.";
      held.push({ ref, clientName: fullName(client), reason, plan: null, alreadySent: Boolean(round && round.status !== "draft") });
      continue;
    }
    const plan = roundMailPlan(client, round, furnishers, now, choices);
    if (sendableRound(client, now, { furnishers })?.number !== round.number || plan.blockers.length > 0) {
      const reason = sendBlockReason(client, now, { furnishers }) ?? plan.blockers.join(" ") ?? "La ronda todavía no se puede enviar.";
      held.push({ ref, clientName: fullName(client), reason: reason || "La ronda todavía no se puede enviar.", plan });
      continue;
    }
    ready.push(plan);
  }
  const byClass: Record<MailClass, number> = { first_class: 0, certified: 0, certified_return_receipt: 0 };
  for (const plan of ready) for (const letter of plan.letters) byClass[letter.mailClass] += 1;
  return {
    ready,
    held,
    letters: ready.reduce((n, p) => n + p.letters.length, 0),
    byClass,
    totalMills: ready.reduce((n, p) => n + p.totalMills, 0),
    verifications: ready.reduce((n, p) => n + p.verifications, 0),
    verificationMills: ready.reduce((n, p) => n + p.verificationMills, 0),
  };
}
