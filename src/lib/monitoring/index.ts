import type { RawReport } from "../domain/parser";

// Monitoring partner abstraction (spec §4.1 + open item #1). The rest of the
// system only ever sees RawReport; each provider gets one adapter file that
// maps its wire format into it. Selected via MONITORING_PROVIDER env.
// The provider we are going with is IdentityIQ (see ./offer.ts, ./identityiq.ts).

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
import { identityIqAdapter } from "./identityiq";

const ADAPTERS: Record<string, MonitoringAdapter> = {
  demo: demoAdapter,
  // Chosen provider (2026-11-19). Report access pending IDIQ partner onboarding.
  identityiq: identityIqAdapter,
  // Kept as the white-label alternative should the IdentityIQ route not work out.
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
