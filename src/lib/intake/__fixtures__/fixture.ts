import type { RawReport } from "../../domain/parser";

// FICTIONAL. The demo report dated on a fixed day, so the fixture files never
// change and the tests can pin "now" right after it.

export const FIXTURE_REPORT_DATE = "2026-11-20";

export function fixtureRawReport(demo: RawReport): RawReport {
  return { ...structuredClone(demo), source: "fixture", pulledAt: `${FIXTURE_REPORT_DATE}T12:00:00.000Z` };
}
