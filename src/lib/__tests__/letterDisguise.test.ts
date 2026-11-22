import { describe, expect, it } from "vitest";
import { DEFAULT_LETTER_FONT, fontRotationEnabled, pickFont } from "../letters/fonts";
import { rewordingEnabled, varyLetterWording } from "../letters/variation";

// Font rotation and AI rewording were built to keep letters from looking like a
// template. Under full service that could read as hiding who prepared them, so
// both stay off until the attorney clears them.
describe("letters look the way they were reviewed, until the attorney says otherwise", () => {
  it("uses one plain print font by default", () => {
    expect(fontRotationEnabled({})).toBe(false);
    expect(DEFAULT_LETTER_FONT.kind).toBe("print");
    const fonts = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => pickFont(id, {}).family));
    expect(fonts).toEqual(new Set([DEFAULT_LETTER_FONT.family]));
  });

  it("rotates only when LETTER_FONT_ROTATION=1", () => {
    const env = { LETTER_FONT_ROTATION: "1" };
    const fonts = new Set(Array.from({ length: 40 }, (_, i) => pickFont(`letter-${i}`, env).family));
    expect(fonts.size).toBeGreaterThan(1);
  });

  it("does not reword letters by default", async () => {
    expect(rewordingEnabled({})).toBe(false);
    expect(rewordingEnabled({ LETTER_AI_REWORDING: "1" })).toBe(true);
    const body = "I am writing to dispute the following item.";
    expect(await varyLetterWording(body)).toBe(body);
  });
});
