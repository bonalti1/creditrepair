import { DEMO_RAW_REPORT } from "../../demo";
import { callClaude, pdfBlock, textDocumentBlock, type ModelCaller } from "../claude";
import { intakeConfigured, intakeModel, MAX_REPORT_TEXT_CHARS } from "../config";
import { estimateCostUsd, NO_USAGE, type ModelUsage } from "../cost";
import { checkUpload } from "../files";
import { htmlToText, redactSensitive } from "../redact";
import { AI_ENVELOPE_FORMAT, type AiReportEnvelope } from "./envelope";
import { extractionFromRaw } from "./fromRaw";
import { REPORT_JSON_SCHEMA, REPORT_REQUEST_TEXT, REPORT_SYSTEM_PROMPT, type ReportExtraction } from "./model";
import { validateReportExtraction, type ReportValidation } from "./validate";

// Reading one uploaded credit report: prepare what is sent, ask Claude,
// check the answer. Server only (it holds the API key and the file).
//
//   PDF          sent as a PDF document. The SSN and birth date cannot be cut
//                out of a PDF here (no PDF library), so the instructions say to
//                ignore them and the answer is checked for them.
//   saved page   reduced to its text, SSN-like numbers and birth dates
//                replaced with [REDACTED], then sent as plain text. Every quote
//                the model gives is then checked against that text.
//
// Without an API key, a simulated reading (the demo report, dated today, with
// one entry deliberately marked as unsure) comes back, labelled as such.

export interface ReportIntakeResult {
  /** The reading to preview and save; null when it cannot be used or must not be kept. */
  envelope: AiReportEnvelope | null;
  validation: ReportValidation;
  simulated: boolean;
  model: string;
  usage: ModelUsage;
  costUsd: number;
  /** Pages in the PDF when they could be counted. */
  pageCount: number | null;
  /** A plain-Spanish reason the reading failed before validation (upload or model problem); null otherwise. */
  problem: string | null;
}

/** Pages of a PDF, counted from its page objects. Null when the file keeps them compressed and they cannot be counted. */
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = Buffer.from(bytes).toString("latin1");
  const count = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  return count > 0 ? count : null;
}

export const MODEL_PROBLEM_ES: Record<string, string> = {
  refusal: "La IA no quiso leer este documento. Necesita una persona.",
  max_tokens: "El reporte es demasiado largo para leerlo de una vez. Necesita una persona (o sube solo las secciones de cuentas).",
  invalid_json: "La respuesta de la IA no se pudo leer. Vuelve a intentarlo; si se repite, necesita una persona.",
  empty: "La IA no devolvió nada. Vuelve a intentarlo; si se repite, necesita una persona.",
  api_error: "No se pudo hablar con el servicio de IA. Vuelve a intentarlo en unos minutos.",
  not_configured: "La lectura con IA no está configurada en este servidor.",
};

function failed(problem: string, base: Partial<ReportIntakeResult> = {}): ReportIntakeResult {
  return {
    envelope: null,
    validation: { raw: null, fatal: [problem], warnings: [], items: [], discard: false, provider: null },
    simulated: false,
    model: intakeModel(),
    usage: NO_USAGE,
    costUsd: 0,
    pageCount: null,
    problem,
    ...base,
  };
}

/** The demo's reading: its report dated today, an Experian card added that the "AI" was unsure about. */
export function simulatedReportExtraction(now: Date): ReportExtraction {
  const raw = structuredClone(DEMO_RAW_REPORT);
  raw.pulledAt = now.toISOString();
  const extraction = extractionFromRaw(raw, { provider: "Ejemplo (simulado)", page: (b) => ({ equifax: 3, experian: 5, transunion: 7 })[b] });
  extraction.tradelines.push({
    bureau: "experian",
    creditor: "Synchrony Bank",
    accountNumberMasked: "****5521",
    accountType: "credit_card",
    status: "open",
    paymentStatus: "30 days late",
    balance: 310,
    creditLimit: 800,
    openedAt: "2022-04-02",
    lastPaymentAt: null,
    firstDelinquencyAt: null,
    lastReportedAt: null,
    remarks: [],
    citation: { page: 5, quote: "SYNCHRONY BANK ****5521 Open 30 Days Late $310" },
    confidence: "low",
    doubt: "The payment status column is cut off at the page edge; '30 days late' may belong to TransUnion's column.",
  });
  extraction.summaryCounts = extraction.summaryCounts.map((c) => (c.bureau === "experian" ? { ...c, accounts: 2 } : c));
  return extraction;
}

export interface ReportIntakeInput {
  bytes: Uint8Array;
  fileName: string | null;
  now: Date;
  intakeId?: string | null;
  /** The model call; the default calls Claude. Tests pass a fake. */
  call?: ModelCaller;
  /** Force the simulated reading (no key, or the demo). */
  simulate?: boolean;
}

export async function extractReport(input: ReportIntakeInput): Promise<ReportIntakeResult> {
  const upload = checkUpload("credit_report", input.bytes);
  if (!upload.ok) return failed(upload.message);
  const fileKind = upload.kind === "pdf" ? "pdf" : upload.kind === "html" ? "html" : "text";
  const pageCount = fileKind === "pdf" ? countPdfPages(input.bytes) : null;

  const envelope = (extraction: unknown, simulated: boolean, model: string): AiReportEnvelope => ({
    format: AI_ENVELOPE_FORMAT,
    version: 1,
    simulated,
    intakeId: input.intakeId ?? null,
    fileName: input.fileName,
    fileKind,
    model,
    extractedAt: input.now.toISOString(),
    extraction,
  });

  if (input.simulate || (!input.call && !intakeConfigured())) {
    const extraction = simulatedReportExtraction(input.now);
    const validation = validateReportExtraction(extraction, { now: input.now });
    return { envelope: envelope(extraction, true, "simulado"), validation, simulated: true, model: "simulado", usage: NO_USAGE, costUsd: 0, pageCount, problem: null };
  }

  let sourceText: string | null = null;
  let documentBlock;
  if (fileKind === "pdf") {
    documentBlock = pdfBlock(input.bytes, "Credit report");
  } else {
    const decoded = new TextDecoder("utf-8").decode(input.bytes);
    sourceText = redactSensitive(fileKind === "html" ? htmlToText(decoded) : decoded);
    if (sourceText.length > MAX_REPORT_TEXT_CHARS) {
      return failed(`La página tiene ${sourceText.length.toLocaleString("es-MX")} caracteres de texto; el máximo es ${MAX_REPORT_TEXT_CHARS.toLocaleString("es-MX")}. ¿Es un solo reporte?`, { pageCount });
    }
    documentBlock = textDocumentBlock(sourceText, "Credit report (saved page, redacted)");
  }

  const answer = await (input.call ?? callClaude)({
    task: "credit_report",
    system: REPORT_SYSTEM_PROMPT,
    content: [documentBlock, { type: "text", text: REPORT_REQUEST_TEXT(fileKind === "pdf" ? "pdf" : "text", input.fileName) }],
    schema: REPORT_JSON_SCHEMA,
  });
  const costUsd = estimateCostUsd(answer.usage);
  if (answer.problem) {
    return failed(MODEL_PROBLEM_ES[answer.problem] ?? MODEL_PROBLEM_ES.invalid_json!, { model: answer.model, usage: answer.usage, costUsd, pageCount });
  }

  const validation = validateReportExtraction(answer.output, { now: input.now, sourceText, pageCount });
  return {
    // An answer with SSN- or birth-date-like content is not kept anywhere, not even for the preview.
    envelope: validation.discard ? null : envelope(answer.output, false, answer.model),
    validation,
    simulated: false,
    model: answer.model,
    usage: answer.usage,
    costUsd,
    pageCount,
    problem: null,
  };
}
