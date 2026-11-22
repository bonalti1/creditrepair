import { formatUsAddress, parseUsAddress } from "../mail/address";
import { demoLetterMail, demoRosario } from "../mail/demo";
import type { IntakeRecord } from "../intake/types";
import type { SelfResolution, StaffClient } from "../staff/types";
import { resolutionText, type ResolutionKind } from "./resolutions";

// ─────────────────────────────────────────────────────────────────────────
// DEMO DATA for what fixes itself (migration 0022). Nobody here exists.
//
//   c09 Ramiro     the post office could not confirm his address (a unit is
//                  missing); he was asked to confirm it with one tap, and the
//                  automatic reminders are on it: not a person's yet
//   c20 Leticia    confirmed her address from the system's link two days ago
//   c27 Héctor     a letter of his round 3 came back; the address was
//                  corrected with the post office's data and the same letter
//                  went again (same round, no new charge)
//   c13 Paulina    her first proof of address was blurry; she uploaded another
//                  from the re-upload link and it was accepted
//   c21 Joaquín    his round went out by itself; the post office wrote his
//                  return address and one bureau's with ZIP+4
//   c25 Gerardo    a declined charge went through on the retry
//   c51, c52       two more clients whose round 4 waits on the same company as
//                  Rosario's (Midland Credit Management): one item in the
//                  queue for the three of them
// Every date is counted back from "now".
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function resolution(client: StaffClient, kind: ResolutionKind, at: string, detail: Record<string, unknown>): SelfResolution {
  return { id: `${client.id}-res-${kind}-${(client.resolutions ?? []).length}`, kind, at, text: resolutionText(kind, detail) };
}

function addResolution(client: StaffClient | undefined, kind: ResolutionKind, at: string, detail: Record<string, unknown> = {}): void {
  if (!client) return;
  client.resolutions = [...(client.resolutions ?? []), resolution(client, kind, at, detail)];
}

/** Called by buildDemoClients before the autopilot's demo history is worked out, so the reminders follow from it. */
export function attachDemoSelfHealing(clients: StaffClient[], ago: (days: number, hours?: number) => string): void {
  const byId = new Map(clients.map((c) => [c.id, c]));

  // Ramiro: his address, as he typed it, lacks the apartment number the building needs.
  const ramiro = byId.get("c09");
  if (ramiro) {
    const parsed = parseUsAddress(ramiro.addressLines);
    if (parsed.ok) {
      const a = parsed.address;
      ramiro.addressLines = formatUsAddress({ ...a, line1: `${a.line1} Interior` });
      ramiro.addressCheck = {
        id: "demo-c09-address",
        reason: "verification",
        finding: "ambiguous",
        requestedAt: ago(1, 3),
        inputLines: ramiro.addressLines,
        suggestionLines: formatUsAddress({ ...a, line1: a.line1.toUpperCase(), line2: "APT 3", city: a.city.toUpperCase(), zip: `${a.zip}-2214` }),
        letterId: null,
        roundNumber: ramiro.rounds.find((r) => r.status === "ready")?.number ?? null,
        confirmedAt: null,
        confirmedLines: null,
        closedAt: null,
        requests: 1,
      };
    }
  }

  // Leticia: asked two and a half days ago, confirmed two days ago.
  const leticia = byId.get("c20");
  if (leticia) {
    leticia.addressCheck = {
      id: "demo-c20-address",
      reason: "verification",
      finding: "ambiguous",
      requestedAt: ago(2, 12),
      inputLines: leticia.addressLines,
      suggestionLines: [],
      letterId: null,
      roundNumber: 2,
      confirmedAt: ago(2),
      confirmedLines: leticia.addressLines,
      closedAt: null,
      requests: 1,
    };
    addResolution(leticia, "address_confirmed", ago(2));
  }

  // Héctor: the letter to the first recipient of round 3 came back; the same letter went again two days ago.
  const hector = byId.get("c27");
  const round = hector?.rounds.find((r) => r.number === 3 && r.mailedAt);
  const original = round?.letters[0];
  if (hector && round && original) {
    original.mailStatus = "returned";
    original.mail = demoLetterMail(original, round.mailedAt!, "returned");
    const remailAt = ago(2);
    const remail = { ...original, id: `${original.id}-reenvio`, remailOf: original.id, mailStatus: "in_transit" as const };
    remail.mail = demoLetterMail(remail, remailAt, "in_transit");
    round.letters = [...round.letters, remail];
    addResolution(hector, "letter_remailed", remailAt, { recipient: original.recipient.name });
  }

  // Paulina: the first proof of address was blurry; the second, from the link, was accepted.
  const paulina = byId.get("c13");
  if (paulina) {
    const records: IntakeRecord[] = [
      { id: "demo-c13-poa-1", kind: "proof_of_address", at: ago(4, 6), status: "needs_person", simulated: true, reasons: ["Es un recibo de servicios.", "La foto está borrosa."] },
      {
        id: "demo-c13-poa-2",
        kind: "proof_of_address",
        at: ago(3, 2),
        status: "accepted",
        simulated: true,
        reasons: ["Es un recibo de servicios.", "Se lee con claridad.", "El nombre coincide con el de tu cuenta.", "La dirección coincide con tu dirección postal.", "Es reciente."],
      },
    ];
    paulina.intake = [...(paulina.intake ?? []), ...records];
    addResolution(paulina, "document_reuploaded", ago(3, 2), { kind: "proof_of_address" });
  }

  // Joaquín: his round went out by itself this morning; two addresses were written the post office's way.
  const joaquin = byId.get("c21");
  if (joaquin?.rounds[0]?.mailedAt) {
    const at = joaquin.rounds[0].mailedAt;
    addResolution(joaquin, "address_corrected", at, { subject: "client", lines: "su dirección con el código postal de 9 dígitos" });
    addResolution(joaquin, "address_corrected", at, { subject: "bureau", name: "TransUnion", lines: "la dirección del buró con el código postal de 9 dígitos" });
  }

  // Gerardo: the round 3 charge was declined once and went through on the retry.
  const gerardo = byId.get("c25");
  const retried = gerardo?.billing.charges.find((c) => c.roundNumber === 3 && c.attempts > 1 && c.chargedAt);
  if (gerardo && retried) addResolution(gerardo, "payment_fixed", retried.chargedAt!, { roundNumber: 3 });
}

/** Rosario's round 4 waits on Midland's dispute address; two more clients wait on the same company. */
export function demoMidlandClients(now: Date): StaffClient[] {
  const people: Array<{ id: string; first: string; last: string; phone: string; street: string; zip: string; readyHours: number }> = [
    { id: "c51", first: "Aurelio", last: "Cantú", phone: "+17135550151", street: "915 Calle Ejemplo", zip: "77009", readyHours: 30 },
    { id: "c52", first: "Mireya", last: "Saldívar", phone: "+17135550152", street: "2230 Calle Ejemplo", zip: "77011", readyHours: 20 },
  ];
  return people.map((p) => {
    const base = demoRosario(now);
    const copy = JSON.parse(JSON.stringify(base).replace(/"c50/g, `"${p.id}`).replace(/c50-/g, `${p.id}-`)) as StaffClient;
    return {
      ...copy,
      id: p.id,
      firstName: p.first,
      lastName: p.last,
      phone: p.phone,
      addressLines: [p.street, `Houston, TX ${p.zip}`],
      rounds: copy.rounds.map((r) => (r.status === "ready" ? { ...r, readyAt: new Date(now.getTime() - p.readyHours * HOUR_MS).toISOString() } : r)),
      lastActivityAt: new Date(now.getTime() - 3 * DAY_MS).toISOString(),
    };
  });
}
