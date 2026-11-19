import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkMarketingCopy } from "../src/lib/compliance/guardrails";
import { buildPrompts, checkSpot, estimateCredits, listSpots, loadLock, timelineSeconds, type Spot } from "./pipeline/spot";

const lock = loadLock();
const spots = listSpots();

describe("ad spots", () => {
  it("has at least one spot", () => {
    expect(spots.length).toBeGreaterThan(0);
  });

  it.each(spots.map((s) => [s.id, s] as const))("%s passes the claim check and is internally consistent", (_id, spot) => {
    expect(checkSpot(spot, lock)).toEqual([]);
  });

  it("the mechanic spot is the 15-second cut that shipped", () => {
    const spot = spots.find((s) => s.id === "mecanico")!;
    expect(timelineSeconds(spot, lock)).toBeCloseTo(15, 5);
    expect(estimateCredits(spot, lock)).toBeCloseTo(51, 5);
  });

  it("writes the locked character into every generation request", () => {
    const spot = spots.find((s) => s.id === "mecanico")!;
    for (const request of buildPrompts(spot, lock)) {
      expect(request.still.prompt).toContain(lock.character.wardrobe);
      expect(request.still.reference.higgsfieldJobId).toMatch(/^[0-9a-f-]{36}$/);
      expect(request.video.prompt).toContain(lock.voice.direction);
      expect(request.video.prompt).toContain("No subtitles");
    }
  });
});

describe("ad text around the video", () => {
  const ads = JSON.parse(readFileSync("content/ads/mecanico.json", "utf8")) as {
    primaryText: string[]; headline: string[]; description: string[];
  };

  it("passes the claim rules, line by line", () => {
    for (const line of [...ads.primaryText, ...ads.headline, ...ads.description]) {
      expect(checkMarketingCopy(line), line).toEqual([]);
    }
  });

  it("fits Meta's display lengths", () => {
    for (const line of ads.headline) expect(line.length, line).toBeLessThanOrEqual(40);
    for (const line of ads.description) expect(line.length, line).toBeLessThanOrEqual(50);
    for (const line of ads.primaryText) expect(line.length, line).toBeLessThanOrEqual(220);
  });
});

describe("the gate refuses a script that could not ship", () => {
  const base = spots.find((s) => s.id === "mecanico")!;
  const withLine = (text: string): Spot => ({
    ...base,
    lines: [base.lines[0]!, { speaker: "capi", text }],
    captions: [],
    shots: base.shots.map((s) => (s.id === "close" ? { ...s, action: [`He says: "${text}"`] } : s)),
  });

  it("rejects the original punchline", () => {
    const problems = checkSpot(
      withLine("Lo que yo te voy a arreglar... es tu crédito. Para que vayas por el carro que siempre quisiste."),
      lock,
    );
    expect(problems.map((p) => p.problem).join(" ")).toMatch(/diy-positioning/);
    expect(problems.map((p) => p.problem).join(" ")).toMatch(/no-outcome-promise/);
  });

  it("rejects captions that say something the actors do not", () => {
    const spot: Spot = { ...base, captions: [...base.captions.slice(0, -1), { html: "y sube tu puntaje.", from: 10.38, to: 11.55 }] };
    expect(checkSpot(spot, lock).map((p) => p.where)).toContain("captions");
  });

  it("rejects a spoken line that no shot directs", () => {
    const spot: Spot = { ...base, lines: [...base.lines, { speaker: "capi", text: "Nos vemos pronto." }], captions: [] };
    expect(checkSpot(spot, lock).some((p) => p.problem.includes("not found verbatim"))).toBe(true);
  });
});
