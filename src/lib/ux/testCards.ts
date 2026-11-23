import { DEMO_TOKEN_DECLINED, DEMO_TOKEN_OK } from "../billing/gateway";
import { brandFromIin, CARD_BRAND_NAME, type KnownBrand } from "../billing/cardBrands";

// The demo's test cards, as the payment screens offer them while the
// processor is the demo one. Each carries its token (what the demo processor
// takes), the last four digits, and the card's IIN: only the first six digits
// of the networks' published test numbers, never a whole number. The brand is
// worked out from the IIN (billing/cardBrands.ts, brandFromIin), the same way
// the processor's hosted fields tell it, so the screen can say before the card
// is sent that a brand is not taken.

export interface TestCard {
  token: string;
  /** The first six digits of the test number. */
  iin: string;
  last4: string;
  /** "ok" and "declined" are the two cards the demo always had; the others pass. */
  testId: "ok" | "declined" | "mastercard" | "amex" | "discover";
}

export const TEST_CARDS: readonly TestCard[] = [
  { token: DEMO_TOKEN_OK, iin: "424242", last4: "4242", testId: "ok" },
  { token: DEMO_TOKEN_DECLINED, iin: "400000", last4: "0002", testId: "declined" },
  { token: "demo_tok_mastercard_4444", iin: "555555", last4: "4444", testId: "mastercard" },
  { token: "demo_tok_amex_0005", iin: "378282", last4: "0005", testId: "amex" },
  { token: "demo_tok_discover_1117", iin: "601111", last4: "1117", testId: "discover" },
];

/** The brand the test card's IIN says. */
export function testCardBrand(card: TestCard): KnownBrand | null {
  return brandFromIin(card.iin);
}

/** "Visa ···· 4242". */
export function testCardLine(card: TestCard): string {
  const brand = testCardBrand(card);
  return `${brand ? CARD_BRAND_NAME[brand] : "Card"} ···· ${card.last4}`;
}
