import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "../integrations/email";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../integrations/whatsapp";
import { furnisherFromRow } from "../mail/server";
import { roundMailPlan } from "../mail/sendPlan";
import { furnisherGaps } from "../mail/gaps";
import { recordFurnisherGaps } from "../mail/gapsServer";
import { handleReturnedLetters, type ReturnsDeps, type ReturnsSummary } from "../mail/returnsServer";
import { reportError } from "../observability/errors";
import { sendRound, type SendRoundOptions, type SendRoundResult } from "../rounds/send";
import { clientsFromRows } from "../staff/fromRows";
import { loadStaffRows } from "../staff/load";
import { sendableRound } from "../staff/stage";
import type { StaffClient } from "../staff/types";
import { availabilityFromEnv } from "./channels";
import type { PlannedMessage } from "./followups";
import { planDeliveries } from "./plan";
import { roundPlanKey } from "./planKey";
import { autoSendState, upcomingFirstRound } from "./sending";
import { runReviewRequests, type ReviewRunSummary } from "../reviews/server";
import { emailSubject, renderTemplateBody } from "./templates";
import { unsubscribeUrl } from "./unsubscribe";
import { loadAutopilotSettings, queueingWhatsApp, queueStatus, recordOptChange } from "./store";
import type { AutopilotEnv, AutopilotSettings, ChannelAvailability } from "./types";

export * from "./store";

// The autopilot on the database. Everything here runs on the server with the
// service role; the callers (the cron route, the staff routes, the webhooks)
// have already checked who is asking.
//
// The rules themselves are pure and live next door (followups.ts, plan.ts,
// sending.ts). This file reads, claims, sends and records.

type Row = Record<string, unknown>;

// ── Sending one message ─────────────────────────────────────────────────

export interface DeliveryResult {
  ok: boolean;
  providerRef: string | null;
  note?: string;
  /** The provider says this address unsubscribed: recorded as an opt-out. */
  unsubscribed?: boolean;
}

export type Deliver = (client: StaffClient, message: PlannedMessage) => Promise<DeliveryResult>;

/** The real channels. WhatsApp: text inside the 24-hour window, else the approved template. Email: with the legal footer. */
export const deliverForReal: Deliver = async (client, message) => {
  const choice = message.choice;
  if (choice.channel === "whatsapp") {
    const to = client.phone.replace(/^\+/, "");
    if (choice.mode === "text") {
      const result = await sendWhatsAppText(to, message.body, `autopilot:${message.topic}`);
      return result.sent ? { ok: true, providerRef: null } : { ok: false, providerRef: null, note: "not_configured" };
    }
    const result = await sendWhatsAppTemplate(
      to,
      { name: message.template.name, locale: message.locale, params: message.params, rendered: message.body },
      `autopilot:${message.topic}`,
    );
    return result.sent ? { ok: true, providerRef: result.id } : { ok: false, providerRef: null, note: "not_configured" };
  }
  if (choice.channel === "email") {
    const link = unsubscribeUrl(client.id, process.env, message.locale);
    const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? "";
    if (!link || !address || !client.email) return { ok: false, providerRef: null, note: "email_not_ready" };
    const result = await sendEmail(
      {
        to: client.email,
        subject: emailSubject(message.topic, message.locale),
        text: renderTemplateBody(message.template, message.locale, message.params),
        unsubscribeUrl: link,
        postalAddress: address,
        idempotencyKey: message.dedupeKey,
      },
      message.locale,
    );
    return { ok: result.sent, providerRef: result.providerRef, ...(result.sent ? {} : { note: "not_configured" }), ...(result.unsubscribed ? { unsubscribed: true } : {}) };
  }
  return { ok: false, providerRef: null, note: "no_channel" };
};

/**
 * Claim, send, record. The claim comes first and is what makes a message go
 * once: a follow-up is a new row under its unique dedupe key, a status message
 * moves from queued to sending only if it is still queued. Whoever loses the
 * claim sends nothing. A run that stops between the claim and the answer
 * leaves the row "sending": it is never tried again (at most once).
 */
async function claimAndSend(db: SupabaseClient, client: StaffClient, message: PlannedMessage, deliver: Deliver, now: Date): Promise<"sent" | "failed" | "duplicate"> {
  const channel = message.choice.channel;
  if (!channel) return "duplicate";
  let id: string;
  if (message.outboundId) {
    const { data, error } = await db
      .from("outbound_messages")
      .update({ status: "sending", channel })
      .eq("id", message.outboundId)
      .eq("status", "queued")
      .select("id");
    if (error) throw new Error(`outbound_messages: ${error.message}`);
    const claimed = (data as Row[] | null) ?? [];
    if (claimed.length === 0) return "duplicate";
    id = String(claimed[0]!.id);
  } else {
    const { data, error } = await db
      .from("outbound_messages")
      .insert({
        user_id: client.id,
        dedupe_key: message.dedupeKey,
        kind: message.kind,
        topic: message.topic,
        step: message.step,
        channel,
        template: message.template.name,
        params: message.params,
        locale: message.locale,
        body: message.body,
        link: message.link,
        status: "sending",
        queued_at: now.toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return "duplicate";
      throw new Error(`outbound_messages: ${error.message}`);
    }
    id = String((data as Row).id);
  }

  let result: DeliveryResult;
  try {
    result = await deliver(client, message);
  } catch (error) {
    await reportError(error, { where: "autopilot:deliver", userId: client.id, extra: { dedupeKey: message.dedupeKey } });
    result = { ok: false, providerRef: null, note: (error as Error).message.slice(0, 200) };
  }
  await db
    .from("outbound_messages")
    .update({ status: result.ok ? "sent" : "failed", sent_at: now.toISOString(), provider_ref: result.providerRef, note: result.note ?? null })
    .eq("id", id)
    .eq("status", "sending");
  if (result.unsubscribed) await recordOptChange(db, { userId: client.id, kind: "opt_out", channel: channel === "email" ? "email" : "whatsapp", keyword: "PROVIDER" });
  return result.ok ? "sent" : "failed";
}

// ── The run ─────────────────────────────────────────────────────────────

export interface AutopilotDeps {
  /** Which channels can carry messages. Default: what the server's environment configures. */
  channels?: ChannelAvailability;
  /** How a message is actually sent. Default: WhatsApp / email for real. */
  deliver?: Deliver;
  /** The one mailing path. Replaceable in tests; production uses rounds/send.ts unchanged. */
  sendRound?: typeof sendRound;
  /** Passed through to sendRound (tests: a fake mail service). */
  sendDeps?: SendRoundOptions["deps"];
  /** The app's address, for links in messages. */
  base?: string;
  /** Returned letters: how addresses are checked again and how a re-mail is mailed (tests: fakes). */
  returnsDeps?: ReturnsDeps;
}

export interface AutopilotRunSummary {
  settings: Pick<AutopilotSettings, "roundsEnabled" | "followupsEnabled" | "statusEnabled">;
  clients: number;
  /** Rounds the system saw ready for the first time in this run. */
  newlyReady: number;
  roundsSent: Array<{ userId: string; roundNumber: number; letters: number }>;
  roundsRefused: Array<{ userId: string; roundNumber: number; reason: string }>;
  roundsHeld: number;
  roundsInWindow: number;
  /** Round 1s noted while their client's cancellation window runs: they go out on its first working day. */
  roundsWaitingForWindow?: number;
  messagesSent: number;
  messagesFailed: number;
  messagesCancelled: number;
  duplicates: number;
  waiting: { quiet_hours: number; daily_cap: number; no_channel: number };
  /** Returned letters looked at, re-mailed, sent to the client, marked bad, left to a person. */
  returns?: ReturnsSummary;
  /** Companies whose dispute address is missing, and how many were seen missing for the first time. */
  furnisherGaps?: { open: number; fresh: number };
  /** Review requests queued in this run (src/lib/reviews: once per client, at a milestone). */
  reviews?: ReviewRunSummary;
}

async function loadClients(db: SupabaseClient): Promise<StaffClient[]> {
  // Only people with an account: the outbound log and the rounds are theirs (a prospect has neither).
  return clientsFromRows(await loadStaffRows(db)).filter((c) => c.signedUpAt);
}

/**
 * One run: see which rounds are ready, mail the ones whose review window is
 * over (if automatic sending is on), then send the messages that are due.
 * Safe to run twice: the second run finds every round already mailed and
 * every message already claimed.
 */
export async function runAutopilot(db: SupabaseClient, now: Date = new Date(), deps: AutopilotDeps = {}): Promise<AutopilotRunSummary> {
  const settings = await loadAutopilotSettings(db);
  const env: AutopilotEnv = { settings, channels: deps.channels ?? availabilityFromEnv() };
  const deliver = deps.deliver ?? deliverForReal;
  const mail = deps.sendRound ?? sendRound;
  const summary: AutopilotRunSummary = {
    settings: { roundsEnabled: settings.roundsEnabled, followupsEnabled: settings.followupsEnabled, statusEnabled: settings.statusEnabled },
    clients: 0,
    newlyReady: 0,
    roundsSent: [],
    roundsRefused: [],
    roundsHeld: 0,
    roundsInWindow: 0,
    messagesSent: 0,
    messagesFailed: 0,
    messagesCancelled: 0,
    duplicates: 0,
    waiting: { quiet_hours: 0, daily_cap: 0, no_channel: 0 },
  };

  const { data: bookRows, error: bookError } = await db.from("furnishers").select("*");
  if (bookError) throw new Error(`furnishers: ${bookError.message}`);
  let furnishers = ((bookRows as Row[] | null) ?? []).map(furnisherFromRow);

  let clients = await loadClients(db);
  summary.clients = clients.length;

  // 0. Returned letters: re-check the addresses and, when the post office's data corrects one, mail the
  // same letter again once (same round, no new charge); ask the client about their own address; mark a
  // creditor's address bad. Only what none of that settles stays a person's (mail/returns.ts).
  const held = new Set(clients.filter((c) => (c.holds ?? []).some((h) => !h.releasedAt)).map((c) => c.id));
  summary.returns = await handleReturnedLetters(db, now, { roundsEnabled: settings.roundsEnabled, heldUserIds: held }, deps.returnsDeps);
  if (summary.returns.remailed.length > 0 || summary.returns.askedClient > 0 || summary.returns.furnisherMarked > 0) clients = await loadClients(db);

  // The companies the prepared rounds wait on, once each for every client: when each was first seen missing.
  const { data: bookAfter } = await db.from("furnishers").select("*");
  const bookNow = ((bookAfter as Row[] | null) ?? []).map(furnisherFromRow);
  furnishers = bookNow;
  const gaps = furnisherGaps(clients, furnishers);
  summary.furnisherGaps = { open: gaps.length, fresh: await recordFurnisherGaps(db, gaps, now) };

  // 1. Rounds: note the ones ready for the first time, and mail the ones whose window is over.
  for (const client of clients) {
    const round = sendableRound(client, now, { furnishers });
    if (!round) {
      // Round 1 inside the cancellation window: noted now, so it goes out on the first run of the first
      // working day after the window instead of a review window later (sending.ts: upcomingFirstRound).
      // No status message and nothing mailed until then.
      const upcoming = upcomingFirstRound(client, now, furnishers);
      if (upcoming && !upcoming.round.readyAt) {
        const { error } = await db
          .from("autopilot_ready_rounds")
          .upsert(
            { user_id: client.id, round_number: upcoming.round.number, plan_key: roundPlanKey(upcoming.round), first_ready_at: now.toISOString() },
            { onConflict: "user_id,round_number,plan_key", ignoreDuplicates: true },
          );
        if (error) throw new Error(`autopilot_ready_rounds: ${error.message}`);
        summary.newlyReady += 1;
        summary.roundsWaitingForWindow = (summary.roundsWaitingForWindow ?? 0) + 1;
      }
      continue;
    }
    const planKey = roundPlanKey(round);
    if (!round.readyAt) {
      const { error } = await db
        .from("autopilot_ready_rounds")
        .upsert({ user_id: client.id, round_number: round.number, plan_key: planKey, first_ready_at: now.toISOString() }, { onConflict: "user_id,round_number,plan_key", ignoreDuplicates: true });
      if (error) throw new Error(`autopilot_ready_rounds: ${error.message}`);
      round.readyAt = now.toISOString();
      summary.newlyReady += 1;
      await queueStatus(db, client.id, { kind: "next_round_prepared", roundNumber: round.number, planKey }, now);
    }
    const state = autoSendState(client, round, now, settings);
    if (state.status === "held") summary.roundsHeld += 1;
    if (state.status === "waiting") summary.roundsInWindow += 1;
    if (state.status !== "due") continue;

    // The console's own blockers first (an address that cannot be read…); then the server's gates, in send.ts.
    const plan = roundMailPlan(client, round, furnishers, now);
    if (plan.blockers.length > 0) {
      summary.roundsRefused.push({ userId: client.id, roundNumber: round.number, reason: plan.blockers.join(" ") });
      continue;
    }
    let result: SendRoundResult;
    try {
      result = await mail(db, {
        userId: client.id,
        roundNumber: round.number,
        // Recorded as sent by "sistema" (attack_rounds.sent_by_name): the activity log shows "El sistema".
        sender: { kind: "staff", name: "sistema" },
        requireAgreement: true,
        via: "mail",
        now,
        deps: { ...deps.sendDeps, sendWhatsApp: queueingWhatsApp(db, client.id, now) },
      });
    } catch (error) {
      await reportError(error, { where: "autopilot:sendRound", userId: client.id });
      result = { ok: false, status: 500, error: (error as Error).message.slice(0, 200) };
    }
    if (result.ok) {
      summary.roundsSent.push({ userId: client.id, roundNumber: round.number, letters: result.letters.length });
      await db.from("events").insert({ user_id: client.id, kind: "round_sent_automatically", payload: { roundNumber: round.number, planKey, readyAt: round.readyAt } });
    } else {
      summary.roundsRefused.push({ userId: client.id, roundNumber: round.number, reason: result.error });
    }
  }

  // 1b. Review requests: every client who reached a milestone and was never asked, whatever they think
  // of the service (src/lib/reviews/reviews.ts). Queued as status messages, so step 2 sends them under the same rules.
  try {
    summary.reviews = await runReviewRequests(db, clients, now);
  } catch (error) {
    await reportError(error, { where: "autopilot:reviews" });
  }

  // 2. Messages, on the records as they are now (the sends above queued theirs).
  if (summary.roundsSent.length > 0 || summary.newlyReady > 0 || (summary.reviews?.asked ?? 0) > 0) clients = await loadClients(db);
  for (const client of clients) {
    const plan = planDeliveries(client, now, env, deps.base);
    for (const { id, note } of plan.cancel) {
      const { data } = await db.from("outbound_messages").update({ status: "cancelled", note }).eq("id", id).eq("status", "queued").select("id");
      summary.messagesCancelled += ((data as Row[] | null) ?? []).length;
    }
    for (const reason of plan.waiting) summary.waiting[reason] += 1;
    for (const message of plan.send) {
      const outcome = await claimAndSend(db, client, message, deliver, now);
      if (outcome === "sent") summary.messagesSent += 1;
      else if (outcome === "failed") summary.messagesFailed += 1;
      else summary.duplicates += 1;
    }
  }
  return summary;
}
