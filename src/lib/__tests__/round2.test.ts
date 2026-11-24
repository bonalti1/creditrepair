import { createHash } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as coachPost } from "@/app/api/coach/route";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { checkMarketingCopy } from "@/lib/compliance/guardrails";
import { DEMO_RAW_REPORT, DEMO_REPORT, DEMO_SCORE_HISTORY } from "@/lib/demo";
import { ESTIMATED_CYCLE_DAYS } from "@/lib/rounds/timing";
import { parseReport } from "@/lib/domain/parser";
import type { ReportItem } from "@/lib/domain/types";
import { DICTS } from "@/lib/i18n/dictionaries";
import { MARKETING, marketingStrings } from "@/lib/i18n/marketing";
import { SITE_COPY } from "@/lib/site/copy";
import { monitoringName } from "@/lib/monitoring/offer";
import { GOALS } from "@/lib/sales/invite";
import { resetRateLimits } from "@/lib/security/rateLimit";
import { crossBureauNote, differingAnswerLine, sameItemOnOtherBureaus } from "@/lib/ux/crossBureau";
import { itemCheckHints, itemFacts } from "@/lib/ux/itemDisplay";
import { approvedMessage, itemPhrases, letterCoverage, waitingListNote, waitingNote } from "@/lib/ux/roundCopy";
import { letterItems, sessionPlan } from "@/lib/ux/sessionPlan";

// Second round of the phone test: what the card shows and asks (A), what each
// round mails and what waits (B), the same account on two bureaus (C), the
// coach with no key (D), the notes after approval (E), scores with one pull
// (F), the English first pages (G) and the small copy changes (I).

const items = DEMO_REPORT.items;
const find = (name: string, bureau: string) => items.find((i) => i.name === name && i.bureau === bureau)!;
const personal = (field: string) => items.find((i) => i.category === "personal_info" && i.data.field === field)!;
const clean = (text: string) => expect(checkMarketingCopy(text), text).toEqual([]);
const AT = "2026-11-19T12:00:00.000Z";
const attested = (...list: ReportItem[]) =>
  Object.fromEntries(list.map((i) => [i.fingerprint, { state: "attested", attestedAt: AT }]));

const midlandEq = find("Midland Credit Management", "equifax");
const midlandEx = find("Midland Credit Management", "experian");
const capitalOne = find("Capital One", "equifax");
const autoFinance = find("Auto Finance Corp", "equifax");
const retailCard = find("Retail Card Services", "transunion");

const tradeline = (fields: Record<string, unknown>): ReportItem =>
  parseReport({
    source: "test",
    pulledAt: "2026-07-01T00:00:00.000Z",
    bureaus: { equifax: { tradelines: [{ creditor: "Acme Bank", ...fields }] } },
  }).items[0]!;

describe("A. the card shows what it asks about", () => {
  it("accepts the new optional account fields without changing a fingerprint", () => {
    const expected = (identity: string) => createHash("sha256").update(identity).digest("hex").slice(0, 24);
    expect(capitalOne.fingerprint).toBe(expected("equifax|tradeline|capital one|****1234"));
    expect(midlandEx.fingerprint).toBe(expected("experian|tradeline|midland credit management|****8821"));
    // The same account with and without the new fields is the same item.
    const bare = tradeline({ accountNumberMasked: "****1" });
    const full = tradeline({
      accountNumberMasked: "****1",
      creditLimit: 900,
      lastPaymentAt: "2026-01-02",
      firstDelinquencyAt: "2025-03-04",
      lastReportedAt: "2026-05",
    });
    expect(full.fingerprint).toBe(bare.fingerprint);
  });

  it("shows the limit and each date in plain labels, in both languages", () => {
    const full = tradeline({
      balance: 100,
      creditLimit: 900,
      openedAt: "2020-01-15",
      lastPaymentAt: "2026-01-02",
      firstDelinquencyAt: "2025-03-04",
      lastReportedAt: "2026-05",
    });
    const es = Object.fromEntries(itemFacts(full, "es").map((f) => [f.label, f.value]));
    expect(es).toEqual({
      Saldo: "$100",
      "Límite de crédito": "$900",
      "Fecha de apertura": "15 de enero de 2020",
      "Último pago": "2 de enero de 2026",
      "Primer atraso": "4 de marzo de 2025",
      "Último reporte": "mayo de 2026",
    });
    expect(itemFacts(full, "en").map((f) => f.label)).toEqual([
      "Balance",
      "Credit limit",
      "Opened",
      "Last payment",
      "First late payment",
      "Last reported",
    ]);
  });

  it("gives the demo accounts dates, the same on both bureaus, and no limit on a collection", () => {
    const eq = DEMO_RAW_REPORT.bureaus.equifax!.tradelines;
    const ex = DEMO_RAW_REPORT.bureaus.experian!.tradelines;
    expect(eq[0]).toMatchObject({ creditor: "Capital One", creditLimit: 1500 });
    expect(eq[0]!.openedAt && eq[0]!.lastPaymentAt).toBeTruthy();
    expect(eq[1]!.openedAt).toBe(ex[0]!.openedAt);
    expect(eq[1]!.firstDelinquencyAt).toBe(ex[0]!.firstDelinquencyAt);
    expect(eq[1]!.firstDelinquencyAt).toBeTruthy();
    expect(eq[1]!.creditLimit).toBeUndefined();
    expect(ex[0]!.creditLimit).toBeUndefined();
  });

  it("never asks a collection about a limit, and names the dates that are shown", () => {
    const hints = itemCheckHints(midlandEq, "es");
    expect(hints).toEqual([
      "¿Reconoces al acreedor y la cuenta?",
      "¿El saldo que aparece es correcto?",
      "¿Las fechas que aparecen (apertura, primer atraso) coinciden con tu realidad?",
      "¿Ya pasaron más de 7 años desde el primer atraso? Si sí, podría estar desactualizada.",
    ]);
    expect(hints.join(" ")).not.toMatch(/límite|último pago/);
    expect(itemCheckHints(midlandEq, "en").join(" ")).not.toMatch(/limit|last payment/);
  });

  it("asks a card with a limit and a last payment about those, and not about a first late payment", () => {
    expect(itemCheckHints(capitalOne, "es")).toEqual([
      "¿Reconoces al acreedor y la cuenta?",
      "¿El saldo y el límite de crédito que aparecen son correctos?",
      "¿Las fechas que aparecen (apertura, último pago) coinciden con tu realidad?",
    ]);
    expect(itemCheckHints(capitalOne, "en")).toEqual([
      "Do you recognize the creditor and the account?",
      "Are the balance and the credit limit shown correct?",
      "Do the dates shown (opened, last payment) match your reality?",
    ]);
  });

  it("asks only whether the creditor is recognised when the card shows nothing else", () => {
    expect(itemCheckHints(tradeline({}), "es")).toEqual(["¿Reconoces al acreedor y la cuenta?"]);
    expect(itemCheckHints(tradeline({}), "en")).toEqual(["Do you recognize the creditor and the account?"]);
    expect(itemCheckHints(tradeline({ creditLimit: 500 }), "en")).toContain("Is the credit limit shown correct?");
    expect(itemCheckHints(tradeline({ openedAt: "2020-01-15" }), "es")).toContain(
      "¿La fecha que aparece (apertura) coincide con tu realidad?",
    );
    // No first late payment on the card: no question about seven years.
    expect(itemCheckHints(tradeline({ balance: 5, openedAt: "2010-01-15" }), "es").join(" ")).not.toMatch(/7 años/);
  });

  it("ties every question to a fact on the card", () => {
    // A question that mentions a limit, a balance or a date needs that fact among the card's facts.
    const cases = [
      tradeline({}),
      tradeline({ balance: 10 }),
      tradeline({ creditLimit: 10 }),
      tradeline({ lastReportedAt: "2026-05" }),
      tradeline({ balance: 10, creditLimit: 20, firstDelinquencyAt: "2019-01-01" }),
      ...items,
    ];
    for (const item of cases) {
      const labels = itemFacts(item, "es").map((f) => f.label);
      const questions = itemCheckHints(item, "es").join(" ");
      if (/límite/.test(questions)) expect(labels).toContain("Límite de crédito");
      if (/saldo/.test(questions)) expect(labels).toContain("Saldo");
      if (/primer atraso/.test(questions)) expect(labels).toContain("Primer atraso");
      if (/último pago/.test(questions)) expect(labels).toContain("Último pago");
      if (/apertura/.test(questions)) expect(labels).toContain("Fecha de apertura");
      if (/último reporte/.test(questions)) expect(labels).toContain("Último reporte");
    }
  });

  it("asks inquiries and public records only about what they show", () => {
    expect(itemCheckHints(autoFinance, "es")).toHaveLength(3);
    const [undated, record, bareRecord] = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: {
        equifax: {
          inquiries: [{ inquirer: "Some Lender", date: "" }],
          publicRecords: [
            { recordType: "bankruptcy", court: "S.D. Texas", filedAt: "2021-02-10", status: "discharged" },
            { recordType: "lien" },
          ],
        },
      },
    }).items as [ReportItem, ReportItem, ReportItem];
    expect(itemCheckHints(undated, "en")).toEqual([
      "Do you remember applying for credit with this company?",
      "Did you authorize them to check your credit?",
    ]);
    expect(itemCheckHints(record, "en")).toHaveLength(3);
    expect(itemCheckHints(bareRecord, "es")).toEqual(["¿El registro es realmente tuyo (no de alguien con nombre parecido)?"]);
  });

  it("keeps every question a neutral question inside the claim rules", () => {
    const cases = [
      ...items,
      tradeline({ balance: 10, creditLimit: 20, openedAt: "2019", lastPaymentAt: "2020", firstDelinquencyAt: "2019-01-01", lastReportedAt: "2026-05" }),
      tradeline({ balance: 10 }),
      tradeline({ creditLimit: 10 }),
      tradeline({ openedAt: "2019" }),
    ];
    for (const locale of ["es", "en"] as const) {
      for (const item of cases) {
        for (const line of itemCheckHints(item, locale)) {
          clean(line);
          expect(line, line).toContain("?");
          // A question never tells the customer to dispute.
          expect(line, line).not.toMatch(/disput|deber[íi]as|you should/i);
        }
      }
    }
  });
});

describe("B. what this round mails and what waits", () => {
  // The tester's path: Midland on Equifax, Auto Finance, the name and the employer.
  const four = attested(midlandEq, autoFinance, personal("name"), personal("employer"));

  it("puts 2 of 4 confirmed items in round 1 and leaves 2 waiting", () => {
    const session = sessionPlan(items, four);
    expect(session.roundNumber).toBe(1);
    expect(session.attestedFlags).toHaveLength(4);
    expect(session.inRound.map((i) => i.name)).toEqual(["Name: R. MARTINEZ JR", "Employer: ACME LLC"]);
    expect(session.waiting.map((i) => i.name)).toEqual(["Midland Credit Management", "Auto Finance Corp"]);
    // The letters hold exactly the in-round items, and none of the waiting ones.
    const mailed = session.plan.letters.flatMap((l) => l.itemFingerprints);
    expect(mailed.sort()).toEqual(session.inRound.map((i) => i.fingerprint).sort());
    for (const item of session.waiting) expect(mailed).not.toContain(item.fingerprint);
  });

  it("sends everything in the first round when no personal information is confirmed", () => {
    const session = sessionPlan(items, attested(midlandEq, autoFinance));
    expect(session.roundNumber).toBe(2);
    expect(session.inRound.map((i) => i.name)).toEqual(["Midland Credit Management", "Auto Finance Corp"]);
    expect(session.waiting).toEqual([]);
    expect(waitingNote(session, "es")).toBeNull();
    expect(waitingNote(session, "en")).toBeNull();
  });

  it("has nothing in the round and nothing waiting when nothing is confirmed", () => {
    const session = sessionPlan(items, { [midlandEq.fingerprint]: { state: "correct" } });
    expect(session.inRound).toEqual([]);
    expect(session.waiting).toEqual([]);
  });

  it("counts only the items inside these letters in the headline", () => {
    const session = sessionPlan(items, four);
    expect(DICTS.es.attack.subtitle(session.plan.letters.length, session.inRound.length)).toMatch(
      /^2 cartas generadas con tus 2 elementos confirmados\./,
    );
    expect(DICTS.en.attack.subtitle(session.plan.letters.length, session.inRound.length)).toMatch(
      /^2 letters generated from your 2 confirmed items\./,
    );
  });

  it("names what each letter covers, not just who receives it", () => {
    const { plan } = sessionPlan(items, four);
    expect(plan.letters.map((l) => [l.target.key, letterCoverage(l, items, "es")])).toEqual([
      ["equifax", ["Nombre: R. MARTINEZ JR"]],
      ["experian", ["Empleador: ACME LLC"]],
    ]);
    expect(letterCoverage(plan.letters[0]!, items, "en")).toEqual(["Name: R. MARTINEZ JR"]);
    expect(letterItems(plan.letters[1]!, items)).toEqual([personal("employer")]);
    // A file request to a secondary bureau covers no item and says what it is.
    const round2 = sessionPlan(items, attested(midlandEq)).plan;
    const fileRequest = round2.letters.find((l) => l.itemFingerprints.length === 0)!;
    expect(letterCoverage(fileRequest, items, "es")).toEqual(["solicitud de expediente"]);
    expect(letterCoverage(fileRequest, items, "en")).toEqual(["file disclosure request"]);
  });

  it("says plainly what waits, for how long, and why the order is what it is", () => {
    const session = sessionPlan(items, four);
    const es = waitingNote(session, "es")!;
    expect(es.title).toBe("No todo lo que confirmaste va en estas cartas");
    expect(es.body).toBe(
      "Esta ronda trata primero tus datos personales (2). Tu cobranza de Midland Credit Management y tu consulta de Auto Finance Corp ya tienen tu confirmación y van en tu siguiente ronda, unos 40 días después de enviar estas cartas. Los datos personales van primero porque los burós los usan para identificar tu expediente.",
    );
    const en = waitingNote(session, "en")!;
    expect(en.body).toBe(
      "This round covers your personal information first (2). Your Midland Credit Management collection and your Auto Finance Corp inquiry are confirmed and go in your next round, about 40 days after these letters are mailed. Personal information goes first because the bureaus use it to identify your file.",
    );
    expect(es.body).toContain(`${ESTIMATED_CYCLE_DAYS} días`);
    expect(en.body).toContain(`${ESTIMATED_CYCLE_DAYS} days`);
  });

  it("uses the singular for one waiting item and tells two bureaus apart", () => {
    const one = sessionPlan(items, attested(capitalOne, personal("address")));
    expect(waitingNote(one, "es")!.body).toContain(
      "Tu cuenta de Capital One ya tiene tu confirmación y va en tu siguiente ronda",
    );
    expect(waitingNote(one, "en")!.body).toContain("Your Capital One account is confirmed and goes in your next round");
    expect(itemPhrases([midlandEq, midlandEx, retailCard], "es")).toEqual([
      "tu cobranza de Midland Credit Management en Equifax",
      "tu cobranza de Midland Credit Management en Experian",
      "tu consulta de Retail Card Services",
    ]);
    expect(itemPhrases([midlandEq, midlandEx], "en")).toEqual([
      "your Midland Credit Management collection on Equifax",
      "your Midland Credit Management collection on Experian",
    ]);
  });

  it("has the assistant say which letters went out and which confirmed items wait", () => {
    const session = sessionPlan(items, four);
    const es = approvedMessage(session, items, "es");
    expect(es).toContain("Estas 2 cartas se imprimen y van por correo:");
    expect(es).toContain("• Equifax Information Services LLC — Nombre: R. MARTINEZ JR");
    expect(es).toContain("• Experian — Empleador: ACME LLC");
    expect(es).toContain(
      "No van en estas cartas y esperan a tu siguiente ronda, unos 40 días después: tu cobranza de Midland Credit Management y tu consulta de Auto Finance Corp.",
    );
    const en = approvedMessage(session, items, "en");
    expect(en).toContain("• Experian — Employer: ACME LLC");
    expect(en).toContain("Not in these letters, waiting for your next round about 40 days later:");
    // Nothing waiting: the message does not mention a wait.
    const all = approvedMessage(sessionPlan(items, attested(midlandEq)), items, "es");
    expect(all).toContain("Midland Credit Management");
    expect(all).not.toMatch(/esperan a tu siguiente ronda/);
    const single = approvedMessage(sessionPlan(items, attested(personal("name"))), items, "en");
    expect(single).toContain("This letter is being printed and mailed:");
  });

  it("keeps the round copy inside the claim rules and free of promises", () => {
    const sessions = [
      sessionPlan(items, four),
      sessionPlan(items, attested(capitalOne, personal("address"))),
      sessionPlan(items, attested(midlandEq, midlandEx, autoFinance, retailCard, personal("name"))),
      sessionPlan(items, attested(midlandEq, autoFinance)),
    ];
    for (const locale of ["es", "en"] as const) {
      clean(waitingListNote(locale));
      clean(DICTS[locale].rounds.waitingTitle);
      clean(DICTS[locale].attack.covers);
      for (const session of sessions) {
        const note = waitingNote(session, locale);
        const lines = [approvedMessage(session, items, locale), note?.title ?? "", note?.body ?? ""];
        for (const line of lines) {
          clean(line);
          // The order is stated; it is never said to help, speed up or raise anything.
          expect(line, line).not.toMatch(/mejor|más rápido|sube|aumenta|better|faster|improve|increase|boost|raise/i);
        }
      }
    }
  });
});

describe("C. the same account on another bureau", () => {
  it("matches an account by creditor and masked number, and an inquiry by inquirer and date", () => {
    expect(sameItemOnOtherBureaus(midlandEq, items)).toEqual([midlandEx]);
    expect(sameItemOnOtherBureaus(midlandEx, items)).toEqual([midlandEq]);
    expect(sameItemOnOtherBureaus(capitalOne, items)).toEqual([]);
    expect(sameItemOnOtherBureaus(autoFinance, items)).toEqual([]);
    expect(sameItemOnOtherBureaus(personal("name"), items)).toEqual([]);

    const report = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: {
        equifax: {
          tradelines: [
            { creditor: "Acme Bank", accountNumberMasked: "****1111" },
            { creditor: "No Number Bank" },
          ],
          inquiries: [{ inquirer: "Car Lender", date: "2026-03-14" }],
        },
        experian: {
          tradelines: [
            { creditor: "ACME  bank", accountNumberMasked: "****1111" }, // same account, written differently
            { creditor: "Acme Bank", accountNumberMasked: "****2222" }, // same creditor, another account
            { creditor: "No Number Bank" }, // no number: cannot be called the same account
          ],
          inquiries: [{ inquirer: "Car Lender", date: "2026-04-01" }], // same inquirer, another date
        },
        transunion: {
          tradelines: [{ creditor: "Acme Bank", accountNumberMasked: "****1111" }],
          inquiries: [{ inquirer: "Car Lender", date: "2026-03-14" }],
        },
      },
    }).items;
    const at = (name: string, bureau: string, n = 0) => report.filter((i) => i.name === name && i.bureau === bureau)[n]!;
    expect(sameItemOnOtherBureaus(at("Acme Bank", "equifax"), report).map((i) => i.bureau)).toEqual([
      "experian",
      "transunion",
    ]);
    expect(sameItemOnOtherBureaus(at("Acme Bank", "experian"), report)).toEqual([]);
    expect(sameItemOnOtherBureaus(at("No Number Bank", "equifax"), report)).toEqual([]);
    expect(sameItemOnOtherBureaus(at("Car Lender", "equifax"), report).map((i) => i.bureau)).toEqual(["transunion"]);
    expect(sameItemOnOtherBureaus(at("Car Lender", "experian"), report)).toEqual([]);
    // Never the item itself, and never another item on the same bureau.
    for (const item of report) {
      for (const other of sameItemOnOtherBureaus(item, report)) expect(other.bureau).not.toBe(item.bureau);
    }
  });

  it("names the other bureau before any answer exists", () => {
    expect(crossBureauNote(midlandEq, items, {}, "es")).toEqual({
      text: "Esta misma cuenta también aparece en Experian. Cada buró se revisa por separado, porque los burós no siempre tienen la misma información.",
      differs: false,
    });
    expect(crossBureauNote(midlandEx, items, {}, "en")!.text).toBe(
      "This same account also appears on Equifax. Each bureau is reviewed separately, because bureaus do not always hold the same information.",
    );
    expect(crossBureauNote(capitalOne, items, {}, "es")).toBeNull();
  });

  it("says what the customer answered on the other bureau", () => {
    const answered = attested(midlandEq);
    expect(crossBureauNote(midlandEx, items, answered, "es")!.text).toBe(
      "Esta misma cuenta también aparece en Equifax. En Equifax respondiste «Creo que es inexacto». Cada buró se revisa por separado, porque los burós no siempre tienen la misma información.",
    );
    const correct = { [midlandEq.fingerprint]: { state: "correct" } };
    expect(crossBureauNote(midlandEx, items, correct, "en")!.text).toContain("On Equifax you answered “Looks correct”.");
    const pending = { [midlandEq.fingerprint]: { state: "flagged" } };
    expect(crossBureauNote(midlandEx, items, pending, "es")!.text).toContain(
      "En Equifax la marcaste, pero falta tu confirmación.",
    );
  });

  it("says plainly when the two answers differ, and that it can be right", () => {
    const flags = { ...attested(midlandEq), [midlandEx.fingerprint]: { state: "correct" } };
    const es = crossBureauNote(midlandEx, items, flags, "es")!;
    expect(es.differs).toBe(true);
    expect(es.text).toBe(
      "Esta misma cuenta también aparece en Equifax. En Equifax respondiste «Creo que es inexacto». Tus respuestas no son iguales. Eso puede estar bien: los burós no siempre tienen la misma información.",
    );
    expect(crossBureauNote(midlandEq, items, flags, "en")!.text).toContain(
      "Your answers are not the same. That can be right: bureaus do not always hold the same information.",
    );
    expect(differingAnswerLine(midlandEx, items, flags, "es")).toBe(
      "En Equifax respondiste otra cosa sobre esta misma cuenta. Eso puede estar bien: los burós no siempre tienen la misma información. Para cambiar una respuesta, entra a Más → Revisar.",
    );
    // The same answer on both, or only one answer: nothing to say.
    const same = attested(midlandEq, midlandEx);
    expect(crossBureauNote(midlandEx, items, same, "es")!.differs).toBe(false);
    expect(differingAnswerLine(midlandEx, items, same, "es")).toBeNull();
    expect(differingAnswerLine(midlandEx, items, {}, "en")).toBeNull();
    expect(differingAnswerLine(capitalOne, items, attested(capitalOne), "en")).toBeNull();
  });

  it("stays neutral: it never offers to copy an answer or says which to give", () => {
    const flagSets = [
      {},
      attested(midlandEq),
      { [midlandEq.fingerprint]: { state: "correct" } },
      { ...attested(midlandEq), [midlandEx.fingerprint]: { state: "correct" } },
      { ...attested(midlandEx), [midlandEq.fingerprint]: { state: "correct" } },
    ];
    for (const locale of ["es", "en"] as const) {
      for (const flags of flagSets) {
        for (const item of [midlandEq, midlandEx]) {
          const lines = [crossBureauNote(item, items, flags, locale)?.text, differingAnswerLine(item, items, flags, locale)];
          for (const line of lines) {
            if (!line) continue;
            clean(line);
            expect(line, line).not.toMatch(/aplic|copi|misma respuesta|deber[íi]as|te conviene|apply|copy|same answer|you should|we recommend/i);
            expect(line, line).not.toContain("?");
          }
        }
      }
    }
  });

  it("never turns one answer into another item's confirmation", () => {
    // Confirming Midland on Equifax leaves Midland on Experian unanswered and out of every letter.
    const session = sessionPlan(items, attested(midlandEq, personal("name")));
    expect(session.attestedFlags.map((f) => f.fingerprint)).not.toContain(midlandEx.fingerprint);
    const round2 = sessionPlan(items, attested(midlandEq));
    expect(round2.plan.letters.flatMap((l) => l.itemFingerprints)).toEqual([midlandEq.fingerprint]);
  });
});

describe("D. the coach with no key", () => {
  beforeEach(() => resetRateLimits());

  const ask = (body: unknown) =>
    coachPost(
      new Request("https://x.test/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.77" },
        body: JSON.stringify(body),
      }),
    );

  it("answers 200 with no reply instead of a 5xx when ANTHROPIC_API_KEY is missing", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // A question no saved answer covers: without a key there is nothing to answer it with.
      const res = await ask({ messages: [{ role: "user", content: "¿Qué es una cuenta de cobranza médica?" }] });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ reply: null, configured: false });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("answers from an approved saved answer even without a key, marked as the team's (src/lib/staff/answers.ts)", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await ask({ messages: [{ role: "user", content: "¿Cuánto tardan los burós en responder?" }] });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reply: string; source: string };
      expect(body.source).toBe("saved_answer");
      expect(body.reply).toMatch(/30 días/);
      expect(body.reply).toMatch(/Respuesta aprobada por el equipo/);
      // A question only a proposal covers is not answered from the library.
      const itin = await ask({ messages: [{ role: "user", content: "¿Puedo activar el monitoreo con mi ITIN?" }] });
      expect(await itin.json()).toEqual({ reply: null, configured: false });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("still refuses a malformed request with 400", async () => {
    expect((await ask({ messages: [] })).status).toBe(400);
    expect((await ask({ messages: [{ role: "assistant", content: "hola" }] })).status).toBe(400);
  });
});

describe("E. reviewing again after the letters went out", () => {
  it("says the letters already went out and when a change counts", () => {
    for (const d of Object.values(DICTS)) {
      for (const line of [d.items.afterMailedCard, d.items.afterMailedList, d.items.afterMailedNoted]) clean(line);
    }
    expect(DICTS.es.items.afterMailedCard).toBe(
      "Las cartas de esta ronda ya salieron. Si cambias tu respuesta, el cambio cuenta desde tu siguiente ronda.",
    );
    expect(DICTS.en.items.afterMailedCard).toBe(
      "This round's letters have already gone out. If you change your answer, the change applies from your next round.",
    );
  });
});

describe("F. scores with a single pull", () => {
  it("keeps the demo's one history entry equal to today's scores", () => {
    expect(DEMO_SCORE_HISTORY[0]!.scores).toEqual(DEMO_REPORT.scores);
  });
});

describe("G. the first pages in English", () => {
  const en = MARKETING.en;
  const es = MARKETING.es;

  it("passes the advertising claim rules: hero, steps, FAQ, footer and every other English string", () => {
    const site = SITE_COPY.en;
    const hero = [
      site.home.headline,
      site.home.headlineAccent,
      site.home.lead,
      en.empezar.headline,
      en.empezar.headlineAccent,
      `${en.empezar.leadBefore} ${en.empezar.leadStrong} ${en.empezar.leadAfter}`,
      en.empezar.underCta,
    ];
    const steps = en.empezar.steps.flatMap((s) => [s.title, s.body, s.alt]);
    const faq = en.empezar.faq.flat();
    const footers = [site.footer.disclaimer, site.footer.aiDisclosure, en.empezar.footer, en.empezar.more];
    for (const line of [...hero, ...steps, ...faq, ...footers]) clean(line);
    const all = marketingStrings("en");
    expect(all.length).toBeGreaterThan(90);
    for (const line of all) clean(line);
    for (const g of GOALS) clean(g.labelEn);
    clean(monitoringName("en"));
  });

  it("is the same page in both languages: same sections, same number of lines", () => {
    expect(SITE_COPY.en.home.how.steps).toHaveLength(SITE_COPY.es.home.how.steps.length);
    expect(en.empezar.steps).toHaveLength(es.empezar.steps.length);
    expect(en.empezar.community).toHaveLength(es.empezar.community.length);
    expect(en.empezar.faq).toHaveLength(es.empezar.faq.length);
    expect(marketingStrings("en")).toHaveLength(marketingStrings("es").length);
    // No English line was left in Spanish, and none is empty.
    const spanish = new Set(marketingStrings("es"));
    for (const line of marketingStrings("en")) {
      expect(line.trim().length, line).toBeGreaterThan(0);
      if (/[a-záéíóúñ]{4,}\s+[a-záéíóúñ]{4,}/i.test(line)) expect(spanish.has(line), line).toBe(false);
    }
  });

  it("keeps the same disclaimers and the commission disclosure in English", () => {
    for (const footer of [SITE_COPY.en.footer.disclaimer, en.empezar.footer]) {
      // Who decides what, who does the work, and no promise about how it ends.
      expect(footer).toMatch(/You decide what is inaccurate on your report/);
      expect(footer).toMatch(/our team prepares and mails the letters for you/);
      expect(footer).toMatch(/We do not guarantee results/);
      expect(footer).toMatch(/results vary case by case/i);
      expect(footer).toMatch(/Available in Texas/);
      expect(footer).toMatch(/This is not legal advice/);
    }
    expect(SITE_COPY.en.footer.aiDisclosure).toMatch(/artificial intelligence assistant/);
    expect(en.empezar.footer).toMatch(/No one can take correct, current information off a credit report/);
    expect(en.empezar.footer).toMatch(/Credalti earns a commission on that subscription/);
    expect(en.onboarding.disclosure).toBe("Disclosure: Credalti earns a commission from the monitoring service when you subscribe.");
    expect(en.onboarding.welcomeNote).toMatch(/Results vary case by case/);
    expect(en.onboarding.assistNote).toMatch(/Results vary case by case/);
    // The one price on these pages is the monitoring provider's, on the
    // onboarding step that offers it, and it is the same in both languages.
    const priceOf = (text: string) => text.match(/~?\$\d+(?:\.\d+)?/)?.[0];
    const monitoringPrice = (copy: typeof en) => priceOf(copy.onboarding.monitoringRows(null)[0]![1]);
    expect(monitoringPrice(en)).toBeDefined();
    expect(monitoringPrice(en)).toBe(monitoringPrice(es));
  });

  it("greets an invited customer in English", () => {
    expect(en.onboarding.hello("María")).toBe("Hi, María!");
    expect(en.onboarding.sentBy("Ana")).toMatch(/^Ana, from our team, sent you here\./);
    expect(GOALS.find((g) => g.key === "mortgage")!.labelEn).toBe("Buy a house");
    // The Spanish labels the salesperson's page uses are unchanged.
    expect(GOALS.map((g) => g.label)).toEqual([
      "Comprar una casa",
      "Comprar un auto",
      "Calificar para mejores tarjetas",
      "Mejorar mi crédito en general",
    ]);
  });
});

describe("I. small copy changes", () => {
  it("says who does what in plain words, in both footers", () => {
    // Full service: the client decides what is inaccurate, the team prepares and mails.
    const sentences = [
      "Credalti es una empresa de servicios de crédito.",
      "Tú decides qué es inexacto en tu reporte; nuestro equipo prepara y envía las cartas por ti.",
    ];
    for (const sentence of sentences) clean(sentence);
    for (const footer of [SITE_COPY.es.footer.disclaimer, MARKETING.es.empezar.footer]) {
      expect(footer.startsWith(sentences.join(" "))).toBe(true);
      expect(footer).toMatch(/No garantizamos resultados/);
      // The old positioning is gone from the footers.
      expect(footer).not.toMatch(/DIY|hazlo tú mismo|herramienta de software|No disputamos por ti/i);
    }
    for (const locale of ["es", "en"] as const) {
      for (const line of marketingStrings(locale)) expect(line).not.toMatch(/\bDIY\b|do.it.yourself|hazlo tú mismo/i);
    }
  });

  it("says the name and address in the letter preview are placeholders", () => {
    clean(DICTS.es.attack.placeholderNote);
    clean(DICTS.en.attack.placeholderNote);
    expect(DICTS.es.attack.placeholderNote).toMatch(/son de ejemplo/);
    expect(DICTS.en.attack.placeholderNote).toMatch(/placeholders/);
  });

  it("does not touch the attestation text", () => {
    expect(ATTESTATION_TEXT.es).toBe("Creo que este elemento es inexacto, no verificable o está desactualizado.");
    expect(ATTESTATION_TEXT.en).toBe("I believe this item is inaccurate, unverifiable, or outdated.");
  });
});
