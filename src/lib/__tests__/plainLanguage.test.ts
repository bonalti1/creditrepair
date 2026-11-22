import { describe, expect, it } from "vitest";
import { cancellationDeadline } from "@/lib/agreement/businessDays";
import { DICTS } from "@/lib/i18n/dictionaries";
import { MARKETING } from "@/lib/i18n/marketing";
import { LESSONS } from "@/lib/learn/lessons";
import { PULSE_COPY } from "@/lib/pulse/pulse";
import { BILLING_COPY } from "@/lib/ux/billingCopy";
import { getCategoryExplainers, getStageExplainers, getTermGlossary } from "@/lib/ux/explainers";
import { HUMAN_HELP } from "@/lib/ux/humanHelp";
import { ITEM_KIND_LINES, PERSONAL_INFO_HINT_LINES } from "@/lib/ux/itemDisplay";
import { nextAction, type JourneyState } from "@/lib/ux/journey";
import { collectStrings, longSentences, MAX_SENTENCE_WORDS, sentences, wordsIn } from "@/lib/ux/plainLanguage";
import { LETTERS_OUT_LINE, reviewCompleteLine, reviewFinishedLine, reviewIntroLine } from "@/lib/ux/reviewChatCopy";
import { waitingListNote } from "@/lib/ux/roundCopy";

// Plain language: no sentence in the client app's copy runs over 25 words.
// The agreement's legal documents (/acuerdo, src/lib/agreement/documents.ts)
// are attorney text and are exempt.

const NOW = new Date("2026-11-22T18:00:00Z");
const signedAt = new Date(NOW.getTime() - 20 * 86_400_000);
const AGREEMENT = {
  disclosureAcknowledgedAt: signedAt.toISOString(),
  signedAt: signedAt.toISOString(),
  cancellationDeadline: cancellationDeadline(signedAt).toISOString(),
  cancelledAt: null,
  serviceEndRequestedAt: null,
};

/** The journey's copy, through every step it can show. */
function journeyStrings(locale: "es" | "en"): string[] {
  const base: JourneyState = { reportImported: true, totalItems: 8, reviewedCount: 8, attestedCount: 3, roundApproved: false, agreement: AGREEMENT };
  const states: JourneyState[] = [
    { ...base, agreement: null },
    { ...base, agreement: { ...AGREEMENT, signedAt: null, cancellationDeadline: null } },
    { ...base, agreement: { ...AGREEMENT, cancelledAt: NOW.toISOString() } },
    { ...base, agreement: { ...AGREEMENT, serviceEndRequestedAt: NOW.toISOString() } },
    { ...base, agreement: { ...AGREEMENT, signedAt: NOW.toISOString(), cancellationDeadline: cancellationDeadline(NOW).toISOString() } },
    { ...base, reportImported: false },
    { ...base, reviewedCount: 0 },
    { ...base, reviewedCount: 5 },
    { ...base, attestedCount: 0 },
    base,
    { ...base, paymentMethodOnFile: false },
    { ...base, roundApproved: true, mailedAt: new Date(NOW.getTime() - 5 * 86_400_000).toISOString() },
    { ...base, roundApproved: true, mailedAt: new Date(NOW.getTime() - 35 * 86_400_000).toISOString() },
    { ...base, roundApproved: true, mailedAt: new Date(NOW.getTime() - 50 * 86_400_000).toISOString() },
  ];
  return states.flatMap((s) =>
    (["full_service", "self_serve"] as const).flatMap((mode) => {
      const step = nextAction(s, locale, { mode, now: NOW });
      return [step.title, step.description, step.cta];
    }),
  );
}

function clientCopy(locale: "es" | "en"): Record<string, string[]> {
  return {
    "i18n/dictionaries": collectStrings(DICTS[locale]),
    "i18n/marketing (landing, /empezar, onboarding)": collectStrings(MARKETING[locale]),
    "ux/journey": journeyStrings(locale),
    "ux/explainers": [
      ...collectStrings(getCategoryExplainers(locale)),
      ...collectStrings(getStageExplainers(locale)),
      ...collectStrings(getTermGlossary(locale)),
    ],
    "ux/billingCopy": collectStrings(BILLING_COPY[locale]),
    "ux/humanHelp": collectStrings(HUMAN_HELP).filter(Boolean),
    "ux/itemDisplay": [...collectStrings(ITEM_KIND_LINES), ...PERSONAL_INFO_HINT_LINES],
    "ux/reviewChatCopy": collectStrings([
      reviewIntroLine("full_service", 3),
      reviewCompleteLine("full_service", 3),
      reviewFinishedLine("full_service"),
      LETTERS_OUT_LINE,
    ]),
    "ux/roundCopy": [waitingListNote(locale)],
    "pulse": collectStrings(PULSE_COPY[locale]),
    "learn/lessons": LESSONS.flatMap((l) => [l.title[locale], l.summary[locale], ...l.body[locale]]),
  };
}

describe("the checker", () => {
  it("splits sentences and counts words", () => {
    expect(sentences("Hola. ¿Cómo estás? Bien")).toEqual(["Hola.", "¿Cómo estás?", "Bien"]);
    expect(wordsIn("Tus cartas — de la ronda 1 — salieron.")).toBe(7);
  });

  it("flags a long sentence", () => {
    const long = Array.from({ length: 30 }, () => "palabra").join(" ") + ".";
    expect(longSentences([long])).toHaveLength(1);
  });
});

describe(`plain language: no sentence over ${MAX_SENTENCE_WORDS} words in client copy`, () => {
  for (const locale of ["es", "en"] as const) {
    for (const [source, strings] of Object.entries(clientCopy(locale))) {
      it(`${locale}: ${source}`, () => {
        expect(strings.length).toBeGreaterThan(0);
        expect(longSentences(strings).map((l) => `${l.words}: ${l.sentence}`)).toEqual([]);
      });
    }
  }
});

describe("legal terms come with their plain words", () => {
  it("every FCRA mention in Spanish client copy names the law in plain words nearby", () => {
    const strings = Object.values(clientCopy("es")).flat();
    for (const s of strings.filter((t) => /\bFCRA\b/.test(t))) {
      expect(s, s).toMatch(/ley/i);
    }
  });

  it("the same in English, the language a client starts in", () => {
    const strings = Object.values(clientCopy("en")).flat();
    expect(strings.filter((t) => /\bFCRA\b/.test(t)).length).toBeGreaterThan(0);
    for (const s of strings.filter((t) => /\bFCRA\b/.test(t))) {
      expect(s, s).toMatch(/\blaw\b/i);
    }
  });
});
