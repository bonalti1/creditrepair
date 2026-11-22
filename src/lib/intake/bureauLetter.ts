import { z } from "zod";
import type { Bureau, ReportItem } from "../domain/types";
import { callClaude, imageBlock, pdfBlock, type ModelCaller } from "./claude";
import { intakeConfigured, intakeModel } from "./config";
import { estimateCostUsd, NO_USAGE, type ModelUsage } from "./cost";
import { DAY_MS, parseLooseDate } from "./dates";
import { checkUpload } from "./files";
import { creditorsMatch, lastFour } from "./match";
import { findSensitive } from "./redact";
import { CITATION_SCHEMA, CONFIDENCE_VALUES, S } from "./schema";
import type { BureauLetterSummary, IntakeStatus, LetterItemResult, LetterOutcome } from "./types";

// The paper answers the bureaus mail back: OPTIONAL. The source of truth for a
// round's results is the client's next report compared with the previous one
// (outcomes.ts). Nothing in the round cycle waits for, asks for or reminds
// anyone about a letter. When one does arrive (the client photographs it on
// the rounds page, or staff upload one that reached them another way), Claude
// reads which bureau, the date, which items it mentions and what it says
// happened to each, with a citation, and code matches each item to the
// client's report by creditor and the last 4 digits of the account.
//
// A person is needed only when the letter asks for more information or calls
// the dispute "frivolous"/irrelevant: those are the answers a report cannot
// show and that need someone to act. Anything else doubtful (an item not
// found on the report, an unsure reading) is noted on the client page for
// staff, without an exception: the next report settles it anyway.
//
// The client sees the letter's words as facts about the letter ("la carta
// dice que…"), never a result we claim, never a score, never a promise
// (docs/BRAND.md). Nothing here decides what to dispute next.

const OUTCOMES = ["deleted", "verified", "updated", "in_investigation", "more_info_requested", "frivolous", "unclear"] as const satisfies readonly LetterOutcome[];

export const LETTER_SYSTEM_PROMPT = `You read a letter that a US consumer received by mail from a credit bureau (Equifax, Experian or TransUnion) in answer to a credit report dispute, from a photo or scan, and transcribe what it says into the schema. A person at a credit services company will check your work against your citations.

Transcribe:
- isBureauLetter: true only if the letter is from Equifax, Experian or TransUnion about a dispute or a credit report. A collection letter, a bill or a letter from a creditor is not.
- bureau: which bureau sent it ("other" for another company, "unknown" if you cannot tell).
- letterDate: the letter's date (YYYY-MM-DD), or null.
- items: every account or inquiry the letter reports a result for. For each: the creditor / company name as printed; the account number as printed (if it is printed in full, write only its last 4 digits preceded by "****"; empty string if none); the outcome; the letter's own words for that outcome (short); a citation (1-based page number and a short exact quote showing the creditor name); and your confidence.
  Outcomes, as the letter states them:
  - "deleted": the item was deleted / removed from the file.
  - "verified": the information was verified as accurate / remains / no change.
  - "updated": the item was updated or modified (balance, status, dates, remarks changed).
  - "in_investigation": still being investigated / reinvestigation in progress.
  - "more_info_requested": the bureau asks for more information or documents before it can proceed with this item.
  - "frivolous": the bureau says the dispute is frivolous or irrelevant, or that it will not investigate.
  - "unclear": you cannot tell what the letter says happened.
- generalNotice: if the whole letter (not one item) asks for more information or proof of identity, says the dispute is frivolous/irrelevant, or says the investigation is still in progress, say which ("more_info_requested", "frivolous", "in_investigation"); otherwise "none". Give its citation, or null.
- unreadable: parts you could not read.
- confidence: "high" only if you read the whole letter clearly.

Copy the letter's facts only. Do not judge whether the result is right or what the consumer should do next. Never write a Social Security number, a date of birth, a full account number or any ID number, and never quote them.`;

export const LETTER_JSON_SCHEMA = S.obj({
  isBureauLetter: S.bool(),
  bureau: S.enum(["equifax", "experian", "transunion", "other", "unknown"]),
  letterDate: S.nullable(S.str("YYYY-MM-DD")),
  items: S.arr(
    S.obj({
      creditor: S.str(),
      accountNumber: S.str('As printed and masked, e.g. "****1234"; empty string if none.'),
      outcome: S.enum(OUTCOMES),
      outcomeWords: S.str("The letter's own words for the outcome, short."),
      citation: CITATION_SCHEMA,
      confidence: S.enum(CONFIDENCE_VALUES),
    }),
  ),
  generalNotice: S.enum(["none", "more_info_requested", "frivolous", "in_investigation"]),
  generalCitation: S.nullable(CITATION_SCHEMA),
  unreadable: S.arr(S.str()),
  confidence: S.enum(CONFIDENCE_VALUES),
});

const zCitation = z.object({ page: z.number().int(), quote: z.string() }).strict();
const letterSchema = z
  .object({
    isBureauLetter: z.boolean(),
    bureau: z.enum(["equifax", "experian", "transunion", "other", "unknown"]),
    letterDate: z.string().nullable(),
    items: z.array(
      z
        .object({
          creditor: z.string(),
          accountNumber: z.string(),
          outcome: z.enum(OUTCOMES),
          outcomeWords: z.string(),
          citation: zCitation,
          confidence: z.enum(CONFIDENCE_VALUES),
        })
        .strict(),
    ),
    generalNotice: z.enum(["none", "more_info_requested", "frivolous", "in_investigation"]),
    generalCitation: zCitation.nullable(),
    unreadable: z.array(z.string()),
    confidence: z.enum(CONFIDENCE_VALUES),
  })
  .strict();

export type LetterReading = z.infer<typeof letterSchema>;

const BUREAU_ES: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

export interface LetterDecision {
  /**
   * needs_person: the letter asks for more information or says "frivolous" (an exception for staff).
   * read: read, with notes for staff (unmatched items, an unsure reading); no exception.
   * accepted: read and every item matched.
   */
  status: Extract<IntakeStatus, "accepted" | "needs_person" | "read">;
  /** For staff, plain Spanish: what was read, what needs a person, and any notes. */
  reasons: string[];
  /** Null when nothing usable came back. */
  summary: BureauLetterSummary | null;
}

/** The report items a letter can be about: the client's current items of that bureau. */
function candidates(items: readonly ReportItem[], bureau: Bureau, creditor: string, account: string | null): ReportItem[] {
  const four = lastFour(account);
  return items.filter((item) => {
    if (item.bureau !== bureau || item.category === "personal_info") return false;
    if (!creditorsMatch(item.name, creditor)) return false;
    if (item.category !== "tradeline") return four === null;
    const itemFour = lastFour(String((item.data as { accountNumberMasked?: unknown }).accountNumberMasked ?? ""));
    return four === null || itemFour === null || itemFour === four;
  });
}

/**
 * The decision, in code: match each item the letter mentions to one report
 * item, and say whether a person is needed. `disputed` are the fingerprints
 * of the items in the client's mailed letters: when a name matches more than
 * one item, the one that was disputed is the one the letter answers.
 */
export function decideLetter(output: unknown, reportItems: readonly ReportItem[], now: Date, disputed: ReadonlySet<string> = new Set()): LetterDecision {
  // Nothing usable: noted for staff. The next report is the source of truth, so no exception.
  const unusable = (reasons: string[]): LetterDecision => ({ status: "read", reasons, summary: null });
  if (findSensitive(output).length > 0) return unusable(["La lectura de la carta traía algo parecido a un número de Seguro Social o una fecha de nacimiento y se descartó. Si hace falta, léela tú."]);
  const parsed = letterSchema.safeParse(output);
  if (!parsed.success) return unusable(["La lectura de la carta no tiene la forma esperada y no se usó. Si hace falta, léela tú."]);
  const r = parsed.data;
  if (!r.isBureauLetter) return unusable(["No parece una carta de Equifax, Experian o TransUnion."]);
  if (r.bureau === "other" || r.bureau === "unknown") return unusable(["No se pudo saber qué buró envió la carta."]);
  const bureau: Bureau = r.bureau;

  const action: string[] = [];
  const notes: string[] = [];
  const date = parseLooseDate(r.letterDate);
  const letterDate = date?.precision === "day" && date.time - now.getTime() <= DAY_MS ? date.text : null;
  if (!letterDate) notes.push("No se pudo leer la fecha de la carta.");

  const items: LetterItemResult[] = r.items.map((entry) => {
    const four = lastFour(entry.accountNumber);
    const account = four ? `****${four}` : null;
    const found = candidates(reportItems, bureau, entry.creditor, account);
    const preferred = found.length > 1 ? found.filter((item) => disputed.has(item.fingerprint)) : found;
    const match = preferred.length === 1 ? preferred[0]! : null;
    const label = `${entry.creditor.trim()}${account ? ` ${account}` : ""}`;
    if (!match) {
      notes.push(
        found.length === 0
          ? `La carta menciona «${label}» y no se encontró en el reporte de ${BUREAU_ES[bureau]} del cliente.`
          : `La carta menciona «${label}» y coincide con más de un punto del reporte.`,
      );
    }
    if (entry.outcome === "more_info_requested") action.push(`Sobre «${label}» el buró pide más información.`);
    if (entry.outcome === "frivolous") action.push(`Sobre «${label}» el buró dice que la disputa es «frívola» o que no la investigará.`);
    if (entry.outcome === "unclear") notes.push(`No queda claro qué dice la carta sobre «${label}».`);
    if (entry.confidence !== "high") notes.push(`La lectura de «${label}» no es segura.`);
    const quote = entry.citation.quote.replace(/\s+/g, " ").trim().slice(0, 240);
    return {
      creditor: entry.creditor.trim(),
      account,
      outcome: entry.outcome,
      fingerprint: match?.fingerprint ?? null,
      citation: quote ? { page: Number.isInteger(entry.citation.page) && entry.citation.page > 0 ? entry.citation.page : null, quote } : null,
    };
  });

  if (items.length === 0) notes.push("No se encontró ningún punto con resultado en la carta.");
  if (r.generalNotice === "more_info_requested") action.push("La carta pide más información o documentos.");
  if (r.generalNotice === "frivolous") action.push("La carta dice que la disputa es «frívola» o que no se investigará.");
  for (const part of r.unreadable) if (part.trim()) notes.push(`No se pudo leer: ${part.trim().slice(0, 160)}`);
  if (r.confidence !== "high") notes.push("La lectura de la carta no es segura.");

  const summary: BureauLetterSummary = { bureau, letterDate, items };
  if (action.length > 0) return { status: "needs_person", reasons: [...action, ...notes], summary };
  if (notes.length > 0) return { status: "read", reasons: notes, summary };
  return {
    status: "accepted",
    reasons: [`Carta de ${BUREAU_ES[bureau]} del ${letterDate}: ${items.length === 1 ? "1 punto" : `${items.length} puntos`}, ${items.length === 1 ? "identificado" : "todos identificados"} en el reporte.`],
    summary,
  };
}

export { clientLetterSummary } from "./letterSummary";

// ── Reading one letter ──────────────────────────────────────────────────

export interface LetterCheckResult extends LetterDecision {
  simulated: boolean;
  model: string;
  usage: ModelUsage;
  costUsd: number;
}

/** The demo's letter: Equifax, about the demo report. One account is not on the report (a note for staff) and one answer asks for more information (a person is needed). */
export function simulatedLetterReading(now: Date): LetterReading {
  const date = new Date(now.getTime() - 3 * DAY_MS).toISOString().slice(0, 10);
  return {
    isBureauLetter: true,
    bureau: "equifax",
    letterDate: date,
    items: [
      { creditor: "Midland Credit Management", accountNumber: "****8821", outcome: "deleted", outcomeWords: "Deleted", citation: { page: 1, quote: "MIDLAND CREDIT MANAGEMENT ****8821 — Deleted" }, confidence: "high" },
      { creditor: "Auto Finance Corp", accountNumber: "", outcome: "verified", outcomeWords: "Verified, no change", citation: { page: 1, quote: "AUTO FINANCE CORP (inquiry) — Verified, no change" }, confidence: "high" },
      { creditor: "LVNV Funding", accountNumber: "****4410", outcome: "more_info_requested", outcomeWords: "We need additional information", citation: { page: 2, quote: "LVNV FUNDING LLC ****4410 — We need additional information to process your request" }, confidence: "high" },
    ],
    generalNotice: "none",
    generalCitation: null,
    unreadable: [],
    confidence: "high",
  };
}

export async function readBureauLetter(input: {
  bytes: Uint8Array;
  reportItems: readonly ReportItem[];
  disputed?: ReadonlySet<string>;
  now: Date;
  call?: ModelCaller;
  /** True with a database: a simulated reading then always goes to a person. */
  live: boolean;
}): Promise<LetterCheckResult> {
  if (!input.call && !intakeConfigured()) {
    const decision = decideLetter(simulatedLetterReading(input.now), input.reportItems, input.now, input.disputed);
    const base = { simulated: true, model: "simulado", usage: NO_USAGE, costUsd: 0 };
    // With a database and no key nothing was read: noted for staff, no exception (the next report is the source of truth).
    if (input.live) return { ...base, status: "read", reasons: ["La lectura automática no está activa todavía: la carta quedó guardada sin leer."], summary: null };
    return { ...base, ...decision };
  }
  const upload = checkUpload("bureau_letter", input.bytes);
  if (!upload.ok) return { status: "read", reasons: [upload.message], summary: null, simulated: false, model: intakeModel(), usage: NO_USAGE, costUsd: 0 };
  const block = upload.kind === "pdf" ? pdfBlock(input.bytes, "Bureau letter") : imageBlock(input.bytes, upload.kind === "png" ? "image/png" : "image/jpeg");
  const answer = await (input.call ?? callClaude)({
    task: "bureau_letter",
    system: LETTER_SYSTEM_PROMPT,
    content: [block, { type: "text", text: "Transcribe this letter. Answer with the JSON object only." }],
    schema: LETTER_JSON_SCHEMA,
  });
  const meta = { simulated: false, model: answer.model, usage: answer.usage, costUsd: estimateCostUsd(answer.usage) };
  if (answer.problem) return { ...meta, status: "read", reasons: ["La lectura automática de la carta no se pudo hacer. Si hace falta, léela tú."], summary: null };
  return { ...meta, ...decideLetter(answer.output, input.reportItems, input.now, input.disputed) };
}
