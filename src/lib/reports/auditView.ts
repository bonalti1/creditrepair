import type { Bureau, NormalizedReport, ReportItem } from "../domain/types";

// One report as an audit: bureau by bureau, what it lists, the items that
// read as negative first. Used by the printable report pages (the staff
// Reports tab and the client's "My reports"). A reading aid: it says where
// to look, never that an item is wrong. No scores: the page a client prints
// carries none, and staff read scores on the client page.

export type AuditGroupKey = "negative" | "accounts" | "inquiries" | "public_records" | "personal_info";

export interface AuditGroup {
  key: AuditGroupKey;
  items: ReportItem[];
}

export interface AuditBureau {
  bureau: Bureau;
  total: number;
  negative: number;
  groups: AuditGroup[];
}

export interface AuditView {
  total: number;
  negative: number;
  bureaus: AuditBureau[];
}

const ORDER: readonly Bureau[] = ["equifax", "experian", "transunion"];

function groupOf(item: ReportItem): AuditGroupKey {
  if (item.category === "personal_info") return "personal_info";
  if (item.category === "inquiry") return "inquiries";
  if (item.category === "public_record") return "public_records";
  return item.negative ? "negative" : "accounts";
}

const GROUP_ORDER: readonly AuditGroupKey[] = ["negative", "public_records", "accounts", "inquiries", "personal_info"];

export function auditView(report: NormalizedReport): AuditView {
  const bureaus = ORDER.flatMap((bureau): AuditBureau[] => {
    const items = report.items.filter((i) => i.bureau === bureau);
    if (items.length === 0) return [];
    const groups = GROUP_ORDER.flatMap((key): AuditGroup[] => {
      const inGroup = items.filter((i) => groupOf(i) === key);
      return inGroup.length > 0 ? [{ key, items: inGroup }] : [];
    });
    return [{ bureau, total: items.length, negative: items.filter((i) => i.negative).length, groups }];
  });
  return { total: report.items.length, negative: report.items.filter((i) => i.negative).length, bureaus };
}

export const AUDIT_GROUP_LABEL: Record<"es" | "en", Record<AuditGroupKey, string>> = {
  en: {
    negative: "Accounts that look negative",
    public_records: "Public records",
    accounts: "Other accounts",
    inquiries: "Inquiries",
    personal_info: "Personal information",
  },
  es: {
    negative: "Cuentas que se ven negativas",
    public_records: "Registros públicos",
    accounts: "Otras cuentas",
    inquiries: "Consultas",
    personal_info: "Datos personales",
  },
};

export const BUREAU_LABEL: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };
