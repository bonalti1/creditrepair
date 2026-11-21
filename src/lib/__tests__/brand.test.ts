import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_NAME, BRAND, COMPANY_NAME } from "../brand";
import { inviteMessageEs } from "../sales/invite";
import { COACH_SYSTEM_PROMPT } from "../coach/systemPrompt";
import { AFFILIATE_DISCLOSURE } from "../monitoring/offer";
import { MARKETING } from "../i18n/marketing";

// The company was renamed from the name spelled out below (in two halves, so
// this file does not trip its own check) to Credalti.
const OLD_NAME = new RegExp(["credit", "capi"].join(""), "i");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(tsx?|css|svg|json|md)$/.test(name) ? [path] : [];
  });
}

describe("brand", () => {
  it("is Credalti, with Capi as the assistant", () => {
    expect(BRAND.name).toBe("Credalti");
    expect(COMPANY_NAME).toBe("Credalti");
    expect(BRAND.assistant).toBe("Capi");
    expect(ASSISTANT_NAME).toBe("Capi");
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

  it("the ad pipeline's end card and brand lock use the new name", () => {
    const assemble = readFileSync("content/pipeline/assemble.ts", "utf8");
    expect(assemble).toContain('Cred<span class="alti">alti</span>');
    for (const file of ["content/pipeline/assemble.ts", "content/brand/lock.json", "content/README.md", "content/ads/mecanico.json"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(OLD_NAME);
    }
  });

  it("customer-facing text reads the name from one place", () => {
    expect(inviteMessageEs({ name: "María" }, "https://x.test/onboarding")).toContain("para entrar a Credalti:");
    expect(COACH_SYSTEM_PROMPT).toContain("Eres Capi, el asistente de crédito con inteligencia artificial de Credalti");
    expect(AFFILIATE_DISCLOSURE.es).toContain("Credalti recibe una comisión");
    expect(MARKETING.es.landing.footer).toContain("Credalti");
    expect(MARKETING.en.landing.footer).toContain("Credalti");
    expect(readFileSync("src/components/Logo.tsx", "utf8")).toContain("BRAND.wordmark[0]");
    // The icon is the gauge only: no lettering to rename.
    expect(readFileSync("src/app/icon.svg", "utf8")).not.toMatch(/<text/);
  });
});
