import { formatCents } from "../billing/rules";
import { readerLabel } from "../reports/readers";
import { displayName } from "./conversation";
import { count, longDay, shortDay } from "./format";
import { clientAgreement, nextAutomaticStep, reviewProgress } from "./stage";
import { deadlineOf } from "../agreement/gate";
import { type StaffLocale, staffLocaleFallback } from "./i18n/locale";
import type { ReportImport, StaffClient } from "./types";

// A client's story in dated lines, newest first, built only from what is on
// record. The first entry is what the system will do next, when it has
// something scheduled. Written in the console's language (English unless the
// member chose Spanish); what a client or a teammate typed is quoted as typed.

export interface TimelineEntry {
  at: string;
  text: string;
  /** "upcoming": the system's next step. "client": something the client did. "team": the system or staff. */
  kind: "upcoming" | "client" | "team";
  /** A line about money (a charge, a refund, the payment method): left out for a role without billing. */
  money?: boolean;
}

/** "Ana", or "The team"/"El equipo" when the teammate gave no name (staffAuthor signs those "equipo"). */
function teammate(by: string, locale: StaffLocale): string {
  const name = displayName(by);
  return !name || name.toLowerCase() === "equipo" ? (locale === "es" ? "El equipo" : "The team") : name;
}

/** "Visa ···· 4242". */
export function cardLabel(brand: string, last4: string): string {
  const name = brand.replace(/_/g, " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ···· ${last4}`;
}

/** "Ana importó un reporte con fecha del 20 de noviembre de 2026 (8 puntos): …" / "Ana imported a report dated November 20, 2026 (8 items): …" */
function importLine(record: ReportImport, locale: StaffLocale): string {
  const who = teammate(record.by, locale);
  if (locale === "en") {
    const changes = [
      record.removed > 0 ? count(record.removed, "item no longer shows", "items no longer show") : "",
      record.added > 0 ? count(record.added, "new item", "new items") : "",
      record.changed > 0 ? count(record.changed, "item changed", "items changed") : "",
    ].filter(Boolean);
    const what =
      record.closedRound !== null
        ? `imported the new report, with the answers to round ${record.closedRound}`
        : `imported a report dated ${longDay(record.reportDate, "en")}`;
    return `${who} ${what} (${count(record.itemCount, "item", "items")})${changes.length > 0 ? `: ${changes.join(", ")}` : ""}`;
  }
  const changes = [
    record.removed > 0 ? count(record.removed, "punto ya no aparece", "puntos ya no aparecen") : "",
    record.added > 0 ? count(record.added, "punto nuevo", "puntos nuevos") : "",
    record.changed > 0 ? count(record.changed, "punto cambió", "puntos cambiaron") : "",
  ].filter(Boolean);
  const what =
    record.closedRound !== null
      ? `importó el reporte nuevo, con las respuestas a la ronda ${record.closedRound}`
      : `importó un reporte con fecha del ${longDay(record.reportDate, "es")}`;
  return `${who} ${what} (${count(record.itemCount, "punto", "puntos")})${changes.length > 0 ? `: ${changes.join(", ")}` : ""}`;
}

export function clientTimeline(client: StaffClient, now: Date, locale: StaffLocale = staffLocaleFallback()): TimelineEntry[] {
  const es = locale === "es";
  const L = (spanish: string, english: string) => (es ? spanish : english);
  const past: TimelineEntry[] = [];
  const add = (at: string | null, text: string, kind: TimelineEntry["kind"], money = false) => {
    if (at) past.push({ at, text, kind, ...(money ? { money: true } : {}) });
  };

  add(client.createdAt, L(`Primer contacto con ventas (${client.salesperson})`, `First contact with sales (${client.salesperson})`), "team");
  add(client.signedUpAt, L("Creó su cuenta", "Created their account"), "client");
  // The acknowledgement of the disclosure statements is its own record, before the contract.
  if (client.disclosureAcknowledgedAt && client.disclosureAcknowledgedAt !== client.agreementSignedAt) {
    add(client.disclosureAcknowledgedAt, L("Recibió y confirmó la declaración de sus derechos", "Received and acknowledged the statement of their rights"), "client");
  }
  add(client.agreementSignedAt, L("Firmó el acuerdo de servicio", "Signed the service agreement"), "client");
  if (client.agreementCancelledAt) {
    add(
      client.agreementCancelledAt,
      client.cancelledWithinWindow === false
        ? L("Canceló su acuerdo, después del plazo de cancelación", "Cancelled their agreement, after the cancellation period")
        : L(
            "Canceló su acuerdo dentro del plazo de 3 días hábiles. No se le cobra ni se le envía nada",
            "Cancelled their agreement within the 3-business-day period. Nothing is charged or sent",
          ),
      "client",
    );
  }
  // The end of the cancellation window is told once it has passed, unless the client cancelled first.
  const deadline = client.agreementSignedAt ? deadlineOf(clientAgreement(client)) : null;
  if (deadline && deadline.getTime() < now.getTime() && !client.agreementCancelledAt) {
    add(deadline.toISOString(), L("Terminó su periodo de cancelación: el equipo puede empezar", "Their cancellation period ended: the team can start"), "team");
  }
  add(client.serviceEndRequestedAt ?? null, L("Pidió terminar el servicio", "Asked to end the service"), "client");

  // Reports staff brought in are told by their own record: who, when and what changed.
  const imports = client.reportImports ?? [];
  for (const record of imports) add(record.at, importLine(record, locale), "team");
  const closedByStaff = new Set(imports.flatMap((record) => (record.closedRound !== null ? [record.closedRound] : [])));

  for (const sample of client.reportSamples ?? []) {
    add(
      sample.savedAt,
      L(
        `${teammate(sample.savedBy, locale)} guardó una muestra de reporte de ${readerLabel(sample.provider)}. Todavía no hay lector para leerla`,
        `${teammate(sample.savedBy, locale)} saved a sample report from ${readerLabel(sample.provider)}. There's no reader for it yet`,
      ),
      "team",
    );
  }

  if (client.report) {
    const n = client.report.items.length;
    const pulled = new Date(client.report.pulledAt).getTime();
    // The report that brought a round's answers is told once, as the answers.
    const isResponse = client.rounds.some(
      (r) => r.respondedAt && Math.abs(new Date(r.respondedAt).getTime() - pulled) < 24 * 60 * 60 * 1000,
    );
    const importedByStaff = imports.some((record) => record.reportDate === client.report!.pulledAt);
    if (!isResponse && !importedByStaff) {
      add(client.report.pulledAt, L(`Se importó su reporte (${n} ${n === 1 ? "punto" : "puntos"})`, `Their report was imported (${n} ${n === 1 ? "item" : "items"})`), "team");
    }

    const review = reviewProgress(client);
    if (review.total > 0 && review.pending === 0) {
      const lastAnswer = client.report.items
        .map((item) => {
          const answer = client.answers[item.fingerprint];
          return answer?.status === "inaccurate" ? answer.confirmedAt : answer?.status === "correct" ? answer.answeredAt : "";
        })
        .sort()
        .at(-1);
      add(
        lastAnswer || null,
        L(
          `Terminó su revisión: ${review.inaccurate} ${review.inaccurate === 1 ? "inexacto" : "inexactos"}, ${review.correct} ${review.correct === 1 ? "correcto" : "correctos"}`,
          `Finished their review: ${review.inaccurate} inaccurate, ${review.correct} correct`,
        ),
        "client",
      );
    }
  }

  for (const round of client.rounds) {
    const letters = es ? `${round.letters.length} ${round.letters.length === 1 ? "carta" : "cartas"}` : `${round.letters.length} ${round.letters.length === 1 ? "letter" : "letters"}`;
    add(round.mailedAt, L(`Se envió la ronda ${round.number} (${letters})`, `Round ${round.number} went out (${letters})`), "team");
    if (!closedByStaff.has(round.number)) {
      add(
        round.respondedAt,
        L(`Se importó el reporte nuevo, con las respuestas a la ronda ${round.number}`, `The new report was imported, with the answers to round ${round.number}`),
        "team",
      );
    }
  }

  // Money, told by its own records: the method on file, each charge with the
  // round it paid for, a decline, a refund with its reason, a pause.
  const { paymentMethod, charges, pause } = client.billing;
  if (paymentMethod) {
    const card = cardLabel(paymentMethod.brand, paymentMethod.last4);
    add(
      paymentMethod.addedAt,
      L(`Agregó su método de pago (${card}) y aceptó la autorización de pagos`, `Added their payment method (${card}) and accepted the payment authorization`),
      "client",
      true,
    );
  }
  for (const charge of charges) {
    const amount = formatCents(charge.amountCents);
    if (charge.chargedAt) {
      add(
        charge.chargedAt,
        L(
          `Se cobró la ronda ${charge.roundNumber} (${amount}), enviada el ${shortDay(charge.workDate, "es")}`,
          `Charged for round ${charge.roundNumber} (${amount}), mailed ${shortDay(charge.workDate, "en")}`,
        ),
        "team",
        true,
      );
    } else if (charge.status === "failed" && charge.lastAttemptAt) {
      const tries = es ? (charge.attempts === 1 ? "1 intento" : `${charge.attempts} intentos`) : charge.attempts === 1 ? "1 try" : `${charge.attempts} tries`;
      add(
        charge.lastAttemptAt,
        charge.nextAttemptAt
          ? L(
              `No pasó el cobro de la ronda ${charge.roundNumber} (${amount}). Van ${tries}; el sistema lo vuelve a intentar`,
              `The round ${charge.roundNumber} charge (${amount}) didn't go through. ${tries} so far; the system will try again`,
            )
          : L(
              `No pasó el cobro de la ronda ${charge.roundNumber} (${amount}) en ${tries}. El caso quedó en pausa`,
              `The round ${charge.roundNumber} charge (${amount}) failed after ${tries}. The case is paused`,
            ),
        "team",
        true,
      );
    }
    if (charge.refund) {
      const who = teammate(charge.refund.by, locale);
      const refunded = formatCents(charge.refund.amountCents);
      add(
        charge.refund.at,
        L(
          `${who} devolvió el cobro de la ronda ${charge.roundNumber} (${refunded}): «${charge.refund.reason}»`,
          `${who} refunded the round ${charge.roundNumber} charge (${refunded}): “${charge.refund.reason}”`,
        ),
        "team",
        true,
      );
    }
  }
  if (pause) {
    const who = teammate(pause.by, locale);
    add(pause.at, L(`${who} puso los cobros en pausa: «${pause.reason}»`, `${who} paused billing: “${pause.reason}”`), "team", true);
  }

  for (const question of client.questions) {
    add(question.askedAt, L(`Preguntó: «${question.text}»`, `Asked: “${question.text}”`), "client");
    add(question.answeredAt, L("El equipo respondió su pregunta", "The team answered their question"), "team");
  }

  past.sort((a, b) => b.at.localeCompare(a.at));

  const next = nextAutomaticStep(client, now, locale);
  return next ? [{ at: next.at, text: next.text, kind: "upcoming", ...(/cobr|charge/i.test(next.text) ? { money: true } : {}) }, ...past] : past;
}
