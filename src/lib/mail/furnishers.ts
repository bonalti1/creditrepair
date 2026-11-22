import { z } from "zod";
import { formatUsAddress, parseUsAddress } from "./address";

// The furnisher address book: where letters to creditors and debt collectors
// are mailed.
//
// A credit report names a company the way its computer abbreviates it
// ("MIDLAND CREDIT MGMT", "CAP ONE"), and a report may print an address for
// it, which is usually a payments or general address, not where disputes go.
// So a letter to a furnisher is mailed only to an address in this book that a
// person checked against a source and dated. There is no fallback: a company
// with no checked address holds the round, and the team sees which company
// needs one (stage.ts: furnisher_address_missing). Nothing here guesses.
//
// Matching is exact after normalizing (normalizeCompanyName): case, accents,
// punctuation, common abbreviations and legal suffixes do not matter; any
// other difference does. "MIDLAND CREDIT MGMT INC." finds "Midland Credit
// Management"; "MIDLAND FUNDING" does not (a different company). To teach the
// book a spelling, add it as an alias.

export interface FurnisherChange {
  at: string;
  /** The teammate who saved it. */
  by: string;
  changes: Array<{ field: FurnisherField; from: string; to: string }>;
}

export interface FurnisherEntry {
  id: string;
  /** The company's name, as it should appear on the envelope. */
  name: string;
  /** Other spellings, as reports print them ("MIDLAND CREDIT MGMT", "MCM"). */
  aliases: string[];
  /** Where disputes are mailed. Empty until someone finds it. */
  addressLines: string[];
  phone: string | null;
  notes: string | null;
  /** Where the address was checked: a link to the company's own page, or the letter it came from. */
  source: string | null;
  /** The day a person checked the address against the source (YYYY-MM-DD). Null: not checked, not used. */
  verifiedOn: string | null;
  updatedAt: string;
  updatedBy: string;
  /** Every save, oldest first. Never edited. */
  history: FurnisherChange[];
}

export type FurnisherField = "name" | "aliases" | "addressLines" | "phone" | "notes" | "source" | "verifiedOn";

export const FURNISHER_FIELD_LABEL: Record<FurnisherField, string> = {
  name: "Nombre",
  aliases: "Otros nombres",
  addressLines: "Dirección para disputas",
  phone: "Teléfono",
  notes: "Notas",
  source: "Fuente",
  verifiedOn: "Verificada el",
};

/** The same, for a member whose console is in English. */
export const FURNISHER_FIELD_LABEL_EN: Record<FurnisherField, string> = {
  name: "Name",
  aliases: "Other names",
  addressLines: "Dispute address",
  phone: "Phone",
  notes: "Notes",
  source: "Source",
  verifiedOn: "Verified on",
};

// ── Names ───────────────────────────────────────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  MGMT: "MANAGEMENT",
  MGT: "MANAGEMENT",
  MNGMT: "MANAGEMENT",
  MANAGMENT: "MANAGEMENT",
  SVC: "SERVICES",
  SVCS: "SERVICES",
  SERVICE: "SERVICES",
  SRVCS: "SERVICES",
  FIN: "FINANCIAL",
  FINL: "FINANCIAL",
  FINCL: "FINANCIAL",
  NATL: "NATIONAL",
  ASSOC: "ASSOCIATES",
  ASSN: "ASSOCIATION",
  INTL: "INTERNATIONAL",
  CR: "CREDIT",
  CRED: "CREDIT",
  BK: "BANK",
  COLL: "COLLECTION",
  COLLS: "COLLECTIONS",
  RECOV: "RECOVERY",
  ACCPT: "ACCEPTANCE",
  ACPT: "ACCEPTANCE",
  MTG: "MORTGAGE",
};

/** Words that say what kind of legal entity it is, not which company. Dropped when comparing. */
const LEGAL_WORDS = new Set(["INC", "INCORPORATED", "LLC", "LLP", "LP", "LTD", "CORP", "CORPORATION", "CO", "COMPANY", "NA", "PLC", "THE"]);

/**
 * The comparison key for a company name: upper case, no accents or
 * punctuation, "&" as AND, abbreviations spelled out, legal-form words
 * dropped, spaces removed. "Midland Credit Mgmt., Inc." → "MIDLANDCREDITMANAGEMENT".
 */
export function normalizeCompanyName(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    // "N.A." and "N A" are one word before punctuation goes.
    .replace(/\bN\.?\s?A\.?(?=\s|$|,)/g, " NA ")
    .replace(/['’`]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? word)
    .filter((word) => !LEGAL_WORDS.has(word));
  return words.join("");
}

/** Every key an entry answers to: its name and each alias. */
export function entryKeys(entry: Pick<FurnisherEntry, "name" | "aliases">): string[] {
  return [...new Set([entry.name, ...entry.aliases].map(normalizeCompanyName).filter(Boolean))];
}

export type FurnisherMatch =
  | { status: "found"; entry: FurnisherEntry }
  | { status: "none" }
  | { status: "ambiguous"; entries: FurnisherEntry[] };

/** The book's entry for a company name, by exact normalized name or alias. */
export function findFurnisher(book: readonly FurnisherEntry[], name: string): FurnisherMatch {
  const key = normalizeCompanyName(name);
  if (!key) return { status: "none" };
  const hits = book.filter((entry) => entryKeys(entry).includes(key));
  if (hits.length === 0) return { status: "none" };
  if (hits.length > 1) return { status: "ambiguous", entries: hits };
  return { status: "found", entry: hits[0]! };
}

/**
 * Entries whose name shares most of its words with this one, when there is
 * no exact match: "MIDLAND CREDIT" and "Midland Credit Management". Only a
 * SUGGESTION for a person ("¿Es la misma empresa?"): a letter is never mailed
 * on a near match, only on an exact name or alias a person added.
 */
export function nearFurnishers(book: readonly FurnisherEntry[], name: string, limit = 3): FurnisherEntry[] {
  const words = (s: string) =>
    new Set(
      s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .split(" ")
        .map((w) => ABBREVIATIONS[w] ?? w)
        .filter((w) => w.length > 1 && !LEGAL_WORDS.has(w)),
    );
  const mine = words(name);
  if (mine.size === 0) return [];
  const scored = book
    .map((entry) => {
      const best = Math.max(
        ...[entry.name, ...entry.aliases].map((candidate) => {
          const theirs = words(candidate);
          const shared = [...mine].filter((w) => theirs.has(w)).length;
          return shared / Math.max(mine.size, theirs.size, 1);
        }),
      );
      return { entry, best };
    })
    .filter((s) => s.best >= 0.5 && !entryKeys(s.entry).includes(normalizeCompanyName(name)))
    .sort((a, b) => b.best - a.best);
  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * A company whose dispute address is missing, as recorded once for every
 * client (furnisher_gaps, migration 0022): when it was first seen missing
 * (the queue's clock counts from here) and when it was resolved.
 */
export interface FurnisherGapRecord {
  normalizedName: string;
  company: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

// ── Addresses ───────────────────────────────────────────────────────────

export type AddressResolution =
  | { ok: true; entry: FurnisherEntry; addressLines: string[] }
  | {
      ok: false;
      reason: "unknown" | "no_address" | "not_verified" | "bad_address" | "ambiguous";
      entry: FurnisherEntry | null;
      /** One sentence for staff, naming the company. */
      message: string;
    };

/**
 * Where a letter to this company is mailed, or why it cannot be. Only a
 * complete US address that a person dated against a source is used.
 */
export function resolveFurnisherAddress(book: readonly FurnisherEntry[], name: string): AddressResolution {
  const match = findFurnisher(book, name);
  if (match.status === "ambiguous") {
    return {
      ok: false,
      reason: "ambiguous",
      entry: null,
      message: `«${name}» coincide con ${match.entries.length} empresas de la libreta (${match.entries.map((e) => e.name).join(", ")}). Deja ese nombre en una sola.`,
    };
  }
  if (match.status === "none") {
    return { ok: false, reason: "unknown", entry: null, message: `${name} no está en la libreta de acreedores. Falta su dirección para disputas.` };
  }
  const entry = match.entry;
  if (entry.addressLines.length === 0) {
    return { ok: false, reason: "no_address", entry, message: `Falta la dirección para disputas de ${entry.name}.` };
  }
  if (!entry.verifiedOn || !entry.source) {
    return { ok: false, reason: "not_verified", entry, message: `La dirección de ${entry.name} no está verificada (falta la fuente o la fecha).` };
  }
  const parsed = parseUsAddress(entry.addressLines);
  if (!parsed.ok) {
    return { ok: false, reason: "bad_address", entry, message: `La dirección de ${entry.name} no se puede leer: ${parsed.message}` };
  }
  return { ok: true, entry, addressLines: formatUsAddress(parsed.address) };
}

// ── Saving ──────────────────────────────────────────────────────────────

const text = (max: number) => z.string().max(max).transform((s) => s.replace(/\s+/g, " ").trim());

/** What the form sends. The same schema checks it in the browser and on the server. */
export const furnisherInputSchema = z.object({
  id: z.string().max(64).optional(),
  name: text(120),
  aliases: z.array(text(120)).max(20),
  addressLines: z.array(text(80)).max(5),
  phone: text(40),
  notes: text(1000),
  source: text(500),
  verifiedOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
});

export type FurnisherInput = z.input<typeof furnisherInputSchema>;

export type FurnisherCheck =
  | { ok: true; value: Omit<FurnisherEntry, "id" | "updatedAt" | "updatedBy" | "history"> & { id?: string } }
  | { ok: false; problems: string[] };

/**
 * Validates a save against the rest of the book. An address must read as a
 * complete US address; "verified on" needs an address and a source and cannot
 * be in the future; a name or alias may belong to one company only.
 */
export function checkFurnisherInput(input: FurnisherInput, book: readonly FurnisherEntry[], today: Date): FurnisherCheck {
  const parsed = furnisherInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problems: ["Revisa los campos: alguno es demasiado largo o tiene un formato que no se reconoce."] };
  const v = parsed.data;
  const problems: string[] = [];

  if (!v.name) problems.push("Escribe el nombre de la empresa.");
  // Spellings are kept as the reports print them ("MIDLAND CREDIT MGMT" stays, even though it
  // matches the name anyway: staff read them); only exact repeats (any case) are dropped.
  const seen = new Set([v.name.toLowerCase()]);
  const aliases = v.aliases.filter((a) => {
    const key = a.toLowerCase();
    if (!a || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const lines = v.addressLines.filter(Boolean);
  let addressLines: string[] = [];
  if (lines.length > 0) {
    const address = parseUsAddress(lines);
    if (address.ok) addressLines = formatUsAddress(address.address);
    else problems.push(`La dirección no se puede leer: ${address.message}`);
  }

  if (v.verifiedOn) {
    if (lines.length === 0) problems.push("Una dirección verificada necesita la dirección.");
    if (!v.source) problems.push("Escribe la fuente: dónde se comprobó la dirección (enlace a la página de la empresa, o la carta de la que salió).");
    const day = new Date(`${v.verifiedOn}T12:00:00Z`);
    if (Number.isNaN(day.getTime())) problems.push("La fecha de verificación no es válida.");
    else if (v.verifiedOn > today.toISOString().slice(0, 10)) problems.push("La fecha de verificación no puede ser futura.");
  }

  // One company per name.
  const others = book.filter((entry) => entry.id !== v.id);
  for (const candidate of [v.name, ...aliases].filter(Boolean)) {
    const key = normalizeCompanyName(candidate);
    const clash = others.find((entry) => entryKeys(entry).includes(key));
    if (clash) problems.push(`«${candidate}» ya corresponde a ${clash.name}.`);
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      ...(v.id ? { id: v.id } : {}),
      name: v.name,
      aliases,
      addressLines,
      phone: v.phone || null,
      notes: v.notes || null,
      source: v.source || null,
      verifiedOn: v.verifiedOn || null,
    },
  };
}

const show = (value: unknown): string => (Array.isArray(value) ? value.join(" · ") : value == null ? "" : String(value));

/** What changed between two versions of an entry, field by field. Empty when nothing did. */
export function furnisherChanges(
  before: Pick<FurnisherEntry, FurnisherField> | null,
  after: Pick<FurnisherEntry, FurnisherField>,
): FurnisherChange["changes"] {
  const fields: FurnisherField[] = ["name", "aliases", "addressLines", "phone", "notes", "source", "verifiedOn"];
  return fields.flatMap((field) => {
    const from = show(before?.[field]);
    const to = show(after[field]);
    return from === to ? [] : [{ field, from, to }];
  });
}

// ── Seed ────────────────────────────────────────────────────────────────

/**
 * The companies the demo's reports name. Names and spellings only, except
 * where the company's own site gives a dispute address:
 *
 * Capital One: P.O. Box 31293, Salt Lake City, UT 84131-1293, "for credit
 * bureau disputes", from Capital One's help center page on disputing items on
 * a credit report (credit cards). Read on 2026-11-21 through a web search
 * excerpt of that page; the page could not be opened from the build
 * environment. Capital One auto loans use a different address. Open the
 * source before the first real letter.
 *
 * Midland Credit Management: no address on the company's own site could be
 * read. Left empty on purpose: its letters wait until a person adds it.
 *
 * "Sample Medical Collections" is invented (the demo report's medical
 * collection); it has no address and never will.
 */
export const FURNISHER_SEED: ReadonlyArray<Omit<FurnisherEntry, "updatedAt" | "updatedBy" | "history">> = [
  {
    id: "f-capital-one",
    name: "Capital One",
    aliases: ["CAPITAL ONE BANK USA NA", "CAPITAL ONE N.A.", "CAP ONE", "CAPITAL ONE BANK"],
    addressLines: ["P.O. Box 31293", "Salt Lake City, UT 84131-1293"],
    phone: null,
    notes: "Tarjetas de crédito. Los préstamos de auto de Capital One usan otra dirección.",
    source: "https://www.capitalone.com/help-center/credit-cards/disputing-items-on-your-credit-report/",
    verifiedOn: "2026-11-21",
  },
  {
    id: "f-midland",
    name: "Midland Credit Management",
    aliases: ["MIDLAND CREDIT MGMT", "MIDLAND CREDIT MANAGEMENT INC", "MCM"],
    addressLines: [],
    phone: null,
    notes: "Agencia de cobranza. Falta la dirección para disputas: búscala en su sitio o en una carta que le haya llegado al cliente.",
    source: null,
    verifiedOn: null,
  },
  {
    id: "f-sample-medical",
    name: "Sample Medical Collections",
    aliases: ["SAMPLE MEDICAL COLL"],
    addressLines: [],
    phone: null,
    notes: "Empresa inventada de la demo.",
    source: null,
    verifiedOn: null,
  },
];
