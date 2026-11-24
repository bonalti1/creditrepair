import { cancellationDeadline } from "../agreement/businessDays";
import { caseDay, caseTimeline, type CaseEventKind, type CaseFacts, type CaseIcon } from "../case/timeline";
import type { Locale } from "../i18n/dictionaries";

// The home page's example (Alti explains; a small cameo carries the letters): what "Mi caso" would show a few days after
// the visitor's answer. Built on the server with the app's own timeline rules
// (src/lib/case/timeline.ts), from invented facts dated from today, so the
// example says exactly what a client's Mi caso says, in the same words, and
// the phone frame needs no logic of its own (and the browser no extra code).
//
// Everything here is sample data and the page labels it "Example". The
// letters are the ones the app would prepare for a collection on two
// bureaus: one to each bureau, one to the collector (certified, like every
// letter to a collector: src/lib/mail/classes.ts).

export type DemoChoice = "notMine" | "wrongBalance" | "looksRight";

export interface DemoCaseLine {
  day: string;
  title: string;
  detail?: string;
  icon: CaseIcon;
}

export interface DemoCase {
  sentence: string;
  happened: DemoCaseLine[];
  next: Array<{ day: string | null; title: string; detail?: string }>;
}

const DAY = 24 * 60 * 60 * 1000;
const at = (base: Date, days: number, hour = 15) => {
  const d = new Date(base.getTime() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

/** The kinds of event the example shows: the work, not the paperwork before it. */
/** The invented collector, in each language (the same name the example item shows). */
export const DEMO_COLLECTOR: Record<Locale, string> = { en: "Sample Collections", es: "Cobranzas de Muestra" };

const SHOWN: readonly CaseEventKind[] = ["review_finished", "round_prepared", "round_mailed", "letters_delivered"];

/** The invented case. `disputed` is false when the visitor said the item looks right. */
export function demoFacts(today: Date, disputed: boolean, collector: string = DEMO_COLLECTOR.en): CaseFacts {
  const signed = new Date(today.getTime() - 9 * DAY);
  return {
    agreement: {
      disclosureAcknowledgedAt: at(today, -9, 14),
      signedAt: signed.toISOString(),
      cancellationDeadline: cancellationDeadline(signed).toISOString(),
      cancelledAt: null,
      serviceEndRequestedAt: null,
    },
    documents: [
      { kind: "government_id", receivedAt: at(today, -8), checkedAt: at(today, -8, 18) },
      { kind: "proof_of_address", receivedAt: at(today, -8), checkedAt: at(today, -8, 18) },
    ],
    reportImports: [at(today, -2)],
    review: { total: 1, reviewed: 1, confirmed: disputed ? 1 : 0, finishedAt: at(today, 0, 14) },
    rounds: disputed
      ? [
          {
            number: 1,
            preparedAt: at(today, 0, 16),
            mailedAt: at(today, 1),
            letters: [
              { recipient: "Experian", mailClass: "first_class", status: "delivered", mailedAt: at(today, 1), deliveredAt: at(today, 4), returnedAt: null },
              { recipient: "TransUnion", mailClass: "first_class", status: "delivered", mailedAt: at(today, 1), deliveredAt: at(today, 4), returnedAt: null },
              { recipient: collector, mailClass: "certified", status: "delivered", mailedAt: at(today, 1), deliveredAt: at(today, 5), returnedAt: null },
            ],
            answers: [],
          },
        ]
      : [],
    charges: [],
  };
}

/** What Mi caso shows, about a week after today, for one answer. */
export function demoCase(choice: DemoChoice, locale: Locale, today: Date = new Date()): DemoCase {
  const disputed = choice !== "looksRight";
  const now = new Date(today.getTime() + 6 * DAY);
  const t = caseTimeline(demoFacts(today, disputed, DEMO_COLLECTOR[locale]), locale, now);
  return {
    sentence: t.sentence,
    happened: t.events
      .filter((e) => SHOWN.includes(e.kind))
      .map((e) => ({ day: e.day, title: e.title, detail: e.detail, icon: e.icon })),
    next: t.next.map((n) => {
      const day = n.at ? caseDay(n.at, locale) : null;
      // "Your next round is prepared around January 4" already says its day.
      return { day: day && !n.title.includes(day) ? day : null, title: n.title, detail: n.detail };
    }),
  };
}

/** All three answers, for the island to switch between without a request. */
export function demoCases(locale: Locale, today: Date = new Date()): Record<DemoChoice, DemoCase> {
  return {
    notMine: demoCase("notMine", locale, today),
    wrongBalance: demoCase("wrongBalance", locale, today),
    looksRight: demoCase("looksRight", locale, today),
  };
}
