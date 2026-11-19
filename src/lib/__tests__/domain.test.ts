import { describe, expect, it } from "vitest";
import { DEMO_RAW_REPORT } from "@/lib/demo";
import { buildAttackPlan, nextStageFor, ROUND_CYCLE_DAYS } from "@/lib/domain/attack";
import { PRIMARY_BUREAUS, SECONDARY_BUREAUS, UNVERIFIED_BUREAUS } from "@/lib/domain/bureaus";
import { diffReports, diffSummary } from "@/lib/domain/diff";
import { parseReport } from "@/lib/domain/parser";
import type { ItemFlag, ReportItem } from "@/lib/domain/types";

const report = parseReport(DEMO_RAW_REPORT);
const attest = (items: ReportItem[]): ItemFlag[] =>
  items.map((i) => ({ fingerprint: i.fingerprint, reason: "", attested: true, attestedAt: "2026-07-02T00:00:00.000Z" }));

describe("parseReport", () => {
  it("turns the provider payload into items for every bureau and category", () => {
    expect(report.items).toHaveLength(8);
    expect(report.scores).toEqual({ equifax: 561, experian: 574, transunion: 558 });
    const byCategory = (c: string) => report.items.filter((i) => i.category === c).length;
    expect(byCategory("tradeline")).toBe(3);
    expect(byCategory("inquiry")).toBe(2);
    expect(byCategory("personal_info")).toBe(3);
  });

  it("marks collections and hard inquiries negative, current accounts and personal info not", () => {
    const find = (name: string, bureau: string) => report.items.find((i) => i.name === name && i.bureau === bureau)!;
    expect(find("Midland Credit Management", "equifax").negative).toBe(true);
    expect(find("Capital One", "equifax").negative).toBe(false);
    expect(find("Auto Finance Corp", "equifax").negative).toBe(true);
    expect(report.items.filter((i) => i.category === "personal_info").every((i) => !i.negative)).toBe(true);
  });

  it("gives the same item the same fingerprint on every pull, and different bureaus different ones", () => {
    const again = parseReport(DEMO_RAW_REPORT);
    expect(again.items.map((i) => i.fingerprint)).toEqual(report.items.map((i) => i.fingerprint));
    expect(new Set(report.items.map((i) => i.fingerprint)).size).toBe(report.items.length);
  });

  it("accepts a report that covers fewer than three bureaus and fills optional fields", () => {
    const partial = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: { experian: { tradelines: [{ creditor: "Acme Bank" }] } },
    });
    expect(partial.items).toHaveLength(1);
    expect(partial.items[0]!.bureau).toBe("experian");
    expect(partial.items[0]!.data).toMatchObject({ accountNumberMasked: "", status: "", remarks: [] });
    expect(partial.scores).toEqual({});
  });

  it("rejects an unknown bureau", () => {
    expect(() => parseReport({ source: "x", pulledAt: "now", bureaus: { innovis: {} } })).toThrow();
  });

  it("rejects a payload that is not a report", () => {
    expect(() => parseReport({ source: "x" })).toThrow();
    expect(() => parseReport({ source: "x", pulledAt: "now", bureaus: { equifax: { score: 9000 } } })).toThrow();
  });
});

describe("diffReports", () => {
  const withoutCollection = parseReport({
    ...DEMO_RAW_REPORT,
    pulledAt: "2026-08-10T00:00:00.000Z",
    bureaus: {
      ...DEMO_RAW_REPORT.bureaus,
      equifax: {
        ...DEMO_RAW_REPORT.bureaus.equifax!,
        tradelines: [{ ...DEMO_RAW_REPORT.bureaus.equifax!.tradelines[0]!, balance: 120 }],
      },
    },
  });

  it("detects a deleted item and a changed balance between pulls", () => {
    const diff = diffReports(report, withoutCollection);
    expect(diff.deleted.map((i) => i.name)).toEqual(["Midland Credit Management"]);
    expect(diff.changed.map((i) => i.name)).toEqual(["Capital One"]);
    expect(diff.added).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(6);
  });

  it("summarises deleted and remaining negatives for the day-40 message", () => {
    const summary = diffSummary(diffReports(report, withoutCollection));
    expect(summary).toEqual({ deletedCount: 1, remainingNegative: 3 });
  });

  it("reports nothing when the report did not change", () => {
    const diff = diffReports(report, parseReport(DEMO_RAW_REPORT));
    expect(diff.deleted.length + diff.added.length + diff.changed.length).toBe(0);
  });
});

describe("buildAttackPlan — the attestation invariant", () => {
  const negatives = report.items.filter((i) => i.category !== "personal_info");
  const personal = report.items.filter((i) => i.category === "personal_info");

  it("sends nothing when the user has attested nothing", () => {
    for (const roundNumber of [1, 2, 3]) {
      expect(buildAttackPlan({ roundNumber, items: report.items, flags: [], history: {} }).letters).toHaveLength(0);
    }
  });

  it("never includes an item that is flagged but not attested", () => {
    const flags: ItemFlag[] = [
      { fingerprint: negatives[0]!.fingerprint, reason: "x", attested: false, attestedAt: null },
      // A ticked box with no timestamp is not a logged attestation.
      { fingerprint: negatives[1]!.fingerprint, reason: "x", attested: true, attestedAt: null },
      ...attest([negatives[2]!]),
    ];
    const plan = buildAttackPlan({ roundNumber: 2, items: report.items, flags, history: {} });
    const included = plan.letters.flatMap((l) => l.itemFingerprints);
    expect(included).toEqual([negatives[2]!.fingerprint]);
  });

  it("only ever lists fingerprints that were attested, in every round", () => {
    const flags = attest([negatives[0]!, personal[0]!]);
    const attested = new Set(flags.map((f) => f.fingerprint));
    for (const roundNumber of [1, 2, 3, 4]) {
      const plan = buildAttackPlan({ roundNumber, items: report.items, flags, history: {} });
      for (const fp of plan.letters.flatMap((l) => l.itemFingerprints)) expect(attested.has(fp)).toBe(true);
    }
  });

  it("ignores an attestation for an item that is no longer on the report", () => {
    const flags: ItemFlag[] = [{ fingerprint: "gone", reason: "", attested: true, attestedAt: "2026-07-02T00:00:00.000Z" }];
    const plan = buildAttackPlan({ roundNumber: 3, items: report.items, flags, history: {} });
    expect(plan.letters.flatMap((l) => l.itemFingerprints)).toHaveLength(0);
  });
});

describe("buildAttackPlan — rounds and escalation", () => {
  const negatives = report.items.filter((i) => i.category !== "personal_info");
  const personal = report.items.filter((i) => i.category === "personal_info");

  it("round 1 is personal-information cleanup only, one letter per bureau that has any", () => {
    const plan = buildAttackPlan({ roundNumber: 1, items: report.items, flags: attest(report.items), history: {} });
    expect(plan.letters.every((l) => l.templateKey === "personal_info_cleanup")).toBe(true);
    expect(plan.letters.map((l) => l.target.key).sort()).toEqual(["equifax", "experian"]);
    expect(plan.letters.flatMap((l) => l.itemFingerprints).sort()).toEqual(personal.map((i) => i.fingerprint).sort());
  });

  it("round 2 groups items by bureau and category and adds the secondary bureaus", () => {
    const plan = buildAttackPlan({ roundNumber: 2, items: report.items, flags: attest(negatives), history: {} });
    const primary = plan.letters.filter((l) => l.target.type === "bureau");
    expect(primary.map((l) => `${l.target.key}:${l.templateKey}`).sort()).toEqual([
      "equifax:dispute_611_accounts",
      "equifax:dispute_611_inquiries",
      "experian:dispute_611_accounts",
      "transunion:dispute_611_inquiries",
    ]);
    expect(plan.letters.filter((l) => l.target.type === "secondary_bureau")).toHaveLength(SECONDARY_BUREAUS.length);
  });

  it("does not repeat the secondary-bureau letters after round 2", () => {
    const plan = buildAttackPlan({ roundNumber: 3, items: report.items, flags: attest(negatives), history: {} });
    expect(plan.letters.some((l) => l.target.type === "secondary_bureau")).toBe(false);
  });

  it("climbs the ladder: dispute, then method of verification, then the furnisher", () => {
    expect(nextStageFor("a", {})).toBe("dispute");
    expect(nextStageFor("a", { a: "dispute" })).toBe("mov");
    expect(nextStageFor("a", { a: "mov" })).toBe("furnisher_direct");
    expect(nextStageFor("a", { a: "furnisher_direct" })).toBe("furnisher_direct");
  });

  it("sends a debt-validation letter to a collector and a furnisher dispute to an ordinary creditor", () => {
    const collection = report.items.find((i) => i.name === "Midland Credit Management" && i.bureau === "equifax")!;
    const card = report.items.find((i) => i.name === "Capital One")!;
    const plan = buildAttackPlan({
      roundNumber: 4,
      items: report.items,
      flags: attest([collection, card]),
      history: { [collection.fingerprint]: "mov", [card.fingerprint]: "mov" },
    });
    const byTarget = Object.fromEntries(plan.letters.map((l) => [l.target.name, l.templateKey]));
    expect(byTarget["Midland Credit Management"]).toBe("debt_validation");
    expect(byTarget["Capital One"]).toBe("furnisher_direct");
    expect(plan.letters.every((l) => l.target.type === "furnisher")).toBe(true);
  });

  it("keeps an item with no known furnisher at the bureau instead of dropping it", () => {
    const inquiry = report.items.find((i) => i.category === "inquiry")!;
    const plan = buildAttackPlan({
      roundNumber: 4,
      items: report.items,
      flags: attest([inquiry]),
      history: { [inquiry.fingerprint]: "mov" },
    });
    expect(plan.letters).toHaveLength(1);
    expect(plan.letters[0]!.target.type).toBe("bureau");
    expect(plan.letters[0]!.templateKey).toBe("mov_request");
  });

  it("uses a 40-day cycle", () => {
    expect(ROUND_CYCLE_DAYS).toBe(40);
  });
});

describe("bureau registry", () => {
  // The mail client splits "City, ST 12345" out of the last address line; an
  // address in any other shape would reach the mail provider with empty fields.
  const CITY_STATE_ZIP = /^(.*),\s*([A-Z]{2})\s+(\d{5}(-\d{4})?)$/;

  it("has a mailable two-line address for every bureau", () => {
    for (const target of [...Object.values(PRIMARY_BUREAUS), ...SECONDARY_BUREAUS]) {
      expect(target.addressLines, target.key).toHaveLength(2);
      expect(target.addressLines[1], target.key).toMatch(CITY_STATE_ZIP);
      expect(target.name.length, target.key).toBeGreaterThan(3);
    }
  });

  it("records when and against what every address was checked", () => {
    for (const target of [...Object.values(PRIMARY_BUREAUS), ...SECONDARY_BUREAUS]) {
      expect(target.verifiedOn, target.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(target.source, target.key).toMatch(/^https:\/\//);
    }
  });

  it("mails nothing to a company whose address could not be confirmed", () => {
    const mailable = new Set([...Object.values(PRIMARY_BUREAUS), ...SECONDARY_BUREAUS].map((t) => t.key));
    for (const pending of UNVERIFIED_BUREAUS) expect(mailable.has(pending.key), pending.key).toBe(false);
  });

  it("has unique keys", () => {
    const keys = [...Object.values(PRIMARY_BUREAUS), ...SECONDARY_BUREAUS].map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
