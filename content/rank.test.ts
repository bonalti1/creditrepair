import { describe, expect, it } from "vitest";
import { checkSpot, hookVariants, loadHooks, loadLock, loadSpot, type Hook } from "./pipeline/spot";
import { nextBatch, rankAds, type AdResult } from "./pipeline/rank";

const ad = (name: string, spend: number, impressions: number, views3s: number, leads: number): AdResult => ({
  ad: name, spend, impressions, views3s, leads,
});

describe("opening hooks", () => {
  const lock = loadLock();
  const spot = loadSpot("mecanico");
  const hooks = loadHooks("mecanico");

  it("has ten for the mechanic ad, each passing the claim rules", () => {
    expect(hooks).toHaveLength(10);
    expect(new Set(hooks.map((h) => h.id)).size).toBe(10);
    for (const variant of hookVariants(spot, hooks)) expect(checkSpot(variant, lock), variant.id).toEqual([]);
  });

  it("refuses a hook that promises an outcome, or one too long to read", () => {
    const bad: Hook = { id: "x1", html: "Sube tu puntaje <b>en 30 días</b>" };
    expect(checkSpot({ ...spot, hook: bad }, lock).map((p) => p.where)).toContain("hook x1");
    const long: Hook = { id: "x2", html: "Esta es una frase de apertura demasiado larga para leerse en tres segundos" };
    expect(checkSpot({ ...spot, hook: long }, lock).some((p) => p.problem.includes("60 characters"))).toBe(true);
  });
});

describe("ranking ad results", () => {
  const results = [
    ad("h01", 60, 9000, 3600, 12), // $5.00 per lead: the leader
    ad("h02", 60, 9000, 3300, 11), // $5.45: within 20% of the leader
    ad("h03", 60, 9000, 3000, 8),  // $7.50: middle
    ad("h04", 60, 9000, 2500, 5),  // $12.00: far above typical
    ad("h05", 60, 9000, 2800, 0),  // spent 2x a typical lead with nothing
    ad("h06", 6, 700, 300, 1),     // barely run
  ];
  const ranked = rankAds(results);
  const verdict = (name: string) => ranked.find((r) => r.ad === name)!.verdict;

  it("scales the leaders, stops the clear losers and waits on thin data", () => {
    expect(verdict("h01")).toBe("scale");
    expect(verdict("h02")).toBe("scale");
    expect(verdict("h03")).toBe("keep");
    expect(verdict("h04")).toBe("stop");
    expect(verdict("h05")).toBe("stop");
    expect(verdict("h06")).toBe("wait");
  });

  it("lists leaders first and gives a reason for every verdict", () => {
    expect(ranked.slice(0, 2).map((r) => r.ad)).toEqual(["h01", "h02"]);
    expect(ranked.every((r) => r.reason.length > 10)).toBe(true);
  });

  it("does not crown a winner from one lucky lead", () => {
    const early = rankAds([ad("a", 25, 2500, 900, 1), ad("b", 25, 2500, 1000, 0), ad("c", 25, 2500, 950, 0)]);
    expect(early.every((r) => r.verdict === "keep")).toBe(true);
  });

  it("falls back to the opening when leads are too few to compare", () => {
    const early = rankAds([ad("a", 25, 3000, 1200, 1), ad("b", 25, 3000, 1100, 0), ad("c", 25, 3000, 300, 0)]);
    expect(early.find((r) => r.ad === "c")!.verdict).toBe("stop");
  });

  it("says what to make next", () => {
    expect(nextBatch(ranked)[0]).toBe("Scale: h01, h02.");
    expect(nextBatch(rankAds([ad("a", 1, 100, 30, 0)]))[0]).toMatch(/No leader yet/);
  });
});
