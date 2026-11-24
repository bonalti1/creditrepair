import { REQUIRED_DOCUMENTS } from "../staff/types";
import type { CaseFacts } from "../case/timeline";
import type { AftercareSourceKey } from "./sources";
import type { HomeMarkKey, MarkState } from "./plan";

// "Home-ready": a milestone track for clients whose goal is buying a home,
// and plain explanations of what lenders usually look at.
//
// Three milestones come from the case itself (documents, review, the first
// round mailed); three the client marks (positive accounts, savings, talking
// to a loan officer). A partner loan officer or real estate agent sees the
// milestone names and dates only, and only with the client's consent
// (partner_home_ready(), migration 0030): never a score or anything from the
// report.
//
// The lender section is general information. Every rule there is stated as
// "usually" or "many lenders", with "requirements vary by lender", and with
// its source and whether it is confirmed. Nothing compares the client's own
// numbers to a lender's minimum.

export type L = "es" | "en";
type Bi = Record<L, string>;

export const HOME_MILESTONES = ["documents", "report_reviewed", "disputes_in_progress", "positive_accounts", "savings", "loan_officer"] as const;
export type HomeMilestone = (typeof HOME_MILESTONES)[number];

/** What a partner may also see: the milestones above, and graduation. The same names as partner_home_ready(). */
export const PARTNER_HOME_MILESTONES = [...HOME_MILESTONES, "graduated"] as const;
export type PartnerHomeMilestone = (typeof PARTNER_HOME_MILESTONES)[number];

/** The client's own mark behind each milestone they mark themselves. */
export const MILESTONE_MARK: Partial<Record<HomeMilestone, HomeMarkKey>> = {
  positive_accounts: "home_positive_accounts",
  savings: "home_savings",
  loan_officer: "home_loan_officer",
};

export interface MilestoneCopy {
  title: Bi;
  /** What it means, in one or two plain sentences. */
  body: Bi;
  /** Tips: what to do. */
  tips: Record<L, string[]>;
}

export const MILESTONE_COPY: Record<HomeMilestone, MilestoneCopy> = {
  documents: {
    title: { en: "Documents organized", es: "Documentos en orden" },
    body: {
      en: "Your ID and proof of address are with your team. Lenders will ask for more.",
      es: "Tu identificación y tu comprobante de domicilio ya están con tu equipo. Los prestamistas te pedirán más.",
    },
    tips: {
      en: ["Keep recent pay stubs, two years of tax returns and two months of bank statements in one folder.", "With an ITIN, keep the IRS letter that gave you your ITIN."],
      es: ["Guarda en una carpeta tus talones de pago recientes, tus declaraciones de impuestos de dos años y dos meses de estados de cuenta.", "Con ITIN, guarda la carta del IRS que te dio tu ITIN."],
    },
  },
  report_reviewed: {
    title: { en: "Report reviewed", es: "Reporte revisado" },
    body: {
      en: "You went through every item on your report and told us which ones you believe are inaccurate.",
      es: "Revisaste cada punto de tu reporte y nos dijiste cuáles crees que son inexactos.",
    },
    tips: { en: ["You can change an answer any time from Review."], es: ["Puedes cambiar una respuesta cuando quieras desde Revisar."] },
  },
  disputes_in_progress: {
    title: { en: "Disputes in progress", es: "Disputas en curso" },
    body: {
      en: "Your team mailed letters about the items you marked. The bureaus decide how they answer.",
      es: "Tu equipo envió cartas sobre los puntos que marcaste. Los burós deciden cómo responden.",
    },
    tips: { en: ["Mi caso shows each round and its dates."], es: ["Mi caso muestra cada ronda y sus fechas."] },
  },
  positive_accounts: {
    title: { en: "Positive accounts in place", es: "Cuentas positivas activas" },
    body: {
      en: "You have accounts you pay on time every month. Mark it when you feel this is true for you.",
      es: "Tienes cuentas que pagas a tiempo cada mes. Márcalo cuando sientas que ya es así.",
    },
    tips: { en: ["See \"Add positive accounts, carefully\" in your plan."], es: ["Mira «Suma cuentas positivas, con cuidado» en tu plan."] },
  },
  savings: {
    title: { en: "Savings plan for the down payment", es: "Plan de ahorro para el enganche" },
    body: {
      en: "Besides the down payment, buyers usually pay closing costs, and some lenders ask for savings left over.",
      es: "Además del enganche, casi siempre se pagan gastos de cierre, y algunos prestamistas piden que te quede un ahorro.",
    },
    tips: {
      en: [
        "Save in one account you do not touch, so lenders can see the money there.",
        "Ask a loan officer about down payment help programs in your area.",
        "Large cash deposits may need a paper trail. Keep receipts.",
      ],
      es: [
        "Ahorra en una cuenta que no toques, así los prestamistas ven el dinero ahí.",
        "Pregúntale a un oficial de préstamos por programas de ayuda para el enganche en tu zona.",
        "Los depósitos grandes en efectivo pueden necesitar comprobantes. Guarda los recibos.",
      ],
    },
  },
  loan_officer: {
    title: { en: "Talk to a loan officer", es: "Habla con un oficial de préstamos" },
    body: {
      en: "A loan officer can tell you which loans you may look at and what that lender asks for. You can talk to more than one.",
      es: "Un oficial de préstamos te dice qué préstamos puedes considerar y qué pide ese prestamista. Puedes hablar con más de uno.",
    },
    tips: {
      en: ["Ask what their lender requires, in writing.", "Compare lenders within 45 days, so the credit checks count as one inquiry."],
      es: ["Pide por escrito lo que pide su prestamista.", "Compara prestamistas en 45 días, así las consultas cuentan como una sola."],
    },
  },
};

export interface MilestoneState {
  key: HomeMilestone;
  done: boolean;
  /** When it was reached or marked, if done. */
  at: string | null;
  /** True when the client marks it; false when the case decides it. */
  clientMarks: boolean;
}

const latest = (dates: Array<string | null | undefined>) => dates.filter((d): d is string => typeof d === "string" && !Number.isNaN(Date.parse(d))).sort().at(-1) ?? null;
const earliest = (dates: Array<string | null | undefined>) => dates.filter((d): d is string => typeof d === "string" && !Number.isNaN(Date.parse(d))).sort()[0] ?? null;

/** The track for this client, from their case and their own marks. */
export function homeReadyTrack(facts: CaseFacts, marks: MarkState): MilestoneState[] {
  const docsAt = REQUIRED_DOCUMENTS.every((k) => facts.documents.some((d) => d.kind === k))
    ? latest(REQUIRED_DOCUMENTS.map((k) => earliest(facts.documents.filter((d) => d.kind === k).map((d) => d.receivedAt))))
    : null;
  const firstMailed = earliest(facts.rounds.map((r) => r.mailedAt));
  // Nothing to dispute after a finished review is also a step done.
  const disputesAt = firstMailed ?? (facts.review.finishedAt && facts.review.confirmed === 0 ? facts.review.finishedAt : null);
  const out: MilestoneState[] = [
    { key: "documents", done: Boolean(docsAt), at: docsAt, clientMarks: false },
    { key: "report_reviewed", done: Boolean(facts.review.finishedAt), at: facts.review.finishedAt, clientMarks: false },
    { key: "disputes_in_progress", done: Boolean(disputesAt), at: disputesAt, clientMarks: false },
  ];
  for (const key of ["positive_accounts", "savings", "loan_officer"] as const) {
    const mark = marks[MILESTONE_MARK[key]!];
    out.push({ key, done: mark?.done === true, at: mark?.done ? mark.at : null, clientMarks: true });
  }
  return out;
}

// ── What lenders usually look at (general information) ──────────────────

export interface LenderTopic {
  key: "dti" | "payment_history" | "collections" | "score_ranges" | "itin_loans";
  title: Bi;
  body: Record<L, string[]>;
  sources: AftercareSourceKey[];
}

export const LENDER_TOPICS: LenderTopic[] = [
  {
    key: "dti",
    title: { en: "Debt-to-income (DTI)", es: "Deuda contra ingreso (DTI)" },
    body: {
      en: [
        "DTI is your monthly debt payments divided by your monthly income before taxes.",
        "Example: $1,500 in payments and $5,000 in income is a DTI of 30%.",
        "Each lender and loan type sets its own limit. Many planners suggest keeping it well under 43%.",
      ],
      es: [
        "El DTI es lo que pagas de deudas cada mes, dividido entre tu ingreso mensual antes de impuestos.",
        "Ejemplo: $1,500 en pagos y $5,000 de ingreso es un DTI de 30%.",
        "Cada prestamista y tipo de préstamo pone su propio límite. Muchos asesores sugieren mantenerlo muy por debajo del 43%.",
      ],
    },
    sources: ["cfpbDti", "cfpbQmDti"],
  },
  {
    key: "payment_history",
    title: { en: "Payment history and recent late payments", es: "Historial de pagos y atrasos recientes" },
    body: {
      en: [
        "Lenders read your payment history, and many look closely at the most recent months.",
        "A late payment from long ago usually weighs less than one from last month.",
      ],
      es: [
        "Los prestamistas leen tu historial de pagos, y muchos miran con cuidado los meses más recientes.",
        "Un atraso de hace mucho casi siempre pesa menos que uno del mes pasado.",
      ],
    },
    sources: ["cfpbGoodScore", "cfpbCheckCreditFirst"],
  },
  {
    key: "collections",
    title: { en: "Collections", es: "Cuentas en cobranza" },
    body: {
      en: [
        "Lenders see collection accounts on your report. Some ask you to explain them or to pay some before closing.",
        "What a lender asks depends on the loan type and the lender.",
      ],
      es: [
        "Los prestamistas ven las cuentas en cobranza en tu reporte. Algunos piden que las expliques o que pagues algunas antes del cierre.",
        "Lo que pide un prestamista depende del tipo de préstamo y del prestamista.",
      ],
    },
    sources: ["cfpbCheckCreditFirst"],
  },
  {
    key: "score_ranges",
    title: { en: "Minimum scores by loan type", es: "Puntajes mínimos por tipo de préstamo" },
    body: {
      en: [
        "These are general program rules, not what any lender will do for you.",
        "FHA loans: the program allows 3.5% down from a 580 score, and 10% down from 500 to 579.",
        "Conventional loans: 620 is the usual minimum when a loan is underwritten by hand. Fannie Mae's automated system no longer uses one minimum score.",
        "Many lenders set higher minimums than the program. Requirements vary by lender.",
      ],
      es: [
        "Estas son reglas generales de los programas, no lo que un prestamista hará contigo.",
        "Préstamos FHA: el programa permite 3.5% de enganche desde un puntaje de 580, y 10% de 500 a 579.",
        "Préstamos convencionales: 620 es el mínimo usual cuando el préstamo se revisa a mano. El sistema automático de Fannie Mae ya no fija un mínimo.",
        "Muchos prestamistas piden mínimos más altos que el programa. Los requisitos varían según el prestamista.",
      ],
    },
    sources: ["hudFha", "fannieMaeScores"],
  },
  {
    key: "itin_loans",
    title: { en: "Home loans with an ITIN", es: "Préstamos para casa con ITIN" },
    body: {
      en: [
        "Some lenders offer home loans to people with an ITIN. They are usually their own programs, not FHA or conventional.",
        "They often ask for a larger down payment and may cost more. Some accept rent and utility history.",
        "Ask each lender what they require, in writing.",
      ],
      es: [
        "Algunos prestamistas ofrecen préstamos para casa a personas con ITIN. Casi siempre son programas propios, no FHA ni convencionales.",
        "Muchas veces piden un enganche más grande y pueden costar más. Algunos aceptan historial de renta y servicios.",
        "Pregúntale a cada prestamista qué pide, por escrito.",
      ],
    },
    sources: ["itinLoans"],
  },
];

/** The note that goes with every lender topic. */
export const LENDER_NOTE: Bi = {
  en: "General information, not advice and not an offer of credit. Requirements vary by lender. A lender decides.",
  es: "Información general, no es un consejo ni una oferta de crédito. Los requisitos varían según el prestamista. El prestamista decide.",
};

/** Every sentence a client can read on the home-ready page, for the tests. */
export function homeReadyCopy(locale: L): string[] {
  const out: string[] = [LENDER_NOTE[locale]];
  for (const key of HOME_MILESTONES) {
    const m = MILESTONE_COPY[key];
    out.push(m.title[locale], m.body[locale], ...m.tips[locale]);
  }
  for (const t of LENDER_TOPICS) out.push(t.title[locale], ...t.body[locale]);
  return out;
}

// ── What a partner sees ─────────────────────────────────────────────────

export interface PartnerHomeRow {
  milestone: PartnerHomeMilestone;
  doneAt: string | null;
}

const PARTNER_MILESTONE_LABEL: Record<L, Record<PartnerHomeMilestone, string>> = {
  en: {
    documents: "Documents organized",
    report_reviewed: "Report reviewed",
    disputes_in_progress: "Disputes in progress",
    positive_accounts: "Positive accounts in place (the client's own mark)",
    savings: "Savings plan for the down payment (the client's own mark)",
    loan_officer: "Talked to a loan officer (the client's own mark)",
    graduated: "Finished the program",
  },
  es: {
    documents: "Documentos en orden",
    report_reviewed: "Reporte revisado",
    disputes_in_progress: "Disputas en curso",
    positive_accounts: "Cuentas positivas activas (lo marca el cliente)",
    savings: "Plan de ahorro para el enganche (lo marca el cliente)",
    loan_officer: "Habló con un oficial de préstamos (lo marca el cliente)",
    graduated: "Terminó el programa",
  },
};

export function partnerMilestoneLabel(m: PartnerHomeMilestone, locale: L): string {
  return PARTNER_MILESTONE_LABEL[locale][m];
}

/** partner_home_ready() rows, read defensively: only known milestone names, dates or null. */
export function partnerHomeFromRows(rows: ReadonlyArray<Record<string, unknown>>): PartnerHomeRow[] {
  const byKey = new Map<string, string | null>();
  for (const r of rows) {
    const key = String(r.milestone);
    if (!(PARTNER_HOME_MILESTONES as readonly string[]).includes(key)) continue;
    const raw = r.done_at;
    const at = (typeof raw === "string" || raw instanceof Date) && !Number.isNaN(new Date(raw as string).getTime()) ? new Date(raw as string).toISOString() : null;
    byKey.set(key, at);
  }
  return PARTNER_HOME_MILESTONES.filter((k) => byKey.has(k)).map((k) => ({ milestone: k, doneAt: byKey.get(k) ?? null }));
}

/** The same rows from the client's own facts (the client's preview, the demo). */
export function partnerHomeFromTrack(track: readonly MilestoneState[], graduatedAt: string | null): PartnerHomeRow[] {
  return [...track.map((m) => ({ milestone: m.key as PartnerHomeMilestone, doneAt: m.at })), { milestone: "graduated" as const, doneAt: graduatedAt }];
}

/**
 * The same milestones from a console record (the staff client page, and the
 * demo's partner view). Dates come from the same facts a partner's progress
 * uses (partners/sharing.ts progressFromStaffClient), so the two never disagree.
 */
export function partnerHomeFromProgress(
  progress: { documentsCompleteAt: string | null; reviewFinishedAt: string | null; rounds: ReadonlyArray<{ mailedAt: string }> },
  marks: MarkState,
  graduatedAt: string | null,
): PartnerHomeRow[] {
  const mark = (k: HomeMarkKey) => (marks[k]?.done ? marks[k]!.at : null);
  return [
    { milestone: "documents", doneAt: progress.documentsCompleteAt },
    { milestone: "report_reviewed", doneAt: progress.reviewFinishedAt },
    { milestone: "disputes_in_progress", doneAt: earliest(progress.rounds.map((r) => r.mailedAt)) },
    { milestone: "positive_accounts", doneAt: mark("home_positive_accounts") },
    { milestone: "savings", doneAt: mark("home_savings") },
    { milestone: "loan_officer", doneAt: mark("home_loan_officer") },
    { milestone: "graduated", doneAt: graduatedAt },
  ];
}
