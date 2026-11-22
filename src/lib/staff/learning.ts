import { CHECK_KIND_LABEL, dataChecks, type CheckKind } from "../domain/checks";
import type { Bureau, EscalationStage, ItemCategory, NormalizedReport, ReportItem } from "../domain/types";
import { roundOutcomes, type RoundOutcome } from "../intake/outcomes";
import type { LetterItemResult } from "../intake/types";
import { getLetterMeta } from "../letters/library";
import { reasonLabel } from "../ux/disputeReason";
import { RESPONSE_WINDOW_DAYS } from "../ux/journey";
import type { StaffClient, StaffRound } from "./types";

// "Qué está funcionando": an internal learning loop on dispute outcomes.
//
// INTERNAL OPERATIONS DATA. It is shown only on the business dashboard
// (administrators), to help the team choose and word disputes better. It is
// never shown to a client, never put in a message, and never used in
// marketing: no "X% removed" anywhere a client or a prospect can read it (a
// test scans the client and marketing source for that). It describes what
// happened to past disputes; it predicts nothing about the next one, and the
// bureaus decide every result.
//
// The unit is one DISPUTE: one report item in one mailed letter. Its result is
// read from what is on record, newest evidence first:
//   1. The round's own record (StaffRound.results): the item is gone from a
//      report imported after the round → deleted, on that report's date.
//   2. A later mailed round that disputed the same item again: the item was
//      still reported when that round was written → updated if its data
//      changed between the two letters, verified otherwise.
//   3. intake/outcomes.ts roundOutcomes(): the client's newest report against
//      the letter's copy of the item, plus any bureau letters the AI intake
//      read for that item after the round was mailed.
//   4. Nothing: "waiting" inside the bureaus' 30-day window (plus mail time),
//      "no answer" after it.
// Pure: clients in, numbers out.

/** A result older than this many days after mailing is not waited for any more. */
export const NO_ANSWER_AFTER_DAYS = RESPONSE_WINDOW_DAYS + 10;

/** Cells with fewer disputes than this are hidden: too few to say anything. */
export const MIN_SAMPLE = 10;

export type DisputeResult = "deleted" | "updated" | "verified" | "other_answer" | "no_answer" | "waiting";

export interface DisputeAttempt {
  clientId: string;
  round: number;
  mailedAt: string;
  fingerprint: string;
  bureau: Bureau;
  category: ItemCategory;
  /** Who reports the item: the furnisher's name, else the creditor on the report. */
  furnisher: string;
  /** The reason the client gave; null on an answer confirmed before reasons existed. */
  reasonCode: string | null;
  templateKey: string;
  stage: EscalationStage | "personal_info_cleanup";
  /** The data checks the item had when the round was mailed (empty: none). */
  checkKinds: CheckKind[];
  result: DisputeResult;
  /** Days from mailing to the evidence of the result; null when there is none. */
  daysToResult: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isMailed(round: StaffRound): boolean {
  return Boolean(round.mailedAt) && (round.status === "mailed" || round.status === "responded");
}

const daysBetween = (from: string, to: string): number => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS));

function fromOutcome(outcome: RoundOutcome): DisputeResult {
  switch (outcome) {
    case "deleted":
    case "updated":
    case "verified":
      return outcome;
    case "pending":
      return "waiting";
    default:
      return "other_answer";
  }
}

/** Bureau letters the AI intake read for this client, as roundOutcomes takes them, with the date each was received. */
function bureauLetters(client: StaffClient): Array<{ at: string; items: LetterItemResult[] }> {
  return (client.intake ?? [])
    .filter((r) => r.kind === "bureau_letter" && r.letter && r.letter.items.length > 0)
    .map((r) => ({ at: r.letter!.letterDate ?? r.at, items: r.letter!.items }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Every dispute every mailed round made, with what is on record about its result. */
export function disputeAttempts(clients: readonly StaffClient[], now: Date): DisputeAttempt[] {
  const out: DisputeAttempt[] = [];
  for (const client of clients) {
    const rounds = client.rounds.filter(isMailed).sort((a, b) => a.number - b.number);
    const letters = bureauLetters(client);
    rounds.forEach((round, index) => {
      const mailedAt = round.mailedAt!;
      const later = rounds.slice(index + 1);
      const nextMailedAt = later[0]?.mailedAt ?? null;
      const roundItems = round.letters.flatMap((l) => l.items);
      const removed = new Map((round.results ?? []).map((r) => [r.fingerprint, r.reportDate]));

      // The checks the items had when the round went out: this round's copies,
      // with the rest of the newest report for the cross-bureau comparisons.
      const own = new Set(roundItems.map((i) => i.fingerprint));
      const pool: ReportItem[] = [...roundItems, ...(client.report?.items ?? []).filter((i) => !own.has(i.fingerprint))];
      const checks = dataChecks(pool, mailedAt);

      // Bureau letters received after this round went out, and before the next one.
      const letterResults = letters.filter((l) => l.at > mailedAt && (!nextMailedAt || l.at <= nextMailedAt));
      const after: NormalizedReport | null = client.report && client.report.pulledAt > mailedAt ? client.report : null;
      const windowEnds = new Date(mailedAt).getTime() + RESPONSE_WINDOW_DAYS * DAY_MS;

      for (const letter of round.letters) {
        for (const item of letter.items) {
          const fp = item.fingerprint;
          let result: DisputeResult;
          let evidenceAt: string | null = null;

          const laterCopy = later.flatMap((r) => r.letters.flatMap((l) => l.items)).find((i) => i.fingerprint === fp);
          if (removed.has(fp)) {
            result = "deleted";
            evidenceAt = removed.get(fp)!;
          } else if (laterCopy) {
            result = JSON.stringify(laterCopy.data) === JSON.stringify(item.data) ? "verified" : "updated";
            evidenceAt = round.respondedAt ?? (client.reportImports ?? []).find((imp) => imp.closedRound === round.number)?.reportDate ?? null;
          } else {
            const outcomes = roundOutcomes({
              before: { pulledAt: mailedAt, source: "round", items: roundItems, scores: {} },
              after,
              disputed: [fp],
              windowClosed: after ? new Date(after.pulledAt).getTime() >= windowEnds : false,
              letters: letterResults.flatMap((l) => l.items),
            });
            const found = outcomes.get(fp);
            if (found && found.outcome !== "pending") {
              result = fromOutcome(found.outcome);
              evidenceAt = found.source === "report" ? (after?.pulledAt ?? null) : (letterResults.find((l) => l.items.some((i) => i.fingerprint === fp))?.at ?? null);
            } else {
              result = now.getTime() - new Date(mailedAt).getTime() > NO_ANSWER_AFTER_DAYS * DAY_MS ? "no_answer" : "waiting";
            }
          }

          out.push({
            clientId: client.id,
            round: round.number,
            mailedAt,
            fingerprint: fp,
            bureau: item.bureau,
            category: item.category,
            furnisher: (item.furnisher?.name || item.name).trim(),
            reasonCode: letter.itemReasons?.[fp] ?? null,
            templateKey: letter.templateKey,
            stage: letter.stage,
            checkKinds: [...new Set(checks.filter((c) => c.items.includes(fp)).map((c) => c.kind))],
            result,
            daysToResult: evidenceAt && result !== "waiting" && result !== "no_answer" ? daysBetween(mailedAt, evidenceAt) : null,
          });
        }
      }
    });
  }
  return out;
}

// ── The table ───────────────────────────────────────────────────────────

export const DIMENSIONS = ["bureau", "furnisher", "reason", "template", "check"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  bureau: "Buró",
  furnisher: "Acreedor o cobrador",
  reason: "Motivo del cliente",
  template: "Carta y etapa",
  check: "Lo que mostraban los datos",
};

const BUREAU_LABEL: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

const STAGE_LABEL: Record<DisputeAttempt["stage"], string> = {
  dispute: "1.ª disputa",
  mov: "método de verificación",
  furnisher_direct: "directo al acreedor",
  personal_info_cleanup: "datos personales",
};

/** No check on the item: the baseline the check rows are read against. */
export const NO_CHECK_KEY = "none";

/** The row(s) one dispute counts in, for a dimension: [key, label]. A dispute with several checks counts once under each. */
function keysOf(attempt: DisputeAttempt, dimension: Dimension): Array<[string, string]> {
  switch (dimension) {
    case "bureau":
      return [[attempt.bureau, BUREAU_LABEL[attempt.bureau]]];
    case "furnisher":
      // Personal information is the bureau's own record: no company reports it.
      return attempt.category === "personal_info"
        ? [["personal_info", "Datos personales (los guarda el buró)"]]
        : [[attempt.furnisher.toLowerCase(), attempt.furnisher || "—"]];
    case "reason":
      return attempt.reasonCode ? [[attempt.reasonCode, reasonLabel(attempt.reasonCode, "es") ?? attempt.reasonCode]] : [["none", "Sin motivo (confirmado antes de los motivos)"]];
    case "template": {
      const title = getLetterMeta(attempt.templateKey)?.title.es ?? attempt.templateKey;
      return [[`${attempt.templateKey}|${attempt.stage}`, `${title} · ${STAGE_LABEL[attempt.stage]}`]];
    }
    case "check":
      return attempt.checkKinds.length > 0
        ? attempt.checkKinds.map((kind) => [kind, CHECK_KIND_LABEL[kind].es] as [string, string])
        : [[NO_CHECK_KEY, "Sin hallazgos en los datos"]];
  }
}

export interface OutcomeRow {
  key: string;
  label: string;
  /** Disputes mailed. */
  sent: number;
  deleted: number;
  updated: number;
  verified: number;
  /** "Frivolous", "more information", "still investigating": a bureau letter said so. */
  otherAnswer: number;
  /** Past the window with nothing on record. */
  noAnswer: number;
  /** Still inside the window. */
  waiting: number;
  /** Results on record: deleted + updated + verified + other answer. */
  recorded: number;
  /** Median days from mailing to the result, over results on record with a date; null when none. */
  medianDays: number | null;
  /** False when sent < MIN_SAMPLE: every number but `sent` is hidden. */
  enough: boolean;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One row per value of the dimension, the most disputes first. */
export function outcomeTable(attempts: readonly DisputeAttempt[], dimension: Dimension, minSample = MIN_SAMPLE): OutcomeRow[] {
  const groups = new Map<string, { label: string; attempts: DisputeAttempt[] }>();
  for (const attempt of attempts) {
    for (const [key, label] of keysOf(attempt, dimension)) {
      const group = groups.get(key) ?? { label, attempts: [] };
      group.attempts.push(attempt);
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .map(([key, { label, attempts: list }]) => {
      const count = (r: DisputeResult) => list.filter((a) => a.result === r).length;
      const deleted = count("deleted");
      const updated = count("updated");
      const verified = count("verified");
      const otherAnswer = count("other_answer");
      return {
        key,
        label,
        sent: list.length,
        deleted,
        updated,
        verified,
        otherAnswer,
        noAnswer: count("no_answer"),
        waiting: count("waiting"),
        recorded: deleted + updated + verified + otherAnswer,
        medianDays: median(list.flatMap((a) => (a.daysToResult === null ? [] : [a.daysToResult]))),
        enough: list.length >= minSample,
      };
    })
    .sort((a, b) => b.sent - a.sent || a.label.localeCompare(b.label, "es"));
}

/** The plain definitions shown under the table. */
export const OUTCOME_DEFINITIONS: Array<{ term: string; definition: string }> = [
  { term: "Disputas", definition: "Cada punto de una carta enviada cuenta una vez: un mismo punto en dos rondas cuenta dos veces. Solo entran puntos que el cliente confirmó como inexactos." },
  { term: "Borradas", definition: "Un reporte importado después del envío ya no muestra el punto. No dice por qué ni si volverá a aparecer." },
  { term: "Actualizadas", definition: "El punto sigue en el reporte, con algún dato distinto al de la carta." },
  { term: "Verificadas", definition: "El punto sigue igual en un reporte de después de los 30 días de respuesta, o en la carta de la ronda siguiente." },
  { term: "Otra respuesta", definition: "Una carta del buró, leída por la entrada automática, dijo «frívola», pidió más información o sigue investigando." },
  { term: "Sin respuesta", definition: `Pasaron más de ${NO_ANSWER_AFTER_DAYS} días desde el envío y no hay reporte ni carta que diga nada del punto.` },
  { term: "Esperando", definition: `Todavía dentro de esos ${NO_ANSWER_AFTER_DAYS} días.` },
  { term: "Mediana de días", definition: "Días desde el envío hasta el reporte o la carta que mostró el resultado; la mitad tardó menos y la mitad más." },
  { term: `Menos de ${MIN_SAMPLE}`, definition: `Con menos de ${MIN_SAMPLE} disputas en una fila no se muestran sus resultados: son muy pocas para sacar conclusiones.` },
  { term: "Lo que mostraban los datos", definition: "Los hallazgos de los datos que tenía el punto al enviarse. Un punto con dos hallazgos cuenta en las dos filas; «Sin hallazgos» es la base para comparar." },
];

// ── For the round engine, later ─────────────────────────────────────────

/**
 * An order for candidate options (letter templates, or reasons), best first,
 * from past outcomes: by the share of results on record that were deleted or
 * updated. Candidates whose row has fewer than MIN_SAMPLE disputes, or no
 * results on record, keep their given order after the ranked ones. Ties keep
 * the given order. Pure, and not used by domain/attack.ts today: the engine
 * still escalates dispute → method of verification → furnisher. It is here so
 * a later change can ask "which of these has worked better" from one place.
 */
export function escalationOrder(rows: readonly OutcomeRow[], candidates: readonly string[], minSample = MIN_SAMPLE): string[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const score = (key: string): number | null => {
    const row = byKey.get(key);
    if (!row || row.sent < minSample || row.recorded === 0) return null;
    return (row.deleted + row.updated) / row.recorded;
  };
  const ranked = candidates
    .map((key, index) => ({ key, index, score: score(key) }))
    .filter((c): c is { key: string; index: number; score: number } => c.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((c) => c.key);
  return [...ranked, ...candidates.filter((key) => !ranked.includes(key))];
}
