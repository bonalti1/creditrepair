import { sha256Hex } from "../agreement/sha256";
import { authorizeNetGateway } from "./gateways/authorizeNet";
import { nmiGateway } from "./gateways/nmi";

// The payment processor, behind one small interface.
//
// No processor has been chosen. Ordinary processors often refuse credit repair
// businesses, so the owner will open a specialised merchant account later
// (docs/BILLING.md). Until then the code is written against this interface,
// with two implementations: "demo" (deterministic, moves no money, for the
// demo and the tests) and nothing at all, which answers "not configured".
// A real adapter is one object that implements PaymentGateway.
//
// Card numbers never reach this app. The processor's hosted fields turn the
// card into a TOKEN in the client's browser, and the token is all this
// interface ever accepts. Nothing here takes, logs or stores a card number,
// an expiry date or a security code.
//
// Idempotency. Every call that moves money carries an idempotency key, and the
// processor must treat two calls with the same key as one. The key of a charge
// attempt is the charge's own id plus the attempt number (attemptKey): asking
// again for the same attempt, after a timeout or a crash, can never take the
// money twice, while a new attempt after a recorded decline is a new request.

export interface CreateCustomerInput {
  /** The account id. The only thing about the client that is sent. */
  userId: string;
}

export interface AttachPaymentMethodInput {
  customerRef: string;
  /** The single-use token the processor's hosted fields produced in the browser. */
  token: string;
}

export type AttachResult =
  | { ok: true; paymentMethodRef: string; brand: string; last4: string }
  | { ok: false; code: string };

/** A bank account (ACH) put on file: "checking" or "savings" and the last four digits of the account. Never the numbers. */
export type AttachBankResult =
  | { ok: true; paymentMethodRef: string; accountType: "checking" | "savings"; last4: string }
  | { ok: false; code: string };

/**
 * What the processor told us, in our words. A webhook (or a person entering
 * what the processor's portal shows) becomes one of these; webhooks.ts applies
 * it. `reference` is the processor's reference of the charge attempt.
 */
export type GatewayEvent =
  | { kind: "charge_settled"; eventId: string; reference: string; at: string }
  /** An ACH debit came back from the client's bank (Nacha return code R01…). */
  | { kind: "ach_return"; eventId: string; reference: string; code: string; at: string }
  | { kind: "chargeback_opened"; eventId: string; reference: string; amountCents: number | null; reasonCode: string | null; caseId: string | null; at: string }
  | { kind: "chargeback_closed"; eventId: string; reference: string; outcome: "won" | "lost"; at: string }
  | { kind: "ignored"; eventId: string; type: string };

export type WebhookParse =
  | { ok: true; events: GatewayEvent[] }
  | { ok: false; reason: "not_configured" | "bad_signature" | "malformed" };

/** What the browser needs to mount the processor's own hosted fields. Public values only. */
export type HostedFieldsConfig =
  | { kind: "demo" }
  | { kind: "collectjs"; scriptUrl: string; tokenizationKey: string }
  | { kind: "acceptui"; scriptUrl: string; apiLoginId: string; clientKey: string };

export interface ChargeInput {
  amountCents: number;
  currency: "usd";
  customerRef: string;
  paymentMethodRef: string;
  /** attemptKey(chargeId, attemptNumber). The same key is the same request. */
  idempotencyKey: string;
  /** For the processor's records and the card statement: the round it pays for. No personal data. */
  description: string;
  /** "ach" for a bank account: the processor files it as a consumer debit authorized online (WEB). */
  methodKind?: "card" | "ach";
}

export type GatewayChargeResult =
  | { ok: true; reference: string }
  /** The card or the bank said no. A definite answer: it counts as an attempt. */
  | { ok: false; kind: "declined"; code: string }
  /** No definite answer (timeout, outage). Nothing is known: ask again with the SAME key. */
  | { ok: false; kind: "error"; message: string };

export interface RefundInput {
  /** The processor's reference of the charge being returned. */
  chargeReference: string;
  amountCents: number;
  /** The refund row's id. */
  idempotencyKey: string;
  /** The stored method, for a processor that refunds to it (Authorize.Net). Server only. */
  handle?: { customerRef: string; paymentMethodRef: string };
}

/** "void" when the charge had not settled yet and was cancelled instead of refunded: no money moved back, none was taken. */
export type GatewayRefundResult = { ok: true; reference: string; kind?: "refund" | "void" } | { ok: false; message: string };

export interface PaymentGateway {
  /** Stored with every charge, so the books say who was asked. */
  readonly name: string;
  /** False for the demo: no money moves. */
  readonly live: boolean;
  createCustomer(input: CreateCustomerInput): Promise<{ customerRef: string }>;
  attachPaymentMethod(input: AttachPaymentMethodInput): Promise<AttachResult>;
  charge(input: ChargeInput): Promise<GatewayChargeResult>;
  refund(input: RefundInput): Promise<GatewayRefundResult>;
  /** Optional: forget a stored method at the processor when the client removes or replaces it. */
  detachPaymentMethod?(input: { customerRef: string; paymentMethodRef: string }): Promise<void>;
  /** A bank account from the processor's hosted fields (ACH). Absent: the processor takes cards only. */
  attachBankAccount?(input: AttachPaymentMethodInput): Promise<AttachBankResult>;
  /** Verify and read a webhook. Absent: this processor sends none we use; staff enter returns and chargebacks by hand. */
  parseWebhook?(input: { rawBody: string; headers: Headers }): Promise<WebhookParse>;
  /** Public configuration for the hosted fields in the browser. */
  hostedFields(): HostedFieldsConfig;
}

/** The idempotency key of one attempt of one charge. */
export function attemptKey(chargeId: string, attemptNumber: number): string {
  return `${chargeId}:${attemptNumber}`;
}

// ── Demo gateway ────────────────────────────────────────────────────────

/**
 * Demo tokens. In the real product the processor's hosted fields make the
 * token; in the demo the "Mis pagos" screen offers these, clearly labelled as
 * simulated. A token whose last four digits are 0002 is a card that is always
 * declined, which is how the demo and the tests show a failed payment.
 */
export const DEMO_TOKEN_OK = "demo_tok_visa_4242";
export const DEMO_TOKEN_DECLINED = "demo_tok_visa_0002";
/** A demo bank account (ACH). Ending 0002: every debit is refused, as a bank return for insufficient funds would be. */
export const DEMO_BANK_TOKEN_OK = "demo_bank_checking_6789";
export const DEMO_BANK_TOKEN_RETURNS = "demo_bank_checking_0002";
const DEMO_BANK = /^demo_bank_(checking|savings)_(\d{4})$/;
const DEMO_TOKEN = /^demo_tok_([a-z]{3,12})_(\d{4})$/;
const DEMO_METHOD = /^demo_pm_([a-z]{3,12})_(\d{4})$/;
const DECLINED_LAST4 = "0002";

/** True for a token only the demo gateway understands. */
export function isDemoToken(token: string): boolean {
  return DEMO_TOKEN.test(token);
}

/** "demo_tok_visa_4242" → { brand: "visa", last4: "4242" }. Null for anything else. */
export function parseDemoToken(token: string): { brand: string; last4: string } | null {
  const match = DEMO_TOKEN.exec(token);
  return match ? { brand: match[1]!, last4: match[2]! } : null;
}

export interface DemoGateway extends PaymentGateway {
  /** How many times money "moved": distinct successful charges. For tests. */
  chargesMade(): number;
  /** Every charge call received, repeats included. For tests. */
  chargeCalls(): number;
  refundsMade(): number;
}

/**
 * A deterministic stand-in for a processor. It moves no money and calls
 * nobody. It keeps what it answered per idempotency key, as a real processor
 * does, so the same request twice is one charge.
 */
export function createDemoGateway(): DemoGateway {
  const charges = new Map<string, GatewayChargeResult>();
  const refunds = new Map<string, GatewayRefundResult>();
  let calls = 0;

  return {
    name: "demo",
    live: false,
    async createCustomer({ userId }) {
      return { customerRef: `demo_cus_${sha256Hex(userId).slice(0, 16)}` };
    },
    async attachPaymentMethod({ token }) {
      const parsed = parseDemoToken(token);
      if (!parsed) return { ok: false, code: "invalid_token" };
      return { ok: true, paymentMethodRef: `demo_pm_${parsed.brand}_${parsed.last4}`, brand: parsed.brand, last4: parsed.last4 };
    },
    async attachBankAccount({ token }) {
      const match = DEMO_BANK.exec(token);
      if (!match) return { ok: false, code: "invalid_token" };
      return { ok: true, paymentMethodRef: `demo_pm_${match[1]}_${match[2]}`, accountType: match[1] as "checking" | "savings", last4: match[2]! };
    },
    hostedFields: () => ({ kind: "demo" }),
    async charge(input) {
      calls += 1;
      const known = charges.get(input.idempotencyKey);
      if (known) return known;
      const method = DEMO_METHOD.exec(input.paymentMethodRef) ?? /^demo_pm_(checking|savings)_(\d{4})$/.exec(input.paymentMethodRef);
      let result: GatewayChargeResult;
      if (!method || !Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        result = { ok: false, kind: "declined", code: "invalid_request" };
      } else if (method[2] === DECLINED_LAST4) {
        result = { ok: false, kind: "declined", code: "card_declined" };
      } else {
        result = { ok: true, reference: `demo_ch_${sha256Hex(input.idempotencyKey).slice(0, 20)}` };
      }
      charges.set(input.idempotencyKey, result);
      return result;
    },
    async refund(input) {
      const known = refunds.get(input.idempotencyKey);
      if (known) return known;
      const result: GatewayRefundResult = input.chargeReference.startsWith("demo_ch_")
        ? { ok: true, reference: `demo_re_${sha256Hex(input.idempotencyKey).slice(0, 20)}` }
        : { ok: false, message: "unknown charge" };
      refunds.set(input.idempotencyKey, result);
      return result;
    },
    chargesMade: () => [...charges.values()].filter((result) => result.ok).length,
    chargeCalls: () => calls,
    refundsMade: () => [...refunds.values()].filter((result) => result.ok).length,
  };
}

// ── Which gateway is configured ─────────────────────────────────────────

export type GatewayResolution =
  | { configured: true; gateway: PaymentGateway }
  | {
      configured: false;
      /** What to tell whoever asked, in plain words. */
      message: string;
    };

/** The names BILLING_GATEWAY accepts. */
export const KNOWN_GATEWAYS = ["demo", "nmi", "authorize_net"] as const;

export const GATEWAY_NOT_CONFIGURED =
  "No payment processor is configured (BILLING_GATEWAY is empty). Nothing was charged and nothing will be until one is set up. See docs/BILLING.md.";

let demoSingleton: DemoGateway | null = null;

/**
 * The processor the server should use, from BILLING_GATEWAY.
 *   (empty)  not configured: every route that would move money refuses, and says so.
 *   "demo"   the demo gateway: no money moves. For the demo and for staging only.
 * An unknown name is "not configured", never a silent fallback to the demo.
 */
export function getPaymentGateway(env: Record<string, string | undefined> = process.env): GatewayResolution {
  const name = (env.BILLING_GATEWAY ?? "").trim().toLowerCase();
  if (!name) return { configured: false, message: GATEWAY_NOT_CONFIGURED };
  if (name === "demo") {
    demoSingleton ??= createDemoGateway();
    return { configured: true, gateway: demoSingleton };
  }
  if (name === "nmi" || name === "authorize_net") {
    const built = name === "nmi" ? nmiGateway(env) : authorizeNetGateway(env);
    return built.ok ? { configured: true, gateway: built.gateway } : { configured: false, message: built.message };
  }
  return {
    configured: false,
    message: `BILLING_GATEWAY is "${name}", and no adapter with that name exists. Nothing was charged. See docs/BILLING.md.`,
  };
}
