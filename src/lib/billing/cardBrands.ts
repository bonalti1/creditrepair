// Which card brands the business takes (Credit Repair Cloud added the same
// setting on Nov 13, 2026).
//
// Visa and Mastercard are on by default. American Express and Discover are
// off by default: many merchant accounts that accept credit repair do not
// take them (an administrator turns them on in /equipo/planes once the
// merchant account allows it).
//
// The brand is known three ways, and all three end here:
//   - the demo's test cards: by the card's IIN (its first digits), the same
//     prefixes the card networks publish (brandFromIin);
//   - the processor's hosted fields: NMI Collect.js and Authorize.Net
//     AcceptUI hand back the card type or the BIN with the token
//     (components/billing/HostedFields.tsx), so the screen says it before the
//     card is sent;
//   - the processor's answer when the token is attached: the server refuses a
//     brand that is off (api/billing/payment-method), whatever the screen did.
//
// A card already on file keeps working: only putting a new card on file is
// checked. Pure; no card number is ever handled here, only a few leading
// digits (an IIN), a brand name and the setting.

export const CARD_BRANDS = ["visa", "mastercard", "amex", "discover"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

/** Brands we know but never take: not in the list an administrator can turn on. */
const OTHER_KNOWN = ["jcb", "diners", "unionpay"] as const;
export type KnownBrand = CardBrand | (typeof OTHER_KNOWN)[number];

export type AcceptedCards = Record<CardBrand, boolean>;

export const DEFAULT_ACCEPTED_CARDS: AcceptedCards = { visa: true, mastercard: true, amex: false, discover: false };

export const CARD_BRAND_NAME: Record<KnownBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  jcb: "JCB",
  diners: "Diners Club",
  unionpay: "UnionPay",
};

/**
 * The brand from a card's first digits (at least 1, up to 6; never more is
 * needed): 4 Visa; 51–55 and 2221–2720 Mastercard; 34 and 37 American
 * Express; 6011, 65 and 644–649 Discover. Null while the digits do not say yet.
 */
export function brandFromIin(digits: string): KnownBrand | null {
  const d = digits.replace(/\D/g, "").slice(0, 6);
  if (!d) return null;
  if (d.startsWith("4")) return "visa";
  const two = Number(d.slice(0, 2));
  const three = Number(d.slice(0, 3));
  const four = Number(d.slice(0, 4));
  if (d.length >= 2 && two >= 51 && two <= 55) return "mastercard";
  if (d.length >= 4 && four >= 2221 && four <= 2720) return "mastercard";
  if (d.length >= 2 && (two === 34 || two === 37)) return "amex";
  if (d.length >= 4 && four === 6011) return "discover";
  if (d.length >= 2 && two === 65) return "discover";
  if (d.length >= 3 && three >= 644 && three <= 649) return "discover";
  if (d.length >= 2 && (two === 36 || two === 38 || (three >= 300 && three <= 305))) return "diners";
  if (d.length >= 4 && four >= 3528 && four <= 3589) return "jcb";
  if (d.length >= 2 && two === 62) return "unionpay";
  return null;
}

/** "Visa" / "VISA" / "MasterCard" / "American Express" / "amex" / "disc" → the brand; null when it is not one we know. */
export function normalizeBrand(value: string | null | undefined): KnownBrand | null {
  const v = (value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!v) return null;
  if (v === "visa" || v.startsWith("visa")) return "visa";
  if (v === "mc" || v.startsWith("master")) return "mastercard";
  if (v === "amex" || v === "ax" || v.startsWith("americanexpress")) return "amex";
  if (v.startsWith("disc")) return "discover";
  if (v === "jcb") return "jcb";
  if (v.startsWith("diners") || v === "dinersclub") return "diners";
  if (v.startsWith("unionpay") || v === "cup") return "unionpay";
  return null;
}

/** A stored setting read back, with the defaults for anything missing. Never all off: then the defaults. */
export function readAcceptedCards(row: Partial<Record<string, unknown>> | null | undefined): AcceptedCards {
  const out: AcceptedCards = { ...DEFAULT_ACCEPTED_CARDS };
  for (const brand of CARD_BRANDS) if (typeof row?.[brand] === "boolean") out[brand] = row[brand] as boolean;
  return CARD_BRANDS.some((b) => out[b]) ? out : { ...DEFAULT_ACCEPTED_CARDS };
}

/** Why a setting cannot be saved, or null. At least one brand stays on. */
export function acceptedCardsProblem(input: AcceptedCards): { en: string; es: string } | null {
  return CARD_BRANDS.some((b) => input[b])
    ? null
    : { en: "Keep at least one card brand on: with none, no client could put a card on file.", es: "Deja al menos una marca encendida: sin ninguna, ningún cliente podría registrar una tarjeta." };
}

/**
 * True when this brand may NOT be put on file. A brand we do not recognise
 * (the processor said only "card") is not refused here: the processor decides.
 */
export function brandRefused(brand: string | null | undefined, accepted: AcceptedCards): boolean {
  const known = normalizeBrand(brand);
  if (!known) return false;
  return !(CARD_BRANDS as readonly string[]).includes(known) || !accepted[known as CardBrand];
}

function joinOr(names: string[], locale: "es" | "en"): string {
  if (names.length <= 1) return names[0] ?? "";
  const word = locale === "es" ? "o" : "or";
  return `${names.slice(0, -1).join(", ")} ${word} ${names[names.length - 1]}`;
}

/** "a Visa or Mastercard" / "una Visa o Mastercard": the brands that are on, as a client reads them. */
export function acceptedCardsLine(accepted: AcceptedCards, locale: "es" | "en"): string {
  const names = CARD_BRANDS.filter((b) => accepted[b]).map((b) => CARD_BRAND_NAME[b]);
  return `${locale === "es" ? "una" : "a"} ${joinOr(names, locale)}`;
}

/**
 * The friendly message before a card is sent, in the client's language:
 * "We can't take American Express. Please use a Visa or Mastercard." Null when
 * the brand is fine or not known yet.
 */
export function cardBrandMessage(brand: string | null | undefined, accepted: AcceptedCards, locale: "es" | "en"): string | null {
  if (!brandRefused(brand, accepted)) return null;
  const name = CARD_BRAND_NAME[normalizeBrand(brand)!];
  const use = acceptedCardsLine(accepted, locale);
  return locale === "es" ? `No podemos aceptar ${name}. Por favor usa ${use}.` : `We can't take ${name}. Please use ${use}.`;
}
