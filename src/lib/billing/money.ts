// Money as whole cents, everywhere. Kept apart so every billing module can
// use it without importing the rules (which import the plans).

/** "89.00" → 8900. Null for anything that is not a positive amount with at most two decimals. */
export function feeToCents(fee: string | null | undefined): number | null {
  if (typeof fee !== "string" || !/^\d{1,6}(\.\d{1,2})?$/.test(fee.trim())) return null;
  const [whole, fraction = ""] = fee.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** 8900 → "$89.00". */
export function formatCents(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100).toLocaleString("en-US");
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${whole}.${fraction}`;
}

/** 8900 → "89.00" (no sign, no thousands separator): for CSV files and the database. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A percentage off, rounded to the cent the way the database rounds it (half away from zero). */
export function discounted(cents: number, percentOff: number): number {
  if (!percentOff) return cents;
  return Math.round((cents * (100 - percentOff)) / 100);
}
