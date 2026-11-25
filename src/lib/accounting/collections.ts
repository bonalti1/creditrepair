import { clientTimeZone, isQuietHour } from "../autopilot/clock";
import { MAX_AUTOMATIC_ATTEMPTS, paymentFailedBody } from "../billing/dunning";
import { BRAND } from "../brand";
import { clientLanguage } from "../staff/i18n/locale";
import { whatsappHref } from "../staff/messages";
import { fullName, type StaffClient } from "../staff/types";
import type { ChargeFact } from "./facts";
import { daysBetween, dayOf } from "./periods";
import type { Bilingual, CollectionAction, CollectionActionKind } from "./types";

// Collections: a plain list of payments that did not go through, and what a
// person may do about each one. The rules:
//
//   - Only charges that exist are here, and a charge exists only for work
//     already done after the cancellation window (the database refuses any
//     other: BILLING.md). Nothing is ever asked for work not yet done.
//   - The system already retries a declined card twice and tells the client
//     each time with the "Update my card" link (billing/dunning.ts). A person
//     comes in after that, or when the client writes.
//   - Reminders go by WhatsApp or email, written by the console in the
//     client's language and SENT BY THE PERSON (a wa.me link or an email
//     draft). Never SMS: there is no SMS option here or in the database.
//   - Not while the client has asked for no messages (BAJA / STOP), not in
//     quiet hours on the client's clock (9 p.m. – 8 a.m.), at most one
//     reminder every 3 days per charge, and never after the client cancelled
//     or asked to end the service (an administrator decides those).
//   - No late fees, no threats, no collection agency, nothing reported
//     anywhere. Any next step (wait, pause billing, write off) is a person's
//     decision, recorded with a note.

export const QUIET = { quietStartHour: 21, quietEndHour: 8 };
export const REMINDER_GAP_DAYS = 3;

export type Standing = "processing" | "retrying" | "needs_person" | "written_off";

export const STANDING_LABEL: Record<Standing, Bilingual> = {
  processing: { en: "Processing", es: "En proceso" },
  retrying: { en: "The system will retry", es: "El sistema lo reintentará" },
  needs_person: { en: "Retries used up: needs a person", es: "Reintentos agotados: necesita a una persona" },
  written_off: { en: "Written off", es: "Dado de baja" },
};

export type Block = "opted_out" | "cancelled" | "service_end" | "quiet_hours" | "recent_reminder" | "no_email";

export const BLOCK_TEXT: Record<Block, Bilingual> = {
  opted_out: { en: "The client asked for no messages (STOP). Don't send reminders; they can still write to us.", es: "El cliente pidió no recibir mensajes (BAJA). No envíes recordatorios; puede seguir escribiéndonos." },
  cancelled: { en: "The client cancelled the agreement. An administrator decides what happens with this charge.", es: "El cliente canceló el acuerdo. Un administrador decide qué pasa con este cobro." },
  service_end: { en: "The client asked to end the service. Talk to an administrator before any reminder.", es: "El cliente pidió terminar el servicio. Habla con un administrador antes de cualquier recordatorio." },
  quiet_hours: { en: "It's quiet hours on the client's clock (9 p.m. – 8 a.m.). Send it after 8 a.m. their time.", es: "Es horario de descanso en la hora del cliente (9 p. m. – 8 a. m.). Envíalo después de las 8 a. m. de su hora." },
  recent_reminder: { en: "A reminder went out less than 3 days ago.", es: "Se envió un recordatorio hace menos de 3 días." },
  no_email: { en: "No email on file.", es: "No hay correo registrado." },
};

export interface CollectionItem {
  fact: ChargeFact;
  client: StaffClient | null;
  standing: Standing;
  /** Days since the first decline (or since the charge, while processing). */
  daysOverdue: number;
  actions: CollectionAction[];
  lastReminderAt: string | null;
  /** Why a WhatsApp reminder can't go now (empty: it can). */
  whatsappBlocks: Block[];
  emailBlocks: Block[];
}

export function standingOf(fact: ChargeFact, writtenOff: boolean): Standing {
  if (writtenOff) return "written_off";
  if (fact.charge.status === "pending") return "processing";
  return fact.charge.nextAttemptAt && fact.charge.attempts < MAX_AUTOMATIC_ATTEMPTS ? "retrying" : "needs_person";
}

export function collectionItems(facts: readonly ChargeFact[], clients: readonly StaffClient[], actions: readonly CollectionAction[], now: Date): CollectionItem[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const today = dayOf(now);
  return facts
    .filter((f) => !f.test && (f.charge.status === "failed" || (f.charge.status === "pending" && daysBetween(f.charge.createdAt, today) >= 2)))
    .map((fact): CollectionItem => {
      const client = byId.get(fact.clientId) ?? null;
      const mine = actions.filter((a) => a.chargeId === fact.id).sort((a, b) => a.at.localeCompare(b.at));
      const writtenOff = mine.some((a) => a.kind === "decided_write_off");
      const lastReminderAt = mine.filter((a) => a.kind === "reminder_whatsapp" || a.kind === "reminder_email").at(-1)?.at ?? null;
      const common: Block[] = [];
      if (client?.optOut) common.push("opted_out");
      if (client?.agreementCancelledAt) common.push("cancelled");
      if (client?.serviceEndRequestedAt) common.push("service_end");
      if (lastReminderAt && (now.getTime() - Date.parse(lastReminderAt)) / 86_400_000 < REMINDER_GAP_DAYS) common.push("recent_reminder");
      const quiet = isQuietHour(now, clientTimeZone(client?.state), QUIET) ? (["quiet_hours"] as Block[]) : [];
      const since = fact.charge.status === "failed" ? (fact.charge.lastAttemptAt ?? fact.charge.createdAt) : fact.charge.createdAt;
      return {
        fact,
        client,
        standing: standingOf(fact, writtenOff),
        daysOverdue: Math.max(0, daysBetween(since, today)),
        actions: mine,
        lastReminderAt,
        whatsappBlocks: [...common, ...quiet],
        emailBlocks: [...common, ...(client?.email ? [] : (["no_email"] as Block[]))],
      };
    })
    .sort((a, b) => Number(a.standing === "written_off") - Number(b.standing === "written_off") || b.daysOverdue - a.daysOverdue);
}

/** The reminder in the client's language: the same plain words the automatic notice uses. */
export function reminderText(client: StaffClient, fact: ChargeFact): { language: "en" | "es"; subject: string; body: string } {
  const language = clientLanguage(client);
  const greeting = language === "en" ? `Hi ${client.firstName}, this is the ${BRAND.name} team.` : `Hola ${client.firstName}, te escribe el equipo de ${BRAND.name}.`;
  const body = `${greeting} ${paymentFailedBody(fact.charge)[language]}`;
  const subject = language === "en" ? `${BRAND.name}: a payment didn't go through` : `${BRAND.name}: un pago no pasó`;
  return { language, subject, body };
}

export function reminderLinks(client: StaffClient, fact: ChargeFact): { whatsapp: string; email: string | null } {
  const { subject, body } = reminderText(client, fact);
  return {
    whatsapp: whatsappHref(client.phone, body),
    email: client.email ? `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null,
  };
}

/** Whether a person may record this step now. Reminders follow the blocks above; the decisions are always a person's. */
export function mayRecord(item: CollectionItem, kind: CollectionActionKind): { ok: true } | { ok: false; reasons: Block[] } {
  if (kind === "reminder_whatsapp") return item.whatsappBlocks.length ? { ok: false, reasons: item.whatsappBlocks } : { ok: true };
  if (kind === "reminder_email") return item.emailBlocks.length ? { ok: false, reasons: item.emailBlocks } : { ok: true };
  return { ok: true };
}

export const ACTION_LABEL: Record<CollectionActionKind, Bilingual> = {
  reminder_whatsapp: { en: "WhatsApp reminder sent", es: "Recordatorio por WhatsApp enviado" },
  reminder_email: { en: "Email reminder sent", es: "Recordatorio por correo enviado" },
  called: { en: "Called the client", es: "Se llamó al cliente" },
  note: { en: "Note", es: "Nota" },
  decided_wait: { en: "Decided: wait", es: "Decisión: esperar" },
  decided_write_off: { en: "Decided: write off (stop asking)", es: "Decisión: dar de baja (dejar de pedirlo)" },
  decided_pause: { en: "Decided: pause billing (from the client page)", es: "Decisión: pausar cobros (desde la página del cliente)" },
};

export { fullName };
