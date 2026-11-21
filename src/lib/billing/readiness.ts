import { resolveTerms } from "../agreement/terms";
import { PAYMENT_AUTHORIZATION_VERSION } from "./authorization";
import { getPaymentGateway } from "./gateway";
import { feeToCents } from "./rules";

// Can real money be charged today?
//
// Only when all of this is true:
//   1. a real payment processor is configured (BILLING_GATEWAY names an
//      adapter that is not the demo);
//   2. the plan fee is set (NEXT_PUBLIC_PLAN_MONTHLY_FEE), so every agreement
//      signed from now on carries the amount to charge;
//   3. an attorney approved THIS version of the recurring-payment
//      authorization, which the owner records by setting
//      NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION to the version string.
//
// With a real processor and an unapproved authorization, no client can put a
// payment method on file: unreviewed authorization text must never be
// accepted by a real customer for real money.

// Static read, so the browser bundle carries it (the client's screen marks the draft).
const APPROVED_VERSION = process.env.NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION;

export interface BillingReadiness {
  /** True only when real money can be charged correctly. */
  ready: boolean;
  gatewayConfigured: boolean;
  /** False for the demo processor: no money moves. */
  gatewayLive: boolean;
  gatewayName: string | null;
  feeSet: boolean;
  authorizationVersion: string;
  authorizationApproved: boolean;
  /** What is missing, one plain sentence each. Empty when ready. */
  problems: string[];
}

/** True when the owner recorded an attorney's approval of the current authorization text. */
export function paymentAuthorizationApproved(approvedVersion: string | null | undefined = APPROVED_VERSION): boolean {
  return (approvedVersion ?? "").trim() === PAYMENT_AUTHORIZATION_VERSION;
}

export function billingReadiness(
  env: Record<string, string | undefined> = process.env,
  approvedVersion: string | null | undefined = APPROVED_VERSION,
): BillingReadiness {
  const resolution = getPaymentGateway(env);
  const gatewayConfigured = resolution.configured;
  const gatewayLive = resolution.configured && resolution.gateway.live;
  const feeSet = feeToCents(resolveTerms().monthlyFee) !== null;
  const authorizationApproved = paymentAuthorizationApproved(approvedVersion);

  const problems: string[] = [];
  if (!gatewayConfigured) problems.push("No payment processor is configured (BILLING_GATEWAY). Nothing can be charged.");
  else if (!gatewayLive) problems.push("BILLING_GATEWAY is the demo processor: charges are simulated and no money moves.");
  if (!feeSet) problems.push("NEXT_PUBLIC_PLAN_MONTHLY_FEE is not set: agreements carry no fee to charge.");
  if (!authorizationApproved) {
    problems.push(
      `NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION is not ${PAYMENT_AUTHORIZATION_VERSION}: set it once an attorney approves the recurring-payment authorization.`,
    );
  }

  return {
    ready: problems.length === 0,
    gatewayConfigured,
    gatewayLive,
    gatewayName: resolution.configured ? resolution.gateway.name : null,
    feeSet,
    authorizationVersion: PAYMENT_AUTHORIZATION_VERSION,
    authorizationApproved,
    problems,
  };
}
