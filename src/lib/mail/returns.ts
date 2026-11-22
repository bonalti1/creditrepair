import { verificationPasses, type VerifiedAddress } from "./verify";

// A letter the post office returned: what the system can do about it by
// itself, before a person has to.
//
//   - The return is about the ADDRESS (returned to sender, undeliverable as
//     addressed) and the address can be corrected with the post office's
//     data, or the address book now has another verified address for that
//     company: the SAME letter goes again, once, to the corrected address. It
//     is part of the same round (letters.remail_of, migration 0022): the
//     round's one charge is not repeated, and a re-mail is never re-mailed.
//   - The recipient's address is fine and the CLIENT's own address is what
//     the post office cannot confirm: the client is asked to confirm it with
//     one tap; once they do, the letter goes again with it.
//   - A creditor's address the post office does not deliver to: the address
//     book entry stops counting as verified (a missing address, for every
//     client at once).
//   - Anything else (a lost or damaged letter, nobody picked it up, a letter
//     already sent twice, no correction to make): a person, as before.

/** Lob's words for a return that is about the address (tracking.ts records them as the return reason). */
const ADDRESS_REASONS = new Set(["returned_to_sender", "returned to sender", "package_undeliverable", "address_issue", "undeliverable"]);

/** True when the post office sent it back because of the address. Unknown or missing reasons are a person's. */
export function isAddressRelatedReturn(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const key = reason.trim().toLowerCase().replace(/^letter\.(certified\.)?/, "").replace(/-/g, "_");
  return ADDRESS_REASONS.has(key) || ADDRESS_REASONS.has(reason.trim().toLowerCase());
}

export type ReturnDecision =
  | { action: "remail"; to: string[]; from: string[]; why: string }
  | { action: "ask_client"; check: VerifiedAddress; why: string }
  | { action: "furnisher_bad"; why: string }
  | { action: "person"; why: string };

export interface ReturnInput {
  reason: string | null;
  /** The letter is itself a re-mail, or already has one. */
  alreadyRemailed: boolean;
  recipientType: "bureau" | "secondary_bureau" | "furnisher";
  recipientName: string;
  /** Where it went. */
  sentTo: readonly string[];
  /** Where it would go now (the book's verified address for a creditor, else where it went), checked again. */
  target: readonly string[];
  targetCheck: VerifiedAddress;
  /** The client's address now, checked again. */
  clientLines: readonly string[];
  clientCheck: VerifiedAddress;
  /**
   * The return address the letter carried, when the client changed it since (they answered a request
   * about this letter). Null: unchanged, so there is nothing new to send it from.
   */
  sentFrom: readonly string[] | null;
}

const fold = (lines: readonly string[]) => lines.join(" | ").toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

/** What to do about one returned letter. Pure. */
export function decideReturn(input: ReturnInput): ReturnDecision {
  if (input.alreadyRemailed) {
    return { action: "person", why: "Ya se envió de nuevo una vez y volvió: no se reenvía sola otra vez." };
  }
  if (!isAddressRelatedReturn(input.reason)) {
    return { action: "person", why: "El motivo del correo no es la dirección (perdida, dañada o no la recogieron): lo decide una persona." };
  }
  if (!verificationPasses(input.targetCheck.result)) {
    if (input.recipientType === "furnisher") {
      return { action: "furnisher_bad", why: `El correo no entrega en la dirección de ${input.recipientName}: quedó como dirección faltante en la libreta.` };
    }
    return { action: "person", why: `El correo no confirma la dirección de ${input.recipientName} del registro: la revisa una persona.` };
  }
  const to = input.targetCheck.result === "unchecked" ? [...input.target] : input.targetCheck.lines;
  if (fold(to) !== fold(input.sentTo) && input.targetCheck.result !== "unchecked") {
    return { action: "remail", to, from: verificationPasses(input.clientCheck.result) ? input.clientCheck.lines : [...input.clientLines], why: "La dirección del destinatario se corrigió con los datos del correo." };
  }
  if (!verificationPasses(input.clientCheck.result)) {
    return { action: "ask_client", check: input.clientCheck, why: "La dirección del destinatario está bien; el correo no confirma la del cliente. Se le pide confirmarla." };
  }
  if (input.sentFrom && fold(input.clientCheck.lines) !== fold(input.sentFrom)) {
    return { action: "remail", to, from: input.clientCheck.lines, why: "El cliente confirmó o corrigió su dirección después de la devolución." };
  }
  return { action: "person", why: "Las dos direcciones ya estaban bien escritas: no hay nada que corregir solo." };
}
