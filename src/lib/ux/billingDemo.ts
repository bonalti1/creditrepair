import type { AgreementRecord } from "../agreement/gate";
import { nextRetryAt } from "../billing/dunning";
import { DEMO_TOKEN_DECLINED, DEMO_TOKEN_OK, parseDemoToken } from "../billing/gateway";
import { CHARGE_DELAY_DAYS } from "../billing/rules";
import type { BillableRound, BillingCharge } from "../billing/types";
import type { DemoBillingState, DemoMethod } from "./billingLocal";

// ─────────────────────────────────────────────────────────────────────────
// DEMO ONLY. Example situations for the "Mis pagos" screen.
//
// In the demo the team never mails a round for the person looking at the app,
// so there would be nothing to show. These are invented situations, each
// consistent with the billing rules (a charge exists only for a mailed round,
// dated the day after the mailing), counted back from "now". The screen labels
// them as examples. A signed-in client never sees any of this: their screen
// comes from the server.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const DEMO_SCENARIOS = ["live", "first_tomorrow", "paid_twice", "retrying", "paused"] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export const DEMO_SCENARIO_LABEL: Record<DemoScenario, { es: string; en: string }> = {
  live: { es: "Sin cartas enviadas", en: "No letters mailed" },
  first_tomorrow: { es: "Primer cobro mañana", en: "First charge tomorrow" },
  paid_twice: { es: "Dos rondas pagadas", en: "Two rounds paid" },
  retrying: { es: "Un cobro no pasó", en: "A charge did not go through" },
  paused: { es: "Caso en pausa", en: "Case paused" },
};

export function isDemoScenario(value: string): value is DemoScenario {
  return (DEMO_SCENARIOS as readonly string[]).includes(value);
}

/** The demo method a token stands for, as it would be on file. */
export function demoMethod(token: string, at: string, authorization: { version: string; hash: string }): DemoMethod | null {
  const bank = /^demo_bank_(checking|savings)_(\d{4})$/.exec(token);
  if (bank) {
    return { token, kind: "ach", brand: bank[1]!, last4: bank[2]!, addedAt: at, authorizationVersion: authorization.version, authorizedAt: at, authorizationHash: authorization.hash };
  }
  const parsed = parseDemoToken(token);
  if (!parsed) return null;
  return {
    token,
    brand: parsed.brand,
    last4: parsed.last4,
    addedAt: at,
    authorizationVersion: authorization.version,
    authorizedAt: at,
    authorizationHash: authorization.hash,
  };
}

const BUREAUS = ["Equifax", "Experian", "TransUnion"];

function round(number: number, mailedAt: string): BillableRound {
  return { number, mailed: true, mailedAt, letters: BUREAUS.map((recipient) => ({ recipient, returned: false })) };
}

function charge(roundNumber: number, mailedAt: string, amountCents: number): BillingCharge {
  const at = new Date(new Date(mailedAt).getTime() + CHARGE_DELAY_DAYS * DAY_MS).toISOString();
  return {
    id: demoChargeId(roundNumber, mailedAt),
    roundNumber,
    amountCents,
    status: "succeeded",
    workDate: mailedAt,
    createdAt: at,
    attempts: 1,
    lastAttemptAt: at,
    nextAttemptAt: null,
    chargedAt: at,
    failureCode: null,
    refund: null,
  };
}

/** An id for an invented charge: different for every round, so each receipt has its own number. */
export function demoChargeId(roundNumber: number, mailedAt: string): string {
  return `dm${roundNumber}${Math.floor(new Date(mailedAt).getTime() / 60000).toString(36)}`;
}

function declined(mailedAt: string, amountCents: number, attempts: number, lastAttemptAt: string): BillingCharge {
  return {
    ...charge(1, mailedAt, amountCents),
    status: "failed",
    attempts,
    lastAttemptAt,
    chargedAt: null,
    nextAttemptAt: nextRetryAt(attempts, new Date(lastAttemptAt))?.toISOString() ?? null,
    failureCode: "card_declined",
  };
}

/**
 * One example situation, built relative to `now`. `amountCents` is the plan
 * fee; 0 when no fee is configured, and then the screen prints no amount.
 * `authorization` is what the method on file would carry.
 */
export function demoScenarioState(
  scenario: DemoScenario,
  now: Date,
  amountCents: number,
  current: DemoBillingState,
  authorization: { version: string; hash: string },
): DemoBillingState {
  const ago = (days: number, hours = 1) => new Date(now.getTime() - days * DAY_MS - hours * HOUR_MS).toISOString();
  if (scenario === "live") return { scenario, method: current.method, agreement: null, rounds: [], charges: [] };

  // The example's own agreement: signed two months ago, long past its cancellation window.
  const signedAt = ago(62);
  const agreement: AgreementRecord = {
    disclosureAcknowledgedAt: ago(62, 2),
    signedAt,
    cancellationDeadline: ago(57),
    cancelledAt: null,
    serviceEndRequestedAt: null,
  };
  const good = demoMethod(DEMO_TOKEN_OK, ago(50), authorization);
  const bad = demoMethod(DEMO_TOKEN_DECLINED, ago(22), authorization);

  switch (scenario) {
    case "first_tomorrow":
      // Mailed an hour ago; nothing is charged until tomorrow.
      return { scenario, method: current.method ?? good, agreement, rounds: [round(1, ago(0))], charges: [] };
    case "paid_twice": {
      const first = ago(45);
      const second = ago(5);
      return {
        scenario,
        method: good,
        agreement,
        rounds: [round(1, first), round(2, second)],
        charges: [charge(1, first, amountCents), charge(2, second, amountCents)],
      };
    }
    case "retrying": {
      const mailed = ago(3);
      return { scenario, method: bad, agreement, rounds: [round(1, mailed)], charges: [declined(mailed, amountCents, 1, ago(2))] };
    }
    case "paused": {
      const mailed = ago(20);
      return { scenario, method: bad, agreement, rounds: [round(1, mailed)], charges: [declined(mailed, amountCents, 3, ago(12))] };
    }
  }
}
