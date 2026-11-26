import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoCatalogue } from "@/lib/billing/catalogue";
import { periodTiming, planOption, planTermsHash, snapshotPlan, validatePlanTerms, type PlanTerms, type PlanVersion } from "@/lib/billing/plans";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { MAILED_ON_MAX_DAYS_BACK, mailedOnProblem, mailFeeCents, mailQuote, UNMAILED_NUDGE_DAYS, unmailedTooLong } from "@/lib/diy/rules";
import { buildInvitePath, inviteMessage, parseInvite } from "@/lib/sales/invite";
import {
  BOTH_OPTIONS_NOTE,
  COMPARISON,
  COMPARISON_ROWS,
  effectiveOption,
  OPTION_FOR,
  OPTION_NAME,
  OPTION_SUBTITLE,
  OPTION_TAGLINE,
  optionOfTerms,
  parseServiceOption,
  PRICE_SET_BY_TEAM,
  SERVICE_OPTIONS,
  START_WITH_DIY,
} from "@/lib/service/options";
import { monitoringNote, optionPricesFrom } from "@/lib/site/planText";
import { can, exceptionVisibleTo, STAFF_ROLES } from "@/lib/staff/permissions";
import { buildDemoClients } from "@/lib/staff/demoClients";
import { clientExceptions, clientOption, clientStage, isDiy, sendableRound } from "@/lib/staff/stage";
import { longSentences } from "@/lib/ux/plainLanguage";

// The two service options (docs/SERVICE-OPTIONS.md) as pure rules: the names,
// the comparison, who may do what in the console, the DIY rules and the plans.

const NOW = new Date("2026-12-05T18:00:00.000Z");
const LOCALES = ["en", "es"] as const;

describe("the two options: names and words", () => {
  it("are Credalti Complete first, Credalti DIY second, with the owner's subtitles", () => {
    expect(SERVICE_OPTIONS).toEqual(["full_service", "diy"]);
    expect(OPTION_NAME.full_service).toEqual({ en: "Credalti Complete", es: "Credalti Complete" });
    expect(OPTION_NAME.diy).toEqual({ en: "Credalti DIY", es: "Credalti DIY" });
    expect(OPTION_SUBTITLE.full_service).toEqual({ en: "Done for you", es: "Lo hacemos por ti" });
    expect(OPTION_SUBTITLE.diy).toEqual({ en: "Do it yourself, guided by Alti", es: "Hazlo tú, con la guía de Alti" });
    expect(OPTION_FOR.full_service.en).toBe("Busy, buying a home soon, or want it handled");
    expect(OPTION_FOR.diy.en).toBe("Hands-on, tighter budget, not in a rush");
    expect(START_WITH_DIY.en).toMatch(/^Start with DIY, upgrade anytime and keep everything you've done/);
  });

  it("read the option from what was signed, else what was chosen, else full service", () => {
    expect(parseServiceOption("diy")).toBe("diy");
    expect(parseServiceOption("self_serve")).toBe("diy");
    expect(parseServiceOption("full_service")).toBe("full_service");
    expect(parseServiceOption("anything")).toBeNull();
    expect(optionOfTerms({ serviceOption: "diy" })).toBe("diy");
    // Every agreement before migration 0042 carries no option: full service, its hash unchanged.
    expect(optionOfTerms({})).toBe("full_service");
    expect(optionOfTerms(null)).toBe("full_service");
    expect(effectiveOption({ signedOption: "full_service", chosenOption: "diy" })).toBe("full_service");
    expect(effectiveOption({ chosenOption: "diy" })).toBe("diy");
    expect(effectiveOption({})).toBe("full_service");
  });

  for (const locale of LOCALES) {
    it(`${locale}: every comparison line passes the claim rules, says nothing free, pushes neither and stays short`, () => {
      const lines = [
        ...SERVICE_OPTIONS.flatMap((o) => [OPTION_NAME[o][locale], OPTION_SUBTITLE[o][locale], OPTION_FOR[o][locale], OPTION_TAGLINE[o][locale]]),
        ...SERVICE_OPTIONS.flatMap((o) => COMPARISON_ROWS.filter((r) => r !== "price").map((r) => COMPARISON[o][r as Exclude<typeof r, "price">][locale])),
        START_WITH_DIY[locale],
        BOTH_OPTIONS_NOTE[locale],
        PRICE_SET_BY_TEAM[locale],
        monitoringNote(locale),
      ];
      for (const line of lines) {
        expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        expect(line, line).not.toMatch(/\bfree\b|gratis|gratuit/i);
        expect(line, line).not.toMatch(/recommended|recomendad|most popular|más popular|best value|mejor opción|hurry|apúrate|today only|solo hoy/i);
        expect(line, line).not.toMatch(/\bSMS\b|text message|mensaje de texto/i);
      }
      expect(longSentences(lines).map((l) => l.sentence)).toEqual([]);
    });
  }

  it("say the monitoring is a separate monthly subscription, with the commission", () => {
    expect(monitoringNote("en")).toMatch(/separate monthly subscription/);
    expect(monitoringNote("en")).toMatch(/earns a commission/);
    expect(monitoringNote("es")).toMatch(/suscripción mensual aparte/);
    expect(monitoringNote("es")).toMatch(/recibe una comisión/);
  });
});

describe("the two options: prices from the offered plans", () => {
  const approve = (p: PlanVersion): PlanVersion => ({ ...p, status: "active", attorney: { name: "A. Lawyer", approvedOn: "2026-11-20" }, termsHash: planTermsHash(p.terms, p.name) });

  it("come only from attorney-approved, offered plans: none in the demo, so the team sets the price", () => {
    expect(optionPricesFrom(demoCatalogue(NOW), "en")).toEqual({ full_service: null, diy: null });
    const prices = optionPricesFrom(demoCatalogue(NOW).map(approve), "en");
    expect(prices.diy!.headline).toBe("$39.00 a month");
    expect(prices.diy!.lines.join(" ")).toMatch(/after your 3 business days to cancel/);
    expect(prices.diy!.lines.join(" ")).toMatch(/\$4\.00 per letter/);
    expect(prices.full_service!.headline.length).toBeGreaterThan(0);
  });
});

describe("the console: who may do what with the two options", () => {
  it("mails a DIY client's letters only for an administrator or a specialist", () => {
    expect(STAFF_ROLES.filter((r) => can(r, "diy.mail_requests"))).toEqual(["admin", "specialist"]);
  });

  it("gives the gentle DIY follow-up to sales (and the administrator), never to a specialist", () => {
    expect(STAFF_ROLES.filter((r) => can(r, "options.followup")).sort()).toEqual(["admin", "sales"]);
    expect(exceptionVisibleTo("sales", "diy_followup")).toBe(true);
    expect(exceptionVisibleTo("specialist", "diy_followup")).toBe(false);
  });

  it("keeps DIY clients out of the round work unless they asked us to mail a letter", () => {
    const clients = buildDemoClients(NOW);
    const later = new Date(NOW.getTime() + 5 * 60 * 1000);
    const byId = (id: string) => clients.find((c) => c.id === id)!;
    const [valeria, arturo, celia] = [byId("c70"), byId("c71"), byId("c72")];
    for (const c of [valeria, arturo, celia]) expect(isDiy(c)).toBe(true);
    expect(clientOption(byId("c01"))).toBe("full_service");
    // Arturo: letters ready, not mailed by him, no request: with the client, nothing to send, a question and the 14-day follow-up.
    expect(clientStage(arturo, later)).toBe("with_client");
    expect(sendableRound(arturo, later)).toBeNull();
    expect(clientExceptions(arturo, later).map((e) => e.kind).sort()).toEqual(["diy_followup", "question_waiting"]);
    // Valeria mailed hers: waiting on the bureaus, no notice.
    expect(clientStage(valeria, later)).toBe("waiting_on_bureaus");
    expect(clientExceptions(valeria, later)).toEqual([]);
    // Celia asked us to mail some: in the send queue with only those letters, and nothing else from the full-service work.
    expect(sendableRound(celia, later)!.letters.map((l) => l.id)).toEqual(celia.mailRequests![0]!.letterIds);
    expect(clientExceptions(celia, later).map((e) => e.kind)).not.toContain("review_stalled");
  });
});

describe("Credalti DIY: the client's rules", () => {
  it("records a mailed date only in the past 30 days, never in the future, never before the letters were prepared", () => {
    const prepared = "2026-12-01T15:00:00.000Z";
    expect(mailedOnProblem("2026-12-04", NOW, prepared)).toBeNull();
    expect(mailedOnProblem("2026-12-05", NOW, prepared)).toBeNull();
    expect(mailedOnProblem("2026-12-09", NOW, prepared)).toBe("future");
    expect(mailedOnProblem("2026-11-20", NOW, prepared)).toBe("before_prepared");
    expect(mailedOnProblem("2026-10-01", NOW, null)).toBe("too_old");
    expect(mailedOnProblem("12/04/2026", NOW, prepared)).toBe("invalid");
    expect(MAILED_ON_MAX_DAYS_BACK).toBe(30);
  });

  it("shows the cost of mailing before the client confirms, from the signed plan only", () => {
    const diy = snapshotPlan(demoCatalogue(NOW).find((p) => p.key === "diy-monthly")!);
    expect(mailFeeCents(diy)).toBe(400);
    expect(mailQuote(400, 3)).toMatchObject({ totalCents: 1200, line: { en: "3 letters × $4.00 = $12.00", es: "3 cartas × $4.00 = $12.00" } });
    expect(mailQuote(400, 1).line.en).toBe("1 letter × $4.00 = $4.00");
    // A full-service plan never offers it.
    const complete = snapshotPlan(demoCatalogue(NOW).find((p) => p.terms.type === "per_round")!);
    expect(mailFeeCents(complete)).toBeNull();
    expect(mailFeeCents(null)).toBeNull();
  });

  it("offers help once after 14 days unmailed, and not after the client marked them mailed", () => {
    const prepared = new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(UNMAILED_NUDGE_DAYS).toBe(14);
    expect(unmailedTooLong(prepared, false, NOW)).toBe(true);
    expect(unmailedTooLong(prepared, true, NOW)).toBe(false);
    expect(unmailedTooLong(new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), false, NOW)).toBe(false);
    expect(unmailedTooLong(null, false, NOW)).toBe(false);
  });
});

describe("plans: one option each", () => {
  const diy = demoCatalogue(NOW).find((p) => p.key === "diy-monthly")!;
  const monthly = demoCatalogue(NOW).find((p) => p.terms.type === "subscription")!;

  it("names its option by its type", () => {
    expect(planOption(diy.terms)).toBe("diy");
    expect(planOption(monthly.terms)).toBe("full_service");
  });

  it("accept the demo DIY plan; refuse a mailing fee on a full-service plan, above the limit, or a DIY plan due before the window ends", () => {
    expect(validatePlanTerms(diy.terms)).toEqual([]);
    expect(validatePlanTerms({ ...monthly.terms, mailFeeCents: 400 }).length).toBeGreaterThan(0);
    expect(validatePlanTerms({ ...diy.terms, mailFeeCents: 2501 }).length).toBeGreaterThan(0);
    expect(validatePlanTerms({ ...diy.terms, dueRule: { kind: "after_round_mailed" } } as unknown as PlanTerms).length).toBeGreaterThan(0);
  });

  it("charge a new full-service monthly plan when the month's round is mailed; an older one keeps its timing and its hash", () => {
    expect(periodTiming(monthly.terms)).toBe("on_mailing");
    const { periodTiming: _drop, ...old } = monthly.terms as PlanTerms & { periodTiming?: string };
    expect(periodTiming(old as PlanTerms)).toBe("period_end");
    expect(planTermsHash(old as PlanTerms, monthly.name)).not.toBe(planTermsHash(monthly.terms, monthly.name));
    expect(validatePlanTerms({ ...diy.terms, periodTiming: "on_mailing" }).length).toBeGreaterThan(0);
  });
});

describe("the invitation carries the option the person chose, and nothing when they have not", () => {
  it("as o=complete or o=diy, read back the same", () => {
    const at = (path: string) => new URL(path, "https://app.test").searchParams;
    expect(at(buildInvitePath({ name: "Rosa", option: "diy" })).get("o")).toBe("diy");
    expect(at(buildInvitePath({ name: "Rosa", option: "full_service" })).get("o")).toBe("complete");
    expect(at(buildInvitePath({ name: "Rosa" })).get("o")).toBeNull();
    expect(parseInvite(at(buildInvitePath({ name: "Rosa", option: "diy" })))?.option).toBe("diy");
    for (const locale of LOCALES) {
      for (const option of [null, ...SERVICE_OPTIONS]) {
        const message = inviteMessage({ name: "Rosa", option }, "https://app.test/x", locale);
        expect(checkClaimGuardrails(message, option ?? "full_service"), message).toEqual([]);
        expect(message).not.toMatch(/\bfree\b|gratis/i);
      }
    }
  });

  it("is chosen on the invitation page with nothing selected by default, and both side by side", () => {
    const page = readFileSync("src/app/equipo/invitar/page.tsx", "utf8");
    expect(page).toMatch(/useState<ServiceOption \| null>\(null\)/);
    expect(page).toMatch(/<OptionComparison/);
    expect(page).toMatch(/buildInvitePath\(\{[^}]*option \}\)/);
  });
});
