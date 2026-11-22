import { appLink, renderTemplate, STATUS_TEMPLATES, type MessageTemplate } from "./templates";
import type { MessageLocale, StatusKind } from "./types";

// The moments the client is told about by themselves: letters mailed, a
// certified letter delivered, a new report and what it shows, the next round
// prepared, a payment receipt. Each is a fact already on record; nothing here
// mentions a score, predicts a result or asks the client to decide quickly
// (docs/BRAND.md). "Ya no aparece en tu reporte" is the only thing said about
// what a report shows, always with "los resultados varían".
//
// A status message is queued where the fact is recorded (rounds/send.ts, the
// mail webhook, the report import, the billing run, the autopilot run) and
// sent by the next autopilot run, under the same rules as every automatic
// message: opt-out, quiet hours, the daily cap, the WhatsApp window.

export type StatusEvent =
  | { kind: "letters_mailed"; roundNumber: number; letterCount: number }
  | { kind: "certified_delivered"; letterId: string; recipient: string; deliveredAt: string }
  | { kind: "report_changes"; pullId: string; goneCount: number }
  | { kind: "next_round_prepared"; roundNumber: number; planKey: string }
  | {
      kind: "payment_receipt";
      chargeId: string;
      receiptNumber: string;
      amount: string;
      date: Record<MessageLocale, string>;
      work: Record<MessageLocale, string>;
    };

export interface StatusMessage {
  dedupeKey: string;
  topic: StatusKind;
  locale: MessageLocale;
  template: MessageTemplate;
  params: string[];
  body: string;
  link: string;
}

const PATH: Record<StatusKind, string> = {
  letters_mailed: "/rounds",
  certified_delivered: "/rounds",
  report_changes: "/rounds",
  next_round_prepared: "/rounds",
  payment_receipt: "/pagos",
};

function longDay(iso: string, locale: MessageLocale): string {
  return new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long", timeZone: "America/Chicago" });
}

/** The one key that makes this message once, whatever retries the run makes. */
export function statusDedupeKey(userId: string, event: StatusEvent): string {
  switch (event.kind) {
    case "letters_mailed":
      return `status:${userId}:letters_mailed:r${event.roundNumber}`;
    case "certified_delivered":
      return `status:${userId}:certified_delivered:${event.letterId}`;
    case "report_changes":
      return `status:${userId}:report:${event.pullId}`;
    case "next_round_prepared":
      return `status:${userId}:next_round:r${event.roundNumber}:${event.planKey}`;
    case "payment_receipt":
      return `status:${userId}:receipt:${event.chargeId}`;
  }
}

export function statusMessage(userId: string, firstName: string, locale: MessageLocale, event: StatusEvent, base?: string): StatusMessage {
  const link = appLink(PATH[event.kind], base);
  const name = firstName.trim() || (locale === "es" ? "hola" : "there");
  let template: MessageTemplate;
  let params: string[];
  switch (event.kind) {
    case "letters_mailed": {
      const n = event.letterCount;
      const letters = locale === "es" ? (n === 1 ? "la carta" : `las ${n} cartas`) : n === 1 ? "the letter" : `the ${n} letters`;
      template = STATUS_TEMPLATES.letters_mailed;
      params = [name, letters, String(event.roundNumber), link];
      break;
    }
    case "certified_delivered":
      template = STATUS_TEMPLATES.certified_delivered;
      params = [name, event.recipient, longDay(event.deliveredAt, locale), link];
      break;
    case "report_changes": {
      const n = event.goneCount;
      if (n > 0) {
        const change =
          locale === "es"
            ? n === 1
              ? "1 de los puntos que nos indicaste ya no aparece en tu reporte"
              : `${n} de los puntos que nos indicaste ya no aparecen en tu reporte`
            : n === 1
              ? "1 of the items you pointed out no longer appears on your report"
              : `${n} of the items you pointed out no longer appear on your report`;
        template = STATUS_TEMPLATES.report_changes;
        params = [name, change, link];
      } else {
        template = STATUS_TEMPLATES.report_new;
        params = [name, link];
      }
      break;
    }
    case "next_round_prepared":
      template = STATUS_TEMPLATES.next_round_prepared;
      params = [name, String(event.roundNumber), link];
      break;
    case "payment_receipt":
      template = STATUS_TEMPLATES.payment_receipt;
      params = [name, event.receiptNumber, event.amount, event.date[locale], event.work[locale], link];
      break;
  }
  return { dedupeKey: statusDedupeKey(userId, event), topic: event.kind, locale, template, params, body: renderTemplate(template, locale, params), link };
}

/** How long a queued status message may wait for a channel before it is dropped: old news is not sent. */
export const STATUS_EXPIRY_DAYS = 3;
