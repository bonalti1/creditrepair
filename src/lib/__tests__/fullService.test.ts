import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSISTANT_NAME } from "@/lib/brand";
import { COACH_SYSTEM_PROMPT, coachSystemPrompt } from "@/lib/coach/systemPrompt";
import { assertClaimGuardrails, checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { DICTS } from "@/lib/i18n/dictionaries";
import { MARKETING, marketingStrings } from "@/lib/i18n/marketing";
import { CLIENT_FALLBACK_REPLY, LEAD_GREETING, renderMessage, type WhatsAppEvent } from "@/lib/integrations/whatsapp";
import { inviteMessageEs, SALES_MAY_NOT_SAY, SALES_MAY_SAY } from "@/lib/sales/invite";
import { isFullService, SERVICE_MODE, type ServiceMode } from "@/lib/service/mode";
import { HUMAN_HELP } from "@/lib/ux/humanHelp";
import { LETTERS_OUT_LINE, reviewCompleteLine, reviewFinishedLine, reviewIntroLine } from "@/lib/ux/reviewChatCopy";
import { roundMailedDate, teamRoundStatus } from "@/lib/ux/teamRound";
import { setStaffLocaleFallback } from "../staff/i18n/locale";

// Written against the Spanish console: the sentences these tests pin are the Spanish ones.
setStaffLocaleFallback("es");

// The business is full service: the client says what is inaccurate, the team
// prepares and mails the letters. These tests hold the two halves of that
// together: what may be said about it (the claim rules, per service mode) and
// what the client app and the sales material actually say.

const MODES: ServiceMode[] = ["full_service", "self_serve"];
const rulesIn = (mode: ServiceMode) => (text: string) => checkClaimGuardrails(text, mode).map((v) => v.rule);
const adRulesIn = (mode: ServiceMode) => (text: string) => checkMarketingCopy(text, mode).map((v) => v.rule);

describe("service mode", () => {
  it("is full service unless the environment says self-serve", () => {
    expect(process.env.NEXT_PUBLIC_SERVICE_MODE).toBeUndefined();
    expect(SERVICE_MODE).toBe("full_service");
    expect(isFullService).toBe(true);
  });

  it("is read from one small file that two branches create identically", () => {
    // The file is created with the same content on a parallel branch; any edit
    // here would turn that into a merge conflict.
    expect(readFileSync("src/lib/service/mode.ts", "utf8")).toBe(
      [
        "// How the service is delivered. Full service is the business today: the client",
        "// says what is inaccurate, and the team prepares and mails the letters.",
        "// Self-serve (the client sends their own letters) is kept for later.",
        'export type ServiceMode = "full_service" | "self_serve";',
        "",
        "export const SERVICE_MODE: ServiceMode =",
        '  process.env.NEXT_PUBLIC_SERVICE_MODE === "self_serve" ? "self_serve" : "full_service";',
        "",
        'export const isFullService = SERVICE_MODE === "full_service";',
        "",
      ].join("\n"),
    );
  });
});

describe("claim rules: the process may be described, per mode", () => {
  // True of both ways of delivering the service, and no outcome in sight.
  const ALLOWED_IN_BOTH = [
    "Tú nos dices qué está mal en tu reporte; nuestro equipo prepara y envía las cartas por ti y te mantiene al tanto.",
    "Nuestro equipo prepara y envía tus cartas.",
    "Preparamos y enviamos tus cartas de disputa.",
    "Enviamos tus cartas por correo y te avisamos cómo va cada ronda.",
    "Los burós tienen 30 días para responder. Los resultados varían.",
    "Solo se disputa lo que tú nos dices que es inexacto.",
    "We prepare and mail your dispute letters.",
    "Our team prepares the letters, mails them and tells you how each round is going.",
    "You tell us what is wrong on your report. Results vary.",
    // A plain denial is not a claim.
    "No eliminamos nada: eso lo deciden los burós.",
    "No garantizamos resultados: los burós de crédito deciden.",
    "No prometemos ni garantizamos resultados.",
    "Nunca te garantizamos la eliminación de nada.",
    "No disputamos todo lo negativo, ni información que tú sabes que es correcta.",
    "No te decimos qué marcar: las respuestas son tuyas.",
    "No vamos a arreglar tu crédito por arte de magia; nadie puede.",
    "We do not guarantee results: the credit bureaus decide.",
    "We don't guarantee results.",
    "We never guarantee removal of anything.",
    "We do not dispute everything negative, or information you know is correct.",
    "We do not decide what is inaccurate. You do.",
  ];

  // "We dispute" is true when the team sends the letters, and false when the client does.
  const ALLOWED_IN_FULL_SERVICE_ONLY = [
    "Disputamos por ti los puntos que tú nos indicas.",
    "Nosotros disputamos por ti lo que tú nos dices que es inexacto.",
    "Sí, disputamos por ti, en lo que tú nos indicas.",
    "Disputamos todo lo que tú nos indicas, punto por punto.",
    "We dispute the items you tell us are inaccurate.",
    "Yes, we dispute for you, for what you point out to us.",
    "We dispute everything you tell us is inaccurate.",
  ];

  it.each(MODES.flatMap((mode) => ALLOWED_IN_BOTH.map((text) => [mode, text] as const)))(
    "%s allows: %s",
    (mode, text) => {
      expect(rulesIn(mode)(text)).toEqual([]);
      expect(adRulesIn(mode)(text)).toEqual([]);
    },
  );

  it.each(ALLOWED_IN_FULL_SERVICE_ONLY)("full service allows, self-serve blocks: %s", (text) => {
    expect(rulesIn("full_service")(text)).toEqual([]);
    expect(adRulesIn("full_service")(text)).toEqual([]);
    expect(rulesIn("self_serve")(text)).toEqual(["self-serve-positioning"]);
  });

  it("uses the app's own mode when none is given", () => {
    expect(SERVICE_MODE).toBe("full_service");
    expect(checkClaimGuardrails("Nosotros disputamos por ti")).toEqual([]);
    expect(checkMarketingCopy("We dispute the items you tell us are inaccurate.")).toEqual([]);
    expect(() => assertClaimGuardrails("Disputamos por ti los puntos que tú nos indicas.", "test")).not.toThrow();
    expect(() => assertClaimGuardrails("Nosotros disputamos por ti", "test", "self_serve")).toThrow(
      /self-serve-positioning/,
    );
  });

  it("still lets self-serve copy say that the client sends", () => {
    for (const text of [
      "Tú decides qué disputar y tú apruebas.",
      "El asistente prepara todo. Tú decides y tú envías. Los resultados varían.",
      "You review each item and you send your own disputes. Results vary.",
      "No disputamos por ti.",
      "We do not dispute for you.",
    ]) {
      expect(rulesIn("self_serve")(text), text).toEqual([]);
    }
  });
});

describe("claim rules: an outcome may not be promised, in any mode", () => {
  const BANNED: Array<[text: string, rule: string]> = [
    // "We" as the one who produces the result.
    ["Eliminamos tus cuentas negativas.", "diy-positioning"],
    ["Nosotros eliminamos esa cobranza.", "diy-positioning"],
    ["Borramos tus deudas del reporte.", "diy-positioning"],
    ["Reparamos tu crédito.", "diy-positioning"],
    ["Arreglamos tu crédito.", "diy-positioning"],
    ["Limpiamos tu reporte.", "diy-positioning"],
    ["Te subimos el puntaje.", "diy-positioning"],
    ["Mejoramos tu perfil de crédito.", "diy-positioning"],
    ["Vamos a subir tu puntaje.", "diy-positioning"],
    ["Te voy a arreglar el crédito.", "diy-positioning"],
    ["Yo te arreglo tu crédito.", "diy-positioning"],
    ["No solo eliminamos cobranzas: también consultas.", "diy-positioning"],
    ["We remove collections from your report.", "diy-positioning"],
    ["We fix your credit.", "diy-positioning"],
    ["We repair credit.", "diy-positioning"],
    ["We delete negative items.", "diy-positioning"],
    ["We clean up your report.", "diy-positioning"],
    ["We can remove that collection.", "diy-positioning"],
    ["I'll fix your credit.", "diy-positioning"],
    ["We'll raise your score.", "diy-positioning"],
    ["We boost your credit.", "diy-positioning"],
    // Guarantees, points and timeframes.
    ["Garantizamos la eliminación de tus deudas.", "no-guaranteed-deletions"],
    ["Te garantizamos resultados.", "no-guaranteed-deletions"],
    ["Eliminación garantizada.", "no-guaranteed-deletions"],
    ["We guarantee removal of collections.", "no-guaranteed-deletions"],
    ["We guarantee results.", "no-guaranteed-deletions"],
    ["Sube 100 puntos en 30 días.", "no-points-in-days"],
    ["Gain 80 points in 2 weeks.", "no-points-in-days"],
    ["Podemos eliminar información correcta.", "no-accurate-removal"],
    ["We can remove accurate information.", "no-accurate-removal"],
    // The client's decisions, made by someone else.
    ["Disputamos todo lo negativo.", "client-decides"],
    ["Disputamos por ti todo lo negativo de tu reporte.", "client-decides"],
    ["Vamos a disputar todas las cuentas negativas.", "client-decides"],
    ["Nosotros decidimos qué disputar.", "client-decides"],
    ["Nuestro equipo decide qué es inexacto.", "client-decides"],
    ["El equipo elige cuáles elementos se disputan.", "client-decides"],
    ["Te decimos qué marcar.", "client-decides"],
    ["We dispute everything negative.", "client-decides"],
    ["We'll dispute all your negative items.", "client-decides"],
    ["We dispute everything.", "client-decides"],
    ["We decide what to dispute.", "client-decides"],
    ["Our team decides which items are inaccurate.", "client-decides"],
    ["We'll tell you which ones to flag.", "client-decides"],
  ];

  it.each(MODES.flatMap((mode) => BANNED.map(([text, rule]) => [mode, text, rule] as const)))(
    "%s blocks: %s",
    (mode, text, rule) => {
      expect(rulesIn(mode)(text)).toContain(rule);
      // Whatever the base rules block, the advertising check blocks too.
      expect(adRulesIn(mode)(text)).toContain(rule);
    },
  );

  // Softer promises: banned in ads, sales copy and staff replies, in every mode.
  const BANNED_IN_ADS: Array<[text: string, rule: string]> = [
    ["Mejora tu crédito hoy.", "no-outcome-promise"],
    ["Aumenta tu puntaje.", "no-outcome-promise"],
    ["Limpia tu historial.", "no-outcome-promise"],
    ["Resultados reales.", "no-outcome-promise"],
    ["Boost your credit score fast.", "no-outcome-promise"],
    ["Para que vayas por el carro que siempre quisiste.", "no-outcome-promise"],
    ["So you can finally buy the house you want.", "no-outcome-promise"],
    ["Aprobación garantizada.", "no-approval-claims"],
    ["Guaranteed approval.", "no-approval-claims"],
  ];

  it.each(MODES.flatMap((mode) => BANNED_IN_ADS.map(([text, rule]) => [mode, text, rule] as const)))(
    "%s blocks in advertising: %s",
    (mode, text, rule) => {
      expect(adRulesIn(mode)(text)).toContain(rule);
    },
  );

  it("names the phrase it matched, without the denial in front of it", () => {
    expect(checkClaimGuardrails("No te preocupes, te garantizamos la eliminación de esa cuenta.")[0]).toMatchObject({
      rule: "no-guaranteed-deletions",
      match: "garantizamos la eliminación",
    });
    expect(checkClaimGuardrails("Disputamos todo lo negativo de tu reporte.")[0]).toMatchObject({
      rule: "client-decides",
      match: "Disputamos todo",
    });
  });
});

describe("what a prospect reads, under full service", () => {
  const clean = (text: string) => expect(checkMarketingCopy(text, "full_service"), text).toEqual([]);

  it("passes the advertising claim rules, every line, in Spanish and in English", () => {
    for (const locale of ["es", "en"] as const) {
      const lines = marketingStrings(locale);
      expect(lines.length).toBeGreaterThan(90);
      for (const line of lines) clean(line);
    }
  });

  it("says what the service is, in the same words on the landing page and on /empezar", () => {
    const { landing, empezar } = MARKETING.es;
    expect(landing.lead).toBe(
      "Tú nos dices qué está mal en tu reporte. Nuestro equipo prepara y envía las cartas por ti y te mantiene al tanto.",
    );
    expect(`${empezar.headline} ${empezar.headlineAccent}`).toBe("Tú nos dices qué está mal. Nosotros enviamos las cartas.");
    expect(empezar.leadStrong).toBe("Nuestro equipo prepara y envía las cartas por ti");
    expect(MARKETING.en.landing.lead).toBe(
      "You tell us what is wrong on your report. Our team prepares and mails the letters for you and keeps you posted.",
    );
    // Results are never promised, and the pages say so.
    expect(empezar.leadAfter).toMatch(/Los resultados varían/);
    expect(MARKETING.en.empezar.leadAfter).toMatch(/Results vary/);
  });

  it("leads with talking to the team", () => {
    for (const locale of ["es", "en"] as const) {
      const { landing, empezar } = MARKETING[locale];
      expect(`${landing.talk} ${empezar.ctaWhatsapp}`).toMatch(/equipo|team/);
      expect(empezar.steps[0]!.title).toMatch(/Habla con nuestro equipo|Talk to our team/);
    }
    // The landing page uses the same button mechanics as /empezar.
    const landing = readFileSync("src/components/marketing/LandingContent.tsx", "utf8");
    expect(landing).toContain("NEXT_PUBLIC_WHATSAPP_NUMBER");
    expect(landing).toContain("c.talk");
  });

  it("never says the service is free, or that monitoring is the only cost", () => {
    for (const locale of ["es", "en"] as const) {
      for (const line of marketingStrings(locale)) {
        expect(line, line).not.toMatch(/\bgratis\b|gratuit|\bfree\b|[uú]nico costo|un solo costo|only cost|single cost/i);
      }
    }
  });

  it("states no price on the landing page or on /empezar", () => {
    const walk = (value: unknown, out: string[] = []): string[] => {
      if (typeof value === "string") out.push(value);
      else if (Array.isArray(value)) value.forEach((v) => walk(v, out));
      else if (value && typeof value === "object") Object.values(value).forEach((v) => walk(v, out));
      return out;
    };
    for (const locale of ["es", "en"] as const) {
      const { landing, empezar } = MARKETING[locale];
      for (const line of [...walk(landing), ...walk({ ...empezar, step: empezar.step(1) })]) {
        expect(line, line).not.toMatch(/\$|\d+\s*(dólares|dollars|usd)|\/\s*(mes|month)|\bal mes\b|\ba month\b/i);
      }
    }
    // How billing works is described, without an amount, in one FAQ answer.
    const cost = MARKETING.es.empezar.faq.find(([question]) => question === "¿Cuánto cuesta?")![1];
    expect(cost).toMatch(/Nuestro equipo te explica el plan antes de que firmes/);
    expect(cost).toMatch(/Cada cobro es por trabajo que ya se hizo/);
    expect(cost).toMatch(/que le pagas directo al servicio de monitoreo/);
  });

  it("no longer tells the visitor that they approve or send the letters", () => {
    for (const locale of ["es", "en"] as const) {
      for (const line of marketingStrings(locale)) {
        expect(line, line).not.toMatch(
          /t[uú] env[ií]as|t[uú] apruebas|apru[eé]b|env[ií]alas|you approve|you send|\bapprove\b|give the OK|das el OK/i,
        );
      }
    }
  });

  it("keeps the client's decisions with the client", () => {
    const { empezar } = MARKETING.es;
    const disputes = empezar.faq.find(([question]) => question === "¿Ustedes disputan por mí?")![1];
    expect(disputes).toMatch(/^Sí, en lo que tú nos indicas\./);
    expect(disputes).toMatch(/esa decisión es solo tuya/);
    expect(disputes).toMatch(/No disputamos todo lo negativo/);
    expect(empezar.steps[1]!.body).toMatch(/Esas respuestas son tuyas: nadie las decide por ti\./);
    expect(MARKETING.en.empezar.steps[1]!.body).toMatch(/Those answers are yours: nobody makes them for you\./);
  });

  it("takes the company name from the brand file", () => {
    const source = readFileSync("src/lib/i18n/marketing.ts", "utf8");
    expect(source).not.toMatch(/Credalti/);
    expect(MARKETING.es.landing.footer.startsWith("Credalti es una empresa de servicios de crédito.")).toBe(true);
  });

  it("describes the page the same way in the page metadata", () => {
    for (const file of ["src/app/layout.tsx", "src/app/empezar/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("nuestro equipo prepara y envía las cartas por ti");
      expect(source, file).not.toMatch(/gratuito|tú apruebas|tú envías/);
    }
  });
});

describe("what a client reads in the app, under full service", () => {
  const clean = (text: string) => expect(checkMarketingCopy(text, "full_service"), text).toEqual([]);

  it("keeps the letters and rounds pages inside the claim rules", () => {
    for (const d of Object.values(DICTS)) {
      const t = d.team;
      for (const n of [1, 3]) {
        for (const line of [
          t.lettersLead, t.lettersSubtitle(n, n), t.statusPreparing, t.statusMailed("21 de noviembre"), t.statusWaiting,
          t.preparingTitle, t.preparingBody, t.mailedTitle, t.mailedBody("21 de noviembre"), t.changeNote,
          t.reviewFirstTitle, t.reviewFirstBody, t.continueReview, t.readLetters(n), t.trackRound,
          t.roundsSubtitle(30, 40), t.roundPreparingBody, t.lettersInRound(n), t.waitDays(n), t.responseNote,
          t.roundsEmptyTitle, t.roundsEmptyBody, d.audit.ctaNote,
        ]) {
          expect(line.trim().length).toBeGreaterThan(0);
          clean(line);
          // Process and status only: nothing about what a letter will achieve.
          expect(line, line).not.toMatch(/mejor|sube|aumenta|better|improve|increase|boost|raise/i);
        }
      }
    }
  });

  it("heads the letters page with whose work it is, and asks the client to approve nothing", () => {
    expect(DICTS.es.team.lettersLead).toBe("Esto es lo que tu equipo envía por ti.");
    expect(DICTS.en.team.lettersLead).toBe("This is what your team mails for you.");
    expect(DICTS.es.team.lettersSubtitle(2, 3)).toBe(
      "2 cartas con los 3 elementos que tú confirmaste. Nuestro equipo las prepara y las envía por correo. Tú no tienes que aprobar ni enviar nada.",
    );
    expect(DICTS.es.team.lettersSubtitle(1, 1)).toMatch(/^1 carta con el elemento que tú confirmaste\./);
    expect(DICTS.en.team.lettersSubtitle(1, 1)).toMatch(/^1 letter with the item you confirmed\./);
    expect(DICTS.es.team.statusMailed("21 de noviembre")).toBe("Enviada el 21 de noviembre");
    expect(DICTS.es.team.waitDays(1)).toMatch(/~1 día más/);
  });

  it("has no approve step on the letters page or in the chat", () => {
    const chat = readFileSync("src/app/(app)/asistente/page.tsx", "utf8");
    // The approve action refuses to run, and its button is not rendered.
    expect(chat).toMatch(/const approve = \(\) => \{\s+if \(isFullService\) return;/);
    expect(chat).toMatch(/\{!isFullService && \(\s+<button\s+onClick=\{approve\}/);
    const letters = readFileSync("src/app/(app)/attack/page.tsx", "utf8");
    // The approve button sits in the branch that full service never renders.
    const readOnly = letters.indexOf("{isFullService ? (");
    expect(readOnly).toBeGreaterThan(0);
    expect(letters.indexOf("setRoundApproved(true)")).toBeGreaterThan(readOnly);
    expect(letters.slice(readOnly, letters.indexOf(") : (", readOnly))).not.toMatch(/setRoundApproved|approveButton/);
  });

  it("has the assistant say in the chat who prepares and mails the letters", () => {
    for (const mode of MODES) {
      for (const line of [reviewIntroLine(mode, 1), reviewIntroLine(mode, 6), reviewCompleteLine(mode, 1), reviewCompleteLine(mode, 4), reviewFinishedLine(mode), LETTERS_OUT_LINE]) {
        expect(checkMarketingCopy(line.es, mode), line.es).toEqual([]);
        expect(checkMarketingCopy(line.en, mode), line.en).toEqual([]);
      }
    }
    const full = [reviewIntroLine("full_service", 6), reviewCompleteLine("full_service", 4), reviewFinishedLine("full_service")];
    for (const line of full) {
      expect(line.es).toMatch(/nuestro equipo prepara/);
      expect(line.en).toMatch(/our team prepares/);
      expect(`${line.es} ${line.en}`).not.toMatch(/dame el OK|give me the OK/);
    }
    expect(reviewFinishedLine("full_service").es).toMatch(/No tienes que aprobar nada\.$/);
    // Self-serve keeps its own wording for later.
    expect(reviewFinishedLine("self_serve").es).toMatch(/dame el OK/);
    expect(reviewIntroLine("full_service", 1).es).toMatch(/Queda 1\.$/);
  });

  it("does not offer anything as free", () => {
    for (const group of Object.values(HUMAN_HELP)) {
      expect(`${group.es} ${group.en}`).not.toMatch(/gratis|\bfree\b|sin costo|no cost/i);
    }
    const mas = readFileSync("src/app/(app)/mas/page.tsx", "utf8");
    expect(mas).not.toMatch(/antes de enviar|before sending|Qué enviaste|What you sent/);
  });
});

describe("the state of a round, as the client app shows it under full service", () => {
  const base = { totalItems: 9, reviewedCount: 9, letterCount: 2, mailed: false };

  it("is 'preparing' once the review is finished with something confirmed", () => {
    expect(teamRoundStatus(base)).toBe("preparing");
  });

  it("waits for the review to finish, and has nothing to send when nothing was confirmed", () => {
    expect(teamRoundStatus({ ...base, reviewedCount: 4 })).toBe("reviewing");
    expect(teamRoundStatus({ ...base, reviewedCount: 0, letterCount: 0 })).toBe("reviewing");
    expect(teamRoundStatus({ ...base, letterCount: 0 })).toBe("nothing_to_send");
  });

  it("is 'mailed' only when the saved state says so, and stays mailed if an item is reopened", () => {
    expect(teamRoundStatus({ ...base, mailed: true })).toBe("mailed");
    expect(teamRoundStatus({ ...base, mailed: true, reviewedCount: 8 })).toBe("mailed");
    // A mailed flag with no letters is not a mailed round.
    expect(teamRoundStatus({ ...base, mailed: true, letterCount: 0 })).toBe("nothing_to_send");
  });

  it("never has a mailing date for a round that was not mailed", () => {
    const now = new Date("2026-11-21T15:00:00.000Z");
    expect(roundMailedDate(false, null, now)).toBeNull();
    expect(roundMailedDate(false, "2026-11-01T10:00:00.000Z", now)).toBeNull();
    // The saved date when there is one; today for a round approved before dates were kept.
    expect(roundMailedDate(true, "2026-11-01T10:00:00.000Z", now)!.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(roundMailedDate(true, null, now)).toBe(now);
    expect(roundMailedDate(true, "not a date", now)).toBe(now);
  });
});

describe("WhatsApp messages", () => {
  const events: WhatsAppEvent[] = [
    { kind: "report_imported" },
    { kind: "attack_ready", roundNumber: 2 },
    { kind: "letters_mailed", roundNumber: 2, letterCount: 5 },
    { kind: "letters_mailed", roundNumber: 1, letterCount: 1 },
    { kind: "items_deleted", deletedCount: 2, remainingCount: 3 },
    { kind: "day40_reengage", deletedCount: 1, remainingCount: 4 },
    { kind: "day40_reengage", deletedCount: 0, remainingCount: 1 },
  ];

  it("pass the claim rules in both modes", () => {
    for (const mode of MODES) {
      for (const event of events) {
        expect(checkMarketingCopy(renderMessage(event, mode), mode), `${mode} ${event.kind}`).toEqual([]);
      }
    }
  });

  it("never ask a full-service client to approve or send", () => {
    for (const event of events) {
      const text = renderMessage(event, "full_service");
      expect(text, event.kind).not.toMatch(/aprobaci[oó]n|aprueba|presiona enviar|tú envías|armar tu próxima/i);
      expect(text).toBe(renderMessage(event));
    }
    expect(renderMessage({ kind: "attack_ready", roundNumber: 2 }, "full_service")).toMatch(
      /Tu equipo está preparando tu ronda de cartas #2.*No tienes que aprobar ni enviar nada\./,
    );
    expect(renderMessage({ kind: "letters_mailed", roundNumber: 1, letterCount: 1 }, "full_service")).toMatch(
      /Tu equipo envió por correo la carta de tu ronda #1\./,
    );
    expect(renderMessage({ kind: "day40_reengage", deletedCount: 0, remainingCount: 1 }, "full_service")).toMatch(
      /Revisamos tu reporte de nuevo: el elemento sigue en tu reporte\./,
    );
    // Self-serve keeps its wording.
    expect(renderMessage({ kind: "attack_ready", roundNumber: 2 }, "self_serve")).toMatch(/Tú decides, tú envías\./);
  });

  it("introduce the assistant as AI and hand a lead to a person", () => {
    for (const text of [CLIENT_FALLBACK_REPLY, LEAD_GREETING]) {
      expect(checkMarketingCopy(text), text).toEqual([]);
      expect(text).toContain(`Soy ${ASSISTANT_NAME}, el asistente de IA de Credalti`);
      expect(text).not.toMatch(/preparar tus cartas|\$/);
    }
    expect(LEAD_GREETING).toMatch(/Una persona de nuestro equipo te responde aquí mismo/);
    const webhook = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
    expect(webhook).toContain("Esta persona todavía no es cliente");
  });
});

describe("the assistant's instructions", () => {
  const full = coachSystemPrompt("full_service");
  const self = coachSystemPrompt("self_serve");

  it("describe full service in the app's mode", () => {
    expect(COACH_SYSTEM_PROMPT).toBe(full);
    expect(full).toMatch(/servicio completo/);
    expect(full).toMatch(/prepara las cartas de disputa y las envía por correo a nombre del cliente/);
    expect(full).toMatch(/El cliente no aprueba ni envía cartas/);
    expect(full).not.toMatch(/DIY|hazlo tú mismo|tú envías/);
  });

  it("never promise a result, never pick the items, never quote a price, and hand over to the team", () => {
    for (const prompt of [full, self]) {
      expect(prompt).toMatch(/NUNCA garantices eliminaciones, resultados, ni aumentos de puntaje/);
      expect(prompt).toMatch(/NUNCA le digas al (cliente|usuario) qué elementos marcar/);
      expect(prompt).toMatch(/NUNCA des un precio/);
      expect(prompt).toMatch(/persona del equipo/);
      expect(prompt).toMatch(/SIEMPRE eres transparente en que eres una inteligencia artificial/);
      // No amount anywhere in the instructions.
      expect(prompt).not.toMatch(/\$\s?\d/);
    }
    expect(full).toMatch(/NUNCA digas que el equipo decide qué disputar, ni que se disputa todo lo negativo/);
    expect(full).toMatch(/pásalo al equipo/);
  });

  it("keep the self-serve wording for later", () => {
    expect(self).toMatch(/El USUARIO es quien disputa/);
    expect(self).toMatch(/tú envías/);
    expect(self).not.toMatch(/servicio completo/);
  });
});

describe("what sales says", () => {
  it("sends an invitation that describes full service", () => {
    const message = inviteMessageEs({ name: "María" }, "https://app.example/onboarding?n=Mar%C3%ADa");
    expect(checkMarketingCopy(message, "full_service")).toEqual([]);
    expect(message).toMatch(/firmas tu acuerdo de servicio, subes tu identificación y un comprobante de domicilio, y conectas tu monitoreo/);
    expect(message).toMatch(/Tú decides qué es inexacto y por qué; nuestro equipo prepara y envía las cartas por ti\./);
    expect(message).not.toMatch(/apruebas|tú envías|gratis|\$/);
  });

  it("keeps the two lists short, and what may be said inside the claim rules", () => {
    expect(SALES_MAY_SAY.length).toBeLessThanOrEqual(5);
    expect(SALES_MAY_NOT_SAY.length).toBeLessThanOrEqual(5);
    for (const line of SALES_MAY_SAY) expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
    const may = SALES_MAY_SAY.join(" ");
    expect(may).toMatch(/nuestro equipo prepara y envía las cartas/);
    expect(may).toMatch(/El monitoreo es una suscripción aparte/);
    expect(may).toMatch(/El plan se explica antes de firmar/);
    expect(may).toMatch(/3 días hábiles para cancelar sin costo/);
    const mayNot = SALES_MAY_NOT_SAY.join(" ");
    expect(mayNot).toMatch(/Resultados, puntos, fechas o aprobaciones/);
    expect(mayNot).toMatch(/«eliminamos»/);
    expect(mayNot).toMatch(/Qué marcar/);
    expect(mayNot).toMatch(/Presión/);
    expect(mayNot).toMatch(/no cierres ventas ni tomes pagos por llamada/);
    // No amount is ever written down for sales to repeat.
    expect(`${may} ${mayNot}`).not.toMatch(/\$|[uú]nico costo/);
  });

  it("shows both lists on the invite page", () => {
    const page = readFileSync("src/app/equipo/invitar/page.tsx", "utf8");
    // In the member's language: the Spanish lists or their English twins.
    expect(page).toContain("t(SALES_MAY_SAY, SALES_MAY_SAY_EN).map");
    expect(page).toContain("t(SALES_MAY_NOT_SAY, SALES_MAY_NOT_SAY_EN).map");
    expect(page).not.toMatch(/[uú]nico costo|aprueba todo/);
  });
});
