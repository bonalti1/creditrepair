import { casePausedForPayment, unpaidCharge } from "../billing/dunning";
import { REQUIRED_DOCUMENTS, type StaffClient } from "../staff/types";

// Stage updates the app sends back to HighLevel, so marketing's pipeline
// follows the person after sales hands them to the app.
//
// What is sent is deliberately thin (stagePayload): the HighLevel contact id
// when known, the phone, the stage, its date and the event's id. No name, no
// email, nothing from the credit file (no report, items, scores, letters),
// and no amounts: marketing needs none of it. The database refuses any other
// key on the way into the outbox (migration 0017, integration_outbox_guard).

export const HL_STAGES = [
  "invited",
  "agreement_signed",
  "cancelled_in_window",
  "documents_complete",
  "first_round_mailed",
  "paused_for_payment",
  "service_ended",
] as const;

export type HlStage = (typeof HL_STAGES)[number];

/** The stage names, exactly as the suggested HighLevel pipeline names them (docs/HIGHLEVEL.md). */
export const HL_STAGE_LABEL: Record<HlStage, string> = {
  invited: "Invitado",
  agreement_signed: "Firmó acuerdo",
  cancelled_in_window: "Canceló en su plazo",
  documents_complete: "Documentos completos",
  first_round_mailed: "Primera ronda enviada",
  paused_for_payment: "En pausa por pago",
  service_ended: "Terminó el servicio",
};

/** Exactly what one event carries. Nothing else may be added (the database checks it too). */
export interface StagePayload {
  event: "credalti.stage_changed";
  /** The outbox dedupe key: HighLevel can ignore a repeat with the same id. */
  eventId: string;
  /** HighLevel's contact id, when the person came from HighLevel or was matched to a contact. */
  contactId: string | null;
  /** E.164. HighLevel matches the contact by phone when there is no contact id. */
  phone: string;
  stage: HlStage;
  stageLabel: string;
  /** ISO timestamp of when the stage was reached (or, where the records keep no date, first noticed). */
  occurredAt: string;
  source: "credalti";
  /** One line, for a Slack or n8n webhook used as the fallback destination (SALES_WEBHOOK_URL). */
  text: string;
}

export const STAGE_PAYLOAD_KEYS: readonly (keyof StagePayload)[] = ["event", "eventId", "contactId", "phone", "stage", "stageLabel", "occurredAt", "source", "text"];

export interface StageEvent {
  dedupeKey: string;
  stage: HlStage;
  occurredAt: string;
  phone: string;
  contactId: string | null;
}

export function stagePayload(event: StageEvent): StagePayload {
  const label = HL_STAGE_LABEL[event.stage];
  return {
    event: "credalti.stage_changed",
    eventId: event.dedupeKey,
    contactId: event.contactId,
    phone: event.phone,
    stage: event.stage,
    stageLabel: label,
    occurredAt: event.occurredAt,
    source: "credalti",
    text: `Credalti · ${event.phone} · ${label}`,
  };
}

/** The key that makes "the same stage of the same person" one event, across prospect → client. */
export function stageDedupeKey(phone: string, stage: HlStage, extra?: string): string {
  return `${phone}:${stage}${extra ? `:${extra}` : ""}`;
}

/**
 * Events are derived from the records each time the sync runs, and only those
 * reached in the last few days are queued: turning the sync on does not send
 * a client's whole history, and a missed run is caught up by the next one.
 */
export const SYNC_LOOKBACK_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The stages this person has reached, as events. Pure: from the console's
 * client record (the same one every screen reads) and the time.
 *
 * Where the records keep no date for a stage (documents complete, paused for a
 * payment) the event is dated `now` and is only produced while the client has
 * had activity inside the lookback window.
 */
export function clientStageEvents(client: StaffClient, now: Date, lookbackDays = SYNC_LOOKBACK_DAYS): StageEvent[] {
  const phone = client.phone;
  if (!/^\+1\d{10}$/.test(phone)) return [];
  const contactId = client.leadSource?.highlevelContactId ?? null;
  const since = now.getTime() - lookbackDays * DAY_MS;
  const recent = (iso: string | null | undefined): iso is string => Boolean(iso) && new Date(iso!).getTime() >= since && new Date(iso!).getTime() <= now.getTime() + 60_000;
  const events: StageEvent[] = [];
  const add = (stage: HlStage, at: string, extra?: string) =>
    events.push({ dedupeKey: stageDedupeKey(phone, stage, extra), stage, occurredAt: new Date(at).toISOString(), phone, contactId });

  const invitedAt = client.leadSource?.invitedAt;
  if (recent(invitedAt)) add("invited", invitedAt);
  if (recent(client.agreementSignedAt)) add("agreement_signed", client.agreementSignedAt);

  const cancelledAt = client.agreementCancelledAt;
  if (recent(cancelledAt)) {
    if (client.cancelledWithinWindow === false) add("service_ended", cancelledAt);
    else add("cancelled_in_window", cancelledAt);
  }
  if (recent(client.serviceEndRequestedAt)) add("service_ended", client.serviceEndRequestedAt);

  const active = recent(client.lastActivityAt);
  const ended = Boolean(client.agreementCancelledAt || client.serviceEndRequestedAt);
  if (active && client.agreementSignedAt && !ended && REQUIRED_DOCUMENTS.every((d) => client.documents.includes(d))) {
    add("documents_complete", now.toISOString());
  }

  const first = client.rounds.find((r) => r.number === 1 && r.mailedAt && (r.status === "mailed" || r.status === "responded"));
  if (first && recent(first.mailedAt)) add("first_round_mailed", first.mailedAt!);

  if (active && !ended && casePausedForPayment(client.billing)) {
    // Once per unpaid charge: a later, different missed payment is a new pause.
    add("paused_for_payment", now.toISOString(), unpaidCharge(client.billing)?.id ?? "x");
  }
  // One event per key, in case two records name the same stage.
  return events.filter((e, i) => events.findIndex((o) => o.dedupeKey === e.dedupeKey) === i);
}

// ── Delivery ────────────────────────────────────────────────────────────

/** After this many failed attempts the event is given up (and stays on record). */
export const MAX_ATTEMPTS = 8;

/** When to try again after `attempts` failed tries: 5, 10, 20, 40 minutes… capped at 12 hours. */
export function nextAttemptAt(attempts: number, now: Date): Date {
  const minutes = Math.min(5 * 2 ** Math.max(0, attempts - 1), 12 * 60);
  return new Date(now.getTime() + minutes * 60_000);
}

/** Where events go: HIGHLEVEL_INBOUND_WEBHOOK_URL, else SALES_WEBHOOK_URL, else nowhere. */
export function stageWebhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.HIGHLEVEL_INBOUND_WEBHOOK_URL || env.SALES_WEBHOOK_URL || "";
  return /^https:\/\//.test(url) ? url : null;
}

export type Sender = (url: string, payload: StagePayload) => Promise<{ ok: boolean; error?: string }>;

/** POST the payload as JSON. A 2xx answer is delivered; anything else is retried later. */
export const postStage: Sender = async (url, payload) => {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: (error as Error).name || "network error" };
  }
};
