import { diffReports, diffSummary, type ReportDiff } from "../domain/diff";
import { parseReport, type RawReport } from "../domain/parser";
import type { Bureau, ItemCategory, NormalizedReport, ReportItem } from "../domain/types";
import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import {
  addDays,
  clientStage,
  daysSince,
  formatDay,
  nextStep,
  RESPONSE_WINDOW_DAYS,
  type NextStep,
  type Stage,
} from "../staff/stage";
import { count, longDay } from "../staff/format";
import type { ReportImport, RoundResult, StaffClient, StaffRound } from "../staff/types";
import { itemFacts } from "../ux/itemDisplay";

// Bringing a report into a client's record, in two steps that share one plan:
//
//   importPreview — what the report holds and what saving it would change,
//                   shown to staff BEFORE anything is saved;
//   mergeReport   — the client record after saving it.
//
// Both are pure: a client, a report in the app's own format and a time go in,
// and nothing outside is touched. The staff data layer calls mergeReport; the
// import screen calls importPreview.
//
// What an import never does: it never writes a client's answer. Answers are
// matched to items by fingerprint, so an item that is still on the report
// keeps what the client said about it, a new item has no answer (it waits for
// the client's review), and nothing here can mark an item as inaccurate.

export const BUREAU_ORDER: readonly Bureau[] = ["equifax", "experian", "transunion"];
export const BUREAU_NAME: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

const DAY_MS = 24 * 60 * 60 * 1000;

// ── The plan ────────────────────────────────────────────────────────────

export interface ImportPlan {
  /** The report as it would be saved. */
  report: NormalizedReport;
  /** The report it replaces; null on a first report. */
  previous: NormalizedReport | null;
  /** Against `previous`; null on a first report. */
  diff: ReportDiff | null;
  /** Why this report must not be saved, in plain Spanish; null when it may. */
  blocked: string | null;
  /**
   * The mailed round this report says something about: its date is after the
   * round went out. `removed` are the round's items the report no longer
   * lists (not counting ones already recorded). `closes` is true when the
   * round is still waiting and the report is dated after the response window:
   * that report carries the bureaus' answers.
   */
  round: { number: number; mailedAt: string; windowEnds: string; closes: boolean; removed: ReportItem[] } | null;
  /**
   * A prepared round that has not been mailed and covers an item this report
   * removes or changes. Its letters were written from the old report, so it
   * goes back to "draft" until they are prepared again.
   */
  resetRound: number | null;
}

function coveredFingerprints(round: StaffRound): Set<string> {
  return new Set(round.letters.flatMap((letter) => letter.items.map((item) => item.fingerprint)));
}

/**
 * Decide what importing `raw` into `client` at time `at` (ISO) would do.
 * Changes nothing. `blocked` is written for staff in `locale` (Spanish when
 * left out, as the save paths have always thrown it).
 */
export function planImport(client: StaffClient, raw: RawReport, at: string, locale: "es" | "en" = "es"): ImportPlan {
  const en = locale === "en";
  const parsed = parseReport(raw);
  const now = new Date(at).getTime();
  const pulled = new Date(parsed.pulledAt).getTime();
  // A report dated a few hours ahead is a clock or time-zone difference: it
  // counts as dated now. A report cannot be older than the day it was pulled.
  const report: NormalizedReport = pulled > now && pulled - now <= DAY_MS ? { ...parsed, pulledAt: at } : parsed;
  const previous = client.report;
  const diff = previous ? diffReports(previous, report) : null;

  let blocked: string | null = null;
  if (Number.isNaN(pulled)) {
    blocked = en ? "The report's date can't be read." : "La fecha del reporte no se puede leer.";
  } else if (pulled - now > DAY_MS) {
    blocked = en
      ? `The report's date (${longDay(parsed.pulledAt, "en")}) is in the future. Check “pulledAt”.`
      : `La fecha del reporte (${longDay(parsed.pulledAt)}) está en el futuro. Revisa «pulledAt».`;
  } else if (previous && pulled < new Date(previous.pulledAt).getTime()) {
    blocked = en
      ? `This report is from ${longDay(report.pulledAt, "en")}, older than the one already on file (${longDay(previous.pulledAt, "en")}). An old report isn't saved over a newer one.`
      : `Este reporte es del ${longDay(report.pulledAt)}, más antiguo que el que ya está en archivo (${longDay(previous.pulledAt)}). No se guarda un reporte viejo encima de uno más nuevo.`;
  } else if (previous) {
    // A report that leaves out a whole bureau says nothing about that bureau.
    // Saving it would make every item there look removed.
    const missing = BUREAU_ORDER.filter(
      (bureau) => !raw.bureaus[bureau] && previous.items.some((item) => item.bureau === bureau),
    );
    if (missing.length > 0) {
      const names = missing.map((bureau) => BUREAU_NAME[bureau]).join(en ? " and " : " y ");
      const lost = previous.items.filter((item) => missing.includes(item.bureau)).length;
      blocked = en
        ? `This report doesn't include ${names} and the report on file does. Saving it would make it look like ${count(lost, "item", "items")} from ${names} disappeared, without the report saying so. A report with the same bureaus is needed.`
        : `Este reporte no trae ${names} y el reporte en archivo sí. Guardarlo haría parecer que ${count(lost, "punto", "puntos")} de ${names} ${lost === 1 ? "desapareció" : "desaparecieron"}, sin que el reporte lo diga. Hace falta un reporte con los mismos burós.`;
    }
  }

  const reportTime = new Date(report.pulledAt).getTime();
  const mailedRounds = client.rounds
    .filter((r) => r.mailedAt && (r.status === "mailed" || r.status === "responded") && new Date(r.mailedAt).getTime() <= now)
    .sort((a, b) => b.number - a.number);
  const newest = mailedRounds[0];

  let round: ImportPlan["round"] = null;
  if (newest?.mailedAt && diff && reportTime > new Date(newest.mailedAt).getTime()) {
    const covered = coveredFingerprints(newest);
    const recorded = new Set((newest.results ?? []).map((result) => result.fingerprint));
    const windowEnds = addDays(newest.mailedAt, RESPONSE_WINDOW_DAYS);
    round = {
      number: newest.number,
      mailedAt: newest.mailedAt,
      windowEnds: windowEnds.toISOString(),
      closes: newest.status === "mailed" && reportTime >= windowEnds.getTime(),
      removed: diff.deleted.filter((item) => covered.has(item.fingerprint) && !recorded.has(item.fingerprint)),
    };
  }

  let resetRound: number | null = null;
  if (diff) {
    const touched = new Set([...diff.deleted, ...diff.changed].map((item) => item.fingerprint));
    const unsent = client.rounds.find((r) => r.status === "ready" && [...coveredFingerprints(r)].some((fp) => touched.has(fp)));
    resetRound = unsent?.number ?? null;
  }

  return { report, previous, diff, blocked, round, resetRound };
}

// ── Saving ──────────────────────────────────────────────────────────────

export interface ImportMeta {
  /** When it is saved (ISO). */
  at: string;
  /** The teammate saving it. */
  by: string;
  /** The reader that read it (readers.ts). */
  readerKey: string;
}

/**
 * The client record after this report is saved. Returns a new object; the
 * client passed in is not changed. Throws when the plan says the report must
 * not be saved (see ImportPlan.blocked).
 *
 * - The report and its date replace the old ones.
 * - Answers are carried over untouched. They are keyed by fingerprint, so an
 *   item still on the report keeps its answer and a new item has none.
 * - Items a mailed round disputed that are gone from the report are recorded
 *   on that round as results. A report dated after the round's response window
 *   also closes the round ("responded").
 * - A prepared, unsent round whose items changed goes back to "draft".
 * - The import is added to the client's history.
 */
export function mergeReport(client: StaffClient, raw: RawReport, meta: ImportMeta): StaffClient {
  const plan = planImport(client, raw, meta.at);
  if (plan.blocked) throw new Error(plan.blocked);

  const rounds = client.rounds.map((round): StaffRound => {
    if (plan.round && round.number === plan.round.number) {
      const added: RoundResult[] = plan.round.removed.map((item) => ({
        fingerprint: item.fingerprint,
        outcome: "removed",
        reportDate: plan.report.pulledAt,
      }));
      const results = [...(round.results ?? []), ...added];
      return {
        ...round,
        ...(results.length > 0 ? { results } : {}),
        ...(plan.round.closes ? { status: "responded" as const, respondedAt: meta.at } : {}),
      };
    }
    if (round.number === plan.resetRound) return { ...round, status: "draft" };
    return round;
  });

  const record: ReportImport = {
    at: meta.at,
    by: meta.by,
    readerKey: meta.readerKey,
    reportDate: plan.report.pulledAt,
    itemCount: plan.report.items.length,
    removed: plan.diff?.deleted.length ?? 0,
    added: plan.diff?.added.length ?? 0,
    changed: plan.diff?.changed.length ?? 0,
    closedRound: plan.round?.closes ? plan.round.number : null,
  };

  return {
    ...client,
    report: plan.report,
    rounds,
    reportImports: [...(client.reportImports ?? []), record],
  };
}

// ── The preview ─────────────────────────────────────────────────────────

export interface BureauSummary {
  bureau: Bureau;
  /** Null when the report gives no score for this bureau. */
  score: number | null;
  total: number;
  /** Items the parser's heuristic sees as negative. A reading aid, not a judgement. */
  negative: number;
  byCategory: Record<ItemCategory, number>;
}

export interface ChangedItem {
  item: ReportItem;
  /** "Saldo: $1,250 → $900", one line per fact that differs. */
  differences: string[];
}

export interface ImportPreview {
  /** The report's own date (ISO). */
  reportDate: string;
  /** Whole days from the report's date to now. */
  ageDays: number;
  total: number;
  negative: number;
  byCategory: Record<ItemCategory, number>;
  /** One entry per bureau the report covers, in the usual order. */
  bureaus: BureauSummary[];
  /** Why it cannot be saved; null when it can. */
  blocked: string | null;
  /** Against the report on file; null when this is the client's first. */
  comparison: {
    previousDate: string;
    /** Items of the old report this one no longer lists. `inRound` is the mailed round that disputed it, if any. */
    removed: Array<{ item: ReportItem; inRound: number | null }>;
    added: ReportItem[];
    changed: ChangedItem[];
    unchanged: number;
    /** Negative items gone, and negative items still on the report. */
    removedNegative: number;
    remainingNegative: number;
    /** Scores that differ between the two reports. */
    scores: Array<{ bureau: Bureau; from: number | null; to: number | null }>;
  } | null;
  /** What saving does, one plain sentence each (in the console's language). Empty when blocked. */
  effects: string[];
  /** Things staff should know before saving that do not stop it. */
  notes: string[];
  /** Where the client stands before and after saving; null when blocked. */
  after: { stageBefore: Stage; stageAfter: Stage; next: NextStep } | null;
}

function emptyCategoryCount(): Record<ItemCategory, number> {
  return { tradeline: 0, inquiry: 0, public_record: 0, personal_info: 0 };
}

/** What differs between two versions of one item, in the words the client page already uses for its facts. */
function itemDifferences(previous: ReportItem, current: ReportItem, locale: "es" | "en"): string[] {
  const before = new Map(itemFacts(previous, locale).map((fact) => [fact.label, fact.value]));
  const after = new Map(itemFacts(current, locale).map((fact) => [fact.label, fact.value]));
  const labels = [...new Set([...before.keys(), ...after.keys()])];
  const none = locale === "en" ? "no data" : "sin dato";
  const lines = labels
    .filter((label) => before.get(label) !== after.get(label))
    .map((label) => `${label}: ${before.get(label) ?? none} → ${after.get(label) ?? none}`);
  return lines.length > 0 ? lines : [locale === "en" ? "A detail the item card doesn't show changed." : "Cambió un dato que la ficha no muestra."];
}

/**
 * Everything the import screen shows before saving: what the report holds,
 * what changed against the one on file, and what saving it would do.
 */
export function importPreview(client: StaffClient, raw: RawReport, at: string, locale: "es" | "en" = "es"): ImportPreview {
  const plan = planImport(client, raw, at, locale);
  const { report, previous, diff } = plan;
  const now = new Date(at);
  const en = locale === "en";
  const L = (spanish: string, english: string) => (en ? english : spanish);

  const byCategory = emptyCategoryCount();
  for (const item of report.items) byCategory[item.category] += 1;

  const bureaus: BureauSummary[] = BUREAU_ORDER.filter((bureau) => raw.bureaus[bureau]).map((bureau) => {
    const items = report.items.filter((item) => item.bureau === bureau);
    const categories = emptyCategoryCount();
    for (const item of items) categories[item.category] += 1;
    return {
      bureau,
      score: report.scores[bureau] ?? null,
      total: items.length,
      negative: items.filter((item) => item.negative).length,
      byCategory: categories,
    };
  });

  const ageDays = Math.max(0, daysSince(report.pulledAt, now));
  const notes: string[] = [];
  const absent = BUREAU_ORDER.filter((bureau) => !raw.bureaus[bureau]);
  if (absent.length > 0 && absent.length < BUREAU_ORDER.length) {
    notes.push(
      L(
        `Este reporte no trae ${absent.map((bureau) => BUREAU_NAME[bureau]).join(" ni ")}.`,
        `This report doesn't include ${absent.map((bureau) => BUREAU_NAME[bureau]).join(" or ")}.`,
      ),
    );
  }
  if (report.items.length === 0) notes.push(L("Este reporte no trae ningún punto.", "This report has no items."));
  if (ageDays > FRESH_REPORT_DAYS) {
    notes.push(
      L(
        `Este reporte tiene ${ageDays} días. Con un reporte de más de ${FRESH_REPORT_DAYS} días no se envían cartas: hará falta uno más reciente.`,
        `This report is ${ageDays} days old. No letters go out on a report more than ${FRESH_REPORT_DAYS} days old: a more recent one will be needed.`,
      ),
    );
  }

  let comparison: ImportPreview["comparison"] = null;
  if (previous && diff) {
    const previousByFingerprint = new Map(previous.items.map((item) => [item.fingerprint, item]));
    const disputedIn = new Map<string, number>();
    for (const round of [...client.rounds].sort((a, b) => a.number - b.number)) {
      if (!round.mailedAt) continue;
      for (const fingerprint of coveredFingerprints(round)) disputedIn.set(fingerprint, round.number);
    }
    const summary = diffSummary(diff);
    comparison = {
      previousDate: previous.pulledAt,
      removed: diff.deleted.map((item) => ({ item, inRound: disputedIn.get(item.fingerprint) ?? null })),
      added: diff.added,
      changed: diff.changed.map((item) => ({
        item,
        differences: itemDifferences(previousByFingerprint.get(item.fingerprint)!, item, locale),
      })),
      unchanged: diff.unchanged.length,
      removedNegative: summary.deletedCount,
      remainingNegative: summary.remainingNegative,
      scores: BUREAU_ORDER.flatMap((bureau) => {
        const from = previous.scores[bureau] ?? null;
        const to = report.scores[bureau] ?? null;
        return from === to ? [] : [{ bureau, from, to }];
      }),
    };
  }

  if (plan.blocked) {
    return {
      reportDate: report.pulledAt,
      ageDays,
      total: report.items.length,
      negative: report.items.filter((item) => item.negative).length,
      byCategory,
      bureaus,
      blocked: plan.blocked,
      comparison,
      effects: [],
      notes,
      after: null,
    };
  }

  const effects: string[] = [];
  const total = report.items.length;
  if (!previous || !diff) {
    effects.push(
      total === 1
        ? L("Es su primer reporte: su único punto queda pendiente de la revisión del cliente.", "It's their first report: its one item waits for the client's review.")
        : L(`Es su primer reporte: los ${total} puntos quedan pendientes de la revisión del cliente.`, `It's their first report: all ${total} items wait for the client's review.`),
    );
  } else {
    const kept = [...diff.changed, ...diff.unchanged].filter((item) => {
      const status = client.answers[item.fingerprint]?.status;
      return status === "inaccurate" || status === "correct";
    }).length;
    if (kept > 0) {
      effects.push(
        L(
          `Las respuestas del cliente se conservan: ${count(kept, "punto sigue en el reporte con la respuesta que ya dio", "puntos siguen en el reporte con la respuesta que ya dio")}.`,
          `The client's answers are kept: ${count(kept, "item is still on the report with the answer they already gave", "items are still on the report with the answer they already gave")}.`,
        ),
      );
    }
    if (diff.added.length > 0) {
      effects.push(
        L(
          `${count(diff.added.length, "punto nuevo queda pendiente", "puntos nuevos quedan pendientes")} de la revisión del cliente. Solo el cliente puede responder.`,
          `${count(diff.added.length, "new item waits", "new items wait")} for the client's review. Only the client can answer.`,
        ),
      );
    }
  }

  if (plan.round) {
    const gone = plan.round.removed.length;
    if (plan.round.closes) {
      effects.push(
        en
          ? `It brings the answers to round ${plan.round.number}: the round is marked “Answered”. ${
              gone > 0 ? `${count(gone, "item from that round no longer shows", "items from that round no longer show")} on the report.` : "No item from that round disappeared from the report."
            }`
          : `Trae las respuestas a la ronda ${plan.round.number}: la ronda queda «Con respuesta». ${
              gone > 0
                ? `${count(gone, "punto de esa ronda ya no aparece", "puntos de esa ronda ya no aparecen")} en el reporte.`
                : "Ningún punto de esa ronda desapareció del reporte."
            }`,
      );
    } else if (client.rounds.find((r) => r.number === plan.round!.number)?.status === "mailed") {
      effects.push(
        en
          ? `Round ${plan.round.number} is still open: the bureaus have until ${formatDay(new Date(plan.round.windowEnds), "en")} to answer.${
              gone > 0 ? ` The round records that ${count(gone, "item no longer shows", "items no longer show")}.` : ""
            }`
          : `La ronda ${plan.round.number} sigue abierta: los burós tienen hasta el ${formatDay(new Date(plan.round.windowEnds))} para responder.${
              gone > 0 ? ` Queda anotado en la ronda que ${count(gone, "punto ya no aparece", "puntos ya no aparecen")}.` : ""
            }`,
      );
    } else if (gone > 0) {
      effects.push(
        L(
          `Queda anotado en la ronda ${plan.round.number} que ${count(gone, "punto ya no aparece", "puntos ya no aparecen")} en el reporte.`,
          `Round ${plan.round.number} records that ${count(gone, "item no longer shows", "items no longer show")} on the report.`,
        ),
      );
    }
  } else if (previous) {
    const waiting = client.rounds.find((r) => r.status === "mailed" && r.mailedAt);
    if (waiting?.mailedAt && new Date(report.pulledAt).getTime() <= new Date(waiting.mailedAt).getTime()) {
      notes.push(
        L(
          `Este reporte es anterior al envío de la ronda ${waiting.number}: no dice nada sobre lo que respondieron los burós.`,
          `This report is from before round ${waiting.number} went out: it says nothing about what the bureaus answered.`,
        ),
      );
    }
  }

  if (plan.resetRound !== null) {
    effects.push(
      L(
        `La ronda ${plan.resetRound} estaba lista con cartas escritas sobre el reporte anterior, y este reporte cambia puntos que esas cartas cubren. Vuelve a «En preparación» y no se envía hasta que las cartas se preparen de nuevo.`,
        `Round ${plan.resetRound} was ready with letters written from the previous report, and this report changes items those letters cover. It goes back to “Being prepared” and won't be sent until the letters are prepared again.`,
      ),
    );
  }

  const merged = mergeReport(client, raw, { at, by: "", readerKey: "" });
  const after = { stageBefore: clientStage(client, now), stageAfter: clientStage(merged, now), next: nextStep(merged, now, locale) };

  return {
    reportDate: report.pulledAt,
    ageDays,
    total,
    negative: report.items.filter((item) => item.negative).length,
    byCategory,
    bureaus,
    blocked: null,
    comparison,
    effects,
    notes,
    after,
  };
}

// ── From a report on file back to the app's own format ──────────────────

/**
 * The report on file, written back in the app's own format. Every item keeps
 * the entry it was read from (ReportItem.data), so reading the result again
 * gives the same report. Used to hand staff an editable copy of a report.
 */
export function toRawReport(report: NormalizedReport): RawReport {
  const bureaus: RawReport["bureaus"] = {};
  const section = (bureau: Bureau) =>
    (bureaus[bureau] ??= { tradelines: [], inquiries: [], publicRecords: [], personalInfo: [] });

  for (const item of report.items) {
    const target = section(item.bureau);
    const data = item.data as never;
    if (item.category === "tradeline") target.tradelines.push(data);
    else if (item.category === "inquiry") target.inquiries.push(data);
    else if (item.category === "public_record") target.publicRecords.push(data);
    else target.personalInfo.push(data);
  }
  for (const bureau of BUREAU_ORDER) {
    const score = report.scores[bureau];
    if (score !== undefined) section(bureau).score = score;
  }
  return { source: report.source, pulledAt: report.pulledAt, bureaus };
}
