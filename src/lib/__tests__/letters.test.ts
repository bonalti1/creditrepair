import { describe, expect, it } from "vitest";
import { ASSISTANT_NAME, BRAND } from "@/lib/brand";
import { DEMO_RAW_REPORT } from "@/lib/demo";
import { PRIMARY_BUREAUS } from "@/lib/domain/bureaus";
import { parseReport } from "@/lib/domain/parser";
import type { UserProfile } from "@/lib/domain/types";
import { escapeHtml } from "@/lib/letters/html";
import { renderLetter, TEMPLATES, type LetterContext } from "@/lib/letters/templates";
import { variationProblems } from "@/lib/letters/variation";

// Names that never appear in a consumer's letter: the old company name, the
// assistant, the internal project name and this company.
const NOT_IN_A_LETTER = new RegExp(`\\bCreditCapi\\b|\\b${ASSISTANT_NAME}\\b|${BRAND.internalName}|\\b${BRAND.name}\\b|on behalf of`, "i");

const report = parseReport(DEMO_RAW_REPORT);
const user: UserProfile = {
  id: "u1",
  fullName: "María Fernanda López",
  addressLines: ["456 Calle Real", "Houston, TX 77002"],
  locale: "es",
};
const ctx: LetterContext = {
  user,
  target: PRIMARY_BUREAUS.equifax,
  items: report.items.filter((i) => i.bureau === "equifax" && i.category === "tradeline"),
  date: "2026-07-02T12:00:00.000Z",
  roundNumber: 2,
  enclosures: ["Copy of government-issued photo ID"],
};

describe("letter templates", () => {
  it.each(Object.keys(TEMPLATES))("%s renders a complete first-person letter", (key) => {
    const letter = renderLetter(key, ctx);
    expect(letter).toContain(user.fullName);
    expect(letter).toContain("456 Calle Real");
    expect(letter).toContain(PRIMARY_BUREAUS.equifax.name);
    expect(letter).toContain("July 2, 2026");
    expect(letter).toContain("Sincerely,");
    expect(letter).toContain("- Copy of government-issued photo ID");
    // No unfilled merge fields and no company speaking for the consumer.
    expect(letter).not.toMatch(/\{\{|\}\}|undefined|\[object/);
    expect(letter).not.toMatch(NOT_IN_A_LETTER);
  });

  it("lists exactly the items it was given", () => {
    const letter = renderLetter("dispute_611_accounts", ctx);
    expect(letter).toContain("- Capital One (****1234 · open)");
    expect(letter).toContain("- Midland Credit Management (****8821 · collection)");
    expect(letter.split("\n").filter((l) => l.startsWith("- ") && !l.includes("Copy of"))).toHaveLength(2);
  });

  it("refuses an unknown template", () => {
    expect(() => renderLetter("nope", ctx)).toThrow(/Unknown letter template/);
  });
});

describe("variationProblems — the AI may only reword prose", () => {
  const original = renderLetter("dispute_611_accounts", ctx);
  const prose = "I am exercising my right";

  it("accepts a rewrite that changes prose only", () => {
    expect(original).toContain(prose);
    const varied = original.replace(prose, "I am writing to exercise my right");
    expect(variationProblems(original, varied)).toEqual([]);
  });

  it("rejects a rewrite that drops, adds or edits an item", () => {
    expect(variationProblems(original, original.replace("- Capital One (****1234 · open)\n", ""))).toContain("item lines changed");
    expect(variationProblems(original, original.replace("****8821", "****8822"))).toContain("item lines changed");
    const added = original.replace("- Capital One", "- Chase Bank (****0000)\n- Capital One");
    expect(variationProblems(original, added)).toContain("item lines changed");
  });

  it("rejects a rewrite that changes who it is from or to", () => {
    expect(variationProblems(original, original.replace("P.O. Box 740256", "P.O. Box 1"))).toContain("header block changed");
    expect(variationProblems(original, original.replace(/Sincerely,\n\nMaría Fernanda López/, "Sincerely,\n\nM. Lopez"))).toContain(
      "signature block changed",
    );
  });

  it("rejects a rewrite that loses a legal citation or most of the letter", () => {
    expect(variationProblems(original, original.replace("15 U.S.C. § 1681i", "federal law")).join(" ")).toMatch(/citation missing/);
    expect(variationProblems(original, original.slice(0, Math.floor(original.length / 3)))).toContain("length changed too much");
  });
});

describe("escapeHtml", () => {
  it("neutralises markup in creditor names and user-typed text", () => {
    expect(escapeHtml(`A&B <script>alert("x")</script> O'Neil`)).toBe(
      "A&amp;B &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; O&#39;Neil",
    );
  });
});
