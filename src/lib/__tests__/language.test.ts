import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { COACH_SAFE_FALLBACK, detectMessageLanguage, replyLanguage } from "@/lib/coach/language";
import { coachSystemPrompt, replyLanguageLine } from "@/lib/coach/systemPrompt";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  parseLocale,
  preferredFromAcceptLanguage,
  reconcileWithProfile,
  resolveClientLocale,
  resolveLocale,
} from "@/lib/i18n/detect";
import { MARKETING } from "@/lib/i18n/marketing";
import { SITE_COPY } from "@/lib/site/copy";
import { buildInvitePath, inviteMessage, inviteMessageEn, parseInvite } from "@/lib/sales/invite";

// English first, Spanish if needed (src/lib/i18n/detect.ts). The order:
// the link's ?lang=, then the saved choice, then (signed in) the profile,
// then the browser's language, then English.

const SPANISH_BROWSER = "es-MX,es;q=0.9,en;q=0.8";
const ENGLISH_BROWSER = "en-US,en;q=0.9,es;q=0.8";

describe("which language a visitor starts in", () => {
  it("is English by default", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(resolveLocale({})).toEqual({ locale: "en", source: "default" });
    expect(resolveLocale({ acceptLanguage: "fr-FR,fr;q=0.9" })).toEqual({ locale: "en", source: "default" });
    expect(resolveLocale({ acceptLanguage: ENGLISH_BROWSER })).toEqual({ locale: "en", source: "browser" });
    expect(resolveClientLocale({ link: null, cookie: null, stored: null, languages: [] })).toEqual({ locale: "en", source: "default" });
  });

  it("is Spanish for a browser that prefers Spanish", () => {
    expect(resolveLocale({ acceptLanguage: SPANISH_BROWSER })).toEqual({ locale: "es", source: "browser" });
    expect(resolveLocale({ acceptLanguage: "es" })).toMatchObject({ locale: "es" });
    // Spanish is the first of the two among the visitor's languages.
    expect(preferredFromAcceptLanguage("fr-FR,fr;q=0.9,es;q=0.8,en;q=0.7")).toBe("es");
    // The weights decide, not the order written.
    expect(preferredFromAcceptLanguage("en;q=0.4,es-US;q=0.9")).toBe("es");
    expect(preferredFromAcceptLanguage("es;q=0,en")).toBe("en");
    expect(resolveClientLocale({ link: null, cookie: null, stored: null, languages: ["es-US", "en-US"] })).toEqual({ locale: "es", source: "browser" });
    expect(resolveClientLocale({ link: null, cookie: null, stored: null, languages: ["en-US", "es-US"] })).toEqual({ locale: "en", source: "browser" });
  });

  it("a saved choice wins over the browser", () => {
    expect(resolveLocale({ cookie: "en", acceptLanguage: SPANISH_BROWSER })).toEqual({ locale: "en", source: "saved" });
    expect(resolveLocale({ cookie: "es", acceptLanguage: ENGLISH_BROWSER })).toEqual({ locale: "es", source: "saved" });
    expect(resolveClientLocale({ link: null, cookie: "en", stored: "es", languages: ["es-MX"] })).toEqual({ locale: "en", source: "saved" });
    // A choice from before the cookie existed (localStorage only) still counts as saved.
    expect(resolveClientLocale({ link: null, cookie: null, stored: "es", languages: ["en-US"] })).toEqual({ locale: "es", source: "saved" });
    // Junk is no choice.
    expect(resolveLocale({ cookie: "fr", acceptLanguage: SPANISH_BROWSER })).toEqual({ locale: "es", source: "browser" });
  });

  it("an invitation's lang wins over everything", () => {
    expect(resolveLocale({ query: "es", cookie: "en", acceptLanguage: ENGLISH_BROWSER })).toEqual({ locale: "es", source: "link" });
    expect(resolveLocale({ query: "en", cookie: "es", acceptLanguage: SPANISH_BROWSER })).toEqual({ locale: "en", source: "link" });
    expect(resolveClientLocale({ link: "es", cookie: "en", stored: "en", languages: ["en-US"] })).toEqual({ locale: "es", source: "link" });
    expect(parseLocale("ES")).toBe("es");
    expect(parseLocale("es-MX")).toBe("es");
    expect(parseLocale("en_US")).toBe("en");
    expect(parseLocale("espanol")).toBeNull();
    expect(parseLocale("fr")).toBeNull();
  });

  it("the browser keeps the server's first-render language when it adds nothing (no flash)", () => {
    const server = resolveLocale({ acceptLanguage: SPANISH_BROWSER });
    expect(resolveClientLocale({ link: null, cookie: null, stored: null, languages: ["en-US"], server })).toEqual(server);
  });

  it("signed in: a choice on this device goes to the profile; with none, the profile's language is used", () => {
    expect(reconcileWithProfile({ locale: "es", source: "saved" }, "en")).toEqual({ choice: { locale: "es", source: "saved" }, writeProfile: "es" });
    expect(reconcileWithProfile({ locale: "es", source: "link" }, "es")).toEqual({ choice: { locale: "es", source: "link" }, writeProfile: null });
    expect(reconcileWithProfile({ locale: "en", source: "browser" }, "es")).toEqual({ choice: { locale: "es", source: "profile" }, writeProfile: null });
    expect(reconcileWithProfile({ locale: "en", source: "default" }, null)).toEqual({ choice: { locale: "en", source: "default" }, writeProfile: "en" });
  });
});

describe("the page's declared language", () => {
  const headerValues = new Map<string, string>();
  const cookieValues = new Map<string, string>();
  beforeEach(() => {
    headerValues.clear();
    cookieValues.clear();
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      headers: async () => ({ get: (name: string) => headerValues.get(name.toLowerCase()) ?? null }),
      cookies: async () => ({ get: (name: string) => (cookieValues.has(name) ? { name, value: cookieValues.get(name)! } : undefined) }),
    }));
  });
  afterEach(() => {
    vi.doUnmock("next/headers");
  });

  it("matches the language the page renders in, and the staff console stays Spanish", async () => {
    const { documentLang, requestLocale } = await import("@/lib/i18n/server");
    expect(await documentLang()).toBe("en");
    headerValues.set("accept-language", SPANISH_BROWSER);
    expect(await documentLang()).toBe("es");
    expect((await requestLocale()).locale).toBe("es");
    cookieValues.set(LOCALE_COOKIE, "en");
    expect(await documentLang()).toBe("en");
    expect((await requestLocale()).locale).toBe("en");
    headerValues.set("x-credalti-path", "/equipo/clientes");
    expect(await documentLang()).toBe("es");
  });

  it("the root layout and the pages a visitor sees use it", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toMatch(/<html lang=\{lang\}/);
    expect(layout).not.toMatch(/lang="es"/);
    // The public website's pages get it through their shared frame (SiteShell).
    expect(readFileSync("src/components/site/SiteShell.tsx", "utf8")).toContain("RequestLocaleProvider");
    for (const page of ["src/app/page.tsx", "src/app/precios/page.tsx", "src/app/como-funciona/page.tsx", "src/app/preguntas/page.tsx", "src/app/nosotros/page.tsx", "src/app/derechos/page.tsx", "src/app/socios/page.tsx", "src/components/site/LegalPage.tsx"]) {
      expect(readFileSync(page, "utf8"), page).toContain("<SiteShell>");
    }
    for (const page of ["src/components/site/SiteShell.tsx", "src/app/empezar/page.tsx", "src/app/conoce/[code]/page.tsx", "src/app/(app)/layout.tsx", "src/app/onboarding/layout.tsx", "src/app/login/layout.tsx"]) {
      expect(readFileSync(page, "utf8"), page).toContain("RequestLocaleProvider");
    }
    expect(readFileSync("src/app/global-error.tsx", "utf8")).toContain('<html lang="en">');
  });
});

describe("the proxy and an invitation's ?lang=", () => {
  it("saves the link's language in the cookie, on the request too, for the first render", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("http://localhost:3000/onboarding?n=Mar%C3%ADa&lang=es"));
    expect(res.cookies.get(LOCALE_COOKIE)?.value).toBe("es");
    // What the page itself is handed: the cookie and the path.
    expect(res.headers.get("x-middleware-request-cookie") ?? "").toContain(`${LOCALE_COOKIE}=es`);
    expect(res.headers.get("x-middleware-request-x-credalti-path")).toBe("/onboarding");
    // No lang: nothing saved.
    const plain = await proxy(new NextRequest("http://localhost:3000/"));
    expect(plain.cookies.get(LOCALE_COOKIE)).toBeUndefined();
    const junk = await proxy(new NextRequest("http://localhost:3000/?lang=fr"));
    expect(junk.cookies.get(LOCALE_COOKIE)).toBeUndefined();
  });

  it("runs on the pages a visitor lands on", () => {
    const source = readFileSync("src/proxy.ts", "utf8");
    for (const path of ['"/"', '"/empezar"', '"/onboarding/:path*"', '"/login"', '"/socios"', '"/conoce/:path*"']) expect(source).toContain(path);
  });
});

describe("the salesperson's invitation carries the language", () => {
  it("lang=es in the link, read back on arrival; English by default", () => {
    const es = buildInvitePath({ name: "María", goal: "mortgage", state: "TX", refName: "Ana", lang: "es" });
    expect(es).toContain("lang=es");
    expect(parseInvite(new URL(`https://x.test${es}`).searchParams)).toMatchObject({ name: "María", lang: "es" });
    const en = buildInvitePath({ name: "María", lang: "en" });
    expect(parseInvite(new URL(`https://x.test${en}`).searchParams)).toMatchObject({ lang: "en" });
    expect(parseInvite(new URLSearchParams("n=María&lang=fr"))?.lang).toBeUndefined();
    expect(buildInvitePath({ name: "María" })).not.toContain("lang=");
  });

  it("the message is written in the client's language, and passes the claim rules", () => {
    const url = "https://app.example/onboarding?n=Mar%C3%ADa&lang=en";
    const en = inviteMessage({ name: "María" }, url);
    expect(en).toBe(inviteMessageEn({ name: "María" }, url));
    expect(en).toMatch(/^All set, María! Here is your link to Credalti:/);
    expect(inviteMessage({ name: "María", lang: "es" }, url)).toMatch(/^¡Listo, María!/);
    expect(inviteMessage({ name: "María" }, url, "es")).toMatch(/^¡Listo, María!/);
    for (const text of [en, inviteMessage({ name: "María" }, url, "es")]) {
      expect(checkClaimGuardrails(text)).toEqual([]);
      expect(checkMarketingCopy(text)).toEqual([]);
    }
  });

  it("the invite form offers the language, English first", () => {
    const form = readFileSync("src/app/equipo/invitar/page.tsx", "utf8");
    expect(form).toMatch(/useState<"en" \| "es">\("en"\)/);
    // English is the first option, labelled in the member's console language.
    const en = form.indexOf('<option value="en">{t("Inglés", "English")}</option>');
    const es = form.indexOf('<option value="es">{t("Español", "Spanish")}</option>');
    expect(en).toBeGreaterThan(-1);
    expect(es).toBeGreaterThan(en);
    expect(form).toMatch(/buildInvitePath\(\{[^}]*lang/);
  });
});

describe("positioning: bilingual, not Spanish-first", () => {
  it("the home page says English or Spanish, in both languages", () => {
    expect(SITE_COPY.en.home.eyebrow).toBe("Credit report help, in English or Spanish");
    expect(SITE_COPY.es.home.eyebrow).toBe("Ayuda con tu reporte de crédito, en inglés o en español");
    for (const locale of ["es", "en"] as const) {
      const all = JSON.stringify(MARKETING[locale]) + JSON.stringify(SITE_COPY[locale]);
      expect(all).not.toMatch(/Todo en español|Everything in Spanish|Spanish-first|español primero/i);
    }
  });
});

describe("AltiBot answers in the client's language", () => {
  it("tells English from Spanish in a chat message, and falls back to the app's language", () => {
    expect(detectMessageLanguage("What does this collection on my report mean?")).toBe("en");
    expect(detectMessageLanguage("¿Qué significa esta cobranza en mi reporte?")).toBe("es");
    expect(detectMessageLanguage("Hola, tengo una pregunta")).toBe("es");
    expect(detectMessageLanguage("Hi, I have a question about my letters")).toBe("en");
    expect(detectMessageLanguage("ok")).toBeNull();
    expect(replyLanguage("ok", "es")).toBe("es");
    expect(replyLanguage("ok", undefined)).toBe("en");
    expect(replyLanguage("Can you help me?", "es")).toBe("en");
  });

  it("its instructions name the reply language; the claim rules are the same", () => {
    const en = coachSystemPrompt("full_service", "en");
    const es = coachSystemPrompt("full_service", "es");
    expect(en).toMatch(/ALWAYS reply in the language the person writes in/);
    expect(en).toMatch(/reply in English, the language the person uses in the app/);
    expect(es).toMatch(/responde en español, el idioma que la persona eligió en la app/);
    for (const prompt of [en, es]) expect(prompt).toMatch(/NUNCA garantices eliminaciones, resultados, ni aumentos de puntaje/);
    for (const text of Object.values(COACH_SAFE_FALLBACK)) {
      expect(checkClaimGuardrails(text)).toEqual([]);
      expect(checkMarketingCopy(text)).toEqual([]);
    }
  });

  describe("through /api/coach, with the model mocked", () => {
    const calls: Array<{ system: string }> = [];
    let modelReply = "";
    beforeEach(() => {
      calls.length = 0;
      vi.resetModules();
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.doMock("@anthropic-ai/sdk", () => ({
        default: class {
          messages = {
            create: async (input: { system: string }) => {
              calls.push({ system: input.system });
              return { content: [{ type: "text", text: modelReply }] };
            },
          };
        },
      }));
    });
    afterEach(() => {
      vi.doUnmock("@anthropic-ai/sdk");
      vi.unstubAllEnvs();
    });

    const ask = async (content: string, locale?: "es" | "en") => {
      const { POST } = await import("@/app/api/coach/route");
      const res = await POST(
        new Request("http://localhost/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.0.${calls.length + 1}` },
          body: JSON.stringify({ messages: [{ role: "user", content }], ...(locale ? { locale } : {}) }),
        }),
      );
      return (await res.json()) as { reply: string };
    };

    it("an English question gets English, even in the Spanish app; a Spanish one gets Spanish", async () => {
      modelReply = "A collection is an account a creditor handed to a collection agency. Results vary case by case.";
      expect((await ask("What is a collection account?", "es")).reply).toBe(modelReply);
      expect(calls[0]!.system).toContain(replyLanguageLine("en"));

      modelReply = "Una cobranza es una cuenta que el acreedor pasó a una agencia de cobranza. Los resultados varían.";
      expect((await ask("¿Qué es una cuenta en cobranza?", "en")).reply).toBe(modelReply);
      expect(calls[1]!.system).toContain(replyLanguageLine("es"));
    });

    it("a message that does not say follows the app's language (English unless the client chose Spanish)", async () => {
      modelReply = "Okay.";
      await ask("ok");
      expect(calls[0]!.system).toContain(replyLanguageLine("en"));
      expect(calls[0]!.system).toMatch(/reply in English, the language the person uses in the app/);
      await ask("ok", "es");
      expect(calls[1]!.system).toContain(replyLanguageLine("es"));
      expect(calls[1]!.system).toMatch(/responde en español, el idioma que la persona eligió en la app/);
    });

    it("a reply held back by the claim rules is replaced in the client's language", async () => {
      modelReply = "We guarantee we will delete it and raise your score 100 points in 30 days.";
      expect((await ask("Can you delete this collection?", "es")).reply).toBe(COACH_SAFE_FALLBACK.en);
      modelReply = "Te garantizamos que eliminamos esa cuenta y te subimos 100 puntos en 30 días.";
      expect((await ask("¿Pueden borrar esta cobranza?", "en")).reply).toBe(COACH_SAFE_FALLBACK.es);
    });
  });
});

describe("automatic messages exist in both languages, and the approval list says so", () => {
  it("every client template has an English and a Spanish body with the same parameters, and docs/AUTOPILOT.md lists it", async () => {
    const { ALL_TEMPLATES, FOOTER } = await import("@/lib/autopilot/templates");
    const doc = readFileSync("docs/AUTOPILOT.md", "utf8");
    expect(doc).toMatch(/\*\*en_US\*\* \(English, the `en` body\) and \*\*es_MX\*\* \(Spanish, the `es` body\)/);
    expect(FOOTER.en).toMatch(/Reply STOP/);
    expect(FOOTER.es).toMatch(/responde BAJA/);
    for (const t of ALL_TEMPLATES) {
      for (const locale of ["en", "es"] as const) {
        expect(t.body[locale].trim().length, `${t.name} ${locale}`).toBeGreaterThan(0);
        for (let n = 1; n <= t.params.length; n += 1) expect(t.body[locale], `${t.name} ${locale} {{${n}}}`).toContain(`{{${n}}}`);
      }
      // Listed by name, or as the first of a numbered set ("credalti_acuerdo_1`, `_2`, `_3").
      const base = t.name.replace(/_\d$/, "_1");
      expect(doc.includes(`\`${t.name}\``) || doc.includes(`\`${base}\``), t.name).toBe(true);
    }
    expect(doc).toContain("`credalti_socio_avance`");
    expect(doc).toContain("Hi, {{1}}. {{2}} More details in your Credalti");
  });
});
