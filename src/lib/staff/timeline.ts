import { nextAutomaticStep, reviewProgress } from "./stage";
import type { StaffClient } from "./types";

// A client's story in dated lines, newest first, built only from what is on
// record. The first entry is what the system will do next, when it has
// something scheduled.

export interface TimelineEntry {
  at: string;
  text: string;
  /** "upcoming": the system's next step. "client": something the client did. "team": the system or staff. */
  kind: "upcoming" | "client" | "team";
}

export function clientTimeline(client: StaffClient, now: Date): TimelineEntry[] {
  const past: TimelineEntry[] = [];
  const add = (at: string | null, text: string, kind: TimelineEntry["kind"]) => {
    if (at) past.push({ at, text, kind });
  };

  add(client.createdAt, `Primer contacto con ventas (${client.salesperson})`, "team");
  add(client.signedUpAt, "Creó su cuenta", "client");
  add(client.agreementSignedAt, "Firmó el acuerdo de servicio", "client");

  if (client.report) {
    const n = client.report.items.length;
    const pulled = new Date(client.report.pulledAt).getTime();
    // The report that brought a round's answers is told once, as the answers.
    const isResponse = client.rounds.some(
      (r) => r.respondedAt && Math.abs(new Date(r.respondedAt).getTime() - pulled) < 24 * 60 * 60 * 1000,
    );
    if (!isResponse) add(client.report.pulledAt, `Se importó su reporte (${n} ${n === 1 ? "punto" : "puntos"})`, "team");

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
    add(round.respondedAt, `Se importó el reporte nuevo, con las respuestas a la ronda ${round.number}`, "team");
  }

  for (const question of client.questions) {
    add(question.askedAt, `Preguntó: «${question.text}»`, "client");
    add(question.answeredAt, "El equipo respondió su pregunta", "team");
  }

  past.sort((a, b) => b.at.localeCompare(a.at));

  const next = nextAutomaticStep(client, now);
  return next ? [{ at: next.at, text: next.text, kind: "upcoming" }, ...past] : past;
}
