import type { RawReport } from "../../domain/parser";
import { isSupabaseConfigured } from "../../supabase/config";
import { validateReportExtraction } from "./validate";

// What the AI's reading of a report travels as, from the extraction route to
// the import preview and back to the save: the model's answer exactly as it
// came, plus where it came from. It is the "source" of the `ai_document`
// reader (reports/readers.ts), and every time it is read it is validated
// again (validate.ts), on the server included: a reading is never trusted
// because it passed once.
//
// A simulated reading (no API key, the demo) is marked as such. It can be
// previewed and saved in the demo; it can never be saved to a real client.

export const AI_ENVELOPE_FORMAT = "credalti-ai-report";

export interface AiReportEnvelope {
  format: typeof AI_ENVELOPE_FORMAT;
  version: 1;
  /** True when no AI read anything: a canned example. */
  simulated: boolean;
  /** The intake record (intake_documents.id) this reading belongs to; null in the demo. */
  intakeId: string | null;
  fileName: string | null;
  fileKind: "pdf" | "html" | "text";
  model: string;
  extractedAt: string;
  /** The model's answer, unvalidated. */
  extraction: unknown;
}

/** Plain Spanish problems of a reading that cannot be used. */
export class AiReadProblems extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join(" "));
    this.name = "AiReadProblems";
    this.problems = problems;
  }
}

export function looksLikeAiEnvelope(source: string): boolean {
  const text = source.trimStart();
  return text.startsWith("{") && text.includes(`"${AI_ENVELOPE_FORMAT}"`);
}

/** The envelope from its JSON text, or AiReadProblems. */
export function parseEnvelope(source: string): AiReportEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new AiReadProblems(["Esto no es una lectura con IA de un reporte. Sube el PDF o la página guardada del reporte."]);
  }
  const e = value as Partial<AiReportEnvelope> | null;
  if (!e || e.format !== AI_ENVELOPE_FORMAT || e.version !== 1 || typeof e.simulated !== "boolean") {
    throw new AiReadProblems(["Esto no es una lectura con IA de un reporte. Sube el PDF o la página guardada del reporte."]);
  }
  return e as AiReportEnvelope;
}

/**
 * The `ai_document` reader: the envelope's reading, validated again, as a
 * report in the app's own format. Throws AiReadProblems when it cannot be
 * used. Low-confidence items do not stop it: the import screen shows them
 * and asks the person to confirm they looked.
 */
export function readAiEnvelope(source: string, now: Date): RawReport {
  const envelope = parseEnvelope(source);
  if (envelope.simulated && isSupabaseConfigured()) {
    throw new AiReadProblems(["Es una lectura simulada (sin clave de IA configurada): sirve para la demo y no se guarda en el expediente de un cliente real."]);
  }
  const result = validateReportExtraction(envelope.extraction, { now });
  if (!result.raw) throw new AiReadProblems(result.fatal.length > 0 ? result.fatal : ["La lectura no se puede usar."]);
  return result.raw;
}
