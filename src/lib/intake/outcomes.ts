import { diffReports } from "../domain/diff";
import type { NormalizedReport } from "../domain/types";
import type { LetterItemResult, LetterOutcome } from "./types";

// What happened to each disputed item after a round, from two sources:
//
//   1. The report (primary, always there). The client's next report compared
//      with the one the round was written from: an item that is gone was
//      deleted, one whose fields changed was updated, and one still reported
//      unchanged once the bureaus' response window has closed is treated as
//      verified (the basis for a method-of-verification letter next round).
//      Before the window closes an unchanged item is still pending.
//   2. A bureau's letter (optional, secondary). Clients are not relied on to
//      upload letters, and nothing in the round cycle waits for one. When a
//      letter does arrive it can only add what a report cannot show: a request
//      for more information, a "frivolous"/irrelevant rejection, or an
//      investigation still in progress. On anything a report shows (deleted,
//      updated, still there), the report wins; a letter that disagrees with it
//      is kept as a conflict for a person to see.
//
// Pure: reports and letter results in, a map out. It decides nothing about the
// next round: domain/attack.ts and the client's own answers still do.

export type RoundOutcome = "deleted" | "updated" | "verified" | "pending" | "more_info_requested" | "frivolous" | "in_investigation";

export interface ItemOutcome {
  outcome: RoundOutcome;
  source: "report" | "letter";
  /** A letter said something the report contradicts (the report's outcome is kept). */
  conflict?: { letterOutcome: LetterOutcome };
}

/** Outcomes only a letter can show: the report looks the same either way. */
const LETTER_ONLY: ReadonlySet<LetterOutcome> = new Set(["more_info_requested", "frivolous", "in_investigation"]);

export interface OutcomeInput {
  /** The report the round's letters were written from. */
  before: NormalizedReport;
  /** The newest report, pulled after the round was mailed. Null when none has arrived yet. */
  after: NormalizedReport | null;
  /** Fingerprints of the items the round disputed. */
  disputed: Iterable<string>;
  /** True once the bureaus' response window has closed by the date of `after`. */
  windowClosed: boolean;
  /** Item results from bureau letters that arrived, oldest first. Optional. */
  letters?: readonly LetterItemResult[];
}

export function roundOutcomes(input: OutcomeInput): Map<string, ItemOutcome> {
  const disputed = new Set(input.disputed);
  const out = new Map<string, ItemOutcome>();

  // 1. The report.
  if (input.after) {
    const diff = diffReports(input.before, input.after);
    const deleted = new Set(diff.deleted.map((i) => i.fingerprint));
    const changed = new Set(diff.changed.map((i) => i.fingerprint));
    const still = new Set(input.after.items.map((i) => i.fingerprint));
    for (const fp of disputed) {
      if (deleted.has(fp)) out.set(fp, { outcome: "deleted", source: "report" });
      else if (changed.has(fp)) out.set(fp, { outcome: "updated", source: "report" });
      else if (still.has(fp)) out.set(fp, { outcome: input.windowClosed ? "verified" : "pending", source: "report" });
    }
  }

  // 2. Letters, newest last so it wins among letters.
  for (const item of input.letters ?? []) {
    if (!item.fingerprint || !disputed.has(item.fingerprint) || item.outcome === "unclear") continue;
    const fromReport = out.get(item.fingerprint);
    const reportShowsIt = fromReport && fromReport.source === "report" && fromReport.outcome !== "pending";
    if (LETTER_ONLY.has(item.outcome)) {
      // A report cannot show these, unless it already shows the item gone or changed.
      if (fromReport && (fromReport.outcome === "deleted" || fromReport.outcome === "updated")) {
        out.set(item.fingerprint, { ...fromReport, conflict: { letterOutcome: item.outcome } });
      } else {
        out.set(item.fingerprint, { outcome: item.outcome as RoundOutcome, source: "letter" });
      }
      continue;
    }
    if (reportShowsIt) {
      if (fromReport.outcome !== item.outcome) out.set(item.fingerprint, { ...fromReport, conflict: { letterOutcome: item.outcome } });
      continue;
    }
    // No report since the round (or still inside the window): the letter's word stands until one arrives.
    out.set(item.fingerprint, { outcome: item.outcome as RoundOutcome, source: "letter" });
  }
  return out;
}

/** The disputed items whose outcome is "verified": candidates for a method-of-verification letter next round. */
export function verifiedItems(outcomes: ReadonlyMap<string, ItemOutcome>): string[] {
  return [...outcomes].filter(([, o]) => o.outcome === "verified").map(([fp]) => fp);
}
