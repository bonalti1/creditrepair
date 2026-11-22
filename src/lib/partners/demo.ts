import { NO_BILLING } from "../billing/types";
import type { LeadSource } from "../leads/source";
import type { StaffClient } from "../staff/types";
import type { CommissionRecord, Partner } from "./rules";

// DEMO DATA. Nobody here exists. Four invented referral partners, the
// commission records an administrator would have kept, and where some of the
// invented clients came from: two partners' referrals, a lead that arrived
// from HighLevel this morning, and one a partner sent from their portal.

const DAY = 24 * 60 * 60 * 1000;

export function buildDemoPartners(now: Date): Partner[] {
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  return [
    {
      id: "p-laura",
      name: "Laura Benítez",
      company: "Benítez Realty",
      kind: "realtor",
      phone: "+17135550161",
      email: "laura@ejemplo.com",
      state: "TX",
      status: "approved",
      referralCode: "laura-benitez",
      salesperson: "ana",
      commissionBasis: "signed_client",
      commissionCents: 10000,
      commissionNote: "Acuerdo firmado en octubre. Pago mensual por transferencia.",
      appliedAt: ago(70),
      decidedAt: ago(68),
    },
    {
      id: "p-jorge",
      name: "Jorge Treviño",
      company: "Hipotecas del Valle",
      kind: "loan_officer",
      phone: "+19565550162",
      email: "jorge@ejemplo.com",
      state: "TX",
      status: "approved",
      referralCode: "jorge-trevino",
      salesperson: "luis",
      commissionBasis: "active_client",
      commissionCents: 7500,
      commissionNote: null,
      appliedAt: ago(40),
      decidedAt: ago(39),
    },
    {
      id: "p-sandra",
      name: "Sandra Olvera",
      company: "Olvera Tax Services",
      kind: "tax_preparer",
      phone: "+12105550163",
      email: "sandra@ejemplo.com",
      state: "TX",
      status: "pending",
      referralCode: null,
      salesperson: null,
      commissionBasis: "none",
      commissionCents: 0,
      commissionNote: null,
      appliedAt: ago(1),
      decidedAt: null,
    },
    {
      id: "p-raul",
      name: "Raúl Mendoza",
      company: null,
      kind: "other",
      phone: "+19155550164",
      email: null,
      state: "TX",
      status: "suspended",
      referralCode: "raul-mendoza",
      salesperson: "ana",
      commissionBasis: "none",
      commissionCents: 0,
      commissionNote: "Suspendido: prometía resultados en sus publicaciones.",
      appliedAt: ago(120),
      decidedAt: ago(30),
    },
  ];
}

export function buildDemoCommissions(now: Date): CommissionRecord[] {
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  return [
    { id: "pc-1", partnerId: "p-laura", kind: "owed", amountCents: 10000, referralId: "c09", note: "Firmó Ramiro E.", recordedAt: ago(48), recordedBy: "carmen" },
    { id: "pc-2", partnerId: "p-laura", kind: "paid", amountCents: 10000, referralId: null, note: "Transferencia de octubre", recordedAt: ago(30), recordedBy: "carmen" },
    { id: "pc-3", partnerId: "p-laura", kind: "owed", amountCents: 10000, referralId: "c06", note: "Firmó Lourdes Z.", recordedAt: ago(9), recordedBy: "carmen" },
    { id: "pc-4", partnerId: "p-jorge", kind: "owed", amountCents: 7500, referralId: "c11", note: "Graciela M., primera ronda enviada", recordedAt: ago(5), recordedBy: "carmen" },
  ];
}

/** Which invented clients came through which partner. */
const DEMO_REFERRALS: Record<string, string> = {
  c03: "p-laura",
  c06: "p-laura",
  c09: "p-laura",
  c12: "p-laura",
  c18: "p-laura",
  c11: "p-jorge",
  c21: "p-jorge",
  c14: "p-jorge",
};

/** The demo clients with their lead sources, plus a HighLevel lead from today and a partner's referral. */
export function withDemoLeadSources(clients: StaffClient[], now: Date): StaffClient[] {
  const partners = new Map(buildDemoPartners(now).map((p) => [p.id, p]));
  const hours = (n: number) => new Date(now.getTime() - n * 60 * 60 * 1000).toISOString();
  const partnerSource = (partnerId: string, channel: LeadSource["channel"] = "partner"): LeadSource => {
    const partner = partners.get(partnerId)!;
    return { channel, partnerId, partnerName: partner.name, partnerCode: partner.referralCode };
  };
  const tagged = clients.map((client) => {
    const partnerId = DEMO_REFERRALS[client.id];
    if (partnerId) return { ...client, leadSource: partnerSource(partnerId) };
    if (client.id === "c01") {
      return {
        ...client,
        leadSource: {
          channel: "highlevel" as const,
          highlevelContactId: "hl-mR0bl3s01",
          campaign: "Formulario Casa propia",
          utm: { source: "facebook", medium: "paid", campaign: "casa-propia-nov" },
          consentText: HIGHLEVEL_DEMO_CONSENT,
          consentAt: client.createdAt,
        },
      };
    }
    return client;
  });
  const lead = (fields: Pick<StaffClient, "id" | "firstName" | "lastName" | "phone" | "salesperson" | "createdAt" | "goal" | "leadSource" | "email">): StaffClient => ({
    state: "TX",
    addressLines: [],
    signedUpAt: null,
    agreementSignedAt: null,
    documents: [],
    report: null,
    answers: {},
    rounds: [],
    billing: NO_BILLING,
    lastActivityAt: fields.createdAt,
    notes: [],
    questions: [],
    handled: {},
    assignedTo: null,
    ...fields,
  });
  return [
    ...tagged,
    lead({
      id: "c40",
      firstName: "Carolina",
      lastName: "Esparza",
      phone: "+17135550140",
      email: "carolina.e@ejemplo.com",
      salesperson: "luis",
      createdAt: hours(2),
      goal: "mortgage",
      leadSource: {
        channel: "highlevel",
        highlevelContactId: "hl-cEsp4rz440",
        campaign: "Formulario Casa propia",
        utm: { source: "facebook", medium: "paid", campaign: "casa-propia-nov", content: "video-familia" },
        consentText: HIGHLEVEL_DEMO_CONSENT,
        consentAt: hours(2),
      },
    }),
    lead({
      id: "c41",
      firstName: "Felipe",
      lastName: "Arroyo",
      phone: "+17135550141",
      email: null,
      salesperson: "ana",
      createdAt: hours(26),
      goal: "mortgage",
      leadSource: { ...partnerSource("p-laura"), consentText: "El socio confirma que la persona aceptó que el equipo de Credalti la contacte por WhatsApp.", consentAt: hours(26) },
    }),
  ];
}

/** The consent text in the demo HighLevel leads: the text docs/HIGHLEVEL.md asks the form to show. */
const HIGHLEVEL_DEMO_CONSENT =
  "Acepto que Credalti me contacte por WhatsApp sobre su servicio. Puedo pedir que dejen de escribirme cuando quiera.";

/** The partner the demo portal shows. */
export const DEMO_PORTAL_PARTNER = "p-laura";
