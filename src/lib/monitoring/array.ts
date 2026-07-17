import type { MonitoringAdapter, SubscriptionStatus } from "./index";
import type { RawReport } from "../domain/parser";

// Array adapter SKELETON — Phase 0 gates this: the partner deal isn't signed
// and Array's actual payload shape is only available under NDA/sandbox access.
// The fetch plumbing and env wiring are real; the payload mapping throws until
// the sandbox contract is in hand. DO NOT guess field mappings — a wrong map
// silently produces wrong dispute letters.

async function arrayFetch(path: string): Promise<unknown> {
  const base = process.env.MONITORING_API_BASE_URL;
  const key = process.env.MONITORING_API_KEY;
  if (!base || !key) throw new Error("Array adapter: MONITORING_API_BASE_URL / MONITORING_API_KEY not set");

  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Array API ${res.status}: ${await res.text()}`);
  return res.json();
}

export const arrayAdapter: MonitoringAdapter = {
  key: "array",

  async fetchReport(externalAccountId: string): Promise<RawReport> {
    await arrayFetch(`/reports/tri-merge/${externalAccountId}`);
    // TODO(Phase 1, post-partner-signature): map Array's tri-merge payload to
    // RawReport { source, pulledAt, bureaus: { equifax|experian|transunion:
    // { tradelines, inquiries, publicRecords, personalInfo } } }.
    throw new Error(
      "Array adapter: payload mapping not implemented — requires sandbox access to Array's report schema (Phase 0 dependency #1).",
    );
  },

  async getSubscriptionStatus(externalAccountId: string): Promise<SubscriptionStatus> {
    try {
      const data = (await arrayFetch(`/accounts/${externalAccountId}`)) as { status?: string };
      if (data.status === "active") return "active";
      if (data.status === "past_due") return "past_due";
      if (data.status === "canceled") return "canceled";
      return "unknown";
    } catch {
      return "unknown";
    }
  },
};
