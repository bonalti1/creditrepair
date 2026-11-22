import { nextRetryAt } from "./dunning";
import type { Bilingual, BillingCharge } from "./types";

// ACH returns: a bank debit that "went through" can come back days later
// (Nacha return reason codes). Each code maps to what the existing dunning
// already does for a declined card:
//
//   retry       insufficient or uncollected funds: the same charge is tried
//               again on the dunning schedule (3 and 7 days), the client told.
//   new_method  the account cannot be debited (closed, not found, frozen…):
//               no more tries on it; the case pauses until the client puts
//               another method on file, exactly like an exhausted card.
//   revoked     the client told their bank the debit was not authorized, or
//               revoked the authorization: the bank account is taken off file
//               at once and a person looks. Never retried.
//   person      anything else: no automatic retry; a person looks.
//
// No fee for a returned payment, ever. The descriptions are the commonly
// published Nacha meanings, from memory: UNVERIFIED against the current Nacha
// Operating Rules (docs/BILLING.md).

export type ReturnAction = "retry" | "new_method" | "revoked" | "person";

export const ACH_RETURN_CODES: Record<string, { meaning: Bilingual; action: ReturnAction }> = {
  R01: { meaning: { en: "Insufficient funds", es: "Fondos insuficientes" }, action: "retry" },
  R09: { meaning: { en: "Uncollected funds", es: "Fondos no disponibles" }, action: "retry" },
  R02: { meaning: { en: "Account closed", es: "Cuenta cerrada" }, action: "new_method" },
  R03: { meaning: { en: "No account, or the account could not be found", es: "La cuenta no existe o no se encontró" }, action: "new_method" },
  R04: { meaning: { en: "Invalid account number", es: "Número de cuenta no válido" }, action: "new_method" },
  R16: { meaning: { en: "Account frozen", es: "Cuenta congelada" }, action: "new_method" },
  R20: { meaning: { en: "Account does not allow this kind of payment", es: "La cuenta no permite este tipo de pago" }, action: "new_method" },
  R05: { meaning: { en: "Unauthorized debit to a consumer account", es: "Débito no autorizado a una cuenta personal" }, action: "revoked" },
  R07: { meaning: { en: "Authorization revoked by the customer", es: "El cliente revocó la autorización" }, action: "revoked" },
  R10: { meaning: { en: "Customer says the debit was not authorized", es: "El cliente dice que el débito no fue autorizado" }, action: "revoked" },
  R11: { meaning: { en: "Customer says the debit did not follow the authorization", es: "El cliente dice que el débito no siguió la autorización" }, action: "revoked" },
  R29: { meaning: { en: "Business account: not authorized", es: "Cuenta de empresa: no autorizado" }, action: "revoked" },
  R08: { meaning: { en: "Payment stopped", es: "Pago detenido" }, action: "person" },
};

export function returnAction(code: string): ReturnAction {
  return ACH_RETURN_CODES[code.toUpperCase()]?.action ?? "person";
}

export function returnMeaning(code: string): Bilingual {
  return ACH_RETURN_CODES[code.toUpperCase()]?.meaning ?? { en: `Returned by the bank (${code})`, es: `Devuelto por el banco (${code})` };
}

/**
 * The charge as it stands after its ACH debit came back. The paid attempt
 * becomes a declined one (the attempt count stays: it was an attempt), on the
 * same row, so the dunning schedule picks it up. Pure: returns a new object.
 */
export function afterAchReturn(charge: BillingCharge, code: string, now: Date): BillingCharge {
  const action = returnAction(code);
  const attempts = Math.max(1, charge.attempts);
  return {
    ...charge,
    status: "failed",
    attempts,
    chargedAt: null,
    failureCode: `ach_${code.toUpperCase()}`,
    returnCode: code.toUpperCase(),
    nextAttemptAt: action === "retry" ? (nextRetryAt(attempts, now)?.toISOString() ?? null) : null,
    lastAttemptAt: charge.lastAttemptAt ?? now.toISOString(),
  };
}
