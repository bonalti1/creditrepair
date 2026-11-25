import type { CommissionRecord, Partner } from "../partners/rules";
import type { Bilingual, PartnerTaxInfo } from "./types";

// Partner commissions payable, and the year-end 1099-NEC list.
//
// The amounts are the ones an administrator recorded in /equipo/socios
// (partner_commissions: owed and paid, append-only). Nothing here computes a
// commission or pays one, and nothing can be recorded while "Comisiones a
// socios" is off: the database refuses it until the attorney's approval is
// on record (PARTNERS.md). The books only read and add them up.
//
// 1099-NEC: a business generally files one for each non-employee it paid
// $600 or more in a calendar year for services (box 1), by January 31. The
// list below is a starting point for the CPA: who crossed $600 in PAYMENTS
// recorded in that year, whether their W-9 is on file, and whether the W-9
// says they are exempt. The CPA decides what is filed.

export const NEC_THRESHOLD_CENTS = 60_000;

export interface PartnerPayable {
  partner: Partner;
  owedCents: number;
  paidCents: number;
  balanceCents: number;
  lastPaidAt: string | null;
}

export function partnerPayables(partners: readonly Partner[], records: readonly CommissionRecord[]): PartnerPayable[] {
  return partners
    .map((partner) => {
      const mine = records.filter((r) => r.partnerId === partner.id);
      const owedCents = mine.filter((r) => r.kind === "owed").reduce((a, r) => a + r.amountCents, 0);
      const paid = mine.filter((r) => r.kind === "paid");
      const paidCents = paid.reduce((a, r) => a + r.amountCents, 0);
      return { partner, owedCents, paidCents, balanceCents: owedCents - paidCents, lastPaidAt: paid.map((r) => r.recordedAt).sort().at(-1) ?? null };
    })
    .filter((p) => p.owedCents > 0 || p.paidCents > 0)
    .sort((a, b) => b.balanceCents - a.balanceCents || a.partner.name.localeCompare(b.partner.name));
}

export interface NecLine {
  partner: Partner;
  legalName: string;
  paidCents: number;
  w9OnFile: boolean;
  exempt: boolean;
  /** What is still needed before the CPA can file, in plain words. */
  todo: Bilingual | null;
}

/** Calendar year of a recorded payment (Texas time is close enough here: the CPA reviews the list). */
const yearOf = (iso: string) => Number(new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 4));

export function form1099List(partners: readonly Partner[], records: readonly CommissionRecord[], tax: readonly PartnerTaxInfo[], year: number): NecLine[] {
  const info = new Map(tax.map((t) => [t.partnerId, t]));
  return partners
    .map((partner) => {
      const paidCents = records.filter((r) => r.partnerId === partner.id && r.kind === "paid" && yearOf(r.recordedAt) === year).reduce((a, r) => a + r.amountCents, 0);
      const t = info.get(partner.id);
      const w9OnFile = Boolean(t?.w9ReceivedOn);
      const exempt = Boolean(t?.exempt);
      const todo: Bilingual | null = !w9OnFile
        ? { en: "Ask for a W-9 before the next payment.", es: "Pide un W-9 antes del próximo pago." }
        : !t?.legalName
          ? { en: "Write the legal name from the W-9.", es: "Escribe el nombre legal del W-9." }
          : null;
      return { partner, legalName: t?.legalName || partner.company || partner.name, paidCents, w9OnFile, exempt, todo };
    })
    .filter((l) => l.paidCents >= NEC_THRESHOLD_CENTS)
    .sort((a, b) => b.paidCents - a.paidCents);
}

/** A legal name: words, no digits that could be a tax id. The TIN itself is never stored. */
export function checkLegalName(name: string): string | null {
  const text = name.replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 120) return null;
  if (/\d{3}-?\d{2}-?\d{4}|\d{2}-?\d{7}/.test(text)) return null;
  return text;
}
