import { letterEnclosures, staffLetterText } from "../staff/letters";
import { fullName, type StaffClient, type StaffLetter, type StaffRound } from "../staff/types";
import { formatUsAddress, parseUsAddress } from "./address";
import { defaultMailClass } from "./classes";
import { resolveFurnisherAddress, type FurnisherEntry } from "./furnishers";
import { batchCost, estimatePages, letterCost, type LetterCost } from "./pricing";
import type { MailClass } from "./types";
import { VERIFICATION_COST_MILLS } from "./verify";

// What sending a round would do, letter by letter, before anything is sent:
// where each letter goes, by which class, how many pages, what it costs, and
// what stops it. The send screen (/equipo/enviar) shows exactly this, and the
// send itself refuses a round this plan blocks.
//
// Addresses come from two places only:
//   - bureaus and secondary bureaus: the registry (domain/bureaus.ts), every
//     entry checked and dated;
//   - creditors and collectors: the furnisher address book (furnishers.ts),
//     only an address a person dated against a source.
// The address a credit report prints for a furnisher is never used: it is
// usually not where disputes go.

export interface LetterMailPlan {
  letter: StaffLetter;
  /** The class it will go by: staff's choice, else the letter's own, else the default for its kind. */
  mailClass: MailClass;
  defaultClass: MailClass;
  /** Recipient name and the address lines it will be mailed to; null when there is none to use. */
  to: { name: string; addressLines: string[] } | null;
  /** Where the address came from. */
  addressFrom: "registry" | "address_book";
  /** The address book entry, for a furnisher letter that found one. */
  furnisherEntryId: string | null;
  /** Why this letter cannot go; null when it can. */
  blocker: string | null;
  /** For a furnisher letter with no usable address: the company to add to the book. */
  missingCompany: string | null;
  pages: number;
  cost: LetterCost;
}

export interface RoundMailPlan {
  client: StaffClient;
  round: StaffRound;
  letters: LetterMailPlan[];
  /** The client's address, as the return address. Null when it cannot be read. */
  from: { name: string; addressLines: string[] } | null;
  /** Everything that stops the round, one sentence each. Empty when it can go. */
  blockers: string[];
  totalMills: number;
  /**
   * Addresses checked with the post office's data before mailing (mail/verify.ts):
   * the return address and one per letter, and their estimated cost, apart from
   * the letters' own. An address checked in the last 30 days is reused and
   * costs nothing, so this is the most it can cost.
   */
  verifications: number;
  verificationMills: number;
}

export type MailClassChoices = Readonly<Record<string, MailClass>>;

/** The class a letter goes by: a choice made for this send, the one recorded on the letter, or the default. */
export function chosenMailClass(letter: StaffLetter, choices?: MailClassChoices): MailClass {
  return choices?.[letter.id] ?? letter.mailClass ?? defaultMailClass(letter.templateKey, letter.recipient.type);
}

/** The address a letter is mailed to, or why there is none. */
export function letterDestination(
  letter: StaffLetter,
  book: readonly FurnisherEntry[],
): { to: { name: string; addressLines: string[] } | null; from: "registry" | "address_book"; entryId: string | null; blocker: string | null; missingCompany: string | null } {
  if (letter.recipient.type === "furnisher") {
    const resolved = resolveFurnisherAddress(book, letter.recipient.name);
    if (!resolved.ok) {
      return { to: null, from: "address_book", entryId: resolved.entry?.id ?? null, blocker: resolved.message, missingCompany: resolved.entry?.name ?? letter.recipient.name };
    }
    return { to: { name: resolved.entry.name, addressLines: resolved.addressLines }, from: "address_book", entryId: resolved.entry.id, blocker: null, missingCompany: null };
  }
  const parsed = parseUsAddress(letter.recipient.addressLines);
  if (!parsed.ok || !letter.recipient.verifiedOn) {
    return {
      to: null,
      from: "registry",
      entryId: null,
      blocker: `La dirección de ${letter.recipient.name} en el registro no se puede usar${parsed.ok ? " (no está verificada)" : `: ${parsed.message}`}`,
      missingCompany: null,
    };
  }
  return { to: { name: letter.recipient.name, addressLines: formatUsAddress(parsed.address) }, from: "registry", entryId: null, blocker: null, missingCompany: null };
}

/**
 * A letter not sent yet, as it will go: a letter to a creditor or collector
 * carries the address book's address, or none at all while the book has no
 * checked one. Never the address the report printed. Letters to bureaus, and
 * letters already sent (they show where they went), are returned as they are.
 */
export function letterAsItWillGo(letter: StaffLetter, round: Pick<StaffRound, "status">, book: readonly FurnisherEntry[]): StaffLetter {
  if (letter.recipient.type !== "furnisher" || (round.status !== "ready" && round.status !== "draft")) return letter;
  const destination = letterDestination(letter, book);
  return {
    ...letter,
    recipient: destination.to
      ? { ...letter.recipient, name: destination.to.name, addressLines: destination.to.addressLines }
      : { ...letter.recipient, addressLines: [] },
  };
}

/** The plan for sending one round. Pure. */
export function roundMailPlan(
  client: StaffClient,
  round: StaffRound,
  book: readonly FurnisherEntry[],
  now: Date,
  choices?: MailClassChoices,
): RoundMailPlan {
  const enclosures = letterEnclosures(client).length;
  const letters: LetterMailPlan[] = round.letters.map((letter) => {
    const destination = letterDestination(letter, book);
    const mailClass = chosenMailClass(letter, choices);
    const pages = estimatePages(staffLetterText(client, round, letter, now), enclosures);
    return {
      letter,
      mailClass,
      defaultClass: defaultMailClass(letter.templateKey, letter.recipient.type),
      to: destination.to,
      addressFrom: destination.from,
      furnisherEntryId: destination.entryId,
      blocker: destination.blocker,
      missingCompany: destination.missingCompany,
      pages,
      cost: letterCost({ mailClass, pages }),
    };
  });

  const blockers: string[] = [];
  const returnAddress = parseUsAddress(client.addressLines);
  const from = returnAddress.ok ? { name: fullName(client), addressLines: formatUsAddress(returnAddress.address) } : null;
  if (!from) blockers.push(`La dirección del cliente no se puede leer: ${returnAddress.ok ? "" : returnAddress.message}`.trim());
  for (const blocker of new Set(letters.flatMap((l) => (l.blocker ? [l.blocker] : [])))) blockers.push(blocker);

  const verifications = 1 + letters.length;
  return {
    client,
    round,
    letters,
    from,
    blockers,
    totalMills: batchCost(letters.map((l) => l.cost)),
    verifications,
    verificationMills: verifications * VERIFICATION_COST_MILLS,
  };
}

/**
 * The companies a round cannot be mailed to yet, each once, in letter order:
 * a furnisher letter whose company has no checked address in the book.
 */
export function missingFurnisherAddresses(
  round: Pick<StaffRound, "letters">,
  book: readonly FurnisherEntry[],
): Array<{ company: string; entryId: string | null; message: string }> {
  const seen = new Set<string>();
  const out: Array<{ company: string; entryId: string | null; message: string }> = [];
  for (const letter of round.letters) {
    if (letter.recipient.type !== "furnisher") continue;
    const resolved = resolveFurnisherAddress(book, letter.recipient.name);
    if (resolved.ok) continue;
    const company = resolved.entry?.name ?? letter.recipient.name;
    if (seen.has(company)) continue;
    seen.add(company);
    out.push({ company, entryId: resolved.entry?.id ?? null, message: resolved.message });
  }
  return out;
}

/** The address book form for a company: to edit its entry, or to add it with the name filled in. */
export function addressBookHref(company: string, entryId: string | null): string {
  return entryId ? `/equipo/acreedores?editar=${encodeURIComponent(entryId)}` : `/equipo/acreedores?nuevo=${encodeURIComponent(company)}`;
}
