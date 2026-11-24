import type { FurnisherEntry } from "../mail/furnishers";
import { firstWorkingDay } from "../agreement/businessDays";
import { deadlineOf } from "../agreement/gate";
import { clientAgreement, formatDay, sendableRound, STAFF_TIME_ZONE, workStartsAt } from "../staff/stage";
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

function hourOf(date: Date, locale: "es" | "en"): string {
  return date.toLocaleTimeString(locale === "es" ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: STAFF_TIME_ZONE }).replace(/\s/g, " ");
}

function whenText(at: Date, now: Date, locale: "es" | "en"): string {
  const today = now.toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
  const that = at.toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
  const tomorrow = new Date(now.getTime() + 24 * HOUR_MS).toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
  if (locale === "en") {
    if (that === today) return `today at ${hourOf(at, "en")}`;
    if (that === tomorrow) return `tomorrow at ${hourOf(at, "en")}`;
    return `on ${formatDay(at, "en")} at ${hourOf(at, "en")}`;
  }
  if (that === today) return `hoy a las ${hourOf(at, "es")}`;
  if (that === tomorrow) return `mañana a las ${hourOf(at, "es")}`;
  return `el ${formatDay(at)} a las ${hourOf(at, "es")}`;
}

/** Where a sendable round stands with the autopilot. `readyAt` null: the system has not seen it yet. `text` is for the console, in `locale`. */
export function autoSendState(client: StaffClient, round: StaffRound, now: Date, settings: AutopilotSettings, locale: "es" | "en" = "es"): AutoSendState {
  const en = locale === "en";
  if (!settings.roundsEnabled) return { status: "off", at: null, text: en ? "Automatic sending off: a person sends it." : "Envío automático apagado: la envía una persona." };
  const hold = openHold(client);
  if (hold) return { status: "held", at: null, text: en ? `On hold by ${hold.by}: “${hold.reason}”` : `Detenida por ${hold.by}: «${hold.reason}»` };
  const ready = round.readyAt ? new Date(round.readyAt) : now;
  let at = new Date(ready.getTime() + settings.reviewWindowHours * HOUR_MS);
  // Round 1 goes out on the first working day after the cancellation window (the date the client is shown:
  // rounds/timing.ts, roundOneMailDate), not on a weekend or holiday night right after the deadline.
  if (round.number === 1) {
    const deadline = deadlineOf(clientAgreement(client));
    if (deadline) {
      const first = firstWorkingDay(deadline);
      if (first.getTime() > at.getTime()) at = first;
    }
  }
  if (at.getTime() > now.getTime()) {
    const when = whenText(at, now, locale);
    return { status: "waiting", at: at.toISOString(), text: en ? `Goes out on its own ${when} unless someone holds it.` : `Sale sola ${when} si nadie la detiene.` };
  }
  return { status: "due", at: at.toISOString(), text: en ? "Goes out on the system's next run (every hour)." : "Sale sola en la próxima vuelta del sistema (cada hora)." };
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

/**
 * Round 1 while the client is still inside their cancellation window: the
 * round the console will list in "Listas para enviar" the moment work may start
 * (the first working day after the window, staff/stage.ts: workStartsAt), when
 * nothing else would hold it then. Null otherwise.
 *
 * Why: the review window counts from when the system first saw the round
 * ready. Seen only once the window is over, round 1 would wait a further day
 * (the default 24 hours). Noted while the window runs, its review window is
 * over by then, and the first run of the first working day mails it. Nothing
 * is mailed, charged or sent to the client before that day: send.ts still
 * refuses every letter until the gate allows work (agreement/gate.ts).
 */
export function upcomingFirstRound(client: StaffClient, now: Date, furnishers: readonly FurnisherEntry[]): { round: StaffRound; startsAt: Date } | null {
  const startsAt = workStartsAt(client, now);
  if (!startsAt) return null;
  const round = sendableRound(client, new Date(startsAt.getTime() + 1000), { furnishers });
  return round && round.number === 1 ? { round, startsAt } : null;
}
