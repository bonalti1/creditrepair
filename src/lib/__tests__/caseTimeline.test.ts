import { describe, expect, it } from "vitest";
import { cancellationDeadline } from "@/lib/agreement/businessDays";
import type { AgreementRecord } from "@/lib/agreement/gate";
import { deviceCaseFacts, exampleCaseDates, exampleFlags } from "@/lib/case/demo";
import {
  caseEvents,
  caseNext,
  caseReadAloud,
  caseState,
  caseStatusSentence,
  caseTimeline,
  EMPTY_CASE_FACTS,
  type CaseFacts,
  type CaseRoundFact,
  type CaseState,
} from "@/lib/case/timeline";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { DEMO_REPORT } from "@/lib/demo";

// "Mi caso" and "¿Qué está pasando?": one state per situation, one sentence per
// state, in both languages, with facts only.

const NOW = new Date("2026-11-22T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function signed(daysAgo: number): AgreementRecord {
  const at = new Date(NOW.getTime() - daysAgo * DAY);
  return {
    disclosureAcknowledgedAt: new Date(at.getTime() - 60_000).toISOString(),
    signedAt: at.toISOString(),
    cancellationDeadline: cancellationDeadline(at).toISOString(),
    cancelledAt: null,
    serviceEndRequestedAt: null,
  };
}

const ACTIVE = signed(30);

function facts(over: Partial<CaseFacts> = {}): CaseFacts {
  return {
    ...EMPTY_CASE_FACTS,
    agreement: ACTIVE,
    reportImports: [ago(28)],
    review: { total: 8, reviewed: 8, confirmed: 3, finishedAt: ago(27) },
    ...over,
  };
}

function round(over: Partial<CaseRoundFact> = {}): CaseRoundFact {
  return {
    number: 1,
    preparedAt: ago(14),
    mailedAt: ago(12),
    letters: [
      { recipient: "Equifax", mailClass: "certified", status: "in_transit", mailedAt: ago(12), deliveredAt: null, returnedAt: null },
      { recipient: "Experian", mailClass: "certified", status: "in_transit", mailedAt: ago(12), deliveredAt: null, returnedAt: null },
    ],
    answers: [],
    ...over,
  };
}

/** One example of every state. */
const CASES: Record<CaseState, CaseFacts> = {
  no_agreement: facts({ agreement: null }),
  disclosed: facts({ agreement: { ...ACTIVE, signedAt: null, cancellationDeadline: null } }),
  cancelled: facts({ agreement: { ...signed(1), cancelledAt: ago(0.5) } }),
  end_requested: facts({ agreement: { ...ACTIVE, serviceEndRequestedAt: ago(2) } }),
  in_window: facts({ agreement: signed(0.2) }),
  report_waiting: facts({ reportImports: [] }),
  review_not_started: facts({ review: { total: 8, reviewed: 0, confirmed: 0, finishedAt: null } }),
  reviewing: facts({ review: { total: 8, reviewed: 5, confirmed: 2, finishedAt: null } }),
  nothing_to_send: facts({ review: { total: 8, reviewed: 8, confirmed: 0, finishedAt: ago(27) } }),
  preparing: facts(),
  mailed: facts({ rounds: [round()] }),
  delivered: facts({
    rounds: [round({ letters: round().letters.map((l) => ({ ...l, status: "delivered" as const, deliveredAt: ago(8) })) })],
  }),
  letter_returned: facts({
    rounds: [round({ letters: [{ ...round().letters[0]!, status: "returned", returnedAt: ago(6) }] })],
  }),
  answers_in: facts({ rounds: [round({ answers: [{ from: "Experian", receivedAt: ago(1) }] })] }),
  // The letters carry the round's own mailing date (rounds/timing.ts counts each letter from its own).
  window_over: facts({ rounds: [round({ mailedAt: ago(33), preparedAt: ago(35), letters: round().letters.map((l) => ({ ...l, mailedAt: ago(33) })) })] }),
  next_round_due: facts({ rounds: [round({ mailedAt: ago(45), preparedAt: ago(47), letters: round().letters.map((l) => ({ ...l, mailedAt: ago(45) })) })] }),
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("caseState", () => {
  for (const [state, f] of Object.entries(CASES)) {
    it(`recognises "${state}"`, () => {
      expect(caseState(f, NOW)).toBe(state);
    });
  }

  it("never says letters went out while the agreement does not allow work", () => {
    expect(caseState(facts({ agreement: signed(0.2), rounds: [round()] }), NOW)).toBe("in_window");
  });
});

describe("caseStatusSentence", () => {
  for (const [state, f] of Object.entries(CASES)) {
    for (const locale of ["es", "en"] as const) {
      it(`${state} (${locale}): short, plain and within the claim rules`, () => {
        const sentence = caseStatusSentence(f, locale, NOW);
        expect(sentence.length).toBeGreaterThan(10);
        // At most two short sentences, each under 25 words.
        const parts = sentence.split(/(?<=[.!?])\s+/);
        expect(parts.length).toBeLessThanOrEqual(3);
        for (const p of parts) expect(words(p)).toBeLessThanOrEqual(25);
        expect(checkClaimGuardrails(sentence)).toEqual([]);
        expect(checkMarketingCopy(sentence)).toEqual([]);
        expect(sentence).not.toMatch(/puntaje|score|eliminad|borrad|deleted|removed|guarant|garantiz/i);
      });
    }
  }

  it("says when the letters went out, and the bureaus' 30 days", () => {
    expect(caseStatusSentence(CASES.mailed, "es", NOW)).toBe(
      "Tus cartas de la ronda 1 se enviaron el 10 de noviembre. Los burós tienen unos 30 días para responder.",
    );
    expect(caseStatusSentence(CASES.mailed, "en", NOW)).toBe(
      "Your round 1 letters were mailed on November 10. The bureaus have about 30 days to answer.",
    );
  });

  it("gives the next round's date once the 30 days are over", () => {
    expect(caseStatusSentence(CASES.window_over, "es", NOW)).toContain("alrededor del 29 de noviembre");
  });

  it("says when the team may start inside the cancellation window", () => {
    expect(caseStatusSentence(CASES.in_window, "es", NOW)).toMatch(/Tu equipo empieza el \d+ de \p{L}+, cuando termina/u);
  });

  it("counts what is left of the review", () => {
    expect(caseStatusSentence(CASES.reviewing, "es", NOW)).toContain("faltan 3 puntos");
    expect(caseStatusSentence(facts({ review: { total: 8, reviewed: 7, confirmed: 2, finishedAt: null } }), "es", NOW)).toContain("falta 1 punto");
  });
});

describe("caseEvents", () => {
  const full = facts({
    documents: [{ kind: "government_id", receivedAt: ago(29), checkedAt: ago(28.5) }],
    rounds: [
      round({
        letters: round().letters.map((l) => ({ ...l, status: "delivered" as const, deliveredAt: ago(8) })),
        answers: [{ from: "Experian", receivedAt: ago(1) }],
      }),
    ],
    charges: [{ roundNumber: 1, amountCents: 8900, status: "succeeded", at: ago(11), workDate: ago(12), refundedAt: null }],
  });

  it("lists every fact on record, newest first, with its day", () => {
    const events = caseEvents(full, "es", NOW);
    const kinds = events.map((e) => e.kind);
    for (const kind of [
      "disclosures_read",
      "agreement_signed",
      "cancel_window_over",
      "document_received",
      "document_checked",
      "report_imported",
      "review_finished",
      "round_prepared",
      "round_mailed",
      "letters_delivered",
      "answer_received",
      "charge",
    ]) {
      expect(kinds).toContain(kind);
    }
    const times = events.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(events[0]!.kind).toBe("answer_received");
    expect(events.every((e) => e.day.length > 0)).toBe(true);
  });

  it("says what each charge paid for", () => {
    const charge = caseEvents(full, "es", NOW).find((e) => e.kind === "charge")!;
    expect(charge.title).toBe("Cobro de $89.00 por tu ronda 1");
    expect(charge.detail).toBe("Paga el trabajo de tu ronda 1: las cartas que se enviaron el 10 de noviembre.");
  });

  it("prints no amount when there is none to print", () => {
    const f = facts({ charges: [{ roundNumber: 1, amountCents: null, status: "succeeded", at: ago(11), workDate: ago(12), refundedAt: null }] });
    expect(caseEvents(f, "es", NOW).find((e) => e.kind === "charge")!.title).toBe("Cobro por tu ronda 1");
  });

  it("marks a first-class delivery as the post office's estimate", () => {
    const f = facts({ rounds: [round({ letters: [{ ...round().letters[0]!, mailClass: "first_class", status: "delivered", deliveredAt: ago(8) }] })] });
    expect(caseEvents(f, "es", NOW).find((e) => e.kind === "letters_delivered")!.detail).toContain("calcula el correo");
  });

  it("shows nothing from the future", () => {
    const f = facts({ documents: [{ kind: "government_id", receivedAt: new Date(NOW.getTime() + DAY).toISOString(), checkedAt: null }] });
    expect(caseEvents(f, "es", NOW).some((e) => e.kind === "document_received")).toBe(false);
  });

  it("every line, in both languages, passes the claim rules and stays short", () => {
    for (const f of [...Object.values(CASES), full]) {
      for (const locale of ["es", "en"] as const) {
        const t = caseTimeline(f, locale, NOW);
        const lines = [...t.events.flatMap((e) => [e.title, e.detail ?? ""]), ...t.next.flatMap((n) => [n.title, n.detail ?? ""])];
        for (const line of lines.filter(Boolean)) {
          expect(checkMarketingCopy(line), line).toEqual([]);
          for (const sentence of line.split(/(?<=[.!?])\s+/)) expect(words(sentence), sentence).toBeLessThanOrEqual(25);
        }
      }
    }
  });
});

describe("caseNext", () => {
  it("gives the bureaus' deadline and the next round's date after a mailing", () => {
    const next = caseNext(CASES.mailed, "es", NOW);
    expect(next.map((n) => n.key)).toEqual(["answer-window", "next-round"]);
    expect(next[1]!.title).toBe("Tu siguiente ronda se prepara alrededor del 20 de diciembre");
  });

  it("counts the 30 days from a certified delivery when there is one", () => {
    const due = caseNext(CASES.delivered, "es", NOW)[0]!;
    expect(Date.parse(due.at!)).toBe(Date.parse(ago(8)) + 30 * DAY);
  });

  it("is empty once the client cancelled", () => {
    expect(caseNext(CASES.cancelled, "es", NOW)).toEqual([]);
  });

  it("points the client to the review while it is unfinished", () => {
    expect(caseNext(CASES.reviewing, "es", NOW)[0]!.href).toBe("/asistente");
  });
});

describe("read aloud", () => {
  it("reads the sentence, what comes next and what happened", () => {
    const text = caseReadAloud(caseTimeline(CASES.mailed, "es", NOW), "es");
    expect(text.startsWith("Tus cartas de la ronda 1")).toBe(true);
    expect(text).toContain("Lo que sigue.");
    expect(text).toContain("Lo que ya pasó.");
  });
});

describe("the demo's example case", () => {
  it("is consistent: agreement, review, mailing, delivery, answer and charge in order", () => {
    const d = exampleCaseDates(NOW);
    const order = [d.acknowledged, d.signed, d.reportImported, d.reviewFinished, d.deadline, d.prepared, d.mailed, d.charged, d.delivered, d.answer];
    for (let i = 1; i < order.length; i++) expect(order[i]!.getTime()).toBeGreaterThan(order[i - 1]!.getTime());
    expect(d.answer.getTime()).toBeLessThan(NOW.getTime());
  });

  it("builds the case from the device's stores", () => {
    const d = exampleCaseDates(NOW);
    const flags = exampleFlags(DEMO_REPORT.items, d.reviewFinished.toISOString());
    const f = deviceCaseFacts({
      agreement: { ...signed(27), version: null, locale: "es", signerName: null, documentHash: null, cancelledWithinWindow: null, cancellationReason: null, serviceEndReason: null, terms: null },
      items: DEMO_REPORT.items,
      flags,
      roundFlags: flags,
      roundApproved: true,
      roundMailedAt: d.mailed.toISOString(),
      letterMail: {},
      charges: [],
      showAmounts: false,
      extras: null,
      reportImportedAt: d.reportImported.toISOString(),
      reviewFinishedAt: d.reviewFinished.toISOString(),
    });
    expect(f.review.reviewed).toBe(DEMO_REPORT.items.length);
    expect(f.rounds).toHaveLength(1);
    expect(f.rounds[0]!.letters.length).toBeGreaterThan(0);
    // Nothing saved about delivery: none is invented.
    expect(f.rounds[0]!.letters.every((l) => l.deliveredAt === null)).toBe(true);
    expect(caseState(f, NOW)).toBe("mailed");
  });

  it("shows no round while nothing went out", () => {
    const f = deviceCaseFacts({
      agreement: null,
      items: DEMO_REPORT.items,
      flags: {},
      roundFlags: {},
      roundApproved: false,
      roundMailedAt: null,
      letterMail: {},
      charges: [],
      showAmounts: false,
      extras: null,
      reportImportedAt: ago(0),
      reviewFinishedAt: null,
    });
    expect(f.rounds).toEqual([]);
    expect(caseState(f, NOW)).toBe("no_agreement");
  });
});
