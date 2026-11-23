import type { BillingCharge } from "./types";

// The chargeback rate processors watch: chargebacks received in a window,
// divided by the charges that took money in the same window. Card networks'
// monitoring programs and processors' own limits work on a figure like this
// (commonly cited around 0.9–1% before an account is put in a program or
// closed); the exact formula each uses (by count or by amount, by month of
// the charge or of the dispute) is UNVERIFIED and in docs/BILLING.md.

export interface ChargebackRate {
  chargebacks: number;
  charged: number;
  /** null when nothing was charged in the window. */
  rate: number | null;
}

/** Chargebacks received in the last `days` days ÷ charges that took money in the same days. By count. */
export function chargebackRate(charges: BillingCharge[], now: Date, days = 30): ChargebackRate {
  const from = now.getTime() - days * 24 * 60 * 60 * 1000;
  const inWindow = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= from && t <= now.getTime();
  };
  const charged = charges.filter((c) => inWindow(c.chargedAt)).length;
  const chargebacks = charges.filter((c) => c.chargeback && inWindow(c.chargeback.receivedAt)).length;
  return { chargebacks, charged, rate: charged === 0 ? null : chargebacks / charged };
}

/** The rate above which the console warns: below the ~1% processors commonly act on. */
export const CHARGEBACK_WARNING_RATE = 0.0075;
