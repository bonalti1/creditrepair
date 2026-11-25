import { collectedCents, invoiceNumber } from "../billing/invoices";
import type { PlanType } from "../billing/plans";
import type { BillingCharge, MethodKind } from "../billing/types";
import { fullName, type StaffClient } from "../staff/types";
import type { ChargeMeta } from "./types";

// The billing records as the books read them: one fact per charge, with its
// client, and whether it is a TEST charge. Test charges are never income.
//
// A test charge is one the demo gateway took (BILLING_GATEWAY=demo moves no
// money: gateway "demo"). The console's client list does not carry the
// gateway; the accounting route reads it from the charges table (chargeMeta).

export interface ChargeFact {
  id: string;
  clientId: string;
  clientName: string;
  invoice: string;
  planType: PlanType | null;
  roundNumber: number;
  amountCents: number;
  /** What the processor took (amount less any referral credit), or 0 when nothing was taken. */
  collectedCents: number;
  method: MethodKind;
  gateway: string | null;
  reference: string | null;
  test: boolean;
  charge: BillingCharge;
}

/** Gateways that move no money. */
export const TEST_GATEWAYS: readonly string[] = ["demo", "test", "sandbox"];

export function isTestCharge(meta: ChargeMeta | undefined): boolean {
  return Boolean(meta?.gateway && TEST_GATEWAYS.includes(meta.gateway.toLowerCase()));
}

export function chargeFacts(clients: readonly StaffClient[], meta: Record<string, ChargeMeta> = {}): ChargeFact[] {
  return clients.flatMap((client) =>
    client.billing.charges.map((charge): ChargeFact => {
      const m = meta[charge.id];
      return {
        id: charge.id,
        clientId: client.id,
        clientName: fullName(client),
        invoice: invoiceNumber(charge),
        planType: charge.planType ?? client.agreementPlan?.terms.type ?? null,
        roundNumber: charge.roundNumber,
        amountCents: charge.amountCents,
        collectedCents: charge.chargedAt ? collectedCents(charge) : 0,
        method: charge.methodKind ?? client.billing.paymentMethod?.kind ?? "card",
        gateway: m?.gateway ?? null,
        reference: m?.reference ?? null,
        test: isTestCharge(m),
        charge,
      };
    }),
  );
}

/** Real charges only: the one place test charges are dropped. */
export function realCharges(facts: readonly ChargeFact[]): ChargeFact[] {
  return facts.filter((f) => !f.test);
}

/**
 * A client's name as the books show it until a person asks to see it:
 * "María González" → "M•••• G•••••". Initials survive so a list can still be
 * scanned; the invoice number identifies the charge.
 */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${"•".repeat(Math.min(6, Math.max(2, part.length - 1)))}`)
    .join(" ");
}

export function shownName(name: string, reveal: boolean): string {
  return reveal ? name : maskName(name);
}
