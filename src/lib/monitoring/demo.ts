import type { MonitoringAdapter } from "./index";
import { DEMO_RAW_REPORT } from "../demo";

// Demo adapter: returns the fixture report stamped with the current time.
// Lets the entire pipeline (pull → import → diff → round loop) run end-to-end
// with zero external dependencies.

export const demoAdapter: MonitoringAdapter = {
  key: "demo",
  async fetchReport() {
    return { ...DEMO_RAW_REPORT, pulledAt: new Date().toISOString() };
  },
  async getSubscriptionStatus() {
    return "active";
  },
};
