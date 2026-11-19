import type { MonitoringAdapter, SubscriptionStatus } from "./index";
import type { RawReport } from "../domain/parser";

// IdentityIQ (IDIQ) adapter. Chosen provider as of 2026-11-19.
//
// What is real: the provider is selected with MONITORING_PROVIDER=identityiq
// and the rest of the pipeline (import, diff, rounds) is provider-agnostic.
//
// What is NOT here yet, on purpose: the calls that fetch a customer's report
// and the mapping from IdentityIQ's report format into RawReport. IDIQ gives
// report access to partners under agreement and does not publish the format.
// Guessing either would produce wrong items in dispute letters without any
// error, so both stay unimplemented until one of these is in hand:
//   1. IDIQ partner API documentation and test credentials, or
//   2. a real IdentityIQ 3-bureau report export to build and test a parser on.
// See docs/IDENTITYIQ.md for the questions to put to IDIQ.

const NOT_READY =
  "IdentityIQ adapter: report access is not implemented. It needs IDIQ partner API documentation, or a sample report export to build a parser against (see docs/IDENTITYIQ.md).";

export const identityIqAdapter: MonitoringAdapter = {
  key: "identityiq",

  async fetchReport(): Promise<RawReport> {
    throw new Error(NOT_READY);
  },

  // With no status call available, the subscription state is left as it is in
  // our database. How "active" is established (a partner status call, or a
  // fresh report as proof) is an open question in docs/IDENTITYIQ.md.
  async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    return "unknown";
  },
};
