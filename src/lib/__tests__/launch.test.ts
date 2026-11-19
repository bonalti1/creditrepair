import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkMarketingCopy } from "@/lib/compliance/guardrails";
import { enclosurePagesHtml, isAttachableImage, letterHtml } from "@/lib/letters/enclosures";
import { FRESH_REPORT_DAYS, monitoringMessageEs, monitoringState } from "@/lib/monitoring/subscription";

const now = new Date("2026-11-19T12:00:00.000Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe("is the monitoring subscription active?", () => {
  it("is active on a report from the last 45 days", () => {
    expect(monitoringState({ subscriptionStatus: null, lastPulledAt: daysAgo(3), now })).toMatchObject({ active: true, reason: "fresh_report", reportAgeDays: 3 });
    expect(monitoringState({ subscriptionStatus: "active", lastPulledAt: daysAgo(FRESH_REPORT_DAYS), now }).active).toBe(true);
  });

  it("is not active with no report, or an old one, even if the record says active", () => {
    expect(monitoringState({ subscriptionStatus: "active", lastPulledAt: null, now })).toMatchObject({ active: false, reason: "no_report" });
    expect(monitoringState({ subscriptionStatus: "active", lastPulledAt: daysAgo(FRESH_REPORT_DAYS + 1), now })).toMatchObject({ active: false, reason: "stale_report" });
  });

  it("lets an explicit cancellation or missed payment override a fresh report", () => {
    expect(monitoringState({ subscriptionStatus: "canceled", lastPulledAt: daysAgo(1), now })).toMatchObject({ active: false, reason: "canceled" });
    expect(monitoringState({ subscriptionStatus: "past_due", lastPulledAt: daysAgo(1), now })).toMatchObject({ active: false, reason: "past_due" });
  });

  it("explains each case to the customer within the claim rules", () => {
    for (const reason of ["fresh_report", "no_report", "stale_report", "canceled", "past_due"] as const) {
      const message = monitoringMessageEs({ active: reason === "fresh_report", reason, reportAgeDays: 60 });
      expect(message.length).toBeGreaterThan(10);
      expect(checkMarketingCopy(message), reason).toEqual([]);
    }
  });
});

describe("enclosures", () => {
  it("attaches photos and leaves out what cannot be placed on a page", () => {
    expect(isAttachableImage("u1/government_id.jpg")).toBe(true);
    expect(isAttachableImage("u1/proof_of_address.PNG")).toBe(true);
    expect(isAttachableImage("u1/government_id.heic")).toBe(true);
    expect(isAttachableImage("u1/government_id.pdf")).toBe(false);
  });

  it("puts each enclosure on its own page after the letter", () => {
    const html = letterHtml({
      body: "Dear Equifax,\nA&B <b>bold</b>",
      fontFamily: "Courier New",
      sizePt: 11,
      enclosures: [
        { label: "Copy of government-issued photo ID", url: "https://files.example/a.jpg?token=1&x=2" },
        { label: "Proof of address", url: "https://files.example/b.jpg" },
      ],
    });
    expect(html.match(/page-break-before:always/g)).toHaveLength(2);
    expect(html.indexOf("Dear Equifax")).toBeLessThan(html.indexOf("Enclosure:"));
    expect(html).toContain("A&amp;B &lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain('src="https://files.example/a.jpg?token=1&amp;x=2"');
  });

  it("cannot be broken out of by a hostile link or font name", () => {
    const pages = enclosurePagesHtml([{ label: "ID", url: 'https://x/"><script>alert(1)</script>' }]);
    expect(pages).not.toContain("<script>");
    expect(letterHtml({ body: "x", fontFamily: "Arial';}</style><script>", sizePt: 11 })).not.toContain("<script>");
  });

  it("adds nothing when there are no enclosures", () => {
    expect(letterHtml({ body: "x", fontFamily: "Arial", sizePt: 11 })).not.toContain("Enclosure");
  });
});

describe("database setup file", () => {
  // supabase/setup.sql is every migration in order, for pasting into the
  // Supabase SQL editor in one go. It must never drift from the migrations.
  it("is exactly the migrations, in order", () => {
    const dir = "supabase/migrations";
    const expected = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => `-- ===== ${f} =====\n${readFileSync(`${dir}/${f}`, "utf8").trim()}\n`)
      .join("\n");
    expect(readFileSync("supabase/setup.sql", "utf8")).toBe(expected);
  });
});
