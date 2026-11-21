import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { DEMO_RAW_REPORT } from "../demo";
import { ROUND_CYCLE_DAYS } from "../domain/attack";
import { parseReport } from "../domain/parser";
import type { NormalizedReport } from "../domain/types";
import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import { nextRetryAt } from "../billing/dunning";
import type { BillingAccount } from "../billing/types";
import { paidUpBilling, sampleMethod } from "../staff/billing";
import { applyDemoActions, EMPTY_ACTIONS, type DemoActions } from "../staff/data";
import { buildDemoClients } from "../staff/demoClients";
import { formatPhone, relativeDay } from "../staff/format";
import { exceptionMessage, STAFF_MESSAGE_RULES, whatsappHref, whatsappNumber } from "../staff/messages";
import {
  AGREEMENT_GRACE_DAYS,
  clientExceptions,
  clientStage,
  DOCUMENTS_GRACE_DAYS,
  EXCEPTION_KINDS,
  EXCEPTION_LABEL,
  HANDLED_QUIET_DAYS,
  handledExceptions,
  nextAutomaticStep,
  nextStep,
  RESPONSE_WINDOW_DAYS,
  REVIEW_STALLED_DAYS,
  reviewProgress,
  sendableRound,
  sendBlockReason,
  STAGE_ORDER,
  STAGES,
  type ExceptionKind,
  type Stage,
} from "../staff/stage";
import { clientTimeline } from "../staff/timeline";
import type { ItemAnswer, MailStatus, RoundStatus, StaffClient, StaffRound } from "../staff/types";

// Noon in Texas on 5 December 2026, so calendar dates are unambiguous.
const NOW = new Date("2026-12-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * HOUR).toISOString();

function report(pulledDaysAgo: number): NormalizedReport {
  return parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(pulledDaysAgo) });
}

/** Answers for the first `answered` items; `inaccurate` of them confirmed inaccurate. */
function answers(r: NormalizedReport, answered = r.items.length, inaccurate = 3): Record<string, ItemAnswer> {
  const out: Record<string, ItemAnswer> = {};
  r.items.slice(0, answered).forEach((item, index) => {
    out[item.fingerprint] =
      index < inaccurate
        ? { status: "inaccurate", reason: "No lo reconozco.", confirmedAt: ago(1) }
        : { status: "correct", answeredAt: ago(1) };
  });
  return out;
}

function round(number: number, status: RoundStatus, mailedDaysAgo?: number, mailStatus: MailStatus = "delivered"): StaffRound {
  const r = report(0);
  return {
    number,
    status,
    mailedAt: mailedDaysAgo === undefined ? null : ago(mailedDaysAgo),
    respondedAt: status === "responded" ? ago(1) : null,
    letters: [
      {
        id: `l-${number}`,
        recipient: { type: "bureau", key: "equifax", name: "Equifax Information Services LLC", addressLines: ["P.O. Box 740256", "Atlanta, GA 30374-0256"] },
        templateKey: "personal_info_cleanup",
        category: "personal_info",
        stage: "personal_info_cleanup",
        items: r.items.filter((i) => i.category === "personal_info").slice(0, 1),
        mailStatus: status === "draft" || status === "ready" ? "not_sent" : mailStatus,
      },
    ],
  };
}

const FEE = "89.00";

/**
 * A client far enough along that nothing is missing; each test removes what it
 * needs. Billing is in order unless a test says otherwise: a payment method on
 * file and every mailed round charged and paid the day after it went out.
 */
function client(overrides: Partial<StaffClient> = {}): StaffClient {
  const r = report(2);
  const base: StaffClient = {
    id: "t1",
    firstName: "Prueba",
    lastName: "Ejemplo",
    phone: "+17135550100",
    state: "TX",
    addressLines: ["1 Calle Ejemplo", "Houston, TX 77001"],
    salesperson: "ana",
    createdAt: ago(20),
    signedUpAt: ago(19),
    agreementSignedAt: ago(18),
    documents: ["government_id", "proof_of_address"],
    report: r,
    answers: answers(r),
    rounds: [],
    agreementMonthlyFee: FEE,
    billing: { paymentMethod: null, charges: [], pause: null },
    lastActivityAt: ago(1),
    notes: [],
    questions: [],
    handled: {},
    ...overrides,
  };
  return overrides.billing ? base : { ...base, billing: paidUpBilling(base, FEE, NOW) };
}

/**
 * Billing where the charge for round 1 (mailed `mailedDaysAgo` days ago) was
 * declined `attempts` times, the last time `lastDaysAgo` days ago.
 */
function declinedBilling(mailedDaysAgo: number, attempts: number, lastDaysAgo: number): BillingAccount {
  const last = ago(lastDaysAgo);
  return {
    paymentMethod: sampleMethod(ago(18)),
    charges: [
      {
        id: "ch-1",
        roundNumber: 1,
        amountCents: 8900,
        status: "failed",
        workDate: ago(mailedDaysAgo),
        createdAt: ago(mailedDaysAgo - 1),
        attempts,
        lastAttemptAt: last,
        nextAttemptAt: nextRetryAt(attempts, new Date(last))?.toISOString() ?? null,
        chargedAt: null,
        failureCode: "card_declined",
        refund: null,
      },
    ],
    pause: null,
  };
}

/** Round 1 mailed 20 days ago, its charge declined three times: out of retries. */
const pastDue = (): Partial<StaffClient> => ({ rounds: [round(1, "mailed", 20)], billing: declinedBilling(20, 3, 12) });

const kinds = (c: StaffClient, now = NOW) => clientExceptions(c, now).map((e) => e.kind);

describe("staff: clientStage", () => {
  const cases: Array<[Stage, StaffClient]> = [
    ["lead", client({ signedUpAt: null, agreementSignedAt: null, documents: [], report: null, answers: {} })],
    ["agreement_pending", client({ agreementSignedAt: null, documents: [], report: null, answers: {} })],
    // Signed yesterday: inside the 3-business-day cancellation window, whatever else is on file.
    ["cancellation_window", client({ agreementSignedAt: ago(1), rounds: [round(1, "ready")] })],
    ["documents_pending", client({ documents: ["government_id"], report: null, answers: {} })],
    ["report_pending", client({ report: null, answers: {} })],
    ["client_review_pending", client({ answers: answers(report(2), 3) })],
    ["ready_to_send", client({ rounds: [round(1, "ready")] })],
    ["waiting_on_bureaus", client({ rounds: [round(1, "mailed", 10)] })],
    ["results_in", client({ rounds: [round(1, "responded", 32)] })],
    ["next_round_ready", client({ rounds: [round(1, "responded", 41), round(2, "ready")] })],
    ["paused", client(pastDue())],
    ["cancelled", client({ agreementCancelledAt: ago(16), cancelledWithinWindow: true, rounds: [round(1, "ready")] })],
  ];

  it("covers every stage, each with a label, a short name and a line saying who does what next", () => {
    expect(cases.map(([stage]) => stage)).toEqual([...STAGE_ORDER]);
    for (const stage of STAGE_ORDER) {
      const info = STAGES[stage];
      expect(info.label.length).toBeGreaterThan(3);
      expect(info.short.length).toBeGreaterThan(3);
      expect(info.description).toMatch(/cliente|equipo|sistema|Ventas/);
      expect(["system", "client", "staff", "sales"]).toContain(info.actor);
    }
  });

  it.each(cases)("%s", (stage, c) => {
    expect(clientStage(c, NOW)).toBe(stage);
  });

  it("is the earliest thing still missing", () => {
    // No ID on file outranks a finished review.
    expect(clientStage(client({ documents: ["proof_of_address"], rounds: [round(1, "ready")] }), NOW)).toBe("documents_pending");
    // An extra document does not replace a required one.
    expect(clientStage(client({ documents: ["government_id", "ssn_card"] }), NOW)).toBe("documents_pending");
  });

  it("pauses for a past-due payment and when the client marked nothing as inaccurate", () => {
    expect(clientStage(client(pastDue()), NOW)).toBe("paused");
    const r = report(2);
    expect(clientStage(client({ report: r, answers: answers(r, r.items.length, 0) }), NOW)).toBe("paused");
  });

  it("keeps a client in review until every item has an answer", () => {
    const r = report(2);
    expect(clientStage(client({ report: r, answers: answers(r, r.items.length - 1) }), NOW)).toBe("client_review_pending");
    expect(clientStage(client({ report: r, answers: answers(r) }), NOW)).toBe("ready_to_send");
    expect(reviewProgress(client({ report: r, answers: answers(r, 5, 2) }))).toEqual({
      total: r.items.length,
      answered: 5,
      pending: r.items.length - 5,
      inaccurate: 2,
      correct: 3,
    });
  });

  it("stays on 'results in' while the next round is still a draft", () => {
    expect(clientStage(client({ rounds: [round(1, "responded", 41), round(2, "draft")] }), NOW)).toBe("results_in");
    expect(clientStage(client({ rounds: [round(1, "responded", 41), round(2, "mailed", 0)] }), NOW)).toBe("waiting_on_bureaus");
  });
});

describe("staff: clientExceptions", () => {
  it("returns nothing for a client with nothing wrong", () => {
    expect(clientExceptions(client(), NOW)).toEqual([]);
    expect(clientExceptions(client({ rounds: [round(1, "mailed", 10)] }), NOW)).toEqual([]);
    expect(clientExceptions(client({ signedUpAt: null, agreementSignedAt: null, documents: [], report: null, answers: {} }), NOW)).toEqual([]);
  });

  it("review not finished after more than 5 days", () => {
    const stalled = (days: number, answered = 3) => {
      const r = report(days);
      return client({ report: r, answers: answers(r, answered) });
    };
    expect(REVIEW_STALLED_DAYS).toBe(5);
    expect(kinds(stalled(5))).toEqual([]);
    // 5 days and 23 hours is still 5 whole days.
    const almost = parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(5, 23) });
    expect(kinds(client({ report: almost, answers: answers(almost, 3) }))).toEqual([]);
    expect(kinds(stalled(6))).toEqual(["review_stalled"]);
    // Finished reviews never stall, however old.
    expect(kinds(stalled(6, 99))).toEqual([]);
    const e = clientExceptions(stalled(6), NOW)[0]!;
    expect(e.sentence).toBe("No ha terminado su revisión: le faltan 5 de 8 puntos. Su reporte llegó hace 6 días.");
    expect(e.severity).toBe("medium");
    expect(e.actionLabel).toBe("Recordarle su revisión");
    expect(e.action).toBe("whatsapp");
  });

  it("ID or proof of address missing more than 3 days after the agreement", () => {
    const missing = (days: number, documents: StaffClient["documents"]) =>
      client({ agreementSignedAt: ago(days), documents, report: null, answers: {} });
    expect(DOCUMENTS_GRACE_DAYS).toBe(3);
    expect(kinds(missing(3, []))).toEqual([]);
    expect(kinds(missing(4, []))).toEqual(["documents_missing"]);
    expect(kinds(missing(4, ["government_id", "proof_of_address"]))).toEqual([]);
    expect(clientExceptions(missing(4, []), NOW)[0]!.sentence).toBe(
      "Falta su identificación y comprobante de domicilio. Firmó el acuerdo hace 4 días.",
    );
    expect(clientExceptions(missing(4, ["government_id"]), NOW)[0]!.sentence).toBe(
      "Falta su comprobante de domicilio. Firmó el acuerdo hace 4 días.",
    );
  });

  it("agreement unsigned more than 3 days after signup", () => {
    const unsigned = (days: number) =>
      client({ signedUpAt: ago(days), agreementSignedAt: null, documents: [], report: null, answers: {} });
    expect(AGREEMENT_GRACE_DAYS).toBe(3);
    expect(kinds(unsigned(3))).toEqual([]);
    expect(kinds(unsigned(4))).toEqual(["agreement_unsigned"]);
    expect(clientExceptions(unsigned(4), NOW)[0]!.severity).toBe("low");
    // A lead has not signed up, so there is no clock yet.
    expect(kinds(client({ signedUpAt: null, agreementSignedAt: null, createdAt: ago(30), documents: [], report: null, answers: {} }))).toEqual([]);
  });

  it(`report older than ${FRESH_REPORT_DAYS} days`, () => {
    const aged = (days: number, rounds: StaffRound[] = [round(1, "ready")]) => {
      const r = report(days);
      return client({ report: r, answers: answers(r), rounds });
    };
    expect(FRESH_REPORT_DAYS).toBe(45);
    expect(kinds(aged(45))).toEqual([]);
    expect(kinds(aged(46))).toEqual(["report_stale"]);
    expect(clientExceptions(aged(46), NOW)[0]!.sentence).toMatch(/^Su reporte tiene 46 días/);
    // While letters are out, the response window decides, not the report's age.
    expect(kinds(aged(46, [round(1, "mailed", 20)]))).toEqual([]);
  });

  it("a payment that did not go through after every retry", () => {
    const c = client(pastDue());
    expect(kinds(c)).toEqual(["payment_past_due"]);
    const [e] = clientExceptions(c, NOW);
    expect(e).toMatchObject({ severity: "high", action: "whatsapp", key: "payment_past_due:ch-1", since: ago(12) });
    expect(e!.sentence).toBe(
      "El cobro de la ronda 1 no pasó en 3 intentos y el sistema ya no lo intenta. Su caso está en pausa hasta que actualice su método de pago; al pagar, sigue solo.",
    );
    // Billing in order: nothing to chase.
    expect(kinds(client({ rounds: [round(1, "mailed", 20)] }))).toEqual([]);
    // Cancelled: nothing in flight, nothing to chase, whatever the charges say.
    expect(clientExceptions(client({ ...pastDue(), agreementCancelledAt: ago(1), cancelledWithinWindow: false }), NOW)).toEqual([]);
  });

  it("a letter returned or undeliverable", () => {
    for (const status of ["returned", "undeliverable"] as const) {
      const c = client({ rounds: [round(1, "mailed", 8, status)] });
      const [e] = clientExceptions(c, NOW);
      expect(e!.kind).toBe("letter_returned");
      expect(e!.key).toBe("letter_returned:l-1");
      expect(e!.severity).toBe("high");
      expect(e!.action).toBe("open_client");
      expect(e!.sentence).toContain("Equifax Information Services LLC de la ronda 1");
    }
    for (const status of ["in_transit", "delivered"] as const) {
      expect(kinds(client({ rounds: [round(1, "mailed", 8, status)] }))).toEqual([]);
    }
  });

  it("an escalated question waiting for a person", () => {
    const asked = (answeredAt: string | null, askedAt = ago(2)) =>
      client({ questions: [{ id: "q1", askedAt, text: "¿Puedo usar mi ITIN?", answeredAt }] });
    const [e] = clientExceptions(asked(null), NOW);
    expect(e!.kind).toBe("question_waiting");
    expect(e!.sentence).toBe("Hizo una pregunta que Capi pasó al equipo: «¿Puedo usar mi ITIN?» Espera desde hace 2 días.");
    expect(clientExceptions(asked(null, ago(0, 3)), NOW)[0]!.sentence).toMatch(/Espera desde hoy\.$/);
    expect(kinds(asked(ago(1)))).toEqual([]);
  });

  it(`no new report once the ${RESPONSE_WINDOW_DAYS}-day response window has passed`, () => {
    const waiting = (mailedDays: number, reportDays: number) => {
      const r = report(reportDays);
      return client({ report: r, answers: answers(r), rounds: [round(1, "mailed", mailedDays)] });
    };
    expect(RESPONSE_WINDOW_DAYS).toBe(30);
    expect(kinds(waiting(30, 34))).toEqual([]);
    expect(kinds(waiting(31, 35))).toEqual(["response_overdue"]);
    // A report pulled after the window closed already shows the answers.
    expect(kinds(waiting(33, 2))).toEqual([]);
    // One pulled while the bureaus were still working does not.
    expect(kinds(waiting(33, 10))).toEqual(["response_overdue"]);
    // Very late: still one exception, not a second one for the old report.
    expect(kinds(waiting(60, 64))).toEqual(["response_overdue"]);
    expect(clientExceptions(waiting(31, 35), NOW)[0]!.sentence).toMatch(/^La ronda 1 se envió hace 31 días y no ha llegado un reporte nuevo\./);
  });

  it("lists the most serious first, and every exception carries a sentence, a severity and one action", () => {
    const r = report(47);
    const c = client({
      signedUpAt: ago(60),
      agreementSignedAt: ago(50),
      documents: ["government_id"],
      report: r,
      answers: answers(r, 2),
      billing: declinedBilling(20, 3, 12),
      questions: [{ id: "q1", askedAt: ago(1), text: "¿Cuándo empiezan?", answeredAt: null }],
    });
    const found = clientExceptions(c, NOW);
    expect(found.map((e) => e.kind)).toEqual([
      "payment_past_due",
      "question_waiting",
      "documents_missing",
      "review_stalled",
      "report_stale",
    ]);
    expect(new Set(found.map((e) => e.key)).size).toBe(found.length);
    for (const e of found) {
      expect(e.sentence.length).toBeGreaterThan(20);
      expect(e.actionLabel.length).toBeGreaterThan(5);
      expect(["high", "medium", "low"]).toContain(e.severity);
    }
  });

  it(`a handled exception stays quiet for ${HANDLED_QUIET_DAYS} days, then comes back if nothing changed`, () => {
    const base = client({ agreementSignedAt: ago(6), documents: [], report: null, answers: {} });
    const handledOn = (days: number, hours = 0) => ({ ...base, handled: { documents_missing: ago(days, hours) } });
    expect(kinds(base)).toEqual(["documents_missing"]);
    expect(kinds(handledOn(0, 1))).toEqual([]);
    expect(kinds(handledOn(2, 23))).toEqual([]);
    expect(kinds(handledOn(3))).toEqual(["documents_missing"]);
    const [quiet] = handledExceptions(handledOn(1), NOW);
    expect(quiet!.kind).toBe("documents_missing");
    expect(quiet!.returnsAt).toBe(new Date(new Date(ago(1)).getTime() + HANDLED_QUIET_DAYS * DAY).toISOString());
    expect(handledExceptions(base, NOW)).toEqual([]);
    // A mark for something that is no longer wrong is ignored.
    expect(handledExceptions({ ...client(), handled: { documents_missing: ago(1) } }, NOW)).toEqual([]);
  });

  it("has a label for every kind", () => {
    for (const kind of EXCEPTION_KINDS) expect(EXCEPTION_LABEL[kind].length).toBeGreaterThan(5);
  });
});

describe("staff: nextAutomaticStep", () => {
  it("re-imports the report 30 days after mailing, with the date", () => {
    // Mailed 28 November, read on 5 December: due 28 December.
    const c = client({ rounds: [{ ...round(1, "mailed"), mailedAt: "2026-11-28T18:00:00.000Z" }] });
    const step = nextAutomaticStep(c, NOW)!;
    expect(step.text).toBe("Re-importar el reporte el 28 de diciembre");
    expect(step.at).toBe("2026-12-28T18:00:00.000Z");
    expect(nextStep(c, NOW)).toEqual({ actor: "system", text: step.text, at: step.at });
  });

  it("says 'hoy' on the last day of the window and stops once it has passed", () => {
    const waiting = (days: number, hours = 0) => {
      const r = report(40);
      return client({ report: r, answers: answers(r), rounds: [{ ...round(1, "mailed"), mailedAt: ago(days, hours) }] });
    };
    expect(nextAutomaticStep(waiting(29, 23), NOW)!.text).toBe("Re-importar el reporte hoy");
    expect(nextAutomaticStep(waiting(30), NOW)!.text).toBe("Re-importar el reporte hoy");
    // Past the window with no new report: a person has to step in.
    expect(nextAutomaticStep(waiting(31), NOW)).toBeNull();
    expect(nextStep(waiting(31), NOW).actor).toBe("client");
  });

  it(`prepares the next round ${ROUND_CYCLE_DAYS} days after the last one was mailed`, () => {
    expect(ROUND_CYCLE_DAYS).toBe(40);
    const answered = (mailedAt: string, extra: StaffRound[] = []) =>
      client({ rounds: [{ ...round(1, "responded"), mailedAt }, ...extra] });
    // Mailed 3 November: 40 days later is 13 December.
    const step = nextAutomaticStep(answered("2026-11-03T18:00:00.000Z"), NOW)!;
    expect(step.text).toBe("Preparar las cartas de la ronda 2 el 13 de diciembre");
    expect(step.at).toBe("2026-12-13T18:00:00.000Z");
    // Already past the 40 days: it happens today.
    expect(nextAutomaticStep(answered(ago(45)), NOW)!.text).toBe("Preparar las cartas de la ronda 2 hoy");
    expect(nextAutomaticStep(answered(ago(45), [round(2, "draft")]), NOW)!.text).toBe("Preparar las cartas de la ronda 2 hoy");
  });

  it("prepares round 1 as soon as the review is finished", () => {
    expect(nextAutomaticStep(client(), NOW)!.text).toBe("Preparar las cartas de la ronda 1 hoy");
    expect(nextAutomaticStep(client({ rounds: [round(1, "draft")] }), NOW)!.text).toBe("Preparar las cartas de la ronda 1 hoy");
  });

  it("is null whenever the next move belongs to a person", () => {
    const r = report(2);
    const waitingOnPeople: Array<[StaffClient, "client" | "staff" | "sales"]> = [
      [client({ signedUpAt: null, agreementSignedAt: null, documents: [], report: null, answers: {} }), "sales"],
      [client({ agreementSignedAt: null, documents: [], report: null, answers: {} }), "client"],
      [client({ documents: [], report: null, answers: {} }), "client"],
      [client({ report: null, answers: {} }), "client"],
      [client({ report: r, answers: answers(r, 2) }), "client"],
      [client({ rounds: [round(1, "ready")] }), "staff"],
      [client({ rounds: [round(1, "responded", 41), round(2, "ready")] }), "staff"],
      [client(pastDue()), "client"],
    ];
    for (const [c, actor] of waitingOnPeople) {
      expect(nextAutomaticStep(c, NOW)).toBeNull();
      const step = nextStep(c, NOW);
      expect(step.actor).toBe(actor);
      expect(step.at).toBeNull();
      expect(step.text.length).toBeGreaterThan(8);
    }
    expect(nextStep(client({ rounds: [round(1, "ready")] }), NOW).text).toBe("Enviar la ronda 1");
    expect(nextStep(client({ report: r, answers: answers(r, 2) }), NOW).text).toBe("Terminar su revisión (faltan 6 de 8)");
  });
});

describe("staff: sending", () => {
  it("offers a prepared round, first or later", () => {
    expect(sendableRound(client({ rounds: [round(1, "ready")] }), NOW)?.number).toBe(1);
    expect(sendableRound(client({ rounds: [round(1, "responded", 41), round(2, "ready")] }), NOW)?.number).toBe(2);
    expect(sendableRound(client(), NOW)).toBeNull();
    expect(sendableRound(client({ rounds: [round(1, "draft")] }), NOW)).toBeNull();
    expect(sendableRound(client({ rounds: [round(1, "mailed", 3)] }), NOW)).toBeNull();
    // A charge out of retries pauses the case: the next round is prepared and still does not go out.
    const unpaid = client({ ...pastDue(), rounds: [round(1, "responded", 41), round(2, "ready")], billing: declinedBilling(41, 3, 33) });
    expect(clientStage(unpaid, NOW)).toBe("paused");
    expect(sendableRound(unpaid, NOW)).toBeNull();
  });

  it("holds a round back while the report is too old, even if the notice was marked handled", () => {
    const r = report(46);
    const stale = client({ report: r, answers: answers(r), rounds: [round(1, "ready")] });
    expect(clientStage(stale, NOW)).toBe("ready_to_send");
    expect(sendableRound(stale, NOW)).toBeNull();
    expect(sendBlockReason(stale, NOW)).toMatch(/más de 45 días/);
    expect(nextStep(stale, NOW)).toEqual({ actor: "client", text: "Actualizar su reporte antes de enviar", at: null });
    const quiet = { ...stale, handled: { report_stale: ago(0, 1) } };
    expect(clientExceptions(quiet, NOW)).toEqual([]);
    expect(sendableRound(quiet, NOW)).toBeNull();
    expect(sendBlockReason(client({ rounds: [round(1, "ready")] }), NOW)).toBeNull();
  });
});

describe("staff: demo clients", () => {
  const clients = buildDemoClients(NOW);
  // Read a few minutes after the data was built, as a page does.
  const later = new Date(NOW.getTime() + 5 * 60 * 1000);

  it("are about two dozen invented people in Texas with fictional phone numbers", () => {
    expect(clients.length).toBeGreaterThanOrEqual(13);
    expect(clients.length).toBeLessThanOrEqual(23);
    expect(new Set(clients.map((c) => c.id)).size).toBe(clients.length);
    for (const c of clients) {
      expect(c.state).toBe("TX");
      // Area code + 555-01xx: the range reserved for fiction.
      expect(c.phone).toMatch(/^\+1\d{3}55501\d{2}$/);
      expect(c.firstName.length).toBeGreaterThan(2);
      expect(c.salesperson).toMatch(/^[a-z0-9-]{2,30}$/);
    }
    expect(readFileSync("src/lib/staff/demoClients.ts", "utf8")).toMatch(/DEMO DATA\. Nobody in this file exists\./);
  });

  it("cover every stage and every kind of exception", () => {
    const stages = new Set(clients.map((c) => clientStage(c, later)));
    expect([...stages].sort()).toEqual([...STAGE_ORDER].sort());
    const found = new Set<ExceptionKind>(clients.flatMap((c) => clientExceptions(c, later).map((e) => e.kind)));
    expect([...found].sort()).toEqual([...EXCEPTION_KINDS].sort());
  });

  it("leave most of the work to the system: some need a person, some are ready to send, some need nothing", () => {
    const needPerson = clients.filter((c) => clientExceptions(c, later).length > 0);
    const ready = clients.filter((c) => sendableRound(c, later));
    const nothing = clients.filter((c) => clientExceptions(c, later).length === 0 && !sendableRound(c, later));
    expect(needPerson.length).toBe(11);
    expect(ready.length).toBe(3);
    expect(nothing.length).toBe(9);
    expect(clients.some((c) => nextAutomaticStep(c, later))).toBe(true);
  });

  it("never go stale: the same picture whenever the demo is opened", () => {
    const picture = (now: Date) =>
      buildDemoClients(now).map((c) => `${c.id}:${clientStage(c, now)}:${clientExceptions(c, now).map((e) => e.kind).join("+")}`);
    expect(picture(new Date("2027-03-14T09:30:00.000Z"))).toEqual(picture(NOW));
    expect(picture(new Date("2026-12-31T23:59:00.000Z"))).toEqual(picture(NOW));
  });

  it("put only client-confirmed items in letters", () => {
    for (const c of clients) {
      for (const r of c.rounds) {
        expect(r.letters.length).toBeGreaterThan(0);
        for (const letter of r.letters) {
          for (const item of letter.items) {
            expect(c.answers[item.fingerprint]?.status).toBe("inaccurate");
          }
        }
      }
    }
  });

  it("give every client a readable history, newest first, with the system's next step on top", () => {
    for (const c of clients) {
      const timeline = clientTimeline(c, later);
      expect(timeline.length).toBeGreaterThan(0);
      const past = timeline.filter((e) => e.kind !== "upcoming");
      expect(past.map((e) => e.at)).toEqual([...past.map((e) => e.at)].sort().reverse());
      const next = nextAutomaticStep(c, later);
      expect(timeline[0]!.kind === "upcoming").toBe(next !== null);
    }
  });
});

describe("staff: demo actions", () => {
  const clients = buildDemoClients(NOW);
  const later = new Date(NOW.getTime() + 5 * 60 * 1000);
  const find = (list: StaffClient[], id: string) => list.find((c) => c.id === id)!;

  it("no actions leave the clients as they were", () => {
    expect(applyDemoActions(clients, EMPTY_ACTIONS)).toEqual(clients);
  });

  it("sending a round mails it and starts the response window", () => {
    const ready = clients.find((c) => sendableRound(c, later))!;
    const number = sendableRound(ready, later)!.number;
    const actions: DemoActions = { ...EMPTY_ACTIONS, sent: { [ready.id]: { [String(number)]: later.toISOString() } } };
    const after = find(applyDemoActions(clients, actions), ready.id);
    const sent = after.rounds.find((r) => r.number === number)!;
    expect(sent.status).toBe("mailed");
    expect(sent.mailedAt).toBe(later.toISOString());
    expect(sent.letters.every((l) => l.mailStatus === "in_transit")).toBe(true);
    expect(clientStage(after, later)).toBe("waiting_on_bureaus");
    expect(sendableRound(after, later)).toBeNull();
    // The next thing the system does is charge that round, a day after mailing; then it waits for the bureaus.
    expect(nextAutomaticStep(after, later)!.text).toBe(`Cobrar la ronda ${number} el 6 de diciembre`);
    const charged = { ...after, billing: paidUpBilling(after, FEE, new Date(later.getTime() + 2 * DAY)) };
    expect(nextAutomaticStep(charged, new Date(later.getTime() + 2 * DAY))!.text).toMatch(/^Re-importar el reporte el \d+ de (enero|diciembre)$/);
    // The original objects are not touched.
    expect(find(clients, ready.id).rounds.find((r) => r.number === number)!.status).toBe("ready");
  });

  it("does not re-send a round that is not ready", () => {
    const waiting = clients.find((c) => clientStage(c, later) === "waiting_on_bureaus")!;
    const actions: DemoActions = { ...EMPTY_ACTIONS, sent: { [waiting.id]: { "1": later.toISOString() } } };
    expect(find(applyDemoActions(clients, actions), waiting.id).rounds).toEqual(waiting.rounds);
  });

  it("marking an exception handled takes it off the list; answering a question closes it", () => {
    const stalled = clients.find((c) => clientExceptions(c, later).some((e) => e.kind === "review_stalled"))!;
    const asked = clients.find((c) => clientExceptions(c, later).some((e) => e.kind === "question_waiting"))!;
    const questionKey = clientExceptions(asked, later).find((e) => e.kind === "question_waiting")!.key;
    const actions: DemoActions = {
      ...EMPTY_ACTIONS,
      handled: { [stalled.id]: { review_stalled: later.toISOString() }, [asked.id]: { [questionKey]: later.toISOString() } },
    };
    const after = applyDemoActions(clients, actions);
    expect(clientExceptions(find(after, stalled.id), later)).toEqual([]);
    expect(handledExceptions(find(after, stalled.id), later).map((e) => e.kind)).toEqual(["review_stalled"]);
    expect(find(after, asked.id).questions[0]!.answeredAt).toBe(later.toISOString());
    expect(clientExceptions(find(after, asked.id), later)).toEqual([]);
    // Answered for good: it does not come back when the quiet days end.
    const muchLater = new Date(later.getTime() + 10 * DAY);
    expect(clientExceptions(find(after, asked.id), muchLater).map((e) => e.kind)).not.toContain("question_waiting");
  });

  it("notes are added after the existing ones", () => {
    const c = clients[0]!;
    const note = { id: "n-new", at: later.toISOString(), author: "ana", text: "Llamar el lunes." };
    const after = find(applyDemoActions(clients, { ...EMPTY_ACTIONS, notes: { [c.id]: [note] } }), c.id);
    expect(after.notes).toEqual([...c.notes, note]);
  });
});

describe("staff: what the console says", () => {
  const clients = buildDemoClients(NOW);
  const later = new Date(NOW.getTime() + 5 * 60 * 1000);

  it("drafted WhatsApp messages pass the claim rules and never say what to mark", () => {
    const drafts = clients.flatMap((c) => clientExceptions(c, later).map((e) => exceptionMessage(c, e)));
    expect(drafts.length).toBeGreaterThanOrEqual(EXCEPTION_KINDS.length);
    for (const text of drafts) {
      expect(checkClaimGuardrails(text)).toEqual([]);
      expect(text).toMatch(/^Hola \p{L}+, te escribe el equipo de Credalti\./u);
      expect(text).not.toMatch(/garantiz|te conviene|deber[ií]as marcar|marca (como|este|esta)|puntos? en \d/i);
    }
  });

  it("stage lines, exception sentences and buttons promise nothing and choose nothing for the client", () => {
    const lines = [
      ...STAGE_ORDER.flatMap((s) => [STAGES[s].label, STAGES[s].description]),
      ...clients.flatMap((c) => clientExceptions(c, later).flatMap((e) => [e.sentence, e.actionLabel])),
      ...clients.map((c) => nextStep(c, later).text),
      ...STAFF_MESSAGE_RULES,
    ];
    for (const line of lines) {
      expect(checkClaimGuardrails(line)).toEqual([]);
      expect(line).not.toMatch(/garantiz|subir (su|el) puntaje|prom[eé]tele|elige (los|qué) puntos|marca(r)? (por|los puntos)/i);
    }
    expect(STAFF_MESSAGE_RULES.join(" ")).toMatch(/No prometas resultados/);
    expect(STAFF_MESSAGE_RULES.join(" ")).toMatch(/No le digas al cliente qué puntos marcar/);
  });

  it("the client page shows answers read-only: no control writes an item's answer", () => {
    const page = readFileSync("src/app/equipo/clientes/[id]/page.tsx", "utf8");
    expect(page).toContain("Las respuestas son del cliente. Aquí se leen, no se cambian.");
    const data = readFileSync("src/lib/staff/data.ts", "utf8");
    const api = data.slice(data.indexOf("export interface StaffData"), data.indexOf("// ── Demo implementation"));
    // Exactly these operations: none of them sets what a client said about an item.
    // (saveReport brings in a report and leaves every answer as it was: see reports.test.ts.)
    const methods = [...api.matchAll(/^  (\w+)\(/gm)].map((m) => m[1]);
    expect(methods).toEqual([
      "listClients",
      "getClient",
      "markRoundsSent",
      "addNote",
      "resolveException",
      "saveReport",
      "saveReportSample",
      "sendReply",
      // Money: return a charge, pause or resume automatic charges. Nothing creates a charge or sets an amount.
      "refundCharge",
      "pauseBilling",
      "resumeBilling",
    ]);
  });

  it("builds WhatsApp links from the client's phone", () => {
    expect(whatsappNumber("+17135550142")).toBe("17135550142");
    expect(whatsappNumber("(713) 555-0142")).toBe("17135550142");
    expect(whatsappHref("+17135550142")).toBe("https://wa.me/17135550142");
    expect(whatsappHref("+17135550142", "Hola, ¿cómo estás?")).toBe(
      "https://wa.me/17135550142?text=Hola%2C%20%C2%BFc%C3%B3mo%20est%C3%A1s%3F",
    );
    expect(formatPhone("+17135550142")).toBe("(713) 555-0142");
    expect(relativeDay(ago(0, 2), NOW)).toBe("hoy");
    expect(relativeDay(ago(1, 2), NOW)).toBe("ayer");
    expect(relativeDay(ago(6), NOW)).toBe("hace 6 días");
  });
});

describe("staff: access control", () => {
  const migration = readFileSync("supabase/migrations/0007_staff.sql", "utf8");
  // Statements only: the comments explain what is deliberately absent.
  const sql = migration.replace(/--.*$/gm, "");

  it("defines staff members and a definer function that checks for an active one", () => {
    expect(sql).toMatch(/create table public\.staff_members/);
    expect(sql).toMatch(/user_id uuid primary key references auth\.users \(id\) on delete cascade/);
    expect(sql).toMatch(/role text not null check \(role in \('admin', 'specialist', 'sales'\)\)/);
    expect(sql).toMatch(/active boolean not null default true/);
    expect(sql).toMatch(/created_at timestamptz not null default now\(\)/);
    expect(sql).toMatch(/alter table public\.staff_members enable row level security/);
    expect(sql).toMatch(/create function public\.is_staff\(\)\s+returns boolean\s+language sql\s+stable\s+security definer\s+set search_path = ''/);
    expect(sql).toMatch(/s\.user_id = auth\.uid\(\) and s\.active/);
  });

  it("lets staff read the client tables and write none of them", () => {
    const tables = [
      "profiles",
      "monitoring_subscriptions",
      "report_pulls",
      "report_items",
      "item_flags",
      "attack_rounds",
      "letters",
      "letter_items",
      "identity_documents",
      "chat_messages",
      "events",
    ];
    for (const table of tables) {
      expect(sql).toMatch(new RegExp(`create policy "staff read [a-z ]+" on public\\.${table}\\s+for select using \\(public\\.is_staff\\(\\)\\);`));
    }
    const policies = sql.match(/create policy[^;]+;/g) ?? [];
    expect(policies.length).toBe(tables.length + 1);
    for (const policy of policies) {
      expect(policy).toMatch(/for select using/);
      expect(policy).not.toMatch(/for (all|insert|update|delete)|with check/);
    }
    // The existing migrations are untouched by this one.
    expect(sql).not.toMatch(/drop policy|alter policy/);
  });

  it("gates /equipo: signed in at the proxy, active staff in the layout, open in the demo, never indexed", () => {
    expect(readFileSync("src/proxy.ts", "utf8")).toContain('"/equipo/:path*"');
    const layout = readFileSync("src/app/equipo/layout.tsx", "utf8");
    expect(layout).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(layout).toMatch(/getStaffAccess\(\)/);
    expect(layout).toMatch(/No tienes acceso/);
    const access = readFileSync("src/lib/staff/access.ts", "utf8");
    expect(access).toMatch(/if \(!supabase\) return "demo"/);
    expect(access).toMatch(/rpc\("is_staff"\)/);
  });
});
