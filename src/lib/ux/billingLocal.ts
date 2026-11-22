import type { AgreementRecord } from "../agreement/gate";
import type { BillableRound, BillingCharge, PaymentMethodSummary } from "../billing/types";

// Billing as this device remembers it. Signed in, the server's record is the
// truth (GET /api/billing); what is kept here then is one flag, whether a
// payment method is on file, so every screen can read it without waiting for
// the network. In the demo (signed out) the whole of it lives here: a
// simulated payment method and, when someone picks an example situation,
// invented rounds and charges.
//
// Plain functions, no React: the journey engine reads from here too. Nothing
// stored here is, or could be, a card number: the demo "method" is a brand,
// four digits and a demo token.

export const BILLING_STORAGE_KEY = "bonalti.billing.v1";
export const METHOD_FLAG_KEY = "bonalti.paymentMethodOnFile";

/** The demo's payment method: what the server would keep, plus the demo token that stands in for the vault. */
export interface DemoMethod extends PaymentMethodSummary {
  /** A demo token ("demo_tok_visa_4242", "demo_bank_checking_6789"). Never a card or account number. */
  token: string;
  authorizationHash: string;
}

export interface DemoBillingState {
  /** Which example situation is shown; "live" is this device's own state. */
  scenario: string;
  method: DemoMethod | null;
  /** The example situation's own agreement, rounds and charges. Null for "live". */
  agreement: AgreementRecord | null;
  rounds: BillableRound[];
  charges: BillingCharge[];
}

export const EMPTY_DEMO_BILLING: DemoBillingState = { scenario: "live", method: null, agreement: null, rounds: [], charges: [] };

export function readDemoBilling(): DemoBillingState {
  if (typeof window === "undefined") return EMPTY_DEMO_BILLING;
  try {
    const raw = window.localStorage.getItem(BILLING_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<DemoBillingState>) : null;
    if (!parsed || typeof parsed !== "object") return EMPTY_DEMO_BILLING;
    return {
      scenario: typeof parsed.scenario === "string" ? parsed.scenario : "live",
      method: parsed.method && typeof parsed.method === "object" ? parsed.method : null,
      agreement: parsed.agreement && typeof parsed.agreement === "object" ? parsed.agreement : null,
      rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
      charges: Array.isArray(parsed.charges) ? parsed.charges : [],
    };
  } catch {
    return EMPTY_DEMO_BILLING;
  }
}

export function writeDemoBilling(state: DemoBillingState): void {
  try {
    window.localStorage.setItem(BILLING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode): the state lasts for this visit only.
  }
  writePaymentMethodOnFile(state.method !== null);
}

/** Remember whether a payment method is on file, for the screens that only need that. */
export function writePaymentMethodOnFile(onFile: boolean): void {
  try {
    window.localStorage.setItem(METHOD_FLAG_KEY, onFile ? "1" : "0");
  } catch {
    // ignore
  }
}

/**
 * Whether a payment method is on file, as far as this device knows: true or
 * false in the browser, and undefined where nothing can be known (on the
 * server, in a test). Undefined means "do not ask for one".
 */
export function readPaymentMethodOnFile(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(METHOD_FLAG_KEY) === "1";
  } catch {
    return undefined;
  }
}
