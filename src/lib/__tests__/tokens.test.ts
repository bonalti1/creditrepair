import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The colour tokens in src/app/globals.css, held to brand colors v2 (owner,
// 2026-11-21; docs/BRAND.md) and to WCAG 2.x contrast for every pair the UI
// actually draws. A future edit to the palette cannot silently break the brand
// or make text unreadable.

const css = readFileSync("src/app/globals.css", "utf8");

/** Every `--color-*` token in the @theme block, by name, lowercase hex. */
const TOKENS: Record<string, string> = Object.fromEntries(
  [...css.matchAll(/--color-([a-z]+-\d+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(([, name, hex]) => [name!, hex!.toLowerCase()]),
);

function token(name: string): string {
  const hex = TOKENS[name];
  if (!hex) throw new Error(`No --color-${name} in globals.css`);
  return hex;
}

/** Relative luminance (WCAG 2.x). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const WHITE = "#ffffff";
/** Normal text. */
const AA = 4.5;
/** Large or bold text (18.66px bold, 24px regular) and icons, rings, dots. */
const AA_LARGE = 3;

describe("colour tokens", () => {
  it("are built on brand colors v2", () => {
    // Brand navy: headings, links, active states (700) and dark surfaces and text on gold (900).
    expect(token("blue-700")).toBe("#12213a");
    expect(token("blue-900")).toBe("#12213a");
    // Brand navy-light: the top of the hero gradient, navy avatar circles, hover of navy buttons.
    expect(token("blue-800")).toBe("#2e3c52");
    // Brand gold: the primary button and accents.
    expect(token("amber-400")).toBe("#efb537");
    // Brand light: the page background.
    expect(token("slate-50")).toBe("#f5f6f8");
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--color-slate-50\)/);
  });

  it("keep each scale in one family: the navy tints get lighter from 600 to 50, the gold from 700 to 50", () => {
    const blues = [600, 500, 400, 300, 200, 100, 50].map((n) => luminance(token(`blue-${n}`)));
    expect(blues).toEqual([...blues].sort((a, b) => a - b));
    const golds = [700, 600, 500, 400, 300, 200, 100, 50].map((n) => luminance(token(`amber-${n}`)));
    expect(golds).toEqual([...golds].sort((a, b) => a - b));
    // Neutral navy, not purple-blue: blue stays a modest lead over red in every tint.
    for (const n of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      const hex = token(`blue-${n}`);
      const [r, , b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(b! - r!, `blue-${n}`).toBeGreaterThan(0);
      expect(b! - r!, `blue-${n}`).toBeLessThanOrEqual(48);
    }
  });

  // [foreground, background, minimum, where the UI uses it]
  const PAIRS: Array<[string, string, number, string]> = [
    ["blue-700", WHITE, AA, "navy headings and links on cards"],
    ["blue-700", "slate-50", AA, "navy headings and links on the page"],
    ["blue-700", "blue-50", AA, "selected rows and pills (text-blue-700 on bg-blue-50)"],
    ["blue-700", "blue-100", AA, "step pills on /empezar (text-blue-700 on bg-blue-100)"],
    ["blue-900", "amber-400", AA, "primary button: navy on gold"],
    ["blue-900", "amber-500", AA, "primary button, hovered"],
    ["blue-900", "amber-300", AA, "primary button on the hero, hovered"],
    ["blue-900", "amber-50", AA, "staff pills and notes on the light gold tint"],
    ["blue-900", "amber-100", AA, "Demo pill, waiting chips, draft banners"],
    [WHITE, "blue-900", AA, "white text on the navy hero"],
    [WHITE, "blue-700", AA, "white text on navy buttons and chat bubbles"],
    [WHITE, "blue-800", AA, "white text on navy-light (the hero's top, hovered navy buttons)"],
    [WHITE, "blue-500", AA_LARGE, "white icon on the blue-500 tile in Más"],
    ["blue-100", "blue-900", AA, "lead text on the hero"],
    ["blue-100", "blue-800", AA, "lead text at the top of the hero gradient"],
    ["blue-100", "blue-700", AA, "text on the navy summary card in /acuerdo"],
    ["blue-200", "blue-900", AA, "small print under the hero button"],
    ["blue-200", "blue-800", AA, "small print at the top of the hero gradient"],
    ["amber-400", "blue-900", AA, "gold headline accent on the navy hero"],
    ["amber-400", "blue-800", AA, "gold headline accent at the top of the hero gradient"],
    ["amber-300", "blue-700", AA, "gold label on the navy summary card in /acuerdo"],
    ["amber-700", WHITE, AA, "gold-toned text on white (status words, warnings)"],
    ["amber-700", "amber-50", AA, "status badges: text-amber-700 on bg-amber-50"],
    ["amber-700", "slate-50", AA, "gold-toned text on the page background"],
    ["amber-600", WHITE, AA_LARGE, "gold icons and dots on white"],
    ["blue-600", WHITE, AA_LARGE, "selected ring (ring-blue-600) on white"],
  ];

  it.each(PAIRS)("%s on %s reaches %s:1 (%s)", (fg, bg, min) => {
    const f = fg.startsWith("#") ? fg : token(fg);
    const b = bg.startsWith("#") ? bg : token(bg);
    expect(contrast(f, b)).toBeGreaterThanOrEqual(min);
  });

  it("never sets the brand gold as text on white: it is 1.85:1", () => {
    expect(contrast(token("amber-400"), WHITE)).toBeLessThan(2);
    // So no screen may use the light gold steps as text on a light surface.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(path);
        } else if (/\.tsx$/.test(entry.name)) {
          for (const line of readFileSync(path, "utf8").split("\n")) {
            // Gold text is allowed only on navy: the hero headlines' accent
            // (marketing), the label of the navy summary card in /acuerdo, and
            // labels marked data-on-navy (the navy status and result cards).
            if (/\btext-amber-(300|400|500)\b/.test(line) && !/headlineAccent|id="simple"|data-on-navy/.test(line)) {
              offenders.push(`${path}: ${line.trim()}`);
            }
          }
        }
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });
});
