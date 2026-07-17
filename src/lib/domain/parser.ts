import { createHash } from "crypto";
import { z } from "zod";
import type { Bureau, ItemCategory, NormalizedReport, ReportItem } from "./types";

// Parser: monitoring partner API payload → structured entities (spec §4.1).
// The wire format below is our provider-agnostic intermediate. Each monitoring
// partner (Array / SmartCredit / IdentityIQ) gets an adapter that maps its raw
// tri-merge payload into this shape; the rest of the system only sees this.

const bureauSchema = z.enum(["equifax", "experian", "transunion"]);

const rawTradeline = z.object({
  creditor: z.string(),
  accountNumberMasked: z.string().optional().default(""),
  accountType: z.string().optional().default(""),
  status: z.string().optional().default(""),
  paymentStatus: z.string().optional().default(""),
  balance: z.number().optional(),
  openedAt: z.string().optional(),
  remarks: z.array(z.string()).optional().default([]),
  furnisher: z
    .object({ name: z.string(), addressLines: z.array(z.string()) })
    .nullable()
    .optional(),
});

const rawInquiry = z.object({
  inquirer: z.string(),
  date: z.string(),
  type: z.string().optional().default("hard"),
});

const rawPublicRecord = z.object({
  recordType: z.string(),
  court: z.string().optional().default(""),
  filedAt: z.string().optional(),
  status: z.string().optional().default(""),
});

const rawPersonalInfo = z.object({
  field: z.string(), // name | address | employer | dob | ssn_variant
  value: z.string(),
});

const rawBureauSection = z.object({
  tradelines: z.array(rawTradeline).default([]),
  inquiries: z.array(rawInquiry).default([]),
  publicRecords: z.array(rawPublicRecord).default([]),
  personalInfo: z.array(rawPersonalInfo).default([]),
});

export const rawReportSchema = z.object({
  source: z.string(),
  pulledAt: z.string(),
  bureaus: z.record(bureauSchema, rawBureauSection),
});

export type RawReport = z.infer<typeof rawReportSchema>;

function fingerprint(bureau: Bureau, category: ItemCategory, identity: string): string {
  return createHash("sha256")
    .update(`${bureau}|${category}|${identity.toLowerCase().trim()}`)
    .digest("hex")
    .slice(0, 24);
}

const NEGATIVE_STATUS = /collection|charge.?off|late|delinquen|repossess|foreclos|derog|settled|default/i;

export function parseReport(input: unknown): NormalizedReport {
  const raw = rawReportSchema.parse(input);
  const items: ReportItem[] = [];

  for (const [bureauKey, section] of Object.entries(raw.bureaus)) {
    const bureau = bureauKey as Bureau;
    if (!section) continue;

    for (const t of section.tradelines) {
      items.push({
        fingerprint: fingerprint(bureau, "tradeline", `${t.creditor}|${t.accountNumberMasked}`),
        bureau,
        category: "tradeline",
        name: t.creditor,
        furnisher: t.furnisher ?? null,
        data: t,
        negative:
          NEGATIVE_STATUS.test(t.status) ||
          NEGATIVE_STATUS.test(t.paymentStatus) ||
          t.remarks.some((r) => NEGATIVE_STATUS.test(r)),
      });
    }

    for (const q of section.inquiries) {
      items.push({
        fingerprint: fingerprint(bureau, "inquiry", `${q.inquirer}|${q.date}`),
        bureau,
        category: "inquiry",
        name: q.inquirer,
        furnisher: null,
        data: q,
        negative: q.type === "hard",
      });
    }

    for (const p of section.publicRecords) {
      items.push({
        fingerprint: fingerprint(bureau, "public_record", `${p.recordType}|${p.court}|${p.filedAt ?? ""}`),
        bureau,
        category: "public_record",
        name: `${p.recordType}${p.court ? ` — ${p.court}` : ""}`,
        furnisher: null,
        data: p,
        negative: true,
      });
    }

    for (const pi of section.personalInfo) {
      items.push({
        fingerprint: fingerprint(bureau, "personal_info", `${pi.field}|${pi.value}`),
        bureau,
        category: "personal_info",
        name: `${pi.field}: ${pi.value}`,
        furnisher: null,
        data: pi,
        negative: false,
      });
    }
  }

  return { pulledAt: raw.pulledAt, source: raw.source, items };
}
