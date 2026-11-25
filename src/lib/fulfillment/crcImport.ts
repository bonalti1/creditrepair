import { isForbiddenFieldName } from "../highlevel/lead";

// Importing clients, leads and affiliates from Credit Repair Cloud's CSV
// export (/equipo/importar, administrators; docs/FULFILLMENT.md, "Moving from
// Credit Repair Cloud"). Pure: the screen runs it for the dry run, the route
// runs it again on the server before anything is written.
//
// CRC's column names. CRC's help center (intercom.help/crc-support) could not
// be opened from the build environment, so the names below are the ones CRC
// is known to use in its client and affiliate exports, plus the usual
// variants. NOT verified against a real export: the mapping step shows what
// was detected and lets the administrator point any field at another column,
// and a column nobody maps is never stored.
//
// What is never kept, whatever the mapping says:
//   - a column whose name says it holds a Social Security number, an ITIN or
//     a date of birth (the same rule as the HighLevel webhook:
//     highlevel/lead.ts isForbiddenFieldName) is dropped before the preview,
//     and the screen lists it;
//   - any cell elsewhere that looks like an SSN is blanked, and the row says so.
//
// Only Texas is open (src/lib/compliance): a row from another state is not
// imported, and Georgia never. Nothing is charged: an imported person is a
// prospect with an invitation to finish onboarding and sign Credalti's own
// agreement.

export type ImportKind = "clients" | "leads" | "affiliates";

export type ImportField =
  | "fullName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "altPhone"
  | "state"
  | "city"
  | "status"
  | "assignedTo"
  | "referredBy"
  | "added"
  | "company";

export const FIELDS_BY_KIND: Record<ImportKind, readonly ImportField[]> = {
  clients: ["firstName", "lastName", "fullName", "phone", "altPhone", "email", "state", "city", "status", "assignedTo", "referredBy", "added"],
  leads: ["firstName", "lastName", "fullName", "phone", "altPhone", "email", "state", "city", "status", "assignedTo", "referredBy", "added"],
  affiliates: ["firstName", "lastName", "fullName", "company", "phone", "altPhone", "email", "state"],
};

/** Header names, lowercased with punctuation turned into spaces. The first that matches wins. */
export const CRC_ALIASES: Record<ImportField, readonly string[]> = {
  firstName: ["first name", "firstname", "first", "client first name", "given name", "nombre"],
  lastName: ["last name", "lastname", "last", "client last name", "surname", "family name", "apellido", "apellidos"],
  fullName: ["name", "full name", "client name", "client", "contact name", "affiliate name", "nombre completo"],
  phone: ["phone mobile", "mobile phone", "mobile", "cell phone", "cell", "phone cell", "phone", "phone number", "primary phone", "telefono", "celular"],
  altPhone: ["phone home", "home phone", "phone work", "work phone", "other phone", "phone 2", "secondary phone"],
  email: ["email", "email address", "e mail", "primary email", "correo"],
  state: ["state", "st", "state province", "province", "estado"],
  city: ["city", "ciudad"],
  status: ["status", "client status", "lead status", "contact status", "type", "stage"],
  assignedTo: ["assigned to", "team member", "assigned team member", "agent", "sales rep", "salesperson", "owner", "account manager"],
  referredBy: ["referred by", "affiliate", "referrer", "referral", "affiliate name referred"],
  added: ["date added", "added", "created", "created date", "created at", "start date", "signup date", "date created"],
  company: ["company", "company name", "business", "business name", "organization"],
};

export type Mapping = Partial<Record<ImportField, number>>;

const norm = (header: string) =>
  header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The columns that are dropped before anything else: SSN, ITIN, date of birth. Names only. */
export function sensitiveColumns(headers: readonly string[]): number[] {
  return headers.flatMap((h, i) => (isForbiddenFieldName(h) || /\bdate of birth\b|\bbirth ?date\b|\bss ?#|\bsocial\b/.test(norm(h)) ? [i] : []));
}

/** CRC's columns, found by name. A sensitive column is never mapped. */
export function detectMapping(headers: readonly string[], kind: ImportKind): Mapping {
  const blocked = new Set(sensitiveColumns(headers));
  const normalized = headers.map(norm);
  const mapping: Mapping = {};
  const used = new Set<number>();
  for (const field of FIELDS_BY_KIND[kind]) {
    for (const alias of CRC_ALIASES[field]) {
      const index = normalized.findIndex((h, i) => h === alias && !blocked.has(i) && !used.has(i));
      if (index >= 0) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  // "Name" alone is a full name only when there is no first/last pair.
  if (mapping.firstName !== undefined && mapping.lastName !== undefined) delete mapping.fullName;
  return mapping;
}

/** A mapping with every sensitive column taken out, whatever was chosen. */
export function safeMapping(headers: readonly string[], mapping: Mapping): Mapping {
  const blocked = new Set(sensitiveColumns(headers));
  return Object.fromEntries(Object.entries(mapping).filter(([, i]) => typeof i === "number" && i >= 0 && i < headers.length && !blocked.has(i))) as Mapping;
}

const SSN_IN_TEXT = /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/;

/** US phone → E.164 (+1XXXXXXXXXX), or null. The same shape the prospects table checks. */
export function toUsE164(value: string | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

const STATE_NAMES: Record<string, string> = { texas: "TX", georgia: "GA", tx: "TX", ga: "GA" };

/** "TX", "Texas", "tx " → "TX"; any two letters → upper case; else null. */
export function toState(value: string | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (STATE_NAMES[v]) return STATE_NAMES[v]!;
  return /^[a-z]{2}$/.test(v) ? v.toUpperCase() : null;
}

export type CrcStatus = "client" | "lead" | "inactive" | "unknown";

/** CRC's status words: Client, Lead, Prospect, Inactive, Suspended, Cancelled… */
export function crcStatus(value: string | undefined, kind: ImportKind): CrcStatus {
  const v = norm(value ?? "");
  if (/inactive|suspend|cancel|archiv|lost|dead|closed|former|terminated/.test(v)) return "inactive";
  if (/client|active|enrolled/.test(v)) return "client";
  if (/lead|prospect|new/.test(v)) return "lead";
  if (!v) return kind === "clients" ? "client" : kind === "leads" ? "lead" : "unknown";
  return "unknown";
}

export type RowReason =
  | "no_name"
  | "no_phone"
  | "bad_phone"
  | "no_state"
  | "state_closed"
  | "state_never"
  | "inactive"
  | "duplicate_in_file"
  | "duplicate_prospect"
  | "duplicate_client"
  | "duplicate_partner"
  | "bad_email"
  | "ssn_value_dropped";

export type RowOutcome = "create" | "duplicate" | "problem" | "skip";

export interface PlannedRow {
  /** 1-based line of the file, the header being line 1. */
  line: number;
  outcome: RowOutcome;
  reasons: RowReason[];
  firstName: string;
  lastName: string;
  phoneE164: string | null;
  email: string | null;
  state: string | null;
  city: string | null;
  company: string | null;
  status: CrcStatus;
  statusText: string | null;
  assignedTo: string | null;
  referredBy: string | null;
  added: string | null;
}

export interface Existing {
  /** E.164 phones already on file (open prospects, clients, partners). */
  prospectPhones: ReadonlySet<string>;
  clientPhones: ReadonlySet<string>;
  partnerPhones?: ReadonlySet<string>;
  /** Lowercased emails already on file. */
  prospectEmails: ReadonlySet<string>;
  clientEmails: ReadonlySet<string>;
  partnerEmails?: ReadonlySet<string>;
}

export interface ImportOptions {
  /** Import CRC's inactive / cancelled people too (as leads). Off: skipped. */
  includeInactive?: boolean;
}

/** The states Credalti may sell in now. Only Texas; Georgia never (compliance/stateRules.ts). */
export const OPEN_STATES: readonly string[] = ["TX"];

function splitFull(full: string): [string, string] {
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return [parts[0] ?? "", ""];
  return [parts.slice(0, -1).join(" "), parts.at(-1)!];
}

const clean = (v: string | undefined, max: number) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Every data row, read with the mapping: what would happen to it. Nothing is written. */
export function planImport(
  rows: readonly (readonly string[])[],
  mapping: Mapping,
  kind: ImportKind,
  existing: Existing,
  options: ImportOptions = {},
): PlannedRow[] {
  const [header = [], ...data] = rows;
  const safe = safeMapping(header, mapping);
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  return data.map((cells, index) => {
    const reasons: RowReason[] = [];
    const cell = (field: ImportField): string => {
      const i = safe[field];
      if (i === undefined) return "";
      const raw = cells[i] ?? "";
      // An SSN-like number anywhere but a phone column is dropped from the cell.
      if (field !== "phone" && field !== "altPhone" && SSN_IN_TEXT.test(raw)) {
        if (!reasons.includes("ssn_value_dropped")) reasons.push("ssn_value_dropped");
        return raw.replace(new RegExp(SSN_IN_TEXT.source, "g"), "").trim();
      }
      return raw;
    };
    let firstName = clean(cell("firstName"), 40);
    let lastName = clean(cell("lastName"), 40);
    if ((!firstName || !lastName) && cell("fullName")) {
      const [f, l] = splitFull(cell("fullName"));
      firstName ||= clean(f, 40);
      lastName ||= clean(l, 40);
    }
    const phoneRaw = cell("phone") || cell("altPhone");
    const phoneE164 = toUsE164(phoneRaw) ?? toUsE164(cell("altPhone"));
    const emailRaw = clean(cell("email"), 120).toLowerCase();
    const email = emailRaw && /^[^@ ]+@[^@ ]+\.[a-z]{2,24}$/.test(emailRaw) ? emailRaw : null;
    const state = toState(cell("state"));
    const statusText = clean(cell("status"), 40) || null;
    const status = crcStatus(statusText ?? "", kind);
    const row: PlannedRow = {
      line: index + 2,
      outcome: "create",
      reasons,
      firstName,
      lastName,
      phoneE164,
      email,
      state,
      city: clean(cell("city"), 60) || null,
      company: clean(cell("company"), 120) || null,
      status,
      statusText,
      assignedTo: clean(cell("assignedTo"), 80) || null,
      referredBy: clean(cell("referredBy"), 80) || null,
      added: clean(cell("added"), 40) || null,
    };

    const problems: RowReason[] = [];
    if (firstName.length < 2 || (kind !== "affiliates" && lastName.length < 2)) problems.push("no_name");
    if (emailRaw && !email) problems.push("bad_email");
    if (kind === "affiliates") {
      if (!phoneE164 && !email) problems.push(phoneRaw ? "bad_phone" : "no_phone");
    } else {
      if (!phoneRaw) problems.push("no_phone");
      else if (!phoneE164) problems.push("bad_phone");
      if (!state) problems.push("no_state");
      else if (state === "GA") problems.push("state_never");
      else if (!OPEN_STATES.includes(state)) problems.push("state_closed");
    }
    if (problems.length > 0) {
      reasons.unshift(...problems);
      row.outcome = "problem";
      return row;
    }

    if (kind !== "affiliates" && status === "inactive" && !options.includeInactive) {
      reasons.unshift("inactive");
      row.outcome = "skip";
      return row;
    }

    const dup: RowReason[] = [];
    if ((phoneE164 && seenPhones.has(phoneE164)) || (email && seenEmails.has(email))) dup.push("duplicate_in_file");
    if (kind === "affiliates") {
      if ((phoneE164 && existing.partnerPhones?.has(phoneE164)) || (email && existing.partnerEmails?.has(email))) dup.push("duplicate_partner");
    } else {
      if ((phoneE164 && existing.clientPhones.has(phoneE164)) || (email && existing.clientEmails.has(email))) dup.push("duplicate_client");
      else if ((phoneE164 && existing.prospectPhones.has(phoneE164)) || (email && existing.prospectEmails.has(email))) dup.push("duplicate_prospect");
    }
    if (phoneE164) seenPhones.add(phoneE164);
    if (email) seenEmails.add(email);
    if (dup.length > 0) {
      reasons.unshift(...dup);
      row.outcome = "duplicate";
    }
    return row;
  });
}

export interface PlanSummary {
  rows: number;
  create: number;
  duplicate: number;
  problem: number;
  skip: number;
  /** Of the rows to create: CRC clients and leads. */
  clients: number;
  leads: number;
  ssnCellsDropped: number;
}

export function summarize(plan: readonly PlannedRow[]): PlanSummary {
  const count = (o: RowOutcome) => plan.filter((r) => r.outcome === o).length;
  const created = plan.filter((r) => r.outcome === "create");
  return {
    rows: plan.length,
    create: created.length,
    duplicate: count("duplicate"),
    problem: count("problem"),
    skip: count("skip"),
    clients: created.filter((r) => r.status === "client").length,
    leads: created.filter((r) => r.status !== "client").length,
    ssnCellsDropped: plan.filter((r) => r.reasons.includes("ssn_value_dropped")).length,
  };
}

/** "Mariana R." — what the import log keeps of a name. */
export function shortName(row: Pick<PlannedRow, "firstName" | "lastName">): string {
  const last = row.lastName.trim();
  return `${row.firstName.trim()}${last ? ` ${last.charAt(0).toUpperCase()}.` : ""}`.slice(0, 60);
}

/** The staff member a CRC "Assigned To" names, by handle or name; else the fallback (the importing administrator). */
export function matchSalesperson(assignedTo: string | null, members: ReadonlyArray<{ handle: string; name: string; role: string; active: boolean }>, fallback: string): string {
  if (!assignedTo) return fallback;
  const want = norm(assignedTo);
  const hit = members.find((m) => m.active && (m.role === "sales" || m.role === "admin") && (norm(m.handle) === want || norm(m.name) === want || norm(m.name).split(" ")[0] === want));
  return hit?.handle ?? fallback;
}

/** Duplicate keys of the people already on file, from their phones and emails. */
export function existingFrom(input: {
  prospects: ReadonlyArray<{ phone: string | null; email: string | null }>;
  clients: ReadonlyArray<{ phone: string | null; email: string | null }>;
  partners?: ReadonlyArray<{ phone: string | null; email: string | null }>;
}): Existing {
  const phones = (list: ReadonlyArray<{ phone: string | null }>) => new Set(list.flatMap((p) => (toUsE164(p.phone ?? "") ? [toUsE164(p.phone ?? "")!] : [])));
  const emails = (list: ReadonlyArray<{ email: string | null }>) => new Set(list.flatMap((p) => (p.email ? [p.email.trim().toLowerCase()] : [])));
  return {
    prospectPhones: phones(input.prospects),
    clientPhones: phones(input.clients),
    partnerPhones: phones(input.partners ?? []),
    prospectEmails: emails(input.prospects),
    clientEmails: emails(input.clients),
    partnerEmails: emails(input.partners ?? []),
  };
}

// ── The words ───────────────────────────────────────────────────────────

type Lang = "en" | "es";

export const ROW_REASON_TEXT: Record<Lang, Record<RowReason, string>> = {
  en: {
    no_name: "No first and last name",
    no_phone: "No phone number",
    bad_phone: "Not a US phone number",
    no_state: "No state",
    state_closed: "Not in Texas: only Texas is open",
    state_never: "Georgia: Credalti does not work there",
    inactive: "Inactive or cancelled in CRC",
    duplicate_in_file: "Twice in this file",
    duplicate_prospect: "Already a lead here (same phone or email)",
    duplicate_client: "Already a client here (same phone or email)",
    duplicate_partner: "Already a partner here",
    bad_email: "The email can't be read",
    ssn_value_dropped: "A number that looked like an SSN was removed",
  },
  es: {
    no_name: "Sin nombre y apellido",
    no_phone: "Sin teléfono",
    bad_phone: "No es un teléfono de EE. UU.",
    no_state: "Sin estado",
    state_closed: "No está en Texas: solo Texas está abierto",
    state_never: "Georgia: Credalti no trabaja ahí",
    inactive: "Inactivo o cancelado en CRC",
    duplicate_in_file: "Dos veces en este archivo",
    duplicate_prospect: "Ya es prospecto aquí (mismo teléfono o correo)",
    duplicate_client: "Ya es cliente aquí (mismo teléfono o correo)",
    duplicate_partner: "Ya es socio aquí",
    bad_email: "El correo no se puede leer",
    ssn_value_dropped: "Se quitó un número que parecía un SSN",
  },
};

export const FIELD_LABEL: Record<Lang, Record<ImportField, string>> = {
  en: {
    fullName: "Full name",
    firstName: "First name",
    lastName: "Last name",
    email: "Email",
    phone: "Phone (mobile)",
    altPhone: "Other phone",
    state: "State",
    city: "City",
    status: "CRC status",
    assignedTo: "Assigned to",
    referredBy: "Referred by",
    added: "Date added",
    company: "Company",
  },
  es: {
    fullName: "Nombre completo",
    firstName: "Nombre",
    lastName: "Apellido",
    email: "Correo",
    phone: "Teléfono (celular)",
    altPhone: "Otro teléfono",
    state: "Estado",
    city: "Ciudad",
    status: "Estado en CRC",
    assignedTo: "Asignado a",
    referredBy: "Referido por",
    added: "Fecha de alta",
    company: "Empresa",
  },
};

export const CRC_STATUS_LABEL: Record<Lang, Record<CrcStatus, string>> = {
  en: { client: "CRC client", lead: "CRC lead", inactive: "Inactive in CRC", unknown: "—" },
  es: { client: "Cliente en CRC", lead: "Prospecto en CRC", inactive: "Inactivo en CRC", unknown: "—" },
};
