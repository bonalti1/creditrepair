// US mailing addresses, from the lines we store to the fields a mail service
// wants (street, unit, city, state, ZIP).
//
// We keep addresses as lines, the way they are printed on an envelope:
//   ["P.O. Box 740256", "Atlanta, GA 30374-0256"]
//   ["123 Main St", "Apt 4B", "Houston, TX 77002"]
//   ["Attn: Credit Bureau Disputes", "P.O. Box 31293", "Salt Lake City, UT 84131-1293"]
// A mail service needs them split. parseUsAddress does that, and refuses what
// it cannot read rather than guessing: a wrong city or ZIP is a lost letter
// and a wasted 30-day clock.
//
// What it accepts: a unit on its own line or at the end of the street line
// ("Apt 4", "Suite 200", "Ste 200", "Unit 5", "#5"), an attention line
// ("Attn: …", "c/o …"), ZIP or ZIP+4 (with a hyphen, a space or neither), the
// state as a code or its full name, a comma or none before the state, the
// whole address on one line, and a trailing "USA". What it refuses: no street,
// no city, an unknown state, a missing or malformed ZIP, more than two street
// lines, or a line longer than the mail service allows.

/** The longest street line a US address may have at Lob (address_line1 / address_line2). Verified in Lob's API schema (AddressEditable). */
export const MAX_ADDRESS_LINE = 64;

export interface UsAddress {
  /** Street and number, or "P.O. Box …". */
  line1: string;
  /** Apartment, suite, unit; null when there is none. */
  line2: string | null;
  city: string;
  /** Two-letter code, upper case. */
  state: string;
  /** "77002" or "77002-1234". */
  zip: string;
  /** "Attn: …" or "c/o …" line, when the address has one. Goes above the street. */
  attention: string | null;
}

export type AddressProblem =
  | "empty"
  | "no_street"
  | "no_city"
  | "bad_state"
  | "no_zip"
  | "too_many_lines"
  | "line_too_long";

export type ParsedAddress = { ok: true; address: UsAddress } | { ok: false; problem: AddressProblem; message: string };

const MESSAGE: Record<AddressProblem, string> = {
  empty: "No hay dirección.",
  no_street: "Falta la calle o el apartado postal.",
  no_city: "Falta la ciudad.",
  bad_state: "El estado no es un estado de EE. UU.",
  no_zip: "Falta el código postal (5 dígitos, o 5 + 4).",
  too_many_lines: "Tiene más de dos líneas de calle; no se sabe cuál es la de entrega.",
  line_too_long: `Una línea pasa de ${MAX_ADDRESS_LINE} caracteres, el máximo que acepta el servicio de correo.`,
};

const STATE_NAMES: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO",
  CONNECTICUT: "CT", DELAWARE: "DE", "DISTRICT OF COLUMBIA": "DC", FLORIDA: "FL", GEORGIA: "GA",
  HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY",
  LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN",
  MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
  OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
  "PUERTO RICO": "PR", GUAM: "GU", "VIRGIN ISLANDS": "VI", "AMERICAN SAMOA": "AS", "NORTHERN MARIANA ISLANDS": "MP",
};

/** Every code USPS delivers to: the states, DC, the territories and the military post offices. */
const STATE_CODES = new Set([...Object.values(STATE_NAMES), "AA", "AE", "AP", "FM", "MH", "PW"]);

const COUNTRY_LINE = /^(USA|U\.\s?S\.\s?A\.?|US|U\.\s?S\.?|UNITED STATES( OF AMERICA)?)$/i;
const ATTENTION_LINE = /^(attn\.?|attention|c\/o|care of)\b[:\s]*/i;
const ZIP_AT_END = /(?:^|[\s,])(\d{5})(?:[-\s]?(\d{4}))?\s*$/;
/** A unit at the end of a street line: ", Apt 4B", " Suite 200", " Ste. 200", " #12", " Unit C", " Fl 3". */
const UNIT_ID = String.raw`(?:[\w-]*\d[\w-]*|[A-Za-z])`;
const UNIT_WORD = String.raw`(?:apt|apartment|suite|ste|unit|fl|floor|rm|room|bldg|building|dept|lot|spc|space|trlr)`;
const UNIT = String.raw`(?:${UNIT_WORD}\.?\s*#?\s*${UNIT_ID}|#\s*${UNIT_ID})`;
// The unit's number must have a digit or be a single letter, so "123 Parking Lot Rd" stays one street.
const UNIT_AT_END = new RegExp(String.raw`^(.*?\S)[,\s]+(${UNIT})\s*$`, "i");
/** A line that is only a unit: "Apt 4B", "Suite 200", "#12". */
const UNIT_LINE = new RegExp(String.raw`^${UNIT}$`, "i");

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** The two-letter code for "TX", "tx", "Texas", "TEXAS", "New York". Null when unknown. */
export function stateCode(value: string): string | null {
  const v = clean(value).replace(/\.$/, "").toUpperCase();
  if (v.length === 2) return STATE_CODES.has(v) ? v : null;
  return STATE_NAMES[v] ?? null;
}

/** Splits "City, ST" or "City ST" or "City, State Name": the state from the end. */
function splitCityState(text: string): { city: string; state: string } | null {
  const words = clean(text.replace(/,\s*$/, "")).split(" ");
  // Longest state name first ("West Virginia" before "Virginia").
  for (let take = Math.min(4, words.length); take >= 1; take--) {
    const candidate = words.slice(-take).join(" ").replace(/^,/, "");
    const code = stateCode(candidate);
    if (!code) continue;
    const city = clean(words.slice(0, -take).join(" ").replace(/,\s*$/, ""));
    return { city, state: code };
  }
  return null;
}

/**
 * Reads address lines into street, unit, city, state and ZIP. Refuses what it
 * cannot read with certainty (see the file comment); never fills a gap.
 */
export function parseUsAddress(lines: readonly string[]): ParsedAddress {
  const fail = (problem: AddressProblem): ParsedAddress => ({ ok: false, problem, message: MESSAGE[problem] });

  let rows = lines.map(clean).filter((line) => line.length > 0);
  while (rows.length > 0 && COUNTRY_LINE.test(rows[rows.length - 1]!)) rows = rows.slice(0, -1);
  if (rows.length === 0) return fail("empty");

  // The attention line, if any, is the first line.
  let attention: string | null = null;
  if (ATTENTION_LINE.test(rows[0]!) && rows.length > 1) {
    attention = rows[0]!;
    rows = rows.slice(1);
  }

  // The last line ends with the ZIP. Before it: the state, the city and, on a
  // one-line address, the street.
  const last = rows[rows.length - 1]!;
  const zipMatch = ZIP_AT_END.exec(last);
  if (!zipMatch) return fail("no_zip");
  const zip = zipMatch[2] ? `${zipMatch[1]}-${zipMatch[2]}` : zipMatch[1]!;
  const beforeZip = clean(last.slice(0, zipMatch.index));
  if (!beforeZip) return fail("no_city");

  const street = rows.slice(0, -1);
  let cityPart = beforeZip;
  if (street.length === 0) {
    // One line: "123 Main St, Apt 4, Houston, TX 77002". The city is the last
    // comma-separated piece before the state; without commas it cannot be told
    // from the street, so it is refused.
    const pieces = beforeZip.split(",").map(clean).filter(Boolean);
    if (pieces.length < 2) return fail("no_street");
    const stateHere = stateCode(pieces[pieces.length - 1]!);
    if (stateHere) {
      if (pieces.length < 3) return fail("no_street");
      cityPart = `${pieces[pieces.length - 2]}, ${pieces[pieces.length - 1]}`;
      street.push(...pieces.slice(0, -2));
    } else {
      cityPart = pieces[pieces.length - 1]!;
      street.push(...pieces.slice(0, -1));
    }
  }

  const cityState = splitCityState(cityPart);
  if (!cityState) return fail("bad_state");
  if (!cityState.city || /\d/.test(cityState.city)) return fail("no_city");

  // Street: one line, or a line and a unit.
  let line1: string;
  let line2: string | null = null;
  const streetRows = street.map(clean).filter(Boolean);
  if (streetRows.length === 0) return fail("no_street");
  if (streetRows.length === 1) {
    const unit = UNIT_AT_END.exec(streetRows[0]!);
    // "P.O. Box 12" never has a unit; a street that is only a unit is not a street.
    if (unit && !/^p\.?\s?o\.?\s*box/i.test(streetRows[0]!)) {
      line1 = clean(unit[1]!.replace(/,$/, ""));
      line2 = clean(unit[2]!);
    } else {
      line1 = streetRows[0]!;
    }
  } else if (streetRows.length === 2) {
    // A unit written first ("Apt 4", "123 Main St") is put back in order.
    if (UNIT_LINE.test(streetRows[0]!) && !UNIT_LINE.test(streetRows[1]!)) {
      line1 = streetRows[1]!;
      line2 = streetRows[0]!;
    } else {
      line1 = streetRows[0]!;
      line2 = streetRows[1]!;
    }
  } else {
    return fail("too_many_lines");
  }
  if (UNIT_LINE.test(line1)) return fail("no_street");
  if (line1.length > MAX_ADDRESS_LINE || (line2?.length ?? 0) > MAX_ADDRESS_LINE) return fail("line_too_long");

  return { ok: true, address: { line1, line2, city: cityState.city, state: cityState.state, zip, attention } };
}

/** The address as envelope lines again, in the standard order. */
export function formatUsAddress(address: UsAddress): string[] {
  return [
    ...(address.attention ? [address.attention] : []),
    address.line1,
    ...(address.line2 ? [address.line2] : []),
    `${address.city}, ${address.state} ${address.zip}`,
  ];
}

/** True when the lines read as a complete US address. */
export function isMailableAddress(lines: readonly string[]): boolean {
  return parseUsAddress(lines).ok;
}
