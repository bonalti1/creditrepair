import type { IntakeRecord } from "./types";

// A document the automatic check could not accept: can the CLIENT fix it by
// uploading another one, and how do we say why?
//
// The reasons are the check's own plain Spanish lines (identity.ts:
// decideIdentity), written to the client. Some are things a new photo or a
// newer bill fixes ("La foto está borrosa.", "Tiene más de 90 días…"); some
// are not ("El documento parece modificado.", a name that does not match the
// account, the automatic check not running). Only when EVERY doubt is one the
// client can fix does the system ask for a new upload by itself (autopilot
// follow-up "document_reupload"); otherwise, and after a second failure, a
// person looks, exactly as before.

const FIXABLE: ReadonlyArray<{ test: RegExp; en: string }> = [
  { test: /borrosa/i, en: "the photo is blurry" },
  { test: /reflejo de luz/i, en: "there is a glare on the document" },
  { test: /quedó fuera de la foto/i, en: "part of the document is outside the photo" },
  { test: /muy oscura/i, en: "the photo is too dark" },
  { test: /muy pequeño/i, en: "the document looks too small in the photo" },
  { test: /foto de una pantalla/i, en: "it is a photo of a screen, not of the document" },
  { test: /algo tapa/i, en: "something covers part of the document" },
  { test: /no se lee con claridad/i, en: "it cannot be read clearly" },
  { test: /no está segura de lo que leyó/i, en: "the automatic check could not read it with certainty" },
  { test: /tiene más de \d+ días/i, en: "it is too old; a more recent one is needed" },
  { test: /no se ve la fecha/i, en: "the date is not visible" },
  { test: /fecha del documento está en el futuro/i, en: "the document's date is in the future" },
  { test: /parece vencida/i, en: "the ID appears to be expired" },
  { test: /no se pudo leer la fecha de vencimiento/i, en: "the expiration date could not be read" },
  { test: /^no parece una identificación/i, en: "it does not look like a government photo ID" },
  { test: /^no parece un comprobante/i, en: "it does not look like a proof of address (a bill or statement)" },
  { test: /^parece .*(no una identificación|comprobante de domicilio se necesita)/i, en: "it looks like a different kind of document" },
  { test: /no se encontró una dirección/i, en: "no address was found on the document" },
  { test: /no se encontró un nombre/i, en: "no name was found on the document" },
  { test: /dirección del documento no coincide/i, en: "the address on it does not match the mailing address in your account" },
];

/**
 * One of the check's lines in English, for a client reading the app in
 * English ("The photo is blurry."); null for a line with no English wording
 * here (the page then says a person on the team will look).
 */
export function reasonInEnglish(line: string): string | null {
  const match = FIXABLE.find((f) => f.test.test(line.trim()));
  return match ? `${match.en.charAt(0).toUpperCase()}${match.en.slice(1)}.` : null;
}

/** Lines that only say what passed: neither a doubt nor a reason to stop. */
const NEUTRAL = /^(es |se lee con claridad|el nombre coincide|no está vencida|no muestra fecha|la dirección coincide)/i;

export interface ReuploadRequest {
  /** The client-fixable reasons, as the check wrote them. */
  reasons: string[];
  /** For the message: "la foto está borrosa; tiene más de 90 días…". */
  motivo: { es: string; en: string };
}

const clause = (line: string) => {
  const t = line.trim().replace(/\.$/, "");
  return t.charAt(0).toLowerCase() + t.slice(1);
};

/**
 * The re-upload request for a document check, or null when it is not one the
 * client can fix alone (or it was accepted, or it is not an ID or proof of address).
 */
export function reuploadRequest(record: Pick<IntakeRecord, "kind" | "status" | "reasons">): ReuploadRequest | null {
  if (record.status !== "needs_person") return null;
  if (record.kind !== "government_id" && record.kind !== "proof_of_address") return null;
  const fixable: Array<{ line: string; en: string }> = [];
  for (const line of record.reasons) {
    if (NEUTRAL.test(line.trim())) continue;
    const match = FIXABLE.find((f) => f.test.test(line.trim()));
    // A doubt we do not recognise is a person's: never guessed as fixable.
    if (!match) return null;
    fixable.push({ line, en: match.en });
  }
  if (fixable.length === 0) return null;
  return {
    reasons: fixable.map((f) => f.line),
    motivo: { es: fixable.map((f) => clause(f.line)).join("; "), en: fixable.map((f) => f.en).join("; ") },
  };
}

/** Checks of one kind of document since the last one accepted, newest first. */
export function failuresSinceAccepted(records: readonly IntakeRecord[], kind: "government_id" | "proof_of_address"): IntakeRecord[] {
  const ofKind = records.filter((r) => r.kind === kind).sort((a, b) => b.at.localeCompare(a.at));
  const out: IntakeRecord[] = [];
  for (const r of ofKind) {
    if (r.status === "accepted") break;
    if (r.status === "needs_person") out.push(r);
  }
  return out;
}

export const DOCUMENT_NAME = {
  government_id: { es: "identificación", en: "photo ID" },
  proof_of_address: { es: "comprobante de domicilio", en: "proof of address" },
} as const;
