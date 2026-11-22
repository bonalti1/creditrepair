import type { FurnisherEntry } from "../mail/furnishers";
import { formatDay, sendableRound, STAFF_TIME_ZONE } from "../staff/stage";
import type { StaffClient, StaffRound } from "../staff/types";
import { openHold } from "./followups";
import { roundPlanKey } from "./planKey";
import type { AutopilotSettings } from "./types";

// Automatic sending: a round that passes every gate goes out by itself once
// it has sat in "Listas para enviar" for the review window, unless a person
// holds the client.
//
// This decides WHICH rounds may go. It sends nothing and checks no gate of its
// own: the console's rule (sendableRound, with the furnisher address book)
// says the round may be mailed now, and the one mailing path,
// src/lib/rounds/send.ts, checks every gate again on the server from the
// database (agreement window, unpaid charge, attestation, addresses,
// monitoring, idempotency) before a letter leaves. A round this says yes to
// and the server says no to is simply not sent.

const HOUR_MS = 60 * 60 * 1000;

export { roundPlanKey };

export type AutoSendStatus =
  /** Automatic sending is off: a person sends it. */
  | "off"
  /** A person held this client. */
  | "held"
  /** In the review window; goes by itself at `at`. */
  | "waiting"
  /** The window is over; the next run sends it. */
  | "due";

export interface AutoSendState {
  status: AutoSendStatus;
  /** When it may go by itself (ISO), for "waiting" and "due". */
  at: string | null;
  /** One line for the console. */
  text: string;
}

function hourOf(date: Date): string {
  return date.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: STAFF_TIME_ZONE }).replace(/\s/g, " ");
}

function whenText(at: Date, now: Date): string {
  const today = now.toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
  const that = at.toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
  const tomorrow = new Date(now.getTime() + 24 * HOUR_MS).toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
  if (that === today) return `hoy a las ${hourOf(at)}`;
  if (that === tomorrow) return `mañana a las ${hourOf(at)}`;
  return `el ${formatDay(at)} a las ${hourOf(at)}`;
}

/** Where a sendable round stands with the autopilot. `readyAt` null: the system has not seen it yet. */
export function autoSendState(client: StaffClient, round: StaffRound, now: Date, settings: AutopilotSettings): AutoSendState {
  if (!settings.roundsEnabled) return { status: "off", at: null, text: "Envío automático apagado: la envía una persona." };
  const hold = openHold(client);
  if (hold) return { status: "held", at: null, text: `Detenida por ${hold.by}: «${hold.reason}»` };
  const ready = round.readyAt ? new Date(round.readyAt) : now;
  const at = new Date(ready.getTime() + settings.reviewWindowHours * HOUR_MS);
  if (at.getTime() > now.getTime()) return { status: "waiting", at: at.toISOString(), text: `Sale sola ${whenText(at, now)} si nadie la detiene.` };
  return { status: "due", at: at.toISOString(), text: "Sale sola en la próxima vuelta del sistema (cada hora)." };
}

export interface AutoSendCandidate {
  client: StaffClient;
  round: StaffRound;
  state: AutoSendState;
}

/** The rounds the next run would mail by itself, and the ones still in their window. */
export function autoSendCandidates(clients: StaffClient[], now: Date, settings: AutopilotSettings, furnishers: readonly FurnisherEntry[]): AutoSendCandidate[] {
  return clients.flatMap((client) => {
    const round = sendableRound(client, now, { furnishers });
    return round ? [{ client, round, state: autoSendState(client, round, now, settings) }] : [];
  });
}
