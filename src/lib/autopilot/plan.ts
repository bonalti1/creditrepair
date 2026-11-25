import type { StaffClient } from "../staff/types";
import { settingsAllow, settingsOf } from "../fulfillment/notifications";
import { clientTimeZone, isQuietHour, localDay } from "./clock";
import { clientChannel, clientLocale, dueFollowups, openHold, type PlannedMessage } from "./followups";
import { STATUS_EXPIRY_DAYS } from "./status";
import { ALL_TEMPLATES, renderTemplate } from "./templates";
import type { AutopilotEnv, OutboundMessage } from "./types";

// What one run of the autopilot sends to one client, and what it leaves.
//
// The order of the rules is the order of the checks here:
//   1. A client who opted out gets nothing; queued messages are cancelled.
//   2. Quiet hours (the client's own clock): nothing now, everything waits.
//   3. Status messages first (facts the client should hear), oldest first,
//      then follow-ups; together at most the daily cap per local day.
//   4. Follow-ups never go to a client on hold (status messages still do).
//   5. Every message needs a channel (channels.ts) the client kept in their
//      notification settings; without one it waits (status, until it
//      expires) or the item is a person's (follow-ups).
//   6. A progress update the client turned off in their settings is closed
//      without sending ("client_settings"); required notices (money, letters
//      mailed in their name) always go (fulfillment/notifications.ts).
// Pure: the caller claims and sends (server.ts), the demo only shows it.

export interface DeliveryPlan {
  send: PlannedMessage[];
  /** Queued rows to close without sending, and why. */
  cancel: Array<{ id: string; note: "opted_out" | "expired" | "status_off" | "client_settings" }>;
  /** Why nothing (more) went now, for the run's summary. */
  waiting: Array<"quiet_hours" | "daily_cap" | "no_channel">;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const COUNTED: ReadonlySet<OutboundMessage["status"]> = new Set(["sending", "sent", "simulated", "failed"]);

/** Automatic messages already sent to this client on their local calendar day. */
export function sentToday(client: StaffClient, now: Date): number {
  const zone = clientTimeZone(client.state);
  const today = localDay(now, zone);
  return (client.outbound ?? []).filter((m) => COUNTED.has(m.status) && localDay(new Date(m.sentAt ?? m.queuedAt), zone) === today).length;
}

/** A queued status row as a message ready to go. */
function fromQueued(client: StaffClient, row: OutboundMessage, env: AutopilotEnv, now: Date): PlannedMessage | null {
  const template = ALL_TEMPLATES.find((t) => t.name === row.template);
  if (!template) return null;
  const params = row.params ?? [];
  return {
    dedupeKey: row.dedupeKey,
    kind: "status",
    topic: row.topic,
    step: null,
    locale: row.locale,
    template,
    params,
    // The words as queued; re-rendered only if the row carried none.
    body: row.body || renderTemplate(template, row.locale, params),
    link: row.link,
    outboundId: row.id,
    choice: clientChannel(client, template.name, env, now),
  };
}

export function planDeliveries(client: StaffClient, now: Date, env: AutopilotEnv, base?: string): DeliveryPlan {
  const plan: DeliveryPlan = { send: [], cancel: [], waiting: [] };
  const queued = (client.outbound ?? []).filter((m) => m.status === "queued").sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

  // 1. Opted out: nothing, ever, until they opt back in.
  if (client.optOut) {
    for (const row of queued) plan.cancel.push({ id: row.id, note: "opted_out" });
    return plan;
  }
  const live: OutboundMessage[] = [];
  for (const row of queued) {
    if (now.getTime() - new Date(row.queuedAt).getTime() > STATUS_EXPIRY_DAYS * DAY_MS) plan.cancel.push({ id: row.id, note: "expired" });
    else if (!env.settings.statusEnabled) plan.cancel.push({ id: row.id, note: "status_off" });
    else if (!settingsAllow(settingsOf(client), "status", row.topic)) plan.cancel.push({ id: row.id, note: "client_settings" });
    else live.push(row);
  }

  // 2. Quiet hours, on the client's clock.
  if (isQuietHour(now, clientTimeZone(client.state), env.settings)) {
    if (live.length > 0 || dueFollowups(client, now, env, base).length > 0) plan.waiting.push("quiet_hours");
    return plan;
  }

  // 3–5.
  const candidates: PlannedMessage[] = [
    ...live.flatMap((row) => fromQueued(client, row, env, now) ?? []),
    // 4. A hold stops the reminders (followupStates marks them blocked), never a status message.
    ...(openHold(client) ? [] : dueFollowups(client, now, env, base)),
  ];
  let room = env.settings.dailyCap - sentToday(client, now);
  for (const message of candidates) {
    if (message.choice.channel === null) {
      if (!plan.waiting.includes("no_channel")) plan.waiting.push("no_channel");
      continue;
    }
    if (room <= 0) {
      if (!plan.waiting.includes("daily_cap")) plan.waiting.push("daily_cap");
      break;
    }
    plan.send.push({ ...message, locale: message.locale ?? clientLocale(client) });
    room -= 1;
  }
  return plan;
}
