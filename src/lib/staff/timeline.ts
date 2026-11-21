import { readerLabel } from "../reports/readers";
import { displayName } from "./conversation";
import { count, longDay } from "./format";
import { clientAgreement, nextAutomaticStep, reviewProgress } from "./stage";
import { deadlineOf } from "../agreement/gate";
import type { ReportImport, StaffClient } from "./types";

// A client's story in dated lines, newest first, built only from what is on
// record. The first entry is what the system will do next, when it has
// something scheduled.

export interface TimelineEntry {
  at: string;
  text: string;
  /** "upcoming": the system's next step. "client": something the client did. "team": the system or staff. */
  kind: "upcoming" | "client" | "team";
}

/** "Ana", or "El equipo" when the teammate gave no name (staffAuthor signs those "equipo"). */
function teammate(by: string): string {
  const name = displayName(by);
  return !name || name.toLowerCase() === "equipo" ? "El equipo" : name;
}

/** "Ana importó un reporte con fecha del 20 de noviembre de 2026 (8 puntos): …" */
function importLine(record: ReportImport): string {
  const who = teammate(record.by);
  const changes = [
    record.removed > 0 ? count(record.removed, "punto ya no aparece", "puntos ya no aparecen") : "",
    record.added > 0 ? count(record.added, "punto nuevo", "puntos nuevos") : "",
    record.changed > 0 ? count(record.changed, "punto cambió", "puntos cambiaron") : "",
  ].filter(Boolean);
  const what =
    record.closedRound !== null
      ? `importó el reporte nuevo, con las respuestas a la ronda ${record.closedRound}`
      : `importó un reporte con fecha del ${longDay(record.reportDate)}`;
  return `${who} ${what} (${count(record.itemCount, "punto", "puntos")})${changes.length > 0 ? `: ${changes.join(", ")}` : ""}`;
}

export function clientTimeline(client: StaffClient, now: Date): TimelineEntry[] {
  const past: TimelineEntry[] = [];
  const add = (at: string | null, text: string, kind: TimelineEntry["kind"]) => {
    if (at) past.push({ at, text, kind });
  };

  add(client.createdAt, `Primer contacto con ventas (${client.salesperson})`, "team");
  add(client.signedUpAt, "Creó su cuenta", "client");
  // The acknowledgement of the disclosure statements is its own record, before the contract.
  if (client.disclosureAcknowledgedAt && client.disclosureAcknowledgedAt !== client.agreementSignedAt) {
    add(client.disclosureAcknowledgedAt, "Recibió y confirmó la declaración de sus derechos", "client");
  }
  add(client.agreementSignedAt, "Firmó el acuerdo de servicio", "client");
  if (client.agreementCancelledAt) {
    add(
      client.agreementCancelledAt,
      client.cancelledWithinWindow === false
        ? "Canceló su acuerdo, después del plazo de cancelación"
        : "Canceló su acuerdo dentro del plazo de 3 días hábiles. No se le cobra ni se le envía nada",
      "client",
    );
  }
  // The end of the cancellation window is told once it has passed, unless the client cancelled first.
  const deadline = client.agreementSignedAt ? deadlineOf(clientAgreement(client)) : null;
  if (deadline && deadline.getTime() < now.getTime() && !client.agreementCancelledAt) {
    add(deadline.toISOString(), "Terminó su periodo de cancelación: el equipo puede empezar", "team");
  }
  add(client.serviceEndRequestedAt ?? null, "Pidió terminar el servicio", "client");

  // Reports staff brought in are told by their own record: who, when and what changed.
  const imports = client.reportImports ?? [];
  for (const record of imports) add(record.at, importLine(record), "team");
  const closedByStaff = new Set(imports.flatMap((record) => (record.closedRound !== null ? [record.closedRound] : [])));

  for (const sample of client.reportSamples ?? []) {
    add(
      sample.savedAt,
      `${teammate(sample.savedBy)} guardó una muestra de reporte de ${readerLabel(sample.provider)}. Todavía no hay lector para leerla`,
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
      add(client.report.pulledAt, `Se importó su reporte (${n} ${n === 1 ? "punto" : "puntos"})`, "team");
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
        `Terminó su revisión: ${review.inaccurate} ${review.inaccurate === 1 ? "inexacto" : "inexactos"}, ${review.correct} ${review.correct === 1 ? "correcto" : "correctos"}`,
        "client",
      );
    }
  }

  for (const round of client.rounds) {
    const letters = `${round.letters.length} ${round.letters.length === 1 ? "carta" : "cartas"}`;
    add(round.mailedAt, `Se envió la ronda ${round.number} (${letters})`, "team");
    if (!closedByStaff.has(round.number)) {
      add(round.respondedAt, `Se importó el reporte nuevo, con las respuestas a la ronda ${round.number}`, "team");
    }
  }

  for (const question of client.questions) {
    add(question.askedAt, `Preguntó: «${question.text}»`, "client");
    add(question.answeredAt, "El equipo respondió su pregunta", "team");
  }

  past.sort((a, b) => b.at.localeCompare(a.at));

  const next = nextAutomaticStep(client, now);
  return next ? [{ at: next.at, text: next.text, kind: "upcoming" }, ...past] : past;
}
