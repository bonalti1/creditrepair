import type { ReportItem } from "../domain/types";
import type { Locale } from "../i18n/dictionaries";
import { BUREAU_NAME, joinList } from "./roundCopy";
import { sameAccountKey } from "../domain/checks";

// The same account reported by more than one bureau. Each bureau's copy is its
// own item and gets its own answer and its own confirmation: nothing here
// copies an answer from one bureau to another, and nothing suggests which
// answer to give. The note only tells the customer that the other card exists
// and, if they already answered it, what they said.

// What makes two items "the same" across bureaus (creditor and masked account
// number; inquirer and date) lives with the data checks, so both always agree.
const matchKey = sameAccountKey;

/** The same account or inquiry as it appears on the OTHER bureaus, in report order. */
export function sameItemOnOtherBureaus(item: ReportItem, items: ReadonlyArray<ReportItem>): ReportItem[] {
  const key = matchKey(item);
  if (!key) return [];
  return items.filter((other) => other.bureau !== item.bureau && matchKey(other) === key);
}

type Answer = "correct" | "inaccurate" | "pending";

function answerOf(flag: { state: string } | undefined): Answer | null {
  if (!flag) return null;
  if (flag.state === "correct") return "correct";
  if (flag.state === "attested") return "inaccurate";
  return "pending"; // marked, confirmation still missing
}

const ANSWER: Record<Locale, Record<Answer, string>> = {
  es: {
    correct: "respondiste «Se ve correcto»",
    inaccurate: "respondiste «Creo que es inexacto»",
    pending: "la marcaste, pero falta tu confirmación",
  },
  en: {
    correct: "you answered “Looks correct”",
    inaccurate: "you answered “I believe it's inaccurate”",
    pending: "you flagged it, but your confirmation is still missing",
  },
};

export interface CrossBureauNote {
  /** The whole note, ready to show. */
  text: string;
  /** True when this item and its copy on another bureau both have an answer and the answers are not the same. */
  differs: boolean;
}

/**
 * The note for one item, or null when the item is on one bureau only.
 * `flags` are the customer's saved answers, keyed by fingerprint.
 */
export function crossBureauNote(
  item: ReportItem,
  items: ReadonlyArray<ReportItem>,
  flags: Readonly<Record<string, { state: string } | undefined>>,
  locale: Locale,
): CrossBureauNote | null {
  const others = sameItemOnOtherBureaus(item, items);
  if (others.length === 0) return null;
  const es = locale === "es";
  const bureau = (i: ReportItem) => BUREAU_NAME[i.bureau] ?? i.bureau;
  const thing = item.category === "inquiry" ? (es ? "Esta misma consulta" : "This same inquiry") : es ? "Esta misma cuenta" : "This same account";

  const sentences = [
    es
      ? `${thing} también aparece en ${joinList(others.map(bureau), locale)}.`
      : `${thing} also appears on ${joinList(others.map(bureau), locale)}.`,
  ];

  const mine = answerOf(flags[item.fingerprint]);
  let differs = false;
  for (const other of others) {
    const theirs = answerOf(flags[other.fingerprint]);
    if (!theirs) continue;
    sentences.push(es ? `En ${bureau(other)} ${ANSWER.es[theirs]}.` : `On ${bureau(other)} ${ANSWER.en[theirs]}.`);
    if (mine && mine !== theirs) differs = true;
  }

  if (differs) {
    sentences.push(
      es
        ? "Tus respuestas no son iguales. Eso puede estar bien: los burós no siempre tienen la misma información."
        : "Your answers are not the same. That can be right: bureaus do not always hold the same information.",
    );
  } else if (!mine) {
    sentences.push(
      es
        ? "Cada buró se revisa por separado, porque los burós no siempre tienen la misma información."
        : "Each bureau is reviewed separately, because bureaus do not always hold the same information.",
    );
  }
  return { text: sentences.join(" "), differs };
}

/**
 * Said once, right after an answer that is not the same as the answer already
 * given for the same account on another bureau. Null when the answers agree or
 * there is nothing to compare. It names where an answer can be changed and
 * does not say which one, if any, should change.
 */
export function differingAnswerLine(
  item: ReportItem,
  items: ReadonlyArray<ReportItem>,
  flags: Readonly<Record<string, { state: string } | undefined>>,
  locale: Locale,
): string | null {
  const mine = answerOf(flags[item.fingerprint]);
  if (!mine) return null;
  const different = sameItemOnOtherBureaus(item, items).filter((other) => {
    const theirs = answerOf(flags[other.fingerprint]);
    return theirs !== null && theirs !== mine;
  });
  if (different.length === 0) return null;
  const bureaus = joinList(
    different.map((i) => BUREAU_NAME[i.bureau] ?? i.bureau),
    locale,
  );
  const inquiry = item.category === "inquiry";
  return locale === "es"
    ? `En ${bureaus} respondiste otra cosa sobre esta misma ${inquiry ? "consulta" : "cuenta"}. Eso puede estar bien: los burós no siempre tienen la misma información. Para cambiar una respuesta, entra a Más → Revisar.`
    : `On ${bureaus} you gave a different answer about this same ${inquiry ? "inquiry" : "account"}. That can be right: bureaus do not always hold the same information. To change an answer, go to More → Review.`;
}
