import { ROUND_CYCLE_DAYS } from "../domain/attack";
import type { PlannedLetter, ReportItem } from "../domain/types";
import type { Locale } from "../i18n/dictionaries";
import { letterPrintsReasons } from "../letters/templates";
import { reasonLabel, reasonSentence } from "./disputeReason";
import { itemLabel } from "./itemDisplay";
import { letterItems, type SessionPlan } from "./sessionPlan";

// What a round's letters cover, and what waits, in the customer's words.
// Round 1 mails only personal-information corrections; a confirmed account,
// inquiry or public record goes in the next round. These lines say so wherever
// letters are shown, approved or tracked, so nobody believes something was mailed
// when it was not. Copy rules: state the order and the wait; never say the
// order makes anything better, and never promise what a letter will achieve.

export const BUREAU_NAME: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

const FILE_REQUEST: Record<Locale, string> = { es: "solicitud de expediente", en: "file disclosure request" };

/** "a", "a y b", "a, b y c" / "a", "a and b", "a, b and c". */
export function joinList(parts: string[], locale: Locale): string {
  const and = locale === "es" ? " y " : " and ";
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")}${and}${parts[parts.length - 1]}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** What one letter covers, one label per item ("Nombre: R. BONALTI JR"). A file request names itself. */
export function letterCoverage(letter: PlannedLetter, items: ReportItem[], locale: Locale): string[] {
  const covered = letterItems(letter, items).map((i) => itemLabel(i, locale));
  return covered.length > 0 ? covered : [FILE_REQUEST[locale]];
}

export interface CoverageRow {
  /** Stable key for lists: the item's fingerprint, or "file-request". */
  key: string;
  /** The item's label ("Nombre: R. BONALTI JR"), or the file request's name. */
  label: string;
  /** The reason the customer gave, in their language. Null when none was given. */
  reasonLabel: string | null;
  /** The English sentence this letter prints after the item. Null when it prints none. */
  sentence: string | null;
}

/**
 * What one letter covers, item by item, with the reason the customer gave for
 * each and the sentence the letter prints for it. The sentence is shown only
 * for letters that print reasons, so the card never shows a line the letter
 * does not carry. An item confirmed before reasons existed has neither.
 */
export function letterCoverageRows(
  letter: PlannedLetter,
  items: ReportItem[],
  reasons: Readonly<Record<string, string | undefined>>,
  locale: Locale,
): CoverageRow[] {
  const covered = letterItems(letter, items);
  if (covered.length === 0) return [{ key: "file-request", label: FILE_REQUEST[locale], reasonLabel: null, sentence: null }];
  const prints = letterPrintsReasons(letter.templateKey);
  return covered.map((item) => {
    const code = reasons[item.fingerprint];
    return {
      key: item.fingerprint,
      label: itemLabel(item, locale),
      reasonLabel: reasonLabel(code, locale),
      sentence: prints ? reasonSentence(code) : null,
    };
  });
}

/** "tu cobranza de Midland Credit Management" / "your Midland Credit Management collection". */
function itemPhrase(item: ReportItem, locale: Locale): string {
  const es = locale === "es";
  if (item.category === "tradeline") {
    const data = item.data as { accountType?: unknown; status?: unknown };
    const isCollection = /collection/i.test(String(data.accountType ?? "")) || /collection/i.test(String(data.status ?? ""));
    if (isCollection) return es ? `tu cobranza de ${item.name}` : `your ${item.name} collection`;
    return es ? `tu cuenta de ${item.name}` : `your ${item.name} account`;
  }
  if (item.category === "inquiry") return es ? `tu consulta de ${item.name}` : `your ${item.name} inquiry`;
  if (item.category === "public_record") return es ? `tu registro público (${item.name})` : `your public record (${item.name})`;
  const label = itemLabel(item, locale);
  return es ? `tu dato personal (${label})` : `your personal information entry (${label})`;
}

/**
 * The items as a phrase list. The bureau is added only where two items would
 * otherwise read the same (the same collection confirmed on two bureaus).
 */
export function itemPhrases(items: ReportItem[], locale: Locale): string[] {
  const plain = items.map((i) => itemPhrase(i, locale));
  return plain.map((phrase, index) => {
    const repeated = plain.filter((p) => p === phrase).length > 1;
    if (!repeated) return phrase;
    const bureau = BUREAU_NAME[items[index]!.bureau] ?? items[index]!.bureau;
    return locale === "es" ? `${phrase} en ${bureau}` : `${phrase} on ${bureau}`;
  });
}

export interface RoundNote {
  title: string;
  body: string;
}

/**
 * The note shown with the letters (and above the approve button, in self-serve mode) when
 * something the customer confirmed is not in this round's letters. Null when
 * everything confirmed is in the letters.
 */
export function waitingNote(session: Pick<SessionPlan, "roundNumber" | "inRound" | "waiting">, locale: Locale): RoundNote | null {
  const { roundNumber, inRound, waiting } = session;
  if (waiting.length === 0) return null;
  const one = waiting.length === 1;
  const list = capitalise(joinList(itemPhrases(waiting, locale), locale));
  if (locale === "es") {
    return {
      title: "No todo lo que confirmaste va en estas cartas",
      body: [
        roundNumber <= 1 ? `Esta ronda trata primero tus datos personales (${inRound.length}).` : "",
        `${list} ya ${one ? "tiene" : "tienen"} tu confirmación y ${one ? "va" : "van"} en tu siguiente ronda, unos ${ROUND_CYCLE_DAYS} días después de enviar estas cartas.`,
        roundNumber <= 1 ? "Los datos personales van primero porque los burós los usan para identificar tu expediente." : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  return {
    title: "Not everything you confirmed is in these letters",
    body: [
      roundNumber <= 1 ? `This round covers your personal information first (${inRound.length}).` : "",
      `${list} ${one ? "is" : "are"} confirmed and ${one ? "goes" : "go"} in your next round, about ${ROUND_CYCLE_DAYS} days after these letters are mailed.`,
      roundNumber <= 1 ? "Personal information goes first because the bureaus use it to identify your file." : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** One line under the "waiting" heading on the rounds page. */
export function waitingListNote(locale: Locale): string {
  return locale === "es"
    ? `Ya tienen tu confirmación. No van en las cartas de esta ronda: van en la siguiente, unos ${ROUND_CYCLE_DAYS} días después de enviar estas cartas.`
    : `They are confirmed. They are not in this round's letters: they go in the next one, about ${ROUND_CYCLE_DAYS} days after these letters are mailed.`;
}

/**
 * Capi's message once the customer approves: which letters went out, what each
 * covers, and which confirmed items wait for the next round.
 */
export function approvedMessage(
  session: Pick<SessionPlan, "plan" | "waiting">,
  items: ReportItem[],
  locale: Locale,
): string {
  const { plan, waiting } = session;
  const es = locale === "es";
  const one = plan.letters.length === 1;
  const rows = plan.letters.map((l) => `• ${l.target.name} — ${letterCoverage(l, items, locale).join("; ")}`);
  const parts = [
    es
      ? `¡Hecho! 📬 ${one ? "Esta carta se imprime y va por correo:" : `Estas ${plan.letters.length} cartas se imprimen y van por correo:`}`
      : `Done! 📬 ${one ? "This letter is being printed and mailed:" : `These ${plan.letters.length} letters are being printed and mailed:`}`,
    rows.join("\n"),
  ];
  if (waiting.length > 0) {
    const list = joinList(itemPhrases(waiting, locale), locale);
    parts.push(
      es
        ? `\nNo van en estas cartas y esperan a tu siguiente ronda, unos ${ROUND_CYCLE_DAYS} días después: ${list}. Ya ${waiting.length === 1 ? "tiene" : "tienen"} tu confirmación.`
        : `\nNot in these letters, waiting for your next round about ${ROUND_CYCLE_DAYS} days later: ${list}. ${waiting.length === 1 ? "It is" : "They are"} already confirmed.`,
    );
  }
  parts.push(
    es
      ? "\nLos burós tienen ~30 días para responder; yo vigilo el calendario y te aviso aquí. No tienes que hacer nada más."
      : "\nBureaus have ~30 days to respond; I watch the calendar and message you here. Nothing else to do.",
  );
  return parts.join("\n");
}
