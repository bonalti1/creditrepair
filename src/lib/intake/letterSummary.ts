import type { BureauLetterSummary, IntakeStatus, LetterOutcome } from "./types";

// The plain summary of a bureau's letter the client reads (no server code, no
// SDK: it runs in the browser too). Facts about the letter only.

const BUREAU_ES = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" } as const;

// ── What the client reads ───────────────────────────────────────────────

const OUTCOME_ES: Record<LetterOutcome, string> = {
  deleted: "lo quitaron de tu reporte",
  verified: "lo verificaron y queda como estaba",
  updated: "actualizaron la información",
  in_investigation: "todavía lo están investigando",
  more_info_requested: "piden más información",
  frivolous: "no lo van a investigar",
  unclear: "no queda claro qué dice",
};
const OUTCOME_EN: Record<LetterOutcome, string> = {
  deleted: "it was taken off your report",
  verified: "they verified it and it stays as it was",
  updated: "they updated the information",
  in_investigation: "they are still looking into it",
  more_info_requested: "they ask for more information",
  frivolous: "they will not look into it",
  unclear: "it is not clear what it says",
};

/**
 * The plain summary the client sees: what the letter says, line by line, as
 * the letter's words. No score, no promise, no advice on what to dispute.
 */
export function clientLetterSummary(summary: BureauLetterSummary | null, status: IntakeStatus, locale: "es" | "en"): { title: string; lines: string[]; note: string } {
  const es = locale === "es";
  const who = summary?.bureau ? BUREAU_ES[summary.bureau] : es ? "un buró" : "a bureau";
  const when = summary?.letterDate ? (es ? ` del ${summary.letterDate}` : ` dated ${summary.letterDate}`) : "";
  const title = es ? `Carta de ${who}${when}` : `Letter from ${who}${when}`;
  const lines = (summary?.items ?? []).map((item) => {
    const name = `${item.creditor}${item.account ? ` ${item.account}` : ""}`;
    return es ? `${name}: la carta dice que ${OUTCOME_ES[item.outcome]}.` : `${name}: the letter says ${OUTCOME_EN[item.outcome]}.`;
  });
  const note =
    status === "needs_person"
      ? es
        ? "Una persona del equipo va a revisar esta carta y te escribe si hace falta algo de tu parte."
        : "A person on the team will review this letter and will write to you if anything is needed from you."
      : es
        ? "Esto es lo que dice la carta. De todas formas revisamos tu reporte de nuevo."
        : "This is what the letter says. We review your report again either way.";
  return { title, lines, note };
}

