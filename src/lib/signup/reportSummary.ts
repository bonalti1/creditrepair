import type { ReportItem } from "../domain/types";
import { onTimeCode } from "../ux/itemDisplay";

// "Your report" in the chat signup (docs/SIGNUP-CHAT.md): what the report
// shows, in counts and words only ("2 collections, 1 account with late
// payments and 2 inquiries"). No score, no gauge, no judgement of what is
// wrong: the person reviews every item afterwards and says which ones look
// wrong to them. Nothing here predicts what the bureaus will do.
//
// The same account usually appears on two or three bureaus' reports; it is
// counted once (same kind, same name, same last four digits).

export interface ReportCounts {
  /** Accounts (tradelines), every kind. */
  accounts: number;
  collections: number;
  /** Accounts, other than collections, with a late or missing payment or a charge-off. */
  latePayments: number;
  inquiries: number;
  publicRecords: number;
  /** Names, addresses and employers listed in the personal section. */
  personalInfo: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const norm = (v: unknown) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const last4 = (v: unknown) => str(v).replace(/\D/g, "").slice(-4);

function isCollection(item: ReportItem): boolean {
  return /collection/i.test(str(item.data.accountType)) || /collection/i.test(str(item.data.status));
}

function hasLatePayment(item: ReportItem): boolean {
  const statuses = [item.data.status, item.data.paymentStatus].map(str).join(" ");
  if (/late|delinquen|charge.?off|past.?due/i.test(statuses)) return true;
  const history = Array.isArray(item.data.paymentHistory) ? (item.data.paymentHistory as Array<{ status?: unknown }>) : [];
  return history.some((m) => m && typeof m === "object" && m.status !== undefined && !onTimeCode(m.status));
}

/** One key per account or entry, the same on every bureau. */
function identity(item: ReportItem): string {
  const d = item.data;
  if (item.category === "tradeline") return `t:${norm(d.creditor ?? item.name)}:${last4(d.accountNumberMasked ?? d.accountNumber)}`;
  if (item.category === "inquiry") return `i:${norm(d.inquirer ?? item.name)}:${str(d.date).slice(0, 10)}`;
  if (item.category === "public_record") return `p:${norm(d.recordType)}:${norm(d.court ?? item.name)}:${str(d.filedAt ?? d.date).slice(0, 10)}`;
  return `n:${norm(d.field)}:${norm(d.value ?? item.name)}`;
}

export function reportCounts(items: readonly ReportItem[]): ReportCounts {
  const seen = new Map<string, ReportItem>();
  for (const item of items) if (!seen.has(identity(item))) seen.set(identity(item), item);
  const unique = [...seen.values()];
  const tradelines = unique.filter((i) => i.category === "tradeline");
  return {
    accounts: tradelines.length,
    collections: tradelines.filter(isCollection).length,
    latePayments: tradelines.filter((i) => !isCollection(i) && hasLatePayment(i)).length,
    inquiries: unique.filter((i) => i.category === "inquiry").length,
    publicRecords: unique.filter((i) => i.category === "public_record").length,
    personalInfo: unique.filter((i) => i.category === "personal_info").length,
  };
}

const PARTS: Record<"en" | "es", Record<Exclude<keyof ReportCounts, "accounts">, (n: number) => string>> = {
  en: {
    collections: (n) => `${n} ${n === 1 ? "collection" : "collections"}`,
    latePayments: (n) => `${n} ${n === 1 ? "account" : "accounts"} with late payments`,
    inquiries: (n) => `${n} ${n === 1 ? "inquiry" : "inquiries"}`,
    publicRecords: (n) => `${n} public ${n === 1 ? "record" : "records"}`,
    personalInfo: (n) => `${n} ${n === 1 ? "name, address or employer" : "names, addresses or employers"} in your personal details`,
  },
  es: {
    collections: (n) => `${n} ${n === 1 ? "cobranza" : "cobranzas"}`,
    latePayments: (n) => `${n} ${n === 1 ? "cuenta" : "cuentas"} con pagos tardíos`,
    inquiries: (n) => `${n} ${n === 1 ? "consulta" : "consultas"}`,
    publicRecords: (n) => `${n} ${n === 1 ? "registro público" : "registros públicos"}`,
    personalInfo: (n) => `${n} ${n === 1 ? "nombre, dirección o empleador" : "nombres, direcciones o empleadores"} en tus datos personales`,
  },
};

function join(parts: string[], locale: "en" | "es"): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const and = locale === "es" ? "y" : "and";
  return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
}

/**
 * The report in one plain sentence: "Your report lists 4 accounts: 1
 * collection and 1 account with late payments. It also shows 2 inquiries."
 * Counts only; never a score.
 */
export function reportSummaryLines(counts: ReportCounts, locale: "en" | "es"): string[] {
  const p = PARTS[locale];
  const es = locale === "es";
  const lines: string[] = [];
  const accountWord = es ? (counts.accounts === 1 ? "cuenta" : "cuentas") : counts.accounts === 1 ? "account" : "accounts";
  const flagged = [counts.collections > 0 ? p.collections(counts.collections) : null, counts.latePayments > 0 ? p.latePayments(counts.latePayments) : null].filter(
    (x): x is string => x !== null,
  );
  if (counts.accounts > 0) {
    lines.push(
      flagged.length > 0
        ? es
          ? `Tu reporte muestra ${counts.accounts} ${accountWord}. Entre ellas, ${join(flagged, "es")}.`
          : `Your report lists ${counts.accounts} ${accountWord}. Among them: ${join(flagged, "en")}.`
        : es
          ? `Tu reporte muestra ${counts.accounts} ${accountWord}.`
          : `Your report lists ${counts.accounts} ${accountWord}.`,
    );
  }
  const other = [
    counts.inquiries > 0 ? p.inquiries(counts.inquiries) : null,
    counts.publicRecords > 0 ? p.publicRecords(counts.publicRecords) : null,
    counts.personalInfo > 0 ? p.personalInfo(counts.personalInfo) : null,
  ].filter((x): x is string => x !== null);
  if (other.length > 0) lines.push(es ? `También muestra ${join(other, "es")}.` : `It also shows ${join(other, "en")}.`);
  if (lines.length === 0) lines.push(es ? "Tu reporte no muestra cuentas ni consultas." : "Your report shows no accounts or inquiries.");
  return lines;
}
