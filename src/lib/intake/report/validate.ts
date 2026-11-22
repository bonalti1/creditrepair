import { fingerprint, rawReportSchema, type RawReport } from "../../domain/parser";
import type { Bureau, ItemCategory } from "../../domain/types";
import { daysBetween, DAY_MS, parseLooseDate } from "../dates";
import { findSensitive, normalizeForMatch } from "../redact";
import { reportExtractionSchema, type ReportExtraction } from "./model";

// The deterministic check of a credit report the AI read. Nothing the model
// answered reaches a person, let alone a client's record, before this runs.
//
//   fatal     the reading cannot be used at all: the answer is malformed, it
//             is not a credit report, it has no date or a date in the future,
//             it names a bureau the document does not contain, it has no
//             items, or it carries anything that looks like a Social Security
//             number or a birth date (then it is thrown away whole and never
//             stored).
//   warnings  the reading may be used, but a person must look first: the
//             per-bureau counts do not match the summary the report printed,
//             parts could not be read, the report is old.
//   items     every entry the model returned, each with its citation and a
//             confidence: "high" only when the model was sure AND every check
//             passed. Anything else is "low", with the reasons in plain
//             Spanish. Entries that cannot be saved (no name, a bureau the
//             report does not have, a repeat) are kept in the list, marked
//             `excluded`, so the person sees what was left out and why.
//
// What this never does: decide whether an item is negative, wrong or worth
// disputing. The parser's "se ve negativo" reading is unchanged, and only the
// client says what is inaccurate.

export const BUREAU_LABEL: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };
const BUREAUS: readonly Bureau[] = ["equifax", "experian", "transunion"];

/** Balances and limits above this are not a consumer account; a misread is likelier. */
export const MAX_PLAUSIBLE_AMOUNT = 10_000_000;
/** The oldest date a consumer report item can plausibly carry. */
const OLDEST_PLAUSIBLE_YEAR = 1950;
/** A report older than this still reads, with a warning. */
export const OLD_REPORT_DAYS = 120;
/** Quotes are kept short: they are for finding the place, not for copying the report. */
const MAX_QUOTE_CHARS = 240;

export type Confidence = "high" | "low";

export interface ReviewedItem {
  /** Same fingerprint the saved item will have (domain/parser.ts). */
  fingerprint: string;
  bureau: Bureau;
  category: ItemCategory;
  /** What staff see: the creditor, inquirer, record or personal entry. */
  label: string;
  confidence: Confidence;
  /** Why a person should look, in plain Spanish. Empty when confidence is high. */
  reasons: string[];
  citation: { page: number | null; quote: string } | null;
  /** Left out of the report that would be saved. */
  excluded: boolean;
}

export interface ReportValidation {
  /** The report in the app's own format, or null when the reading cannot be used. */
  raw: RawReport | null;
  fatal: string[];
  warnings: string[];
  items: ReviewedItem[];
  /** The answer had SSN- or birth-date-like content: nothing of it may be stored. */
  discard: boolean;
  provider: string | null;
}

export interface ValidationContext {
  now: Date;
  /**
   * The text that was sent (a saved page, after redaction). When present,
   * every quote must appear in it and every bureau must be named in it.
   * Absent for a PDF, whose text this app cannot read itself.
   */
  sourceText?: string | null;
  /** Pages in the PDF, when they could be counted. Citations must fall inside. */
  pageCount?: number | null;
}

const KNOWN_PROVIDERS: Array<[RegExp, string]> = [
  [/identity\s*iq/i, "identityiq"],
  [/smart\s*credit/i, "smartcredit"],
  [/my\s*free\s*score\s*now/i, "myfreescorenow"],
  [/my\s*score\s*iq/i, "myscoreiq"],
  [/privacy\s*guard/i, "privacyguard"],
];

/** The provider key the saved report records as its source. */
export function providerKey(provider: string | null): string {
  if (!provider) return "ai_document";
  return KNOWN_PROVIDERS.find(([pattern]) => pattern.test(provider))?.[1] ?? "ai_document";
}

/** An account number is masked when at most 6 digits show and something hides the rest, or only up to 4 digits are given. */
export function isMaskedAccount(value: string): boolean {
  const digits = (value.match(/\d/g) ?? []).length;
  if (/\d{7,}/.test(value.replace(/[\s-]/g, ""))) return false;
  if (digits <= 4) return true;
  return digits <= 6 && /[xX*•#]/.test(value);
}

/** Only the last 4 digits, behind "****". */
export function maskAccount(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? `****${digits.slice(-4)}` : "";
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** The words of a name that are worth finding in a quote ("Capital One Bank USA" → capital, one, bank). */
function nameTokens(name: string): string[] {
  return normalizeForMatch(name)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !["inc", "llc", "the", "corp", "usa", "bank", "na", "co"].includes(w));
}

function quoteMentions(quote: string, name: string): boolean {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return true;
  const q = normalizeForMatch(quote);
  return tokens.some((t) => q.includes(t));
}

interface Draft {
  bureau: Bureau;
  category: ItemCategory;
  identity: string;
  label: string;
  reasons: string[];
  excluded: boolean;
  modelSure: boolean;
  citation: { page: number | null; quote: string } | null;
  /** The entry as it would be saved; null when it is left out. */
  value: unknown;
}

export function validateReportExtraction(output: unknown, context: ValidationContext): ReportValidation {
  const empty = (fatal: string[], discard = false): ReportValidation => ({ raw: null, fatal, warnings: [], items: [], discard, provider: null });

  // 1. Nothing that looks like an SSN or a birth date, anywhere. Checked before the shape: it decides whether the answer may even be kept.
  const sensitive = findSensitive(output);
  if (sensitive.length > 0) {
    return empty(
      [
        "La respuesta de la IA traía algo parecido a un número de Seguro Social o a una fecha de nacimiento. Se descartó completa y no se guardó nada de ella. Vuelve a intentarlo o importa el reporte de otra forma.",
      ],
      true,
    );
  }

  // 2. The shape.
  const parsed = reportExtractionSchema.safeParse(output);
  if (!parsed.success) {
    return empty(["La respuesta de la IA no tiene la forma esperada, así que no se usa nada de ella. Vuelve a intentarlo; si se repite, el reporte necesita una persona."]);
  }
  const x: ReportExtraction = parsed.data;
  if (!x.documentIsCreditReport) return empty(["Este documento no parece un reporte de crédito."]);

  const fatal: string[] = [];
  const warnings: string[] = [];
  const now = context.now.getTime();
  const source = context.sourceText ? normalizeForMatch(context.sourceText) : null;

  // 3. The report's date.
  const reportDate = parseLooseDate(x.reportDate);
  if (!reportDate || reportDate.precision !== "day") {
    fatal.push("No se encontró la fecha del reporte. Sin ella no se sabe si es más nuevo que el que está en archivo.");
  } else if (reportDate.time - now > DAY_MS) {
    fatal.push(`La fecha que se leyó del reporte (${reportDate.text}) está en el futuro. Revisa el documento.`);
  } else if (daysBetween(reportDate.time, now) > OLD_REPORT_DAYS) {
    warnings.push(`El reporte es del ${reportDate.text}, de hace más de ${OLD_REPORT_DAYS} días.`);
  }
  const latest = reportDate ? reportDate.time + DAY_MS : now + DAY_MS;

  // 4. The bureaus: no repeats, and each one present in the document.
  const present = BUREAUS.filter((b) => x.bureausPresent.includes(b));
  if (present.length === 0) fatal.push("La lectura no encontró ningún buró en el documento.");
  if (source) {
    for (const b of present) {
      const named = b === "transunion" ? /trans\s*union/i : new RegExp(BUREAU_LABEL[b], "i");
      if (!named.test(context.sourceText!)) {
        fatal.push(`La IA dijo que el reporte trae ${BUREAU_LABEL[b]}, pero el documento no lo menciona. No se usa esta lectura.`);
      }
    }
  }

  const checkCitation = (citation: { page: number; quote: string }, name: string, reasons: string[]) => {
    const quote = clean(citation.quote).slice(0, MAX_QUOTE_CHARS);
    let page: number | null = citation.page;
    if (!Number.isInteger(page) || page < 1 || (context.pageCount && page > context.pageCount)) {
      reasons.push(`La página citada (${citation.page}) no existe en el documento.`);
      page = null;
    }
    if (!quote) reasons.push("No trae cita del documento.");
    else {
      if (source && !source.includes(normalizeForMatch(quote))) reasons.push("La cita no aparece tal cual en el documento.");
      if (name && !quoteMentions(quote, name)) reasons.push("La cita no menciona el nombre que se leyó.");
    }
    return quote ? { page, quote } : null;
  };

  const sure = (confidence: string, doubtText: string | null, reasons: string[]) => {
    if (confidence === "high") return true;
    reasons.push(`La IA no está segura${doubtText ? `: «${clean(doubtText).slice(0, 160)}»` : "."}`);
    return false;
  };

  const date = (value: string | null, what: string, reasons: string[]): string | undefined => {
    if (value === null || value.trim() === "") return undefined;
    const d = parseLooseDate(value);
    if (!d) {
      reasons.push(`La ${what} («${clean(value).slice(0, 30)}») no es una fecha; se dejó fuera.`);
      return undefined;
    }
    const year = Number(d.text.slice(0, 4));
    if (year < OLDEST_PLAUSIBLE_YEAR || d.time > latest) {
      reasons.push(`La ${what} (${d.text}) no es posible para este reporte; se dejó fuera.`);
      return undefined;
    }
    return d.text;
  };

  const amount = (value: number | null, what: string, reasons: string[]): number | undefined => {
    if (value === null) return undefined;
    if (!Number.isFinite(value) || value < 0 || value > MAX_PLAUSIBLE_AMOUNT) {
      reasons.push(`El ${what} (${value}) no es un monto posible; se dejó fuera.`);
      return undefined;
    }
    return Math.round(value * 100) / 100;
  };

  const notPresent = (bureau: Bureau, reasons: string[]) => {
    if (present.includes(bureau)) return false;
    reasons.push(`Está bajo ${BUREAU_LABEL[bureau]}, que el reporte no trae.`);
    return true;
  };

  // 5. Each entry.
  const sections: Partial<Record<Bureau, NonNullable<RawReport["bureaus"]["equifax"]>>> = {};
  for (const b of present) sections[b] = { tradelines: [], inquiries: [], publicRecords: [], personalInfo: [] };
  const drafts: Draft[] = [];

  for (const t of x.tradelines) {
    const reasons: string[] = [];
    const creditor = clean(t.creditor);
    let excluded = notPresent(t.bureau, reasons);
    if (!creditor) {
      reasons.push("No trae el nombre del acreedor.");
      excluded = true;
    }
    let account = clean(t.accountNumberMasked);
    if (account && !isMaskedAccount(account)) {
      account = maskAccount(account);
      reasons.push("El número de cuenta venía completo; se guarda solo con los últimos 4 dígitos.");
    }
    if (!account) reasons.push("No trae número de cuenta.");
    const citation = checkCitation(t.citation, creditor, reasons);
    const modelSure = sure(t.confidence, t.doubt, reasons);
    const openedAt = date(t.openedAt, "fecha de apertura", reasons);
    const lastReportedAt = date(t.lastReportedAt, "fecha del último reporte", reasons);
    const lastPaymentAt = date(t.lastPaymentAt, "fecha del último pago", reasons);
    const firstDelinquencyAt = date(t.firstDelinquencyAt, "fecha de la primera morosidad", reasons);
    if (openedAt && lastReportedAt && openedAt > lastReportedAt) reasons.push("La fecha de apertura es posterior a la del último reporte.");
    const balance = amount(t.balance, "saldo", reasons);
    const creditLimit = amount(t.creditLimit, "límite", reasons);
    const tradeline = {
      creditor,
      accountNumberMasked: account,
      accountType: clean(t.accountType),
      status: clean(t.status),
      paymentStatus: clean(t.paymentStatus),
      ...(balance !== undefined ? { balance } : {}),
      ...(creditLimit !== undefined ? { creditLimit } : {}),
      ...(openedAt ? { openedAt } : {}),
      ...(lastPaymentAt ? { lastPaymentAt } : {}),
      ...(firstDelinquencyAt ? { firstDelinquencyAt } : {}),
      ...(lastReportedAt ? { lastReportedAt } : {}),
      remarks: t.remarks.map(clean).filter(Boolean),
      // Furnisher addresses go on letters: they come only from the verified address book, never from a reading.
      furnisher: null,
    };
    drafts.push({ bureau: t.bureau, category: "tradeline", identity: `${creditor}|${account}`, label: account ? `${creditor} ${account}` : creditor, reasons, excluded, modelSure, citation, value: excluded ? null : tradeline });
  }

  for (const q of x.inquiries) {
    const reasons: string[] = [];
    const inquirer = clean(q.inquirer);
    let excluded = notPresent(q.bureau, reasons);
    if (!inquirer) {
      reasons.push("No trae quién hizo la consulta.");
      excluded = true;
    }
    const when = date(q.date, "fecha de la consulta", reasons);
    if (!when) {
      if (!reasons.some((r) => r.includes("fecha de la consulta"))) reasons.push("La consulta no trae fecha.");
      excluded = true;
    }
    const citation = checkCitation(q.citation, inquirer, reasons);
    const modelSure = sure(q.confidence, q.doubt, reasons);
    drafts.push({ bureau: q.bureau, category: "inquiry", identity: `${inquirer}|${when ?? ""}`, label: when ? `${inquirer} (${when})` : inquirer, reasons, excluded, modelSure, citation, value: excluded ? null : { inquirer, date: when, type: q.type } });
  }

  for (const p of x.publicRecords) {
    const reasons: string[] = [];
    const recordType = clean(p.recordType);
    let excluded = notPresent(p.bureau, reasons);
    if (!recordType) {
      reasons.push("No trae el tipo de registro.");
      excluded = true;
    }
    const court = clean(p.court);
    const filedAt = date(p.filedAt, "fecha de registro", reasons);
    const citation = checkCitation(p.citation, recordType, reasons);
    const modelSure = sure(p.confidence, p.doubt, reasons);
    const record = { recordType, court, ...(filedAt ? { filedAt } : {}), status: clean(p.status) };
    drafts.push({ bureau: p.bureau, category: "public_record", identity: `${recordType}|${court}|${filedAt ?? ""}`, label: `${recordType}${court ? ` — ${court}` : ""}`, reasons, excluded, modelSure, citation, value: excluded ? null : record });
  }

  for (const pi of x.personalInfo) {
    const reasons: string[] = [];
    const value = clean(pi.value);
    let excluded = notPresent(pi.bureau, reasons);
    if (!value) {
      reasons.push("El dato personal está vacío.");
      excluded = true;
    }
    const citation = checkCitation(pi.citation, "", reasons);
    const modelSure = sure(pi.confidence, pi.doubt, reasons);
    const label = { name: "Nombre", address: "Dirección", employer: "Empleador" }[pi.field];
    drafts.push({ bureau: pi.bureau, category: "personal_info", identity: `${pi.field}|${value}`, label: `${label}: ${value}`, reasons, excluded, modelSure, citation, value: excluded ? null : { field: pi.field, value } });
  }

  // 6. Repeats: one item per identity per bureau (two would collide when saved).
  const seen = new Set<string>();
  const items: ReviewedItem[] = drafts.map((draft) => {
    const fp = fingerprint(draft.bureau, draft.category, draft.identity);
    let excluded = draft.excluded;
    if (!excluded) {
      if (seen.has(fp)) {
        draft.reasons.push("Aparece repetido en el mismo buró; se guarda una sola vez. Revisa si son dos cuentas distintas.");
        excluded = true;
      } else {
        seen.add(fp);
        const value = draft.value;
        const section = sections[draft.bureau]!;
        if (draft.category === "tradeline") section.tradelines.push(value as never);
        if (draft.category === "inquiry") section.inquiries.push(value as never);
        if (draft.category === "public_record") section.publicRecords.push(value as never);
        if (draft.category === "personal_info") section.personalInfo.push(value as never);
      }
    }
    const confidence: Confidence = draft.modelSure && draft.reasons.length === 0 && !excluded ? "high" : "low";
    return { fingerprint: fp, bureau: draft.bureau, category: draft.category, label: draft.label, confidence, reasons: draft.reasons, citation: draft.citation, excluded };
  });
  // The first of a repeated pair is flagged too, so the person sees both.
  for (const item of items) {
    if (item.excluded && item.reasons.some((r) => r.startsWith("Aparece repetido"))) {
      const first = items.find((other) => other !== item && !other.excluded && other.fingerprint === item.fingerprint);
      if (first && !first.reasons.some((r) => r.startsWith("Tiene un repetido"))) {
        first.reasons.push("Tiene un repetido en el mismo buró: revisa si son dos cuentas distintas.");
        first.confidence = "low";
      }
    }
  }

  // 7. Scores (staff see them; the client app shows only the current number).
  for (const s of x.scores) {
    if (!present.includes(s.bureau)) continue;
    if (!Number.isInteger(s.score) || s.score < 300 || s.score > 850) {
      warnings.push(`El puntaje de ${BUREAU_LABEL[s.bureau]} que se leyó (${s.score}) no es posible; no se guarda.`);
      continue;
    }
    sections[s.bureau]!.score = s.score;
  }

  // 8. Counts against the report's own summary.
  for (const c of x.summaryCounts) {
    const section = sections[c.bureau];
    if (!section) continue;
    const check = (printed: number | null, got: number, what: [string, string]) => {
      if (printed === null || printed === got) return;
      warnings.push(
        `${BUREAU_LABEL[c.bureau]}: el resumen del reporte dice ${printed} ${printed === 1 ? what[0] : what[1]} y se leyeron ${got}. Revisa que no falte ni sobre ninguna.`,
      );
    };
    check(c.accounts, section.tradelines.length, ["cuenta", "cuentas"]);
    check(c.inquiries, section.inquiries.length, ["consulta", "consultas"]);
    check(c.publicRecords, section.publicRecords.length, ["registro público", "registros públicos"]);
  }
  if (x.summaryCounts.length === 0) warnings.push("El reporte no trae (o no se leyó) un resumen con el número de cuentas por buró, así que no se pudo comparar.");

  for (const part of x.unreadable) if (clean(part)) warnings.push(`No se pudo leer: ${clean(part).slice(0, 200)}`);

  const kept = items.filter((i) => !i.excluded).length;
  if (kept === 0 && fatal.length === 0) fatal.push("La lectura no encontró ninguna cuenta, consulta ni dato del reporte.");

  const provider = clean(x.provider) || null;
  if (fatal.length > 0 || !reportDate) return { raw: null, fatal, warnings, items, discard: false, provider };

  const raw = rawReportSchema.parse({
    source: providerKey(provider),
    pulledAt: new Date(reportDate.time).toISOString(),
    bureaus: sections,
  });
  return { raw, fatal, warnings, items, discard: false, provider };
}

/** Items a person should look at before saving: low confidence or left out. */
export function itemsToReview(validation: Pick<ReportValidation, "items">): ReviewedItem[] {
  return validation.items.filter((item) => item.confidence === "low" || item.excluded);
}
