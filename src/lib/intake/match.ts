// Comparing what a document says with what is on file: a person's name, a
// mailing address, a creditor. Written for how Spanish-speaking clients'
// documents actually differ from their account: accents dropped or added,
// capitals, a middle name or a second surname on one and not the other, "St"
// against "Street". When in doubt these say "no match" and a person looks.

/** Lowercase, no accents, letters/digits/spaces only. "José-María  Núñez" → "jose maria nunez". */
export function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_NOISE = new Set(["jr", "sr", "ii", "iii", "iv", "de", "del", "la", "las", "los", "y", "mr", "mrs", "ms", "sra", "sr"]);

function nameTokens(name: string): string[] {
  return plain(name)
    .split(" ")
    .filter((t) => t.length > 1 && !NAME_NOISE.has(t));
}

/**
 * The document's name is the client's when it has the client's first name
 * and at least one of their other names (a surname). Extra middle names or a
 * second surname on either side are fine; a different first name is not.
 */
export function namesMatch(documentName: string, nameOnFile: string): boolean {
  const doc = new Set(nameTokens(documentName));
  const file = nameTokens(nameOnFile);
  if (doc.size === 0 || file.length === 0) return false;
  if (file.length === 1) return doc.has(file[0]!);
  const [first, ...rest] = file;
  return doc.has(first!) && rest.some((t) => doc.has(t));
}

// ── Addresses ───────────────────────────────────────────────────────────

const STREET_WORDS: Record<string, string> = {
  street: "st", st: "st", avenue: "ave", ave: "ave", av: "ave", road: "rd", rd: "rd", drive: "dr", dr: "dr",
  boulevard: "blvd", blvd: "blvd", lane: "ln", ln: "ln", court: "ct", ct: "ct", circle: "cir", cir: "cir",
  place: "pl", pl: "pl", parkway: "pkwy", pkwy: "pkwy", highway: "hwy", hwy: "hwy", trail: "trl", trl: "trl",
  north: "n", n: "n", south: "s", s: "s", east: "e", e: "e", west: "w", w: "w",
};
const UNIT_WORDS = new Set(["apt", "apartment", "unit", "ste", "suite", "no", "num", "number", "bldg", "building", "fl", "floor", "lot", "rm", "room", "space", "spc"]);

export interface AddressParts {
  houseNumber: string | null;
  /** The street's own name words, without its type or direction ("calle ejemplo" → ["ejemplo"]). */
  streetWords: string[];
  zip: string | null;
}

/** The parts of a US address that decide whether two lines name the same place. */
export function addressParts(lines: readonly string[] | string): AddressParts {
  const text = plain(Array.isArray(lines) ? lines.join(" ") : (lines as string));
  const zips = text.match(/\b\d{5}(?:\s?\d{4})?\b/g) ?? [];
  const zip = zips.length > 0 ? zips[zips.length - 1]!.slice(0, 5) : null;
  const tokens = text.split(" ");
  const numberAt = tokens.findIndex((t) => /^\d+[a-z]?$/.test(t) && t.slice(0, 5) !== zip);
  const houseNumber = numberAt >= 0 ? tokens[numberAt]! : null;
  const streetWords: string[] = [];
  for (const token of tokens.slice(numberAt + 1)) {
    if (UNIT_WORDS.has(token) || /^\d/.test(token)) break;
    if (STREET_WORDS[token]) {
      // The street type ends the street name ("Old Street Apt 2"); a direction before it does not.
      if (!["n", "s", "e", "w"].includes(STREET_WORDS[token]!)) break;
      continue;
    }
    streetWords.push(token);
    if (streetWords.length >= 4) break;
  }
  return { houseNumber, streetWords, zip };
}

/** Same house number, same ZIP code, and a street name word in common. Apartment numbers are not compared. */
export function addressesMatch(documentAddress: readonly string[] | string, addressOnFile: readonly string[] | string): boolean {
  const a = addressParts(documentAddress);
  const b = addressParts(addressOnFile);
  if (!a.zip || !b.zip || a.zip !== b.zip) return false;
  if (!a.houseNumber || !b.houseNumber || a.houseNumber !== b.houseNumber) return false;
  if (a.streetWords.length === 0 || b.streetWords.length === 0) return false;
  return a.streetWords.some((w) => b.streetWords.includes(w));
}

// ── Creditors and accounts ──────────────────────────────────────────────

const COMPANY_NOISE = new Set(["inc", "llc", "corp", "corporation", "co", "company", "na", "n", "a", "the", "of", "bank", "usa", "services", "svcs", "financial", "fin", "credit", "card", "cards", "lp", "ltd"]);

function companyTokens(name: string): string[] {
  return plain(name)
    .split(" ")
    .filter((t) => t.length > 1 && !COMPANY_NOISE.has(t));
}

/** Two creditor names are the same company when one's distinctive words are all in the other ("CAPITAL ONE BANK USA NA" ~ "Capital One"). */
export function creditorsMatch(a: string, b: string): boolean {
  const x = companyTokens(a);
  const y = companyTokens(b);
  if (x.length === 0 || y.length === 0) return plain(a) === plain(b) && plain(a) !== "";
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.every((t) => longer.includes(t));
}

/** The last 4 digits of an account number as printed, or null when it shows fewer. */
export function lastFour(account: string | null | undefined): string | null {
  const digits = (account ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
