import { isCertified } from "./classes";
import type { MailClass } from "./types";

// What mailing costs, so staff see the price of a batch before sending it.
//
// UNVERIFIED: these prices were read on 2026-11-21 from web-search excerpts of
// Lob's "Pricing details" help page (help.lob.com/print-and-mail/ready-to-get-started/pricing-details),
// for the schedule effective 11/01/2026, Developer edition (pay as you go).
// The page itself could not be opened from the build environment, and the
// excerpts cut some rows off. Before relying on a number, open that page (or
// the Lob dashboard's billing screen) and correct the table. What is certain
// and what is assumed:
//   - letter, black and white, First Class, first page included: $1.060 (read)
//   - each additional page, black and white: $0.10 (read; column assumed Developer)
//   - certified mail add-on: $6.950 (read)
//   - electronic return receipt add-on: $2.910 (read); certified with return
//     receipt is assumed to be certified + receipt ($9.860): the combined row
//     was cut off.
//   - letter, color, First Class: $1.14 (from an older copy of the same table)
//   - each additional page, color: $0.20 (ASSUMED: no row was found)
// Enterprise and the higher editions price differently; a Lob invoice is the
// truth. The screen calls this an estimate for that reason.

export interface MailPriceTable {
  /** Where the numbers came from and when they were read. */
  source: string;
  readOn: string;
  /** Cents per letter, first page included. */
  letterBlackWhite: number;
  letterColor: number;
  /** Cents per page after the first. */
  extraPageBlackWhite: number;
  extraPageColor: number;
  /** Cents added per letter, by class. */
  certified: number;
  returnReceipt: number;
}

// UNVERIFIED: see the comment above. Prices are in tenths of a cent where Lob
// quotes three decimals, so they are kept as exact numbers of mills (1/1000 $).
export const LOB_PRICES: MailPriceTable = {
  source: "https://help.lob.com/print-and-mail/ready-to-get-started/pricing-details (11/01/2026 schedule, Developer edition)",
  readOn: "2026-11-21",
  letterBlackWhite: 1060,
  letterColor: 1140,
  extraPageBlackWhite: 100,
  extraPageColor: 200,
  certified: 6950,
  returnReceipt: 2910,
};

export interface LetterCostInput {
  mailClass: MailClass;
  /** Pages of the document, letter and enclosures, as printed. */
  pages: number;
  color?: boolean;
}

export interface LetterCost {
  /** In mills (thousandths of a dollar). */
  mills: number;
  pages: number;
  parts: Array<{ label: string; mills: number }>;
}

/** The estimated price of one letter. */
export function letterCost(input: LetterCostInput, prices: MailPriceTable = LOB_PRICES): LetterCost {
  const pages = Math.max(1, Math.ceil(input.pages));
  const color = input.color === true;
  const parts: LetterCost["parts"] = [
    { label: color ? "Carta a color, primera clase" : "Carta en blanco y negro, primera clase", mills: color ? prices.letterColor : prices.letterBlackWhite },
  ];
  if (pages > 1) {
    const each = color ? prices.extraPageColor : prices.extraPageBlackWhite;
    parts.push({ label: `${pages - 1} ${pages - 1 === 1 ? "página adicional" : "páginas adicionales"}`, mills: (pages - 1) * each });
  }
  if (isCertified(input.mailClass)) parts.push({ label: "Correo certificado", mills: prices.certified });
  if (input.mailClass === "certified_return_receipt") parts.push({ label: "Acuse de recibo electrónico", mills: prices.returnReceipt });
  return { mills: parts.reduce((sum, part) => sum + part.mills, 0), pages, parts };
}

/** The total of several letters, in mills. */
export function batchCost(costs: LetterCost[]): number {
  return costs.reduce((sum, cost) => sum + cost.mills, 0);
}

/** 9860 → "$9.86"; rounded to the cent, half up. */
export function formatMills(mills: number): string {
  const cents = Math.round(mills / 10);
  const whole = Math.floor(cents / 100).toLocaleString("en-US");
  return `$${whole}.${String(cents % 100).padStart(2, "0")}`;
}

// ── Pages ───────────────────────────────────────────────────────────────

/**
 * Lines of letter text that fit on a page, at the sizes the letters print
 * (11–12 pt, 1 in margins). An estimate: long lines wrap, so it counts
 * wrapped lines at about 85 characters.
 */
const LINES_PER_PAGE = 46;
const CHARS_PER_LINE = 85;

/**
 * Pages a letter prints to: its text, plus one page per enclosure, plus the
 * blank address page the mail service adds in front (ADDRESS_PLACEMENT in
 * lob.ts, charged as a page). Certified mail adds its own barcode sheet,
 * which Lob does not charge for, so it is not counted.
 */
export function estimatePages(text: string, enclosurePages: number, options: { addressPage?: boolean } = {}): number {
  const wrapped = text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
  const letterPages = Math.max(1, Math.ceil(wrapped / LINES_PER_PAGE));
  return letterPages + Math.max(0, enclosurePages) + (options.addressPage === false ? 0 : 1);
}
