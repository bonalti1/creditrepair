import { centsToDecimal, formatCents } from "../billing/money";

// One money rule, everywhere in the books: whole cents in an integer, never a
// float. Amounts typed by a person or read from a bank or processor file come
// in through parseMoney and nothing else; they leave through formatCents (the
// screen) or centsToDecimal (files), the same helpers billing uses.

export { centsToDecimal, formatCents };

/** The largest single amount the books accept: $1,000,000.00. */
export const MAX_AMOUNT_CENTS = 100_000_000;

/**
 * "$1,234.56" → 123456; "-12.5" → -1250; "(40.00)" → -4000 (an accountant's
 * negative); "1234" → 123400. Null for anything else: a third decimal, two
 * signs, letters, an empty cell. A trailing "-" ("40.00-") is a negative too,
 * as some bank exports write it.
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let text = String(input).trim().replace(/−/g, "-");
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1).trim();
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }
  text = text.replace(/^(usd|us\$|\$)\s*/i, "").replace(/\s*(usd)$/i, "");
  if (text.startsWith("-") || text.startsWith("+")) return null;
  // Thousands separators only in their places: 1,234,567.89
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(text) && !/^\.\d{1,2}$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.replace(/,/g, "").split(".");
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** A positive amount a person typed, within the books' limit; null otherwise. */
export function parsePositiveAmount(input: string | number | null | undefined): number | null {
  const cents = parseMoney(input);
  return cents !== null && cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export const sumCents = (values: Iterable<number>): number => {
  let total = 0;
  for (const v of values) total += v;
  return total;
};

/** A share in basis points of an amount, rounded half away from zero, like the database. */
export function bpsOf(cents: number, bps: number): number {
  const raw = (Math.abs(cents) * bps) / 10_000;
  return Math.sign(cents) * Math.round(raw);
}
