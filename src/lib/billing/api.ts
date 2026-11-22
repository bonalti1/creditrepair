import { z } from "zod";
import type { AgreementRecord } from "../agreement/gate";
import type { AuthorizationTerms } from "./authorization";
import { REFUND_REASON_MAX_CHARS, REFUND_REASON_MIN_CHARS } from "./refunds";
import type { HostedFieldsConfig } from "./gateway";
import type { PlanSnapshot } from "./plans";
import type { BillableRound, BillingAccount, BillingSwitches, ProvenResult } from "./types";

// What the billing endpoints accept and answer. Kept apart from the routes so
// the tests can check the request rules without a server.

/**
 * True for anything that looks like a card number: 12 to 19 digits, with or
 * without spaces or dashes. The payment-method endpoint accepts a processor
 * TOKEN only; if a card number ever arrives in its place it is refused before
 * anything is stored or logged.
 */
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{12,19}$/.test(digits);
}

/** POST /api/billing/payment-method */
export const paymentMethodBodySchema = z
  .object({
    /** The token the processor's hosted fields produced. Never a card number. */
    token: z
      .string()
      .min(8)
      .max(4000)
      // Processor tokens: NMI's payment_token, Authorize.Net's opaqueData value (base64: + / =).
      .regex(/^[A-Za-z0-9_.:+/=\-]+$/)
      .refine((value) => !looksLikeCardNumber(value), { message: "card_number" }),
    /** "ach" for a bank account; the authorization is then the ACH debit authorization. */
    kind: z.enum(["card", "ach"]).optional(),
    /** The recurring-payment authorization, as the client was shown it. */
    authorization: z.object({
      version: z.string().min(1).max(60),
      locale: z.enum(["es", "en"]),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      accepted: z.literal(true),
    }),
  })
  // Nothing else is accepted: a body carrying "cardNumber", "cvv" or "exp" is refused, not ignored.
  .strict();

export type PaymentMethodBody = z.infer<typeof paymentMethodBodySchema>;

/** POST /api/billing/refund (staff only) */
export const refundBodySchema = z
  .object({
    chargeId: z.string().uuid(),
    reason: z.string().min(REFUND_REASON_MIN_CHARS).max(REFUND_REASON_MAX_CHARS),
    /** The teammate's name as the console knows it, for the record beside their account id. */
    by: z.string().max(80).optional(),
  })
  // No amount field: a refund is the full charge. An "amountCents" in the body is refused.
  .strict();

/** A pause needs a reason someone else can read later. */
export const PAUSE_REASON_MIN_CHARS = 5;

/** POST /api/billing/pause (staff only) */
export const pauseBodySchema = z
  .object({
    userId: z.string().uuid(),
    action: z.enum(["pause", "resume"]),
    reason: z.string().max(1000).optional(),
    by: z.string().max(80).optional(),
  })
  .strict();

/** GET /api/billing, for a signed-in client. */
export interface ClientBillingPayload {
  authenticated: true;
  agreement: AgreementRecord | null;
  /** The fee in the client's signed agreement, or null. */
  signedMonthlyFee: string | null;
  /** What the authorization text is filled in with: from the signed agreement. */
  authorizationTerms: AuthorizationTerms;
  rounds: BillableRound[];
  /** The pause, when there is one, comes without the team's note. */
  account: BillingAccount;
  /** The plan snapshot of the signed agreement, when it was signed under one. */
  plan: PlanSnapshot | null;
  results?: ProvenResult[];
  switches?: BillingSwitches;
  creditBalanceCents?: number;
  processor: {
    /** The processor's hosted fields, for the browser. Null when none is configured. */
    hostedFields: HostedFieldsConfig | null;
    /** True when the processor takes bank accounts (ACH) and the ACH authorization may be accepted. */
    canAddBank: boolean;
    /** False while no processor is set up: nothing can be charged and no method can be added. */
    configured: boolean;
    /** False for the demo processor. */
    live: boolean;
    /** Whether a payment method can be put on file right now. */
    canAddMethod: boolean;
  };
}
