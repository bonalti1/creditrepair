import { formatCents, billingDate, billingDay } from "../billing/rules";
import { DUNNING_RETRY_DAYS } from "../billing/dunning";
import { receiptNumber, workLineWithoutLetters } from "../billing/receipts";
import type { StaffClient } from "../staff/types";
import { clientTimeZone, nextAllowedTime } from "./clock";
import { clientLocale, followupStates, followupTemplate } from "./followups";
import { roundPlanKey } from "./sending";
import { statusMessage, type StatusEvent } from "./status";
import { appLink, renderTemplate } from "./templates";
import { ALL_FOLLOWUPS_ON, type AutopilotEnv, type AutopilotSettings, type ChannelAvailability, type ClientHold, type OptOutRecord, type OutboundMessage } from "./types";

// DEMO DATA for the autopilot. Nobody here exists.
//
// What the system would have done for the invented clients (staff/demoClients.ts)
// if the autopilot had been on all along: the reminders each situation's
// schedule sent, the status messages for what happened (letters mailed,
// receipts, new reports, rounds prepared), a hold a teammate placed, a client
// who wrote BAJA, and one round the system mailed by itself. It is worked out
// from the same rules the real runs use (followups.ts, status.ts), counted
// back from "now", so it reads the same whenever the demo is opened.
//
// In the demo every channel is "simulated": nothing leaves the browser.

export const DEMO_SETTINGS: AutopilotSettings = {
  roundsEnabled: true,
  reviewWindowHours: 24,
  followupsEnabled: true,
  followups: ALL_FOLLOWUPS_ON,
  statusEnabled: true,
  quietStartHour: 21,
  quietEndHour: 8,
  dailyCap: 2,
  updatedAt: null,
  updatedBy: null,
};

export const DEMO_CHANNELS: ChannelAvailability = { whatsapp: true, email: true, approvedTemplates: "all", simulated: true };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Hours ago the system first saw each prepared round ready; the review window counts from there. */
const READY_HOURS_AGO: Record<string, number> = { c07: 20, c08: 30, c14: 6, c09: 26 };

export function attachDemoAutopilot(clients: StaffClient[], now: Date): StaffClient[] {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR_MS).toISOString();
  const env: AutopilotEnv = { settings: DEMO_SETTINGS, channels: DEMO_CHANNELS };

  for (const client of clients) {
    // When each ready round was first seen.
    for (const round of client.rounds) {
      if (round.status === "ready") round.readyAt = at(READY_HOURS_AGO[client.id] ?? 3);
    }
  }

  const byId = (id: string) => clients.find((c) => c.id === id);
  // The invented clients chose Spanish (a client with no saved language reads English);
  // Ximena reads in English.
  for (const client of clients) client.locale ??= "es";
  const ximena = byId("c22");
  if (ximena) ximena.locale = "en";
  // Itzel wrote yesterday (her question): the WhatsApp window is open.
  const itzel = byId("c04");
  if (itzel) itzel.lastInboundAt = at(25);
  // Joaquín's round 1 went out by itself this morning, after its review window.
  const joaquin = byId("c21");
  if (joaquin?.rounds[0]) joaquin.rounds[0].sentBy = "sistema";

  // Heriberto wrote BAJA three days ago: nothing automatic since.
  const optOuts: Record<string, OptOutRecord> = { c12: { at: at(3 * 24 + 5), keyword: "BAJA", channel: "whatsapp" } };
  // Brenda asked to look at one of her letters with someone first.
  const holds: Record<string, ClientHold> = {
    c08: { id: "c08-h1", at: at(5), by: "carmen", reason: "Quiere revisar una de sus cartas con nosotros antes de que salga." },
  };

  for (const client of clients) {
    const until = optOuts[client.id] ? new Date(optOuts[client.id]!.at) : now;
    client.outbound = [...statusHistory(client, until), ...followupHistory(client, until, env)].sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""));
    if (optOuts[client.id]) client.optOut = optOuts[client.id]!;
    if (holds[client.id]) client.holds = [holds[client.id]!];
  }
  return clients;
}

function simulated(client: StaffClient, n: number, fields: Omit<OutboundMessage, "id" | "status" | "queuedAt" | "channel"> & { sentAt: string }): OutboundMessage {
  return { ...fields, id: `${client.id}-o${n}`, status: "simulated", queuedAt: fields.sentAt, channel: "whatsapp" };
}

/** The reminders each open situation's schedule would have sent by `until`, at allowed hours. */
function followupHistory(client: StaffClient, until: Date, env: AutopilotEnv): OutboundMessage[] {
  const zone = clientTimeZone(client.state);
  const locale = clientLocale(client);
  const sent: OutboundMessage[] = [];
  for (let guard = 0; guard < 12; guard += 1) {
    const current = { ...client, outbound: sent };
    const due = followupStates(current, until, env)
      .filter((s) => !s.block && s.next)
      .map((s) => ({ s, sendAt: nextAllowedTime(new Date(s.next!.dueAt), zone, env.settings) }))
      .filter(({ sendAt }) => sendAt.getTime() <= until.getTime())
      .sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime())[0];
    if (!due) break;
    const { s, sendAt } = due;
    const template = followupTemplate(s.situation.kind, s.next!.step);
    const link = appLink(s.schedule.path);
    const params = [client.firstName, ...s.situation.values[locale], link];
    sent.push(
      simulated(client, 100 + sent.length, {
        dedupeKey: `followup:${client.id}:${s.situation.key}:${s.next!.step}`,
        kind: "followup",
        topic: s.situation.kind,
        step: s.next!.step,
        template: template.name,
        params,
        locale,
        body: renderTemplate(template, locale, params),
        link,
        sentAt: sendAt.toISOString(),
      }),
    );
  }
  return sent;
}

/** Status messages for what is on the record, each at the first allowed hour after it happened. */
function statusHistory(client: StaffClient, until: Date): OutboundMessage[] {
  if (!client.signedUpAt) return [];
  const zone = clientTimeZone(client.state);
  const locale = clientLocale(client);
  const events: Array<{ at: string; event: StatusEvent }> = [];
  for (const round of client.rounds) {
    if (round.mailedAt) events.push({ at: round.mailedAt, event: { kind: "letters_mailed", roundNumber: round.number, letterCount: round.letters.length } });
    if (round.respondedAt) {
      events.push({ at: round.respondedAt, event: { kind: "report_changes", pullId: `${client.id}-r${round.number}`, goneCount: (round.results ?? []).length } });
    }
    if (round.status === "ready" && round.number > 1 && round.readyAt) {
      events.push({ at: round.readyAt, event: { kind: "next_round_prepared", roundNumber: round.number, planKey: roundPlanKey(round) } });
    }
  }
  // Billing's notices through the outbound log (migration 0022), each with the «Actualizar mi tarjeta» link:
  // one per declined attempt of a charge still unpaid (first try, then 3 and 7 days later), and the
  // missing-method notice the day a mailed round could be charged.
  for (const charge of client.billing.charges) {
    if (charge.status !== "failed") continue;
    const offsets = [0, ...DUNNING_RETRY_DAYS];
    for (let attempt = 1; attempt <= charge.attempts; attempt++) {
      const at = new Date(new Date(charge.createdAt).getTime() + offsets[attempt - 1]! * DAY_MS).toISOString();
      const next = attempt < charge.attempts ? new Date(new Date(charge.createdAt).getTime() + offsets[attempt]! * DAY_MS).toISOString() : charge.nextAttemptAt;
      events.push({
        at,
        event: {
          kind: "payment_declined",
          chargeId: charge.id,
          attempts: attempt,
          roundNumber: charge.roundNumber,
          amount: formatCents(charge.amountCents),
          retryOn: next ? { es: billingDay(next, "es"), en: billingDay(next, "en") } : null,
        },
      });
    }
  }
  const owed = client.rounds.find((r) => r.mailedAt && !client.billing.paymentMethod && !client.billing.charges.some((c) => c.roundNumber === r.number));
  if (owed?.mailedAt && client.agreementSignedAt) {
    events.push({
      at: new Date(new Date(owed.mailedAt).getTime() + DAY_MS).toISOString(),
      event: { kind: "payment_method_needed", roundNumber: owed.number, workDate: { es: billingDay(owed.mailedAt, "es"), en: billingDay(owed.mailedAt, "en") } },
    });
  }
  for (const round of client.rounds) {
    for (const letter of round.letters) {
      if (!letter.remailOf || !letter.mail?.mailedAt) continue;
      events.push({ at: letter.mail.mailedAt, event: { kind: "letter_remailed", letterId: letter.remailOf, recipient: letter.recipient.name, roundNumber: round.number } });
    }
  }
  for (const charge of client.billing.charges) {
    if (!charge.chargedAt) continue;
    events.push({
      at: charge.chargedAt,
      event: {
        kind: "payment_receipt",
        chargeId: charge.id,
        receiptNumber: receiptNumber(charge.id),
        amount: formatCents(charge.amountCents),
        date: { es: billingDate(charge.chargedAt, "es"), en: billingDate(charge.chargedAt, "en") },
        work: workLineWithoutLetters(charge.roundNumber, charge.workDate),
      },
    });
  }
  return events
    .map(({ at, event }, i) => {
      const sentAt = nextAllowedTime(new Date(new Date(at).getTime() + HOUR_MS), zone, DEMO_SETTINGS);
      const m = statusMessage(client.id, client.firstName, locale, event);
      return simulated(client, i, {
        dedupeKey: m.dedupeKey,
        kind: "status",
        topic: m.topic,
        step: null,
        template: m.template.name,
        params: m.params,
        locale,
        body: m.body,
        link: m.link,
        sentAt: sentAt.toISOString(),
      });
    })
    .filter((m) => new Date(m.sentAt!).getTime() <= until.getTime() && until.getTime() - new Date(m.sentAt!).getTime() < 400 * DAY_MS);
}
