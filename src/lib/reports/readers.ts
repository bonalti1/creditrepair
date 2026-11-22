import { parseReport, rawReportSchema, type RawReport } from "../domain/parser";
import { AiReadProblems, looksLikeAiEnvelope, readAiEnvelope } from "../intake/report/envelope";

// Report readers: turn what staff paste or upload into the app's own report
// format (RawReport, domain/parser.ts). The rest of the pipeline — preview,
// diff, saving on the client — only ever sees RawReport.
//
// One reader works today: the app's own JSON format. The monitoring
// providers are registered as placeholders that refuse to read. Their report
// pages are not a published format, and no real sample has been in hand to
// build a reader against. A reader written from a guess would still produce
// items, some of them wrong, and those items would go into dispute letters
// with no error anywhere (the same reason monitoring/identityiq.ts stays
// unimplemented). So until a provider has a reader built and tested on real
// samples, its pages can only be kept as samples (see ReportSample in
// staff/types.ts), never read.

export type ReaderStatus = "ready" | "needs_sample" | "simulated";

export interface ReportReader {
  key: string;
  /** The name staff see in the provider list. */
  label: string;
  /**
   * "ready": it reads. "needs_sample": no reader exists yet; `read` always
   * throws. "simulated": the AI reader without an API key on this server (or
   * in a browser, which never sees the key): it returns canned, labelled
   * readings that can never be saved to a real client.
   */
  status: ReaderStatus;
  /**
   * "ai": staff upload a PDF or a saved page instead of pasting text; the
   * server sends it to the AI (src/lib/intake) and `read` takes the reading
   * it returns (an envelope), validated again every time.
   */
  upload?: "ai";
  /** A cheap look at the text: does it seem to come from this source? Used only to suggest a provider. */
  detect(source: string): boolean;
  /** The report in the app's own format. Throws ReportReadError, in plain Spanish, when it cannot. */
  read(source: string): RawReport;
}

/** Why a report could not be read. `problems` is one plain Spanish line per thing that is wrong. */
export class ReportReadError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join(" "));
    this.name = "ReportReadError";
    this.problems = problems;
  }
}

/** Files and pasted text up to this size are accepted. */
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
/** The kinds of file the import screen takes. */
export const ACCEPTED_FILE_EXTENSIONS = [".json", ".txt", ".html"] as const;

// ── The app's own format ────────────────────────────────────────────────

const BUREAUS = ["equifax", "experian", "transunion"] as const;
const BUREAU_NAME = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" } as const;

/** A path as staff would point at it in the file: bureaus.equifax.tradelines[0].balance */
function pathText(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>(
    (out, part) => (typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part)),
    "",
  );
}

function valueAt(input: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let current: unknown = input;
  for (const part of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  return current;
}

const EXPECTED: Record<string, string> = {
  string: "un texto entre comillas",
  number: "un número",
  int: "un número entero, sin decimales",
  array: "una lista entre corchetes [ ]",
  record: "un objeto entre llaves { }",
  object: "un objeto entre llaves { }",
  boolean: "verdadero o falso",
};

const FIELD_HINT: Record<string, string> = {
  source: "de dónde viene el reporte",
  pulledAt: "la fecha del reporte",
  bureaus: "las secciones de cada buró",
};

interface SchemaIssue {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  expected?: string;
  keys?: string[];
  minimum?: number | bigint;
  maximum?: number | bigint;
}

/** One schema problem, said the way a person fixing the file needs it. */
function issueLine(issue: SchemaIssue, input: unknown): string {
  const where = pathText(issue.path);
  const name = where ? `«${where}»` : "El archivo";

  if (issue.code === "invalid_type") {
    const expected = EXPECTED[issue.expected ?? ""] ?? "otro tipo de dato";
    if (valueAt(input, issue.path) === undefined) {
      const hint = issue.path.length === 1 ? FIELD_HINT[String(issue.path[0])] : undefined;
      return `Falta ${name}${hint ? ` (${hint})` : ""}. Debe ser ${expected}.`;
    }
    return `${name} debe ser ${expected}.`;
  }
  if (issue.code === "unrecognized_keys") {
    const keys = (issue.keys ?? []).map((k) => `«${k}»`).join(", ");
    if (where === "bureaus") {
      return `${keys} no es un buró que conozcamos. Los burós se escriben equifax, experian y transunion.`;
    }
    return `${name} trae campos que no se reconocen: ${keys}.`;
  }
  if (issue.code === "too_big" || issue.code === "too_small") {
    if (issue.path[issue.path.length - 1] === "score") return `${name} debe ser un puntaje entre 300 y 850.`;
    return issue.code === "too_big"
      ? `${name} es mayor de lo permitido (máximo ${String(issue.maximum)}).`
      : `${name} es menor de lo permitido (mínimo ${String(issue.minimum)}).`;
  }
  return `${name} no tiene un valor válido.`;
}

/** "línea 3, columna 9" from the JSON parser's message, when it says where. */
function jsonErrorPlace(message: string, text: string): string | null {
  const lineColumn = message.match(/line (\d+) column (\d+)/);
  if (lineColumn) return `línea ${lineColumn[1]}, columna ${lineColumn[2]}`;
  const position = message.match(/position (\d+)/);
  if (!position) return null;
  const before = text.slice(0, Number(position[1]));
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  return `línea ${line}, columna ${column}`;
}

/**
 * A date-only value ("2026-11-21") is read as noon UTC, so it stays the same
 * calendar day on a United States clock. Anything else is kept as the instant
 * it names. Null when it is not a date.
 */
function normalizeDate(value: string): string | null {
  const text = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = new Date(dateOnly ? `${text}T12:00:00.000Z` : text);
  if (Number.isNaN(date.getTime())) return null;
  // "2026-02-31" parses in some engines by rolling over; a date must name a real day.
  if (dateOnly && date.toISOString().slice(0, 10) !== text) return null;
  return date.toISOString();
}

function readCredaltiJson(source: string): RawReport {
  const text = source.replace(/^﻿/, "").trim();
  if (!text) throw new ReportReadError(["No hay nada que leer. Pega el texto del reporte o elige un archivo."]);

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    if (text.startsWith("<")) {
      throw new ReportReadError([
        "Esto parece una página web (HTML), no un archivo en el formato Credalti JSON. Si es la página de un proveedor de monitoreo, elige ese proveedor en la lista.",
      ]);
    }
    const place = jsonErrorPlace(error instanceof Error ? error.message : "", text);
    throw new ReportReadError([
      `El texto no es JSON válido${place ? `: hay un error cerca de la ${place}` : ""}. Suele ser una coma, una llave o unas comillas de más o de menos. La plantilla muestra cómo debe verse.`,
    ]);
  }

  const parsed = rawReportSchema.safeParse(input);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => issueLine(issue as SchemaIssue, input));
    throw new ReportReadError([...new Set(lines)]);
  }

  const raw = parsed.data;
  const problems: string[] = [];

  const pulledAt = normalizeDate(raw.pulledAt);
  if (!pulledAt) {
    problems.push(
      `«pulledAt» no es una fecha: dice "${raw.pulledAt}". Escríbela como 2026-11-21 o 2026-11-21T15:00:00Z.`,
    );
  }
  if (!raw.source.trim()) problems.push("«source» está vacío. Di de dónde viene el reporte, por ejemplo \"identityiq\".");
  if (!BUREAUS.some((bureau) => raw.bureaus[bureau])) {
    problems.push("El reporte no trae ningún buró. Hace falta al menos una sección: equifax, experian o transunion.");
  }

  // The same entry twice in one bureau would become two items with one identity.
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const item of parseReport(raw).items) {
    if (seen.has(item.fingerprint) && !repeated.has(item.fingerprint)) {
      repeated.add(item.fingerprint);
      problems.push(`«${item.name}» aparece dos veces en ${BUREAU_NAME[item.bureau]}. Deja una sola entrada.`);
    }
    seen.add(item.fingerprint);
  }

  if (problems.length > 0 || !pulledAt) throw new ReportReadError(problems);
  return { ...raw, pulledAt };
}

/** Looks like the app's own format: JSON that names its bureaus and its date. */
function looksLikeCredaltiJson(source: string): boolean {
  const text = source.replace(/^﻿/, "").trimStart();
  return text.startsWith("{") && /"bureaus"\s*:/.test(text) && /"pulledAt"\s*:/.test(text);
}

// ── Any provider's PDF or saved page, read by the AI ────────────────────

/**
 * The AI reader (src/lib/intake, docs/INTAKE.md). It does not guess a
 * provider's layout in code: Claude transcribes the report with a citation
 * per item, and deterministic checks decide what a person must look at.
 */
const aiDocumentReader: ReportReader = {
  key: "ai_document",
  label: "PDF o página guardada (lectura con IA)",
  get status(): ReaderStatus {
    return typeof window === "undefined" && process.env.ANTHROPIC_API_KEY ? "ready" : "simulated";
  },
  upload: "ai",
  detect: looksLikeAiEnvelope,
  read(source) {
    try {
      return readAiEnvelope(source, new Date());
    } catch (error) {
      if (error instanceof AiReadProblems) throw new ReportReadError(error.problems);
      throw error;
    }
  },
};

// ── Providers without a reader ──────────────────────────────────────────

/**
 * A provider we cannot read yet. `detect` only checks whether the text names
 * the provider's own web address, which a saved page of its site does; it says
 * nothing about how the report inside is laid out, and nothing is parsed.
 */
function needsSample(key: string, label: string, domain: string): ReportReader {
  const mention = new RegExp(`\\b${domain.replace(/\./g, "\\.")}\\b`, "i");
  return {
    key,
    label,
    status: "needs_sample",
    detect: (source) => mention.test(source),
    read() {
      throw new ReportReadError([
        `Todavía no existe un lector para los reportes de ${label}. Para construirlo hace falta un reporte real de ${label} como muestra: su formato no es público y no lo vamos a adivinar.`,
      ]);
    },
  };
}

export const REPORT_READERS: readonly ReportReader[] = [
  {
    key: "credalti_json",
    label: "Credalti (JSON)",
    status: "ready",
    detect: looksLikeCredaltiJson,
    read: readCredaltiJson,
  },
  aiDocumentReader,
  needsSample("identityiq", "IdentityIQ", "identityiq.com"),
  needsSample("smartcredit", "SmartCredit", "smartcredit.com"),
  needsSample("myfreescorenow", "MyFreeScoreNow", "myfreescorenow.com"),
  needsSample("myscoreiq", "MyScoreIQ", "myscoreiq.com"),
  needsSample("privacyguard", "PrivacyGuard", "privacyguard.com"),
];

export function getReportReader(key: string): ReportReader | undefined {
  return REPORT_READERS.find((reader) => reader.key === key);
}

/** The reader's name for staff, or the key itself for one that is no longer registered. */
export function readerLabel(key: string): string {
  return getReportReader(key)?.label ?? key;
}

/**
 * The one source this text seems to come from, or null when nothing matches
 * or more than one does. A suggestion for the provider list, never a decision.
 */
export function suggestReader(source: string): ReportReader | null {
  const matches = REPORT_READERS.filter((reader) => reader.detect(source));
  return matches.length === 1 ? matches[0]! : null;
}
