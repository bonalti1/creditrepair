import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_RAW_REPORT } from "../demo";
import { parseReport } from "../domain/parser";
import { extractReport } from "../intake/report/extract";
import { FIXTURE_REPORT_DATE, fixtureRawReport } from "../intake/__fixtures__/fixture";

// OPT-IN, LIVE: calls the real Claude API with the FICTIONAL fixture report.
// Skipped unless ANTHROPIC_API_KEY is set; it costs a few cents per run.
//
//   ANTHROPIC_API_KEY=… npx vitest run src/lib/__tests__/intake.live.test.ts

const live = Boolean(process.env.ANTHROPIC_API_KEY);
const NOW = new Date(`${FIXTURE_REPORT_DATE}T18:00:00.000Z`);
const expected = parseReport(fixtureRawReport(DEMO_RAW_REPORT));

describe.skipIf(!live)("intake, live: the fixture report read by Claude", () => {
  for (const [name, file] of [
    ["PDF", "src/lib/intake/__fixtures__/demo-monitoring-report.pdf"],
    ["saved page", "src/lib/intake/__fixtures__/demo-monitoring-report.html"],
  ] as const) {
    it(`reads the ${name}: same items as the report, no SSN, a citation on every item`, { timeout: 300_000 }, async () => {
      const result = await extractReport({ bytes: new Uint8Array(readFileSync(file)), fileName: file.split("/").pop()!, now: NOW });
      expect(result.simulated).toBe(false);
      expect(result.problem).toBeNull();
      expect(result.validation.fatal).toEqual([]);
      expect(result.validation.discard).toBe(false);
      const got = parseReport(result.validation.raw).items.map((i) => i.fingerprint).sort();
      expect(got).toEqual(expected.items.map((i) => i.fingerprint).sort());
      expect(result.validation.items.every((i) => i.citation !== null)).toBe(true);
      expect(JSON.stringify(result.envelope)).not.toMatch(/XXX-XX-1234|01\/15\/1985|1985-01-15/);
      console.info(`${name}: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, ~US$${result.costUsd}`);
    });
  }
});
