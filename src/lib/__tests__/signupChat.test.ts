import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TalkToPerson from "@/components/signup/TalkToPerson";
import { aiByline, CAMEO_NAME } from "@/lib/brand";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { NO_SOFT_PULL, registerSoftPullProvider, reportStepMode, softPullProvider, SOFT_PULL_CONSENT } from "@/lib/credit/softPull";
import { DEMO_CLIENT_REPORT } from "@/lib/demo";
import { CASE_REF_ALPHABET, isCaseRef, newCaseRef, normalizeCaseRef } from "@/lib/signup/caseRef";
import { allSignupLines, SIGNUP_COPY, transcript } from "@/lib/signup/copy";
import { reportCounts, reportSummaryLines } from "@/lib/signup/reportSummary";
import { currentQuestion, newProgress, parseProgress, SIGNUP_STEPS, stageOf, stageRank, STEP_LABELS, stepLabel, type SignupProgress } from "@/lib/signup/steps";
import { CHAT_START, primaryCta } from "@/lib/site/cta";
import { longSentences } from "@/lib/ux/plainLanguage";

// The chat signup with Alti (/registro, docs/SIGNUP-CHAT.md): the case
// reference, the five steps and the saved progress, every word Alti says
// (claim rules, AI disclosure, no pressure, nothing free), the report in
// counts only, the soft-pull interface (none by default), and what the
// screens may and may not contain.

const LOCALES = ["en", "es"] as const;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const SCREENS = [...files("src/app/registro"), ...files("src/components/signup")];
const read = (f: string) => readFileSync(f, "utf8");
const code = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

describe("signup chat: the case reference", () => {
  it("is CR- and five characters with no look-alikes", () => {
    expect(CASE_REF_ALPHABET).not.toMatch(/[01ILOUV]/);
    for (let i = 0; i < 300; i += 1) {
      const ref = newCaseRef();
      expect(ref).toMatch(/^CR-[2-9A-HJKMNP-TW-Z]{5}$/);
      expect(isCaseRef(ref)).toBe(true);
    }
    // The database checks the same pattern (migration 0032).
    expect(read("supabase/migrations/0032_calls.sql")).toContain("case_ref ~ '^CR-[2-9A-HJKMNP-TW-Z]{5}$'");
  });

  it("is spread evenly and rarely repeats", () => {
    const refs = new Set(Array.from({ length: 2000 }, () => newCaseRef()));
    expect(refs.size).toBeGreaterThan(1990);
    // Rejection sampling: a byte above the last multiple of 29 is never used.
    const bytes = [255, 254, 253, 0, 1, 2, 3, 4];
    let i = 0;
    const ref = newCaseRef((n) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]!));
    expect(ref).toBe("CR-23456");
  });

  it("reads what a person types or says back", () => {
    expect(normalizeCaseRef("cr 7kq4m")).toBe("CR-7KQ4M");
    expect(normalizeCaseRef(" CR-7KQ4M ")).toBe("CR-7KQ4M");
    expect(normalizeCaseRef("7kq4m")).toBe("CR-7KQ4M");
    expect(normalizeCaseRef("CRAB2")).toBe("CR-CRAB2");
    expect(normalizeCaseRef("CR-7KQ4O")).toBeNull();
    expect(normalizeCaseRef("hello")).toBeNull();
  });
});

describe("signup chat: the five steps and the saved progress", () => {
  const walk = (): SignupProgress[] => {
    const p = newProgress("CR-7KQ4M", null, new Date("2026-11-24T15:00:00Z"));
    const steps: SignupProgress[] = [p];
    const next = (patch: Partial<SignupProgress>) => {
      const last = steps[steps.length - 1]!;
      steps.push({ ...last, ...patch, answers: { ...last.answers, ...(patch.answers ?? {}) } });
    };
    next({ path: "chat" });
    next({ answers: { ...p.answers, firstName: "Rosa" } });
    next({ answers: { ...p.answers, firstName: "Rosa", goal: "mortgage" } });
    next({ answers: { ...p.answers, firstName: "Rosa", goal: "mortgage", state: "TX" } });
    next({ answers: { ...p.answers, firstName: "Rosa", goal: "mortgage", state: "TX", lastName: "Martínez" } });
    next({ answers: { ...p.answers, firstName: "Rosa", goal: "mortgage", state: "TX", lastName: "Martínez", idType: "itin" } });
    next({ answers: { ...p.answers, firstName: "Rosa", goal: "mortgage", state: "TX", lastName: "Martínez", idType: "itin", email: "" } });
    next({ signedIn: true });
    next({ identity: "later" });
    next({ reportSeen: true });
    next({ option: "full_service" });
    next({ planSeen: true });
    next({ stage: "done" });
    return steps;
  };

  it("are Get started, Your info, Verify identity, Your report, Sign up", () => {
    expect(Object.values(STEP_LABELS.en)).toEqual(["Get started", "Your info", "Verify identity", "Your report", "Sign up"]);
    expect(Object.keys(STEP_LABELS.es)).toEqual([...SIGNUP_STEPS]);
    expect(stepLabel("info", "en")).toBe("Step 2 of 5 · Your info");
    expect(stepLabel("report", "es")).toBe("Paso 4 de 5 · Tu reporte");
    expect(stepLabel("done", "en")).toBe("Step 5 of 5 · Sign up");
  });

  it("ask one thing at a time, in order, and the bar follows", () => {
    const questions = walk().map(currentQuestion);
    // The option (Credalti Complete or Credalti DIY) is chosen after the report and before the plan.
    expect(questions).toEqual(["choose", "firstName", "goal", "state", "lastName", "idType", "email", "phone", "identity", "report", "option", "plan", "agreement", "done"]);
    const stages = questions.map(stageOf);
    expect(stages).toEqual(["start", "start", "start", "start", "info", "info", "info", "info", "identity", "report", "signup", "signup", "signup", "done"]);
    // Never backwards.
    for (let i = 1; i < stages.length; i += 1) expect(stageRank(stages[i]!)).toBeGreaterThanOrEqual(stageRank(stages[i - 1]!));
  });

  it("are kept on the device field by field, and nothing else comes back", () => {
    const last = { ...walk().at(-1)!, reportCounts: { accounts: 4, collections: 1, latePayments: 1, inquiries: 2, publicRecords: 0, personalInfo: 3 }, signedName: "Rosa Martínez", deadlineIso: "2026-11-27T05:59:59.999Z" };
    const back = parseProgress(JSON.stringify({ ...last, ssn: "123-45-6789", answers: { ...last.answers, ssn: "123456789" } }));
    expect(back).toEqual(last);
    expect(JSON.stringify(back)).not.toMatch(/123-?45-?6789/);
    expect(parseProgress("{")).toBeNull();
    expect(parseProgress(JSON.stringify({ version: 1, caseRef: "CR-0OIL1" }))).toBeNull();
    expect(parseProgress(JSON.stringify({ ...last, reportCounts: { accounts: -1 } }))!.reportCounts).toBeNull();
    expect(parseProgress(JSON.stringify({ ...last, answers: { ...last.answers, state: "Texas", goal: "yacht" } }))!.answers).toMatchObject({ state: null, goal: null });
  });

  it("the transcript is rebuilt from the answers, in either language, and starts with Alti saying he is AI", () => {
    const done = walk().at(-1)!;
    for (const locale of LOCALES) {
      const lines = transcript(done, locale, { demo: true, monitoring: { provider: null, price: "~$32" } });
      expect(lines[0]!.who).toBe("alti");
      expect(lines[0]!.text).toMatch(locale === "en" ? /AI assistant\. I'm artificial intelligence, not a person/ : /asistente con IA de Credalti\. Soy inteligencia artificial, no una persona/);
      expect(lines.some((l) => l.text.includes("CR-7KQ4M"))).toBe(true);
      expect(lines.filter((l) => l.who === "you").map((l) => l.text)).toContain("Martínez");
      // The monitoring path (no report on file): bought after signing.
      expect(lines.map((l) => l.text).join(" ")).toMatch(locale === "en" ? /right after you sign/ : /justo después de firmar/);
    }
    // A question not answered yet ends the transcript.
    const early = transcript(walk()[2]!, "en", { demo: true, monitoring: { provider: null, price: "~$32" } });
    expect(early.at(-1)!.text).toBe(SIGNUP_COPY.en.alti.askGoal);
  });
});

describe("signup chat: every word", () => {
  for (const locale of LOCALES) {
    it(`${locale}: passes the claim rules and the advertising rules, under full service`, () => {
      const lines = allSignupLines(locale);
      expect(lines.length).toBeGreaterThan(90);
      for (const line of lines) {
        expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
      }
    });

    it(`${locale}: nothing free, no pressure, no outcome, no score talk, short sentences`, () => {
      for (const line of allSignupLines(locale)) {
        expect(line, line).not.toMatch(/\bfree\b|gratis|gratuit/i);
        expect(line, line).not.toMatch(/today only|last (spots?|chance)|hurry|act now|limited time|don't wait|solo hoy|[uú]ltimos lugares|ap[uú]rate|date prisa|por tiempo limitado|no esperes/i);
        expect(line, line).not.toMatch(/\b(deleted|removed|fixed|approved|guaranteed)\b|\b(eliminad[oa]s?|borrad[oa]s?|arreglad[oa]s?|aprobad[oa]s?|garantizad[oa]s?)\b/i);
        expect(line, line).not.toMatch(/\bscores?\b|puntaje|\+\s?\d+\s?(pts?|points?|puntos?)/i);
      }
      expect(longSentences(allSignupLines(locale)).map((l) => `${l.words}: ${l.sentence}`)).toEqual([]);
    });
  }

  it("is the same chat in both languages", () => {
    expect(allSignupLines("es")).toHaveLength(allSignupLines("en").length);
    expect(SIGNUP_COPY.en.choose.alti).toBe("Sign up now with Alti");
    expect(SIGNUP_COPY.en.choose.person).toBe("Talk to a person first");
    expect(SIGNUP_COPY.en.talk.button).toBe("Rather talk to someone?");
    expect(SIGNUP_COPY.en.sheet.read).toBe("I read this");
    expect(SIGNUP_COPY.en.sheet.question).toBe("I have a question first");
    expect(SIGNUP_COPY.en.sheet.stepOf(1, "TX")).toBe("Step 1 of 2 · TX");
  });

  it("the client decides what is inaccurate, and nobody promises how the bureaus respond", () => {
    expect(SIGNUP_COPY.en.alti.reportYouChoose).toMatch(/Only you decide/);
    expect(SIGNUP_COPY.es.alti.reportYouChoose).toMatch(/Solo tú lo decides/);
    expect(SIGNUP_COPY.en.alti.reportNoPromise).toMatch(/Nobody can promise/);
  });
});

describe("signup chat: the report, in words and counts only", () => {
  it("counts an account once across the bureaus", () => {
    const counts = reportCounts(DEMO_CLIENT_REPORT.items);
    // Seven account lines on three bureaus are five accounts: Midland and Capital One are on two each.
    expect(counts.accounts).toBe(5);
    // Midland and Portfolio Recovery.
    expect(counts.collections).toBe(2);
    expect(counts.inquiries).toBeGreaterThanOrEqual(2);
    expect(counts.latePayments).toBeGreaterThanOrEqual(1);
  });

  it("says it in a sentence, never with a score", () => {
    const counts = { accounts: 5, collections: 3, latePayments: 2, inquiries: 1, publicRecords: 0, personalInfo: 2 };
    expect(reportSummaryLines(counts, "en")).toEqual([
      "Your report lists 5 accounts. Among them: 3 collections and 2 accounts with late payments.",
      "It also shows 1 inquiry and 2 names, addresses or employers in your personal details.",
    ]);
    expect(reportSummaryLines(counts, "es")[0]).toBe("Tu reporte muestra 5 cuentas. Entre ellas, 3 cobranzas y 2 cuentas con pagos tardíos.");
    expect(reportSummaryLines({ accounts: 0, collections: 0, latePayments: 0, inquiries: 0, publicRecords: 0, personalInfo: 0 }, "en")).toEqual(["Your report shows no accounts or inquiries."]);
    for (const locale of LOCALES) {
      for (const line of reportSummaryLines(reportCounts(DEMO_CLIENT_REPORT.items), locale)) {
        expect(line).not.toMatch(/\b\d{3}\b|score|puntaje/i);
        expect(checkMarketingCopy(line, "full_service")).toEqual([]);
      }
    }
    // The screens read counts, never the scores.
    for (const file of SCREENS) expect(code(file), file).not.toMatch(/\.scores\b|scoreHistory|bureauScore/);
  });
});

describe("signup chat: the instant soft pull is an interface, with no provider", () => {
  it("defaults to none, and then the step uses the monitoring subscription", () => {
    expect(softPullProvider({}).id).toBe("none");
    expect(softPullProvider({ SOFT_PULL_PROVIDER: "acme" }).id).toBe("none");
    expect(reportStepMode({ providerId: "none", hasReport: false })).toBe("monitoring");
    expect(reportStepMode({ providerId: "none", hasReport: true })).toBe("summary");
    expect(reportStepMode({ providerId: "acme", hasReport: false })).toBe("soft_pull");
  });

  it("a provider counts only when registered and configured", async () => {
    registerSoftPullProvider({ id: "test-pull", displayName: "Test", isAvailable: (env) => Boolean(env?.TEST_PULL_KEY), pull: async () => ({ ok: false, reason: "no_file" }) });
    expect(softPullProvider({ SOFT_PULL_PROVIDER: "test-pull" }).id).toBe("none");
    expect(softPullProvider({ SOFT_PULL_PROVIDER: "test-pull", TEST_PULL_KEY: "k" }).id).toBe("test-pull");
    expect(await NO_SOFT_PULL.pull({ userId: "u", consent: { version: SOFT_PULL_CONSENT.version, textHash: "x", at: "" }, locale: "en" })).toEqual({ ok: false, reason: "not_configured" });
    expect(() => registerSoftPullProvider({ ...NO_SOFT_PULL, id: "Bad Id" })).toThrow();
  });

  it("calls no credit API", () => {
    expect(code("src/lib/credit/softPull.ts")).not.toMatch(/fetch\(|https?:\/\//);
    expect(checkClaimGuardrails(SOFT_PULL_CONSENT.en)).toEqual([]);
  });
});

describe("signup chat: the screens", () => {
  it("label Alti as AI and never show the robot", () => {
    const all = SCREENS.map(code).join("\n");
    expect(all).toMatch(/aiByline\(locale\)/);
    for (const file of SCREENS) {
      expect(code(file), file).not.toMatch(new RegExp(`\\b${CAMEO_NAME}\\b|character="cameo"|cameoImages|altibot_`));
    }
    expect(read("src/components/signup/Bubbles.tsx")).toMatch(/data-testid="ai-byline"[\s\S]*aiByline\(locale\)[\s\S]*sr-only">\{aiByline\(locale\)\}/);
    expect(aiByline("en")).toBe("Alti · AI assistant");
  });

  it("'Talk to a person' shows a person icon, never a character", () => {
    const talk = code("src/components/signup/TalkToPerson.tsx");
    expect(talk).not.toMatch(/Character/);
    expect(talk).toMatch(/name="person"/);
    const chat = code("src/components/signup/SignupChat.tsx");
    const personChoice = chat.slice(chat.indexOf('data-testid="choose-person"'), chat.indexOf("</button>", chat.indexOf('data-testid="choose-person"')));
    expect(personChoice).toMatch(/PersonIcon/);
    expect(personChoice).not.toMatch(/CharacterAvatar/);
  });

  it("show no score visual and no SMS sending", () => {
    for (const file of SCREENS) {
      const text = code(file);
      expect(text, file).not.toMatch(/strokeDasharray|conic-gradient|<Gauge|ScoreRing|arrowUp|arrowDown/);
      expect(text, file).not.toMatch(/twilio|sendSms|sms:/i);
    }
  });

  it("reuse the existing records instead of new ones", () => {
    const chat = code("src/components/signup/SignupChat.tsx");
    // The profile onboarding writes, the intake upload, the address, the open states, the waitlist, the monitoring offer.
    for (const needle of ["/api/profile/onboarding", "<IdentityDocs />", "<MailingAddress />", "useOpenStates()", "/api/waitlist", "MONITORING_OFFER", "parseInvite("]) {
      expect(chat).toContain(needle);
    }
    // The agreement's own store, documents, readiness and signature rules.
    const sheets = code("src/components/signup/AgreementSheets.tsx");
    for (const needle of ["useAgreement()", "agreementDocuments(locale, terms)", "agreementReadiness(", "signerNameMatches(", "acknowledge(locale)", "sign(name, locale)", 'find("federal_disclosure")']) {
      expect(sheets).toContain(needle);
    }
    // The attestation is not touched here, and its words are as they were.
    for (const file of SCREENS) expect(read(file), file).not.toMatch(/ATTESTATION_TEXT/);
    expect(ATTESTATION_TEXT.en).toBe("I believe this item is inaccurate, unverifiable, or outdated.");
  });

  it("have labels on inputs and keyboard paths", () => {
    const chat = code("src/components/signup/SignupChat.tsx");
    expect(chat).toMatch(/<span className="sr-only">\{label\}<\/span>/);
    expect(chat).toMatch(/role="log" aria-live="polite"/);
    expect(chat).toMatch(/prefers-reduced-motion: reduce/);
    expect(code("src/components/signup/AgreementSheets.tsx")).toMatch(/e\.key === "Escape"/);
    expect(code("src/components/signup/TalkToPerson.tsx")).toMatch(/e\.key === "Escape"/);
    expect(code("src/components/signup/SignupProgressBar.tsx")).toMatch(/aria-current=\{state === "current" \? "step" : undefined\}/);
  });

  it("offer a call only when calls are on", () => {
    const render = (callsEnabled: boolean) => renderToStaticMarkup(createElement(TalkToPerson, { locale: "en", caseRef: "CR-7KQ4M", callsEnabled, onClose: () => undefined, onChosen: () => undefined }));
    expect(render(false)).not.toMatch(/Schedule a call|registro\/llamada/);
    expect(render(true)).toMatch(/Schedule a call/);
    expect(render(true)).toMatch(/Questions only/);
    // The booking page does not exist while calls are off.
    expect(code("src/app/registro/llamada/page.tsx")).toMatch(/if \(!callsEnabled\(\)\) notFound\(\)/);
  });

  it("are linked from the website's start, without changing the main button", () => {
    for (const locale of LOCALES) {
      expect(primaryCta(locale, null).href).toBe("/onboarding");
      expect(primaryCta(locale, "15551234567").href).toMatch(/^https:\/\/wa\.me\//);
      expect(primaryCta(locale, null).chat.href).toBe(CHAT_START);
    }
    expect(CHAT_START).toBe("/registro");
    expect(read("src/components/site/ui.tsx")).toMatch(/cta\.chat\.href/);
    expect(read("src/proxy.ts")).toContain('"/registro/:path*"');
  });
});
