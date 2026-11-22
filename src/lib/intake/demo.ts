import type { StaffClient } from "../staff/types";
import type { IntakeRecord } from "./types";

// DEMO DATA. Nobody here exists. What the AI intake would have recorded for a
// few of the invented clients of staff/demoClients.ts, all marked simulated:
//
//   c09 Ramiro    ID checked automatically; his proof of address needs a person
//   c05 Fidel     both documents checked automatically
//   c12 Heriberto uploaded a letter from Equifax that asks for more information
//
// Only clients who already need a person get a new notice, so the console's
// "needs a person" count is unchanged.

export function attachDemoIntake(clients: StaffClient[], ago: (days: number, hours?: number) => string): void {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const add = (id: string, records: IntakeRecord[]) => {
    const client = byId.get(id);
    if (client) client.intake = [...(client.intake ?? []), ...records];
  };

  add("c09", [
    {
      id: "demo-c09-id",
      kind: "government_id",
      at: ago(6, 3),
      status: "accepted",
      simulated: true,
      reasons: ["Es una licencia de conducir.", "Se lee con claridad.", "El nombre coincide con el de tu cuenta.", "No está vencida."],
    },
    {
      id: "demo-c09-poa",
      kind: "proof_of_address",
      at: ago(6, 2),
      status: "needs_person",
      simulated: true,
      reasons: ["Es un recibo de servicios.", "La dirección del documento no coincide con tu dirección postal en la cuenta."],
    },
  ]);
  add("c05", [
    { id: "demo-c05-id", kind: "government_id", at: ago(9, 4), status: "accepted", simulated: true, reasons: ["Es una matrícula consular.", "Se lee con claridad.", "El nombre coincide con el de tu cuenta.", "No está vencida."] },
    { id: "demo-c05-poa", kind: "proof_of_address", at: ago(9, 3), status: "accepted", simulated: true, reasons: ["Es un estado de cuenta bancario.", "Se lee con claridad.", "El nombre coincide con el de tu cuenta.", "La dirección coincide con tu dirección postal.", "Es reciente."] },
  ]);

  const heriberto = byId.get("c12");
  const midland = heriberto?.report?.items.find((i) => i.bureau === "equifax" && i.name === "Midland Credit Management");
  add("c12", [
    {
      id: "demo-c12-letter",
      kind: "bureau_letter",
      at: ago(2, 5),
      status: "needs_person",
      simulated: true,
      reasons: ["Sobre «Midland Credit Management ****8821» el buró pide más información."],
      letter: {
        bureau: "equifax",
        letterDate: ago(6).slice(0, 10),
        items: [
          {
            creditor: "Midland Credit Management",
            account: "****8821",
            outcome: "more_info_requested",
            fingerprint: midland?.fingerprint ?? null,
            citation: { page: 1, quote: "MIDLAND CREDIT MANAGEMENT ****8821 — We need additional information to process your request" },
          },
        ],
      },
    },
  ]);
}
