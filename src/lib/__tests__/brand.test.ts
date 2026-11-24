import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../app/manifest";
import {
  APP_ICONS,
  ASSISTANT_NAME,
  BRAND,
  BRAND_IMAGE_PATHS,
  BRAND_LOGO_PATHS,
  CAMEO_NAME,
  COMPANY_NAME,
  aiByline,
  teamByline,
} from "../brand";
import { inviteMessageEs } from "../sales/invite";
import { COACH_SYSTEM_PROMPT } from "../coach/systemPrompt";
import { AFFILIATE_DISCLOSURE } from "../monitoring/offer";
import { SITE_COPY } from "../site/copy";

// The company was renamed from the name spelled out below (in two halves, so
// this file does not trip its own check) to Credalti.
const OLD_NAME = new RegExp(["credit", "capi"].join(""), "i");
// The capybara mascot that BONALTI replaced as the assistant, as a whole word
// (spelled in two halves for the same reason). "Capital One" does not match.
const OLD_MASCOT = new RegExp(`\\b${["Ca", "pi"].join("")}\\b`, "i");
// The robot's name in the brand kit, before the owner renamed him AltiBot on
// 2026-11-22 (spelled in two halves, as above). As a word and case-sensitive,
// so the lowercase "bonalti." storage keys and the internal project name
// ("... Credit", BRAND.internalName), which are not the robot, do not match.
const OLD_ROBOT = ["BON", "ALTI"].join("");
const OLD_ROBOT_WORD = new RegExp(`\\b(${OLD_ROBOT}|${OLD_ROBOT[0]}${OLD_ROBOT.slice(1).toLowerCase()})\\b(?! Credit)`);

// The brand kit's files, byte for byte: the SHA-256 of each file as the kit
// delivered it (1_Brand_Kit/brand/logo/vector/ and .../favicon/, 2026-11-21).
// The kit is not in the repository (docs/BRAND.md says where it lives), so the
// hashes stand in for it: a re-export, recolour or "clean-up" fails here.
const KIT_FILES: Record<string, string> = {
  "public/brand/logo/credalti-logo-white.svg": "b9f40f149e795731454885f7d583f52de0b37c1de85f240cea2b49e5399f63d5",
  "public/brand/logo/credalti-logo-navy.svg": "f0ffd00cf64209a3ebf19ce80f46946ae97115ea32e80f4a9da94ab8623dee8c",
  "public/brand/logo/credalti-check.svg": "30a211c19e0ca1b0f09b0a61af3cac0a6c7e7354f6d33da15d768de48162c41d",
  // favicon.svg, favicon.ico and apple-touch-icon.png, under Next's file-convention names.
  "src/app/icon.svg": "e203eefe77a5c1d9fe42d9d33e344f5d78f43155f29d7f35883549e6d315825b",
  "src/app/favicon.ico": "40912704dd9ccb8b5d920750fdbb9186bf6668c78a8d4e475a76ea0886b40d75",
  "src/app/apple-icon.png": "64631ea0b1815d3c2b0b4c392ec45fa0a10bcae0b296b57a6a8f9c3855edd628",
  "public/brand/icons/icon-192.png": "10cb688b0d64dcd31d83e376648dd240e97ca2865fd4fb159e1bc28c6b067979",
  "public/brand/icons/icon-512.png": "e11a141b623efe71c520e2e126d35258f9f7ee61fa94a0f396bf3b21dfd248fd",
  "public/brand/icons/icon-maskable-512.png": "a57c5395b1f75770b7756f92f0b5848342d62a3e72358e34fd7ab1611c88707a",
};

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

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
  it("is Credalti, with Alti as the AI assistant and only voice, and the robot as a small cameo (owner, 2026-11-24)", () => {
    expect(BRAND.name).toBe("Credalti");
    expect(COMPANY_NAME).toBe("Credalti");
    // "ALTI should be the one" answering (2026-11-24). Everything else interpolates these values.
    expect(BRAND.assistant).toBe("Alti");
    expect(ASSISTANT_NAME).toBe(BRAND.assistant);
    // The robot, renamed on 2026-11-22, is a small cameo since 2026-11-24.
    expect(BRAND.cameo).toBe(CAMEO_NAME);
    expect("teamMascot" in BRAND).toBe(false);
    // The logo is a file, never typeset: there are no wordmark halves to set in a font.
    expect("wordmark" in BRAND).toBe(false);
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

  it("no source file under src/, no file name under public/ and not the ad lock still names the robot by his old name", () => {
    expect(OLD_ROBOT_WORD.test(`Soy ${OLD_ROBOT}.`)).toBe(true);
    expect(OLD_ROBOT_WORD.test(`"${OLD_ROBOT.toLowerCase()}.locale"`)).toBe(false);
    expect(OLD_ROBOT_WORD.test(BRAND.internalName)).toBe(false);
    const offenders = sourceFiles("src").filter((file) => OLD_ROBOT_WORD.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    expect(allFiles("public").filter((file) => file.toLowerCase().includes(OLD_ROBOT.toLowerCase()))).toEqual([]);
    for (const file of ["content/brand/lock.json", "content/pipeline/assemble.ts", ".env.example"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(OLD_ROBOT_WORD);
    }
  });

  it("points at character images that exist, in @1x and @2x", () => {
    // Four views of each character plus Alti's six poses, each in two sizes.
    expect(BRAND_IMAGE_PATHS).toHaveLength(28);
    for (const path of BRAND_IMAGE_PATHS) {
      expect(path, path).toMatch(/^\/brand\/characters\/.+@[12]x\.webp$/);
      expect(existsSync(join("public", path)), path).toBe(true);
    }
    for (const set of [BRAND.assistantImages, BRAND.assistantPoses, BRAND.cameoImages]) {
      for (const image of Object.values(set)) {
        expect(image.width, image.src).toBeGreaterThan(0);
        expect(image.height, image.src).toBeGreaterThan(0);
        expect(image.src2x).toBe(image.src.replace("@1x", "@2x"));
      }
    }
    // Alti's art is the assistant's; the robot's art is only the cameo's.
    expect(BRAND.assistantImages.front.src).toMatch(/^\/brand\/characters\/alti_/);
    expect(BRAND.cameoImages.front.src).toMatch(/^\/brand\/characters\/altibot_/);
  });

  it("uses the brand kit's logo, favicon and app icon files, byte for byte", () => {
    for (const [file, hash] of Object.entries(KIT_FILES)) {
      expect(existsSync(file), file).toBe(true);
      expect(sha256(file), file).toBe(hash);
    }
    // Every logo and manifest icon path in brand.ts is one of those files.
    expect(BRAND_LOGO_PATHS).toHaveLength(6);
    for (const path of BRAND_LOGO_PATHS) {
      expect(Object.keys(KIT_FILES), path).toContain(join("public", path));
    }
    // Width and height are the files' own viewBox, so the logo is never stretched.
    for (const logo of Object.values(BRAND.logo)) {
      const svg = readFileSync(join("public", logo.src), "utf8");
      const [, , w, h] = svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
      expect([logo.width, logo.height], logo.src).toEqual([w, h]);
    }
    expect(readFileSync(join("public", BRAND.logo.onLight.src), "utf8")).toContain('fill="#12213A"');
    expect(readFileSync(join("public", BRAND.logo.onDark.src), "utf8")).toContain('fill="#FFFFFF"');
    // One way to declare icons: the file conventions in src/app/, no copies in public/.
    for (const name of ["favicon.ico", "favicon.svg", "icon.svg", "apple-touch-icon.png", "site.webmanifest", "manifest.json"]) {
      expect(existsSync(join("public", name)), name).toBe(false);
    }
    expect(existsSync("src/app/manifest.json") || existsSync("src/app/manifest.webmanifest")).toBe(false);
  });

  it("has an installable web manifest with the kit's icons and the brand navy", () => {
    const m = manifest();
    expect(m.name).toBe(BRAND.name);
    expect(m.short_name).toBe(BRAND.name);
    expect(m.start_url).toBe("/dashboard");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBe("#12213A");
    expect(m.background_color).toBe("#12213A");
    expect(APP_ICONS.themeColor).toBe("#12213A");
    const icons = m.icons ?? [];
    expect(icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512", "512x512"]);
    expect(icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(1);
    for (const icon of icons) expect(existsSync(join("public", icon.src)), icon.src).toBe(true);
    // The browser's theme colour is the same navy.
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("themeColor: APP_ICONS.themeColor");
  });

  it("shows the logo from its files, never typeset or drawn in code", () => {
    const logo = readFileSync("src/components/Logo.tsx", "utf8");
    expect(logo).toContain("BRAND.logo.onLight");
    expect(logo).toContain("BRAND.logo.onDark");
    expect(logo).not.toMatch(/<svg|<path|font-display|"Cred"/);
    // The old gauge mark is gone everywhere (it was also a credit-score visual).
    const gauge = sourceFiles("src").filter((file) => /GaugeMark|gaugeSvg/.test(readFileSync(file, "utf8")));
    expect(gauge).toEqual([]);
  });

  it("describes Alti as AI, never as a person, and labels every one of his messages", () => {
    for (const locale of ["es", "en"] as const) {
      expect(BRAND.assistantAlt[locale]).toContain(BRAND.assistant);
      expect(BRAND.assistantAlt[locale]).toMatch(/inteligencia artificial|artificial intelligence/);
      expect(BRAND.assistantAlt[locale]).toMatch(/no es una persona|not a person/);
    }
    // The label on every message the assistant writes, and on the chat header.
    expect(aiByline("en")).toBe("Alti · AI assistant");
    expect(aiByline("es")).toBe("Alti · Asistente con IA");
    // A teammate's message carries the teammate's own name, never Alti's.
    expect(teamByline("Ana", "en")).toBe("Ana · Credalti team");
    expect(teamByline("Ana", "es")).toBe("Ana · equipo Credalti");
    for (const locale of ["es", "en"] as const) {
      for (const line of [teamByline("Ana", locale), teamByline("", locale)]) {
        expect(line).not.toMatch(new RegExp(`\\b(${ASSISTANT_NAME}|${CAMEO_NAME})\\b|\\bIA\\b|\\bAI\\b`));
      }
    }
    // A teammate's words are never put beside a character: TeamMessage has none.
    expect(readFileSync("src/components/TeamMessage.tsx", "utf8")).not.toMatch(/Character/);
  });

  it("the robot is a cameo in two places only, and never speaks or authors a message", () => {
    // The only files that may name or show the robot: the website's mailing
    // animation, the About page (with its copy), the brand's own files, and
    // the two checks that keep the name out (letters, the website chat's replies).
    const ALLOWED = new Set([
      "src/lib/brand.ts",
      "src/lib/letters/versions/validate.ts",
      "src/lib/site/askAlti.ts",
      "src/components/Character.tsx",
      "src/components/site/MailCameo.tsx",
      "src/app/nosotros/page.tsx",
      "src/lib/site/copy.ts",
    ]);
    const uses = (text: string) => new RegExp(`\\b${CAMEO_NAME}\\b|character="cameo"|BRAND\\.cameo|CAMEO_NAME|cameoImages`).test(text);
    const users = sourceFiles("src").filter((file) => uses(readFileSync(file, "utf8")));
    expect(users.filter((file) => !ALLOWED.has(file))).toEqual([]);
    expect(users).toContain("src/components/site/MailCameo.tsx");
    // In the site copy, the name appears only in the About page's words and the mailing animation's caption.
    const strings: Array<[string, string]> = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") strings.push([path, value]);
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}.${i}`));
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(SITE_COPY, "copy");
    const named = strings.filter(([, text]) => new RegExp(`\\b${CAMEO_NAME}\\b`).test(text)).map(([path]) => path);
    expect(named.length).toBeGreaterThan(0);
    for (const path of named) expect(path, path).toMatch(/^copy\.(en|es)\.(about\.|home\.demo\.mail|meta\.about)/);
    // Never a message author: the coach, the chat screens and the WhatsApp texts speak as Alti only.
    expect(COACH_SYSTEM_PROMPT).not.toMatch(new RegExp(`\\b${CAMEO_NAME}\\b`));
    const mail = readFileSync("src/components/site/MailCameo.tsx", "utf8");
    expect(mail).not.toMatch(/byline|Bubble|aiByline/);
  });

  it("'talk to a person' never shows a character, and no screen uses the retired team character", () => {
    const chat = readFileSync("src/app/(app)/asistente/page.tsx", "utf8");
    const human = chat.slice(chat.indexOf("const humanLabel"), chat.indexOf("return (", chat.indexOf("const humanLabel")));
    expect(human).not.toMatch(/CharacterAvatar/);
    expect(human).toMatch(/name="person"/);
    const offenders = sourceFiles("src").filter((file) => /character="team"|teamMascot|character="engine"/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    // The client app and the staff console show no robot.
    const appFiles = [...sourceFiles("src/app/(app)"), ...sourceFiles("src/app/equipo"), ...sourceFiles("src/components/staff")];
    expect(appFiles.filter((file) => /character="cameo"|altibot_/.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("the ad pipeline's end card shows the logo file, and the brand lock uses the new names", () => {
    const assemble = readFileSync("content/pipeline/assemble.ts", "utf8");
    expect(assemble).toContain("public/brand/logo/credalti-logo-white.svg");
    // No typeset wordmark and no score gauge on the end card.
    expect(assemble).not.toMatch(/Cred<span|gaugeSvg|GAUGE/);
    for (const file of ["content/pipeline/assemble.ts", "content/brand/lock.json", "content/README.md", "content/ads/mecanico.json"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(OLD_NAME);
    }
  });

  it("uses the kit's typefaces: Poppins 600/700 for display, Inter 400-600 for text, no Nunito", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toMatch(/import \{ Inter, Poppins \} from "next\/font\/google"/);
    const call = (name: string) => layout.slice(layout.indexOf(`${name}({`), layout.indexOf("});", layout.indexOf(`${name}({`)));
    expect(call("Poppins")).toContain('weight: ["600", "700"]');
    expect(call("Inter")).toContain('weight: ["400", "500", "600"]');
    for (const font of [call("Poppins"), call("Inter")]) {
      expect(font).toContain('subsets: ["latin", "latin-ext"]');
      expect(font).toContain('display: "swap"');
    }
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/--font-sans:\s*var\(--font-inter\),/);
    expect(css).toMatch(/--font-display: var\(--font-poppins\),/);
    // Nunito is gone, from the app and from the ad pipeline.
    const files = [...sourceFiles("src"), "content/pipeline/assemble.ts", "content/brand/lock.json"];
    expect(files.filter((file) => /nunito/i.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("asks only for the weights it loads, so the browser never fakes bold", () => {
    const tsx = sourceFiles("src").filter((file) => file.endsWith(".tsx"));
    // Nothing heavier than Poppins 700.
    expect(tsx.filter((file) => /font-(black|extrabold)\b/.test(readFileSync(file, "utf8")))).toEqual([]);
    // 700 only on the display face: Inter stops at 600.
    const boldInter = tsx.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /\bfont-bold\b/.test(line) && !/\bfont-display\b/.test(line))
        .map(({ i }) => `${file}:${i + 1}`),
    );
    expect(boldInter).toEqual([]);
  });

  it("customer-facing text reads the name from one place", () => {
    expect(inviteMessageEs({ name: "María" }, "https://x.test/onboarding")).toContain("para entrar a Credalti:");
    expect(COACH_SYSTEM_PROMPT).toContain(`Eres ${ASSISTANT_NAME}, el asistente de crédito con inteligencia artificial de Credalti`);
    expect(ASSISTANT_NAME).toBe("Alti");
    expect(COACH_SYSTEM_PROMPT).toContain(`te llamas ${ASSISTANT_NAME} y SIEMPRE eres transparente en que eres una inteligencia artificial`);
    expect(AFFILIATE_DISCLOSURE.es).toContain("Credalti recibe una comisión");
    expect(SITE_COPY.es.footer.disclaimer).toContain("Credalti");
    expect(SITE_COPY.en.footer.disclaimer).toContain("Credalti");
    // The icon is the check only: no lettering to rename.
    expect(readFileSync("src/app/icon.svg", "utf8")).not.toMatch(/<text/);
  });
});
