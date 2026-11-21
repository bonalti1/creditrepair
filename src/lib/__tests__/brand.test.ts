import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_NAME, BRAND, BRAND_IMAGE_PATHS, COMPANY_NAME, TEAM_MASCOT_NAME } from "../brand";
import { inviteMessageEs } from "../sales/invite";
import { COACH_SYSTEM_PROMPT } from "../coach/systemPrompt";
import { AFFILIATE_DISCLOSURE } from "../monitoring/offer";
import { MARKETING } from "../i18n/marketing";

// The company was renamed from the name spelled out below (in two halves, so
// this file does not trip its own check) to Credalti.
const OLD_NAME = new RegExp(["credit", "capi"].join(""), "i");
// The capybara mascot that BONALTI replaced as the assistant, as a whole word
// (spelled in two halves for the same reason). "Capital One" does not match.
const OLD_MASCOT = new RegExp(`\\b${["Ca", "pi"].join("")}\\b`, "i");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(tsx?|css|svg|json|md)$/.test(name) ? [path] : [];
  });
}

/** Every file under a folder, tests included, by path relative to the repository. */
function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

describe("brand", () => {
  it("is Credalti, with BONALTI as the assistant and Alti for the team", () => {
    expect(BRAND.name).toBe("Credalti");
    expect(COMPANY_NAME).toBe("Credalti");
    // Compared without case: the owner may write the robot's name "Bonalti".
    expect(BRAND.assistant.toLowerCase()).toBe("bonalti");
    expect(ASSISTANT_NAME).toBe(BRAND.assistant);
    expect(TEAM_MASCOT_NAME).toBe(BRAND.teamMascot);
    expect(BRAND.teamMascot).toBe("Alti");
    // The two halves of the wordmark spell the name: "Cred" + "alti".
    expect(BRAND.wordmark).toEqual(["Cred", "alti"]);
    expect(BRAND.wordmark.join("")).toBe(BRAND.name);
  });

  it("no source file under src/ still carries the old name", () => {
    const files = sourceFiles("src");
    expect(files.length).toBeGreaterThan(80);
    const offenders = files.filter((file) => OLD_NAME.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no source file under src/ and no file under public/ still names the old mascot", () => {
    const offenders = sourceFiles("src").filter((file) => OLD_MASCOT.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    const publicFiles = allFiles("public");
    expect(publicFiles.length).toBeGreaterThan(0);
    expect(publicFiles.filter((file) => OLD_MASCOT.test(file.replace(/[^a-z0-9]+/gi, " ")))).toEqual([]);
  });

  it("points at character images that exist, in @1x and @2x", () => {
    // Four views of each character, each in two sizes.
    expect(BRAND_IMAGE_PATHS).toHaveLength(16);
    for (const path of BRAND_IMAGE_PATHS) {
      expect(path, path).toMatch(/^\/brand\/characters\/.+@[12]x\.webp$/);
      expect(existsSync(join("public", path)), path).toBe(true);
    }
    for (const set of [BRAND.assistantImages, BRAND.teamMascotImages]) {
      for (const image of Object.values(set)) {
        expect(image.width, image.src).toBeGreaterThan(0);
        expect(image.height, image.src).toBeGreaterThan(0);
        expect(image.src2x).toBe(image.src.replace("@1x", "@2x"));
      }
    }
    // The two roles never share art.
    expect(BRAND.assistantImages.front.src).not.toBe(BRAND.teamMascotImages.front.src);
  });

  it("describes the assistant as AI and the team character as people, never the reverse", () => {
    for (const locale of ["es", "en"] as const) {
      expect(BRAND.assistantAlt[locale]).toContain(BRAND.assistant);
      expect(BRAND.assistantAlt[locale]).toMatch(/inteligencia artificial|artificial intelligence/);
      expect(BRAND.teamMascotAlt[locale]).toContain(BRAND.teamMascot);
      expect(BRAND.teamMascotAlt[locale]).not.toMatch(/\bIA\b|\bAI\b|artificial/i);
    }
    // The team character never labels a message: the chat signs a teammate's
    // words with their own name (TeamMessage), and the console with theirs.
    expect(readFileSync("src/components/TeamMessage.tsx", "utf8")).not.toMatch(/Character|teamMascot/);
    const conversation = readFileSync("src/components/staff/Conversation.tsx", "utf8");
    expect(conversation).not.toMatch(/character="team"/);
  });

  it("the ad pipeline's end card and brand lock use the new name", () => {
    const assemble = readFileSync("content/pipeline/assemble.ts", "utf8");
    expect(assemble).toContain('Cred<span class="alti">alti</span>');
    for (const file of ["content/pipeline/assemble.ts", "content/brand/lock.json", "content/README.md", "content/ads/mecanico.json"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(OLD_NAME);
    }
  });

  it("customer-facing text reads the name from one place", () => {
    expect(inviteMessageEs({ name: "María" }, "https://x.test/onboarding")).toContain("para entrar a Credalti:");
    expect(COACH_SYSTEM_PROMPT).toContain(`Eres ${ASSISTANT_NAME}, el asistente de crédito con inteligencia artificial de Credalti`);
    expect(COACH_SYSTEM_PROMPT).toContain(`te llamas ${ASSISTANT_NAME} y SIEMPRE eres transparente en que eres una inteligencia artificial`);
    expect(AFFILIATE_DISCLOSURE.es).toContain("Credalti recibe una comisión");
    expect(MARKETING.es.landing.footer).toContain("Credalti");
    expect(MARKETING.en.landing.footer).toContain("Credalti");
    expect(readFileSync("src/components/Logo.tsx", "utf8")).toContain("BRAND.wordmark[0]");
    // The icon is the gauge only: no lettering to rename.
    expect(readFileSync("src/app/icon.svg", "utf8")).not.toMatch(/<text/);
  });
});
