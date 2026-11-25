import { suggestCategory, type CategoryKey } from "./categories";
import { activeExpenses, isClosed, vendorWords } from "./expenses";
import { parseMoney } from "./money";
import { daysBetween, isDay, monthOf } from "./periods";
import type { Bilingual, Expense, MonthClose } from "./types";

// Files in: a bank statement (CSV) and a processor's export (CSV). Read in
// the browser, shown with a mapping step (which column is the date, the
// description, the amount), checked line by line, and only then sent. The
// server checks every line again.

/** The most lines one file may bring in. */
export const MAX_IMPORT_LINES = 3000;
/** The largest file read: 2 MB of text. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** RFC 4180 CSV (quotes, doubled quotes, line breaks inside quotes), comma, semicolon or tab. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<string, number>;
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]! += 1;
  }
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
  return rows;
}

/** "03/07/2026", "3/7/26", "2026-03-07", "03-07-2026", "2026/03/07", "07 Mar 2026" → "2026-03-07"; null otherwise. */
export function parseDay(value: string): string | null {
  const text = value.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?.*$/i, "").replace(/T.*$/, "");
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/))) {
    // US banks: month first.
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else if ((match = text.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]+(\d{4})$/))) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    [d, m, y] = [Number(match[1]), months.indexOf(match[2]!.toLowerCase()) + 1, Number(match[3])];
  } else if ((match = text.match(/^([A-Za-z]{3})[a-z]*[ -](\d{1,2}),?[ -](\d{4})$/))) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    [m, d, y] = [months.indexOf(match[1]!.toLowerCase()) + 1, Number(match[2]), Number(match[3])];
  } else return null;
  const day = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isDay(day) ? day : null;
}

// ── The mapping step ────────────────────────────────────────────────────

export interface BankMapping {
  /** Column indexes; null when the file has no such column. */
  date: number | null;
  description: number | null;
  /** One signed amount column… */
  amount: number | null;
  /** …or two: money out and money in. */
  debit: number | null;
  credit: number | null;
  /** How the single amount column writes money out. */
  outflowIs: "negative" | "positive";
  /** Rows to skip before the header (some banks print an account summary first). */
  headerRow: number;
}

const has = (header: string, words: string[]) => words.some((w) => header.includes(w));

/** A first guess at the columns from the header's words. The person confirms or changes it. */
export function guessBankMapping(rows: string[][]): BankMapping {
  // The header is the first row with a date-like and an amount-like word.
  let headerRow = rows.findIndex((r) => r.some((c) => /date|fecha/i.test(c)) && r.some((c) => /amount|debit|credit|withdraw|deposit|monto|cargo|abono/i.test(c)));
  if (headerRow < 0) headerRow = 0;
  const header = (rows[headerRow] ?? []).map((h) => h.toLowerCase());
  const find = (pred: (h: string) => boolean) => {
    const i = header.findIndex(pred);
    return i >= 0 ? i : null;
  };
  /** The first header that matches the earliest word in the list: the words are in order of preference. */
  const prefer = (words: string[]) => {
    for (const w of words) {
      const i = header.findIndex((h) => h.includes(w));
      if (i >= 0) return i;
    }
    return null;
  };
  const date = find((h) => has(h, ["posting date", "posted date", "transaction date", "post date"])) ?? find((h) => has(h, ["date", "fecha"]));
  const description = prefer(["description", "descripcion", "descripción", "payee", "merchant", "concepto", "memo", "name", "details"]);
  const debit = find((h) => has(h, ["debit", "withdrawal", "money out", "cargo", "retiro"]));
  const credit = find((h) => has(h, ["credit", "deposit", "money in", "abono", "deposito", "depósito"]));
  const amount = find((h) => has(h, ["amount", "monto", "importe"]) && !has(h, ["balance", "saldo"]));
  const split = debit !== null && credit !== null;
  return { date, description, amount: split ? null : amount, debit: split ? debit : null, credit: split ? credit : null, outflowIs: "negative", headerRow };
}

export interface BankLine {
  /** 1-based line of the file, for the person to find it. */
  line: number;
  day: string | null;
  description: string;
  /** Signed: money out is negative. Null when the amount could not be read. */
  amountCents: number | null;
  problem: Bilingual | null;
}

export function readBankLines(rows: string[][], m: BankMapping): BankLine[] {
  const body = rows.slice(m.headerRow + 1).slice(0, MAX_IMPORT_LINES);
  return body.map((r, i) => {
    const line = m.headerRow + 2 + i;
    const day = m.date !== null ? parseDay(r[m.date] ?? "") : null;
    const description = (m.description !== null ? (r[m.description] ?? "") : "").replace(/\s+/g, " ").trim().slice(0, 200);
    let amountCents: number | null = null;
    if (m.amount !== null) {
      const v = parseMoney(r[m.amount] ?? "");
      amountCents = v === null ? null : m.outflowIs === "negative" ? v : -v;
    } else if (m.debit !== null || m.credit !== null) {
      const out = m.debit !== null ? parseMoney(r[m.debit] ?? "") : null;
      const inn = m.credit !== null ? parseMoney(r[m.credit] ?? "") : null;
      if (out !== null && out !== 0) amountCents = -Math.abs(out);
      else if (inn !== null && inn !== 0) amountCents = Math.abs(inn);
      else if (out === 0 || inn === 0) amountCents = 0;
    }
    let problem: Bilingual | null = null;
    if (!day) problem = { en: "The date can't be read.", es: "No se puede leer la fecha." };
    else if (amountCents === null) problem = { en: "The amount can't be read.", es: "No se puede leer el monto." };
    else if (!description) problem = { en: "No description.", es: "Sin descripción." };
    return { line, day, description, amountCents, problem };
  });
}

/** The same bank line, whatever file it came in: day | amount | first words. */
export function bankFingerprint(day: string, amountCents: number, description: string): string {
  return `${day}|${amountCents}|${vendorWords(description)}`;
}

export type BankLineStatus = "new" | "inflow" | "duplicate_file" | "duplicate_books" | "closed_month" | "invalid" | "zero";

export interface PlannedLine extends BankLine {
  status: BankLineStatus;
  fingerprint: string | null;
  suggested: CategoryKey | null;
  /** The expense already in the books that this line looks like. */
  matchesExpenseId: string | null;
}

export const BANK_STATUS_LABEL: Record<BankLineStatus, Bilingual> = {
  new: { en: "New expense", es: "Gasto nuevo" },
  inflow: { en: "Money in (not an expense)", es: "Entrada (no es gasto)" },
  duplicate_file: { en: "Twice in this file", es: "Dos veces en este archivo" },
  duplicate_books: { en: "Already in the books", es: "Ya está en los libros" },
  closed_month: { en: "Closed month", es: "Mes cerrado" },
  invalid: { en: "Can't be read", es: "No se puede leer" },
  zero: { en: "Zero amount", es: "Monto cero" },
};

/**
 * What each line would do. A money-out line is a new expense unless the same
 * line is already in the books (same fingerprint), or an expense of the same
 * amount within 3 days whose vendor words match (entered by hand before the
 * statement came). Money in is never an expense: deposits from the processor
 * are matched in reconciliation.
 */
export function planBankImport(lines: readonly BankLine[], existing: readonly Expense[], closes: readonly MonthClose[]): PlannedLine[] {
  const seen = new Set<string>();
  const books = activeExpenses(existing);
  const prints = new Map(books.filter((e) => e.bankFingerprint).map((e) => [e.bankFingerprint!, e.id]));
  return lines.map((l): PlannedLine => {
    if (l.problem || !l.day || l.amountCents === null) return { ...l, status: "invalid", fingerprint: null, suggested: null, matchesExpenseId: null };
    const fingerprint = bankFingerprint(l.day, l.amountCents, l.description);
    const suggested = suggestCategory(l.description);
    const base = { ...l, fingerprint, suggested, matchesExpenseId: null as string | null };
    if (l.amountCents === 0) return { ...base, status: "zero" };
    if (l.amountCents > 0) return { ...base, status: "inflow" };
    if (seen.has(fingerprint)) return { ...base, status: "duplicate_file" };
    seen.add(fingerprint);
    const exact = prints.get(fingerprint);
    if (exact) return { ...base, status: "duplicate_books", matchesExpenseId: exact };
    const words = vendorWords(l.description);
    // Entered by hand before the statement came: same amount within 3 days, and
    // the vendor's name in the line, or the line's words pointing at the same category.
    const near = books.find(
      (e) =>
        e.amountCents === -l.amountCents! &&
        Math.abs(daysBetween(e.spentOn, l.day!)) <= 3 &&
        (words.includes(vendorWords(e.vendor).split(" ")[0] || "\u0000") || (suggested !== null && suggested === e.category)),
    );
    if (near) return { ...base, status: "duplicate_books", matchesExpenseId: near.id };
    if (isClosed(monthOf(l.day), closes)) return { ...base, status: "closed_month" };
    return { ...base, status: "new" };
  });
}

/** A short vendor name from a bank line: "POS PURCHASE LOB.COM 415-555..." → "Lob.com". */
export function vendorFromDescription(description: string): string {
  const cleaned = description
    .replace(/^(pos|debit card|card|ach|online|recurring)?\s*(purchase|payment|debit|withdrawal|pmt)?\s*/i, "")
    .replace(/\s+\d[\d-]{5,}.*$/, "")
    .replace(/\s{2,}.*/, "")
    .trim();
  const name = (cleaned || description).slice(0, 60);
  return name
    .toLowerCase()
    .split(" ")
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** SHA-256 of the file's text, as hex (Web Crypto; the same file twice is refused). */
export async function fileSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
