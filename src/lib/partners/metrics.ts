import { inRange, periodRange, type Period } from "../staff/metrics";
import type { StaffClient } from "../staff/types";
import { referralStatus, type CommissionRecord, type Partner } from "./rules";

// The "Socios" numbers on the business dashboard (/equipo/negocio). Like the
// rest of the dashboard (staff/metrics.ts): only what is on record is
// counted, and every number has its definition beside it. Commission money is
// the administrator's own records (partner_commissions), never a rate times a
// head count.

export type PartnerMetricKey = "partnerReferrals" | "partnerSigned" | "partnerActive" | "partnerOwed" | "partnerPaid" | "partnersApproved";

export const PARTNER_METRIC_INFO: Record<PartnerMetricKey, { label: string; definition: string }> = {
  partnerReferrals: {
    label: "Referidos por socios",
    definition: "Personas cuyo primer contacto fue en el periodo y que llegaron por un socio: su enlace, su portal o un prospecto de HighLevel con su código.",
  },
  partnerSigned: {
    label: "Referidos que firmaron",
    definition: "Referidos por socios que firmaron su acuerdo de servicio en el periodo, sin importar cuándo llegaron.",
  },
  partnerActive: {
    label: "Referidos activos hoy",
    definition: "Hoy: referidos por socios con acuerdo firmado, al menos una ronda enviada y sin cancelar ni pedir terminar. Es el mismo «Activo» que ve el socio en su portal.",
  },
  partnerOwed: {
    label: "Comisión registrada",
    definition: "Suma de las comisiones que una persona administradora registró como debidas en el periodo. La app no calcula ni paga comisiones.",
  },
  partnerPaid: {
    label: "Comisión pagada",
    definition: "Suma de los pagos a socios que una persona administradora registró en el periodo.",
  },
  partnersApproved: {
    label: "Socios aprobados",
    definition: "Hoy: socios con cuenta aprobada. Entre paréntesis, las solicitudes por revisar.",
  },
};

/** The same for the staff console in English. */
export const PARTNER_METRIC_INFO_EN: Record<PartnerMetricKey, { label: string; definition: string }> = {
  partnerReferrals: {
    label: "Referred by partners",
    definition: "People whose first contact was in the period and who came through a partner: their link, their portal or a HighLevel lead with their code.",
  },
  partnerSigned: {
    label: "Referrals who signed",
    definition: "Partner referrals who signed their service agreement in the period, whenever they came in.",
  },
  partnerActive: {
    label: "Referrals active today",
    definition:
      "Today: partner referrals with a signed agreement, at least one round mailed, and no cancellation or request to end. The same “Active” the partner sees in their portal.",
  },
  partnerOwed: {
    label: "Commission recorded",
    definition: "Sum of the commissions an administrator recorded as owed in the period. The app doesn't calculate or pay commissions.",
  },
  partnerPaid: {
    label: "Commission paid",
    definition: "Sum of the payments to partners an administrator recorded in the period.",
  },
  partnersApproved: {
    label: "Partners approved",
    definition: "Today: partners with an approved account. In parentheses, the applications to review.",
  },
};

export interface PartnerRow {
  id: string;
  name: string;
  referrals: number;
  signed: number;
  active: number;
  owedCents: number;
  paidCents: number;
}

export interface PartnerMetrics {
  referrals: number;
  signed: number;
  active: number;
  owedCents: number;
  paidCents: number;
  approved: number;
  pending: number;
  /** Approved and suspended partners with anything on record, most referrals first. */
  rows: PartnerRow[];
}

export function partnerMetrics(clients: StaffClient[], partners: Partner[], commissions: CommissionRecord[], period: Period, now: Date): PartnerMetrics {
  const range = periodRange(period, now);
  const referred = clients.filter((c) => c.leadSource?.partnerId);
  const of = (id: string | null) => referred.filter((c) => !id || c.leadSource?.partnerId === id);
  const count = (list: StaffClient[]) => ({
    referrals: list.filter((c) => inRange(c.createdAt, range)).length,
    signed: list.filter((c) => inRange(c.agreementSignedAt, range)).length,
    active: list.filter((c) => referralStatus(c) === "active").length,
  });
  const money = (id: string | null) => {
    const mine = commissions.filter((r) => (!id || r.partnerId === id) && inRange(r.recordedAt, range));
    return {
      owedCents: mine.filter((r) => r.kind === "owed").reduce((a, r) => a + r.amountCents, 0),
      paidCents: mine.filter((r) => r.kind === "paid").reduce((a, r) => a + r.amountCents, 0),
    };
  };
  const rows = partners
    .filter((p) => p.status === "approved" || p.status === "suspended")
    .map((p) => ({ id: p.id, name: p.name, ...count(of(p.id)), ...money(p.id) }))
    .sort((a, b) => b.referrals - a.referrals || b.active - a.active || a.name.localeCompare(b.name, "es"));
  return {
    ...count(of(null)),
    ...money(null),
    approved: partners.filter((p) => p.status === "approved").length,
    pending: partners.filter((p) => p.status === "pending").length,
    rows,
  };
}
