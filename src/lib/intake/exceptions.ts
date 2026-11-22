import type { StaffException } from "../staff/stage";
import type { IntakeRecord } from "./types";

// What AI intake hands to a person: only the documents it was not sure about.
// An accepted check never reaches the console's "needs a person" list; it
// shows on the client page as "Revisado automáticamente" with its reasons.
//
//   document_check_needs_person   the newest ID or proof of address of that
//                                 kind needs a person (a newer accepted one
//                                 clears it)
//   bureau_letter_needs_person    a bureau's letter that DID arrive (letters
//                                 are optional) and asks for more information
//                                 or calls the dispute "frivolous". A letter
//                                 that never arrives creates nothing: round
//                                 results come from the next report.
//
// A credit report is never an exception here: staff are on the import screen
// when it is read, and the doubtful items are highlighted there.

const DOC_NAME = { government_id: "identificación", proof_of_address: "comprobante de domicilio" } as const;
const BUREAU = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" } as const;

/** The reasons are written to the client ("tu cuenta"); staff read them about the client ("su cuenta"). */
function aboutClient(text: string): string {
  return text.replace(/\btus\b/g, "sus").replace(/\btu\b/g, "su").replace(/\bTu\b/g, "Su");
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function intakeExceptions(records: readonly IntakeRecord[] | undefined, clientId: string): StaffException[] {
  if (!records || records.length === 0) return [];
  const found: StaffException[] = [];

  for (const kind of ["government_id", "proof_of_address"] as const) {
    const newest = records.filter((r) => r.kind === kind).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!newest || newest.status !== "needs_person") continue;
    found.push({
      key: `document_check_needs_person:${newest.id}`,
      kind: "document_check_needs_person",
      severity: "medium",
      sentence: `La revisión automática de su ${DOC_NAME[kind]} no la pudo confirmar: ${clip(aboutClient(newest.reasons.join(" ")), 160)}${newest.simulated ? " (simulado)" : ""}`,
      actionLabel: "Revisar el documento",
      action: "open_client",
      since: newest.at,
      href: `/equipo/clientes/${clientId}#documentos`,
    });
  }

  for (const record of records) {
    if (record.kind !== "bureau_letter" || record.status !== "needs_person") continue;
    const bureau = record.letter?.bureau ? BUREAU[record.letter.bureau] : "un buró";
    const date = record.letter?.letterDate ? ` (del ${record.letter.letterDate})` : "";
    found.push({
      key: `bureau_letter_needs_person:${record.id}`,
      kind: "bureau_letter_needs_person",
      severity: "high",
      sentence: `Subió una carta de ${bureau}${date} que necesita una persona: ${clip(record.reasons.join(" "), 170)}${record.simulated ? " (simulado)" : ""}`,
      actionLabel: "Leer la carta",
      action: "open_client",
      since: record.at,
      href: `/equipo/clientes/${clientId}#documentos`,
    });
  }
  return found;
}
