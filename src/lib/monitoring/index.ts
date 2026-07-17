import type { RawReport } from "../domain/parser";

// Monitoring partner abstraction (spec §4.1 + open item #1). The rest of the
// system only ever sees RawReport; each candidate partner (Array, SmartCredit
// white-label, IdentityIQ affiliate) gets one adapter file that maps its wire
// format into it. Selected via MONITORING_PROVIDER env.

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "unknown";

export interface MonitoringAdapter {
  key: string;
  /** Pull the current tri-merge report for a user's monitoring account. */
  fetchReport(externalAccountId: string): Promise<RawReport>;
  /** Live subscription status — gates the attack builder (revenue engine). */
  getSubscriptionStatus(externalAccountId: string): Promise<SubscriptionStatus>;
}

import { demoAdapter } from "./demo";
import { arrayAdapter } from "./array";

const ADAPTERS: Record<string, MonitoringAdapter> = {
  demo: demoAdapter,
  array: arrayAdapter,
};

export function getMonitoringAdapter(): MonitoringAdapter {
  const key = process.env.MONITORING_PROVIDER || "demo";
  const adapter = ADAPTERS[key];
  if (!adapter) {
    throw new Error(
      `Unknown MONITORING_PROVIDER "${key}". Available: ${Object.keys(ADAPTERS).join(", ")}`,
    );
  }
  return adapter;
}
