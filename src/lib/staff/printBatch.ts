import type { LetterTarget } from "../domain/types";
import type { RoundRef } from "./data";
import { letterEnclosures, staffLetterText } from "./letters";
import { letterDestination } from "../mail/sendPlan";
import { sendableRound, sendBlockReason, type StaffContext } from "./stage";
import { fullName, type DocumentKind, type StaffClient, type StaffLetter, type StaffRound } from "./types";
import { staffLocaleFallback } from "./i18n/locale";

// Printing a batch of letters locally, as an alternative to a mail service:
// staff print the letters, sign and mail them, then mark the rounds as sent.
//
// This file is the logic behind /equipo/imprimir: which rounds a link names,
// which of them may be printed, the letters in print order, and the counts the
// screen shows. The page only lays the result out on paper.
//
// A round is printed with exactly the letters the console already shows for
// it. Nothing here changes a letter, an answer or a reason.

// ── Which rounds ────────────────────────────────────────────────────────

const PARAM = "rondas";
const REF = /^([A-Za-z0-9_-]{1,64}):([1-9]\d?)$/;

/** "c07:1,c14:2" → the rounds named, in order, each once. Anything malformed is ignored. */
export function parseRoundRefs(value: string | null | undefined): RoundRef[] {
  const refs: RoundRef[] = [];
  const seen = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    const match = REF.exec(part.trim());
    if (!match) continue;
    const key = `${match[1]}:${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ clientId: match[1]!, roundNumber: Number(match[2]) });
  }
  return refs;
}

export function roundRefsParam(refs: RoundRef[]): string {
  return refs.map((ref) => `${ref.clientId}:${ref.roundNumber}`).join(",");
}

/** The address of the print view for these rounds. */
export function roundRefsHref(refs: RoundRef[]): string {
  return `/equipo/imprimir?${PARAM}=${encodeURIComponent(roundRefsParam(refs))}`;
}

export const ROUND_REFS_PARAM = PARAM;

/** The send screen for these rounds (/equipo/enviar): classes, addresses and cost before anything goes out. */
export function sendRefsHref(refs: RoundRef[]): string {
  return `/equipo/enviar?${PARAM}=${encodeURIComponent(roundRefsParam(refs))}`;
}

// ── What goes in the envelope ───────────────────────────────────────────

const SLIP_NAME: Record<"es" | "en", Record<DocumentKind, string>> = {
  es: {
    government_id: "copia de identificación",
    proof_of_address: "comprobante de domicilio",
    ssn_card: "copia de la tarjeta de Seguro Social",
    identity_theft_report: "reporte de robo de identidad de la FTC",
  },
  en: {
    government_id: "copy of ID",
    proof_of_address: "proof of address",
    ssn_card: "copy of the Social Security card",
    identity_theft_report: "FTC identity theft report",
  },
};

/** The documents to add to an envelope, as the reminder slip (for whoever stuffs the envelopes) names them. */
export function slipNames(kinds: DocumentKind[], locale: "es" | "en" = "es"): string[] {
  return kinds.map((kind) => SLIP_NAME[locale][kind]);
}

/** "Adjuntar: copia de identificación, comprobante de domicilio" / "Enclose: copy of ID, proof of address". */
export function slipLine(kinds: DocumentKind[], locale: "es" | "en" = "es"): string {
  return `${locale === "es" ? "Adjuntar" : "Enclose"}: ${slipNames(kinds, locale).join(", ")}`;
}

// ── A letter, split for the page ────────────────────────────────────────

export interface LetterParts {
  /** The client's name and address, as the letter's first lines. */
  sender: string[];
  /** The date line. */
  date: string;
  /** The recipient's name and address: the block that shows through the envelope window. */
  recipient: string[];
  /** From the "Re:" line to the last paragraph before the closing. */
  body: string;
  /** "Sincerely," and the name under it, kept apart so the page can leave room to sign. Null if the letter has none. */
  closing: { valediction: string; name: string } | null;
  /** What follows the name: the enclosure list. Empty when there is none. */
  after: string;
}

/**
 * Splits a letter's text into the pieces the page positions separately. It
 * relies on the shape every template shares (letters/parts.ts): the sender,
 * the date and the recipient above a "Re:" line, each set apart by a blank
 * line. No word is added, dropped or changed. Returns null for a text that
 * does not have that shape; the page then prints it as it is.
 */
export function splitLetterText(text: string): LetterParts | null {
  const lines = text.split("\n").map((line) => line.trimEnd());
  const re = lines.findIndex((line) => line.startsWith("Re:"));
  if (re === -1) return null;

  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of lines.slice(0, re)) {
    if (line.trim() === "") {
      if (block.length > 0) blocks.push(block);
      block = [];
    } else block.push(line);
  }
  if (block.length > 0) blocks.push(block);
  if (blocks.length !== 3 || blocks[1]!.length !== 1) return null;

  const rest = lines.slice(re).join("\n");
  const at = rest.lastIndexOf("\nSincerely,\n");
  if (at === -1) return { sender: blocks[0]!, date: blocks[1]![0]!, recipient: blocks[2]!, body: rest.trimEnd(), closing: null, after: "" };

  const tail = rest.slice(at + 1).split("\n");
  const nameAt = tail.findIndex((line, index) => index > 0 && line.trim() !== "");
  return {
    sender: blocks[0]!,
    date: blocks[1]![0]!,
    recipient: blocks[2]!,
    body: rest.slice(0, at).trimEnd(),
    closing: { valediction: tail[0]!, name: nameAt === -1 ? "" : tail[nameAt]! },
    after: nameAt === -1 ? "" : tail.slice(nameAt + 1).join("\n").trim(),
  };
}

// ── The batch ───────────────────────────────────────────────────────────

export interface PrintLetter {
  id: string;
  clientId: string;
  clientName: string;
  roundNumber: number;
  recipient: LetterTarget;
  /** The whole letter, as mailed. */
  text: string;
  /** The same text split for the page, or null when it has an unexpected shape. */
  parts: LetterParts | null;
  /**
   * The identity documents to put in the envelope with this letter. They are
   * the client's photos, so they are not printed here: a letter that has any
   * is followed by a reminder slip.
   */
  enclosures: DocumentKind[];
}

export interface PrintRound {
  client: StaffClient;
  round: StaffRound;
  letters: PrintLetter[];
  /** True when the round was already marked as sent: this is a second copy. */
  alreadySent: boolean;
}

export interface SkippedRound {
  ref: RoundRef;
  /** Null when the client was not found. */
  clientName: string | null;
  /** Why it is not printed, in a sentence. */
  reason: string;
}

export interface PrintCounts {
  rounds: number;
  clients: number;
  letters: number;
  /** Reminder slips: one after each letter that has enclosures. */
  slips: number;
  /** One cover, plus one page per letter and per slip. A long letter adds a page; the screen measures that. */
  pagesAtLeast: number;
}

export interface PrintBatch {
  rounds: PrintRound[];
  /** Every letter of the batch in print order: by round as requested, then as the round lists them. */
  letters: PrintLetter[];
  skipped: SkippedRound[];
  /** The rounds "mark as sent by mail" will mark: those printed here that are not sent yet. */
  toMark: RoundRef[];
  counts: PrintCounts;
}

function printLetter(client: StaffClient, round: StaffRound, letter: StaffLetter, now: Date, context: StaffContext): PrintLetter {
  // A letter to a creditor or collector is printed with the address from the
  // address book (the one it is mailed to), never the one the report printed.
  if (context.furnishers && letter.recipient.type === "furnisher" && round.status === "ready") {
    const destination = letterDestination(letter, context.furnishers);
    if (destination.to) letter = { ...letter, recipient: { ...letter.recipient, name: destination.to.name, addressLines: destination.to.addressLines } };
  }
  const text = staffLetterText(client, round, letter, now, context.letterVersions);
  return {
    id: letter.id,
    clientId: client.id,
    clientName: fullName(client),
    roundNumber: round.number,
    recipient: letter.recipient,
    text,
    parts: splitLetterText(text),
    enclosures: letterEnclosures(client),
  };
}

/**
 * The print batch for these rounds.
 *
 * A round is printed when it can be mailed now (the same rule as "Listas para
 * enviar": prepared, and on a current report), or when it was already sent and
 * someone needs a second copy. A round still being prepared, or held back
 * because the report is too old, is left out and listed with the reason.
 */
export function buildPrintBatch(clients: StaffClient[], refs: RoundRef[], now: Date, context: StaffContext = {}): PrintBatch {
  const byId = new Map(clients.map((client) => [client.id, client]));
  const rounds: PrintRound[] = [];
  const skipped: SkippedRound[] = [];

  for (const ref of refs) {
    const client = byId.get(ref.clientId);
    if (!client) {
      skipped.push({ ref, clientName: null, reason: "No encontramos a este cliente." });
      continue;
    }
    const clientName = fullName(client);
    const skip = (reason: string) => skipped.push({ ref, clientName, reason });
    const es = (context.locale ?? staffLocaleFallback()) === "es";
    const round = client.rounds.find((r) => r.number === ref.roundNumber);
    if (!round) {
      skip(es ? `No tiene una ronda ${ref.roundNumber}.` : `There's no round ${ref.roundNumber}.`);
      continue;
    }
    if (round.letters.length === 0) {
      skip(es ? "La ronda no tiene cartas." : "The round has no letters.");
      continue;
    }
    const alreadySent = round.status === "mailed" || round.status === "responded";
    if (!alreadySent) {
      if (round.status === "draft") {
        skip(es ? "La ronda todavía está en preparación." : "The round is still being prepared.");
        continue;
      }
      if (sendableRound(client, now, context)?.number !== round.number) {
        skip(sendBlockReason(client, now, context) ?? (es ? "La ronda todavía no se puede enviar." : "The round can't be sent yet."));
        continue;
      }
    }
    rounds.push({ client, round, letters: round.letters.map((l) => printLetter(client, round, l, now, context)), alreadySent });
  }

  const letters = rounds.flatMap((r) => r.letters);
  const slips = letters.filter((l) => l.enclosures.length > 0).length;
  return {
    rounds,
    letters,
    skipped,
    toMark: rounds.filter((r) => !r.alreadySent).map((r) => ({ clientId: r.client.id, roundNumber: r.round.number })),
    counts: {
      rounds: rounds.length,
      clients: new Set(rounds.map((r) => r.client.id)).size,
      letters: letters.length,
      slips,
      pagesAtLeast: letters.length === 0 ? 0 : 1 + letters.length + slips,
    },
  };
}

/** Pages on paper: the cover, each letter's pages (a long letter runs to a second one) and the slips. */
export function totalPages(coverPages: number, letterPages: number[], slips: number): number {
  return coverPages + letterPages.reduce((sum, pages) => sum + Math.max(1, pages), 0) + slips;
}
