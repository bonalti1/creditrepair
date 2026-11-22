import { ENCLOSURE_LABELS } from "../letters/enclosures";
import { renderWithVersions, type LetterVersion } from "../letters/versions/versions";
import { fullName, REQUIRED_DOCUMENTS, type DocumentKind, type StaffClient, type StaffLetter, type StaffRound } from "./types";

// A staff letter as text, built one way for every place the console shows it:
// the preview on the client page and the pages printed from /equipo/imprimir.
// What is read on screen is what is printed, and, with the approved letter
// texts passed in (letters/versions), what the server mails.

/** The identity documents that go in the envelope with this client's letters: the required ones that are on file. */
export function letterEnclosures(client: Pick<StaffClient, "documents">): DocumentKind[] {
  return REQUIRED_DOCUMENTS.filter((kind) => client.documents.includes(kind));
}

/**
 * The text of a letter as it is mailed, in English. Each item carries the
 * reason the client gave for it (letter.itemReasons); an item confirmed before
 * reasons existed is listed without one. The client's own words are not in it;
 * the report facts the client chose to include (letter.itemDetails) are.
 * `letterVersions`: the approved texts; without them, version 1 (the text in code).
 */
export function staffLetterText(client: StaffClient, round: StaffRound, letter: StaffLetter, now: Date, letterVersions?: readonly LetterVersion[]): string {
  return renderWithVersions(
    letter.templateKey,
    {
      user: { id: client.id, fullName: fullName(client), addressLines: client.addressLines, locale: "es" },
      target: letter.recipient,
      items: letter.items,
      date: round.mailedAt ?? now.toISOString(),
      roundNumber: round.number,
      enclosures: letterEnclosures(client).map((kind) => ENCLOSURE_LABELS[kind]!),
      itemReasons: letter.itemReasons,
      itemDetails: letter.itemDetails,
    },
    letterVersions,
  );
}
