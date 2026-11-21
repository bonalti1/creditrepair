import { describe, expect, it } from "vitest";
import { ATTESTATION_TEXT, ATTESTATION_VERSION, buildAttestationRecord } from "@/lib/compliance/attestation";
import { assertClaimGuardrails, checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { ALL_STATES, openStates, stateStatus } from "@/lib/compliance/states";
import { renderMessage, type WhatsAppEvent } from "@/lib/integrations/whatsapp";
import { AFFILIATE_DISCLOSURE, MONITORING_OFFER, monitoringNameEs } from "@/lib/monitoring/offer";

const rules = (text: string) => checkClaimGuardrails(text).map((v) => v.rule);
const adRules = (text: string) => checkMarketingCopy(text).map((v) => v.rule);

describe("claim guardrails", () => {
  it.each([
    ["Garantizamos la eliminación de tus deudas", "no-guaranteed-deletions"],
    ["We guarantee removal of collections", "no-guaranteed-deletions"],
    ["Sube 100 puntos en 30 días", "no-points-in-days"],
    ["Gain 80 points in 2 weeks", "no-points-in-days"],
    ["We can remove accurate information", "no-accurate-removal"],
    ["Podemos eliminar información correcta", "no-accurate-removal"],
    ["We fix your credit", "diy-positioning"],
    ["Reparamos, disputamos y mejoramos tu perfil de crédito", "diy-positioning"],
    ["Lo que yo te voy a arreglar... es tu crédito.", "diy-positioning"],
    ["Yo te arreglo tu crédito", "diy-positioning"],
    ["I'll fix your credit", "diy-positioning"],
  ])("blocks %s", (text, rule) => {
    expect(rules(text)).toContain(rule);
  });

  it.each([
    "Tú decides qué disputar y tú apruebas.",
    "Capi prepara todo. Tú decides y tú envías. Los resultados varían.",
    "Tu ronda de cartas #2 está lista para TU aprobación.",
    "De carros no sé nada. Lo mío es tu crédito. Te lo explico, y tú decides.",
    "You review each item and you send your own disputes. Results vary.",
  ])("allows %s", (text) => {
    expect(rules(text)).toEqual([]);
  });

  it("throws from the pipeline variant, naming the rule", () => {
    expect(() => assertClaimGuardrails("Eliminación garantizada", "test")).toThrow(/no-guaranteed-deletions/);
    expect(() => assertClaimGuardrails("Los resultados varían.", "test")).not.toThrow();
  });

  it("passes every templated WhatsApp message", () => {
    const events: WhatsAppEvent[] = [
      { kind: "report_imported" },
      { kind: "attack_ready", roundNumber: 2 },
      { kind: "letters_mailed", roundNumber: 2, letterCount: 5 },
      { kind: "items_deleted", deletedCount: 2, remainingCount: 3 },
      { kind: "day40_reengage", deletedCount: 1, remainingCount: 4 },
    ];
    for (const event of events) expect(rules(renderMessage(event)), event.kind).toEqual([]);
  });
});

describe("advertising rules", () => {
  it.each([
    ["Mejora tu crédito hoy", "no-outcome-promise"],
    ["Aumenta tu puntaje", "no-outcome-promise"],
    ["Resultados reales", "no-outcome-promise"],
    ["Boost your credit score fast", "no-outcome-promise"],
    ["Para que vayas por el carro que siempre quisiste.", "no-outcome-promise"],
    ["So you can finally buy the house you want", "no-outcome-promise"],
    ["Aprobación garantizada", "no-approval-claims"],
  ])("blocks %s", (text, rule) => {
    expect(adRules(text)).toContain(rule);
  });

  it("blocks the commercial's original punchline and allows the line that shipped", () => {
    const original = "Lo que yo te voy a arreglar... es tu crédito. Para que vayas por el carro que siempre quisiste.";
    expect(adRules(original).sort()).toEqual(["diy-positioning", "no-outcome-promise"]);
    expect(adRules("De carros no sé nada. Lo mío es tu crédito. Te lo explico, y tú decides.")).toEqual([]);
    expect(adRules("Tu crédito, explicado paso a paso.")).toEqual([]);
    expect(adRules("Software para que tú disputes tu propio reporte. Tú decides y tú envías. Los resultados varían.")).toEqual([]);
  });

  it("does not apply the advertising rules to ordinary conversation", () => {
    // The coach may explain how scores work; only ads are barred from the imperative promise.
    expect(rules("Pagar a tiempo ayuda: así es como la gente mejora tu puntaje con el tiempo.")).toEqual([]);
  });
});

describe("monitoring offer", () => {
  it("does not name the provider before a partner link exists", () => {
    // No NEXT_PUBLIC_MONITORING_SIGNUP_URL in the test environment.
    expect(MONITORING_OFFER.signupUrl).toBeNull();
    expect(MONITORING_OFFER.providerName).toBeNull();
    expect(monitoringNameEs()).toBe("tu suscripción de monitoreo de crédito");
  });

  it("discloses the commission in both languages, within the claim rules", () => {
    expect(AFFILIATE_DISCLOSURE.es).toMatch(/comisión/);
    expect(AFFILIATE_DISCLOSURE.en).toMatch(/commission/);
    expect(adRules(AFFILIATE_DISCLOSURE.es)).toEqual([]);
    expect(adRules(AFFILIATE_DISCLOSURE.en)).toEqual([]);
  });

  it("shows a price", () => {
    expect(MONITORING_OFFER.priceLabel).toMatch(/\$\d+/);
  });
});

describe("attestation", () => {
  it("records the exact text shown to the user, the version and a timestamp", () => {
    const record = buildAttestationRecord("abc", "es");
    expect(record.text).toBe(ATTESTATION_TEXT.es);
    expect(record.version).toBe(ATTESTATION_VERSION);
    expect(Number.isNaN(Date.parse(record.attestedAt))).toBe(false);
    expect(buildAttestationRecord("abc", "en").text).toBe("I believe this item is inaccurate, unverifiable, or outdated.");
  });
});

describe("state registry", () => {
  it("opens Texas only", () => {
    expect(openStates()).toEqual(["TX"]);
    expect(stateStatus("tx")).toBe("open");
  });

  it("blocks Georgia and waitlists everything not explicitly cleared", () => {
    expect(stateStatus("GA")).toBe("blocked");
    expect(stateStatus("CA")).toBe("waitlist");
    expect(stateStatus("WY")).toBe("waitlist");
    expect(stateStatus("ZZ")).toBe("waitlist");
    expect(ALL_STATES).toHaveLength(50);
  });
});

describe("wording", () => {
  // The owner replaced "ataque" with "ronda de cartas" after two rounds of user
  // testing found it read as aggressive. Keep it out of everything a customer reads.
  it("does not call a round of letters an attack", async () => {
    const { readFileSync } = await import("node:fs");
    const files = [
      "src/lib/i18n/dictionaries.ts", "src/lib/i18n/marketing.ts", "src/lib/ux/journey.ts",
      "src/lib/ux/explainers.ts", "src/lib/ux/roundCopy.ts", "src/lib/integrations/whatsapp.ts",
      "src/lib/monitoring/subscription.ts", "src/app/api/webhooks/whatsapp/route.ts",
      "src/app/(app)/asistente/page.tsx", "src/app/(app)/rounds/page.tsx", "src/app/(app)/items/page.tsx",
      "src/app/(app)/audit/page.tsx", "src/app/(app)/dashboard/page.tsx", "src/app/(app)/mas/page.tsx",
      "src/app/(app)/attack/page.tsx", "src/lib/ux/reviewChatCopy.ts", "src/lib/ux/teamRound.ts",
      "src/lib/sales/invite.ts", "src/app/equipo/invitar/page.tsx",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(/ataque/i.test(text), file).toBe(false);
      // English copy: the word may appear in code (paths, identifiers), never inside a sentence.
      expect(/\b(your|my|next|the) attack\b|Attack #|Attack \d/i.test(text), file).toBe(false);
    }
  });
});
