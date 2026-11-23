import type { RawReport } from "./parser";
import type { Bureau, NormalizedReport, ReportItem } from "./types";

// Personal information on a report: names, addresses, birth dates, employers.
//
// Bureaus print the same entry many ways ("123 Main Street Apt 2" and
// "123 MAIN ST #2"), and monitoring reports repeat entries, so an import could
// add a client's old address again under a slightly different spelling, with a
// new fingerprint and no answer. Here an entry is compared by a NORMALIZED
// value, per bureau:
//
//   personalInfoKey     the comparable form of one entry (field + value);
//   dedupePersonalInfo  a raw report with repeats taken out: an entry already
//                       in the client's file (same bureau, same normalized
//                       value) keeps the file's own entry, so its fingerprint
//                       and the client's answer carry over; a second copy of
//                       one entry in the same report is dropped. The count of
//                       entries skipped is what the import preview shows.
//
// The fingerprint itself (parser.ts) is unchanged, so every answer and letter
// already on record still matches.
//
// Pure: no clock, no I/O.

const FIELD_ALIASES: Record<string, string> = {
  name: "name",
  names: "name",
  alias: "name",
  aka: "name",
  also_known_as: "name",
  address: "address",
  addresses: "address",
  current_address: "address",
  previous_address: "address",
  former_address: "address",
  dob: "dob",
  birth_date: "dob",
  birthdate: "dob",
  date_of_birth: "dob",
  year_of_birth: "dob",
  employer: "employer",
  employers: "employer",
  employment: "employer",
};

/** "Previous Address" / "previous_address" → "address"; an unknown field keeps its own name. */
export function personalInfoField(field: string): string {
  const key = field.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return FIELD_ALIASES[key] ?? key;
}

/** The kinds the import summaries and the client explanations talk about. */
export type PersonalInfoKind = "name" | "address" | "dob" | "employer" | "other";

export function personalInfoKind(field: string): PersonalInfoKind {
  const f = personalInfoField(field);
  return f === "name" || f === "address" || f === "dob" || f === "employer" ? f : "other";
}

// USPS-style abbreviations, so "Street" and "St." compare equal.
const ADDRESS_WORDS: Record<string, string> = {
  street: "st",
  str: "st",
  avenue: "ave",
  av: "ave",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  place: "pl",
  parkway: "pkwy",
  highway: "hwy",
  circle: "cir",
  terrace: "ter",
  trail: "trl",
  square: "sq",
  apartment: "apt",
  unit: "apt",
  suite: "ste",
  number: "apt",
  no: "apt",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  texas: "tx",
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, diciembre: 12,
};

/** Lowercase, accents off, punctuation to spaces, single spaces. */
function plain(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A birth date in any of the usual spellings → "YYYY-MM-DD" (or "YYYY-MM", "YYYY"); null when it cannot be read. */
export function normalizeBirthDate(value: string): string | null {
  const v = value.trim().toLowerCase();
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(v);
  if (m) return m[3] ? `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` : `${m[1]}-${pad(Number(m[2]))}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(v);
  if (m) return `${m[2]}-${pad(Number(m[1]))}`;
  m = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (m && MONTHS[m[1]!]) return `${m[3]}-${pad(MONTHS[m[1]!]!)}-${pad(Number(m[2]))}`;
  m = /^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?,?\s+(?:de\s+)?(\d{4})$/.exec(v);
  if (m && MONTHS[m[2]!]) return `${m[3]}-${pad(MONTHS[m[2]!]!)}-${pad(Number(m[1]))}`;
  m = /^([a-z]+)\.?\s+(\d{4})$/.exec(v);
  if (m && MONTHS[m[1]!]) return `${m[2]}-${pad(MONTHS[m[1]!]!)}`;
  if (/^\d{4}$/.test(v)) return v;
  return null;
}

function normalizeAddress(value: string): string {
  const words = plain(value.replace(/#\s*/g, " apt ")).split(" ");
  const out = words.map((w) => ADDRESS_WORDS[w] ?? w);
  // ZIP+4 → ZIP, and "apt apt 2" (from "Apt #2") → "apt 2".
  return out
    .join(" ")
    .replace(/\b(\d{5}) (\d{4})\b/g, "$1")
    .replace(/\b(apt|ste)( (apt|ste))+\b/g, "$1")
    .trim();
}

const COMPANY_SUFFIXES = new Set(["inc", "llc", "ltd", "co", "corp", "corporation", "company", "incorporated", "lp", "llp", "pllc"]);

function normalizeEmployer(value: string): string {
  // "L.L.C." → "LLC" before the punctuation goes.
  const words = plain(value.replace(/\./g, "")).split(" ");
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

/** The comparable form of one entry: "address|123 main st apt 2 houston tx 77001". */
export function personalInfoKey(field: string, value: string): string {
  const f = personalInfoField(field);
  let v: string;
  if (f === "address") v = normalizeAddress(value);
  else if (f === "dob") v = normalizeBirthDate(value) ?? plain(value);
  else if (f === "employer") v = normalizeEmployer(value);
  else v = plain(value);
  return `${f}|${v}`;
}

/** The key of a personal-info report item, or null for any other kind of item. */
export function personalInfoItemKey(item: Pick<ReportItem, "category" | "data">): string | null {
  if (item.category !== "personal_info") return null;
  const data = item.data as { field?: unknown; value?: unknown };
  return typeof data.field === "string" && typeof data.value === "string" ? personalInfoKey(data.field, data.value) : null;
}

/** One entry the dedupe left out, and why. */
export interface PersonalInfoRepeat {
  bureau: Bureau;
  field: string;
  /** The entry as this report printed it. */
  value: string;
  /** "on_file": the client's file already has it (kept as the file has it). "in_report": the same report lists it twice. */
  reason: "on_file" | "in_report";
  /** The entry it was folded into. */
  keptValue: string;
}

export interface PersonalInfoDedupe {
  /** The report with every repeat taken out. Everything else is untouched. */
  raw: RawReport;
  /** How many personal-info entries were not added again. */
  skipped: number;
  repeats: PersonalInfoRepeat[];
}

/**
 * Take repeats out of a report's personal information before it is saved.
 * `previous` is the report on file (null on a first report): an entry it
 * already has for the same bureau is kept exactly as the file has it, so it is
 * the same item with the same answer, not a new one.
 */
export function dedupePersonalInfo(raw: RawReport, previous: NormalizedReport | null): PersonalInfoDedupe {
  const repeats: PersonalInfoRepeat[] = [];
  const bureaus: RawReport["bureaus"] = {};
  for (const [key, section] of Object.entries(raw.bureaus) as Array<[Bureau, NonNullable<RawReport["bureaus"][Bureau]>]>) {
    // A section without the list (the parser's default fills it) is left exactly as it came.
    if (!section || !Array.isArray(section.personalInfo)) {
      if (section) bureaus[key] = section;
      continue;
    }
    const onFile = new Map<string, { field: string; value: string }>();
    for (const item of previous?.items ?? []) {
      if (item.bureau !== key) continue;
      const k = personalInfoItemKey(item);
      const data = item.data as { field: string; value: string };
      if (k && !onFile.has(k)) onFile.set(k, { field: data.field, value: data.value });
    }
    const seen = new Map<string, string>();
    const kept: Array<{ field: string; value: string }> = [];
    for (const entry of section.personalInfo) {
      const k = personalInfoKey(entry.field, entry.value);
      const already = seen.get(k);
      if (already !== undefined) {
        repeats.push({ bureau: key, field: entry.field, value: entry.value, reason: "in_report", keptValue: already });
        continue;
      }
      const file = onFile.get(k);
      if (file) {
        repeats.push({ bureau: key, field: entry.field, value: entry.value, reason: "on_file", keptValue: file.value });
        kept.push({ ...entry, field: file.field, value: file.value });
        seen.set(k, file.value);
        continue;
      }
      kept.push(entry);
      seen.set(k, entry.value);
    }
    bureaus[key] = { ...section, personalInfo: kept };
  }
  return { raw: { ...raw, bureaus }, skipped: repeats.length, repeats };
}
