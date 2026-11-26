import { z } from "zod";
import { sha256Hex } from "../agreement/sha256";
import { discounted, formatCents } from "./money";
import type { ServiceOption } from "../service/options";
import type { Bilingual, L } from "./types";

// The plan catalogue: what a client can be charged, in Credit Repair Cloud's
// words, with one difference CRC does not have. Federal law (the Credit
// Repair Organizations Act, 15 U.S.C. §1679b(b)) forbids charging for a
// service before it is fully performed, so every option here is defined by
// the WORK it pays for, never by a date on a calendar:
//
//   Subscription (monthly)  a fee for each 30-day period in which a round of
//                           letters was mailed, charged when the period ends.
//                           No work in the period, no charge.
//   Per round               a fee for each round of letters mailed.
//   Flat fee                a fixed total for N rounds: in equal installments,
//                           one after each round is mailed, or in one charge
//                           after the last included round is mailed.
//   Pay per delete          a fee for each item the client disputed through us
//                           that a LATER report no longer shows. Off until an
//                           administrator records the attorney's approval.
//
// Those four are the "Done for you" (full service) plans. The fifth type is
// the other service option (docs/SERVICE-OPTIONS.md, migration 0042):
//
//   DIY subscription        "Do it yourself, guided": a monthly subscription
//                           to the software, charged at the start of each
//                           30-day period from the end of the 3-business-day
//                           cancellation window (the owner reports the
//                           attorney approved this, 2026-11-25: the client
//                           performs the disputes with the software), plus an
//                           optional fee per letter Credalti mails for them,
//                           shown before they confirm and charged after it is
//                           mailed. planOption() says which option a plan is for.
//
// A monthly subscription (full service) charges a period either right after
// the round mailed in it ("on_mailing", the default for new plans: the
// owner's decision of 2026-11-25) or when the period ends ("period_end", how
// every plan made before that decision reads).
//
// "First work fee", as CRC calls it, is allowed with its timing redefined:
// charged once, only after the client's FIRST round is mailed. Never at
// signup and never when letters are only saved or prepared. Any other fee
// before the work (setup, enrollment, activation, retainer…) is refused here,
// by the database trigger (migration 0026), and explained in the plan editor.
//
// "Due date", like CRC's, only ever moves the first charge LATER: "after the
// first round is mailed" (default) or "N days after the first round is
// mailed". CRC's "N days after the plan is saved" and "when letters are
// saved" are shown disabled: both can charge before any work is performed.
//
// Every plan has a most-you'll-pay figure (the cap), printed in the
// agreement and on "Mis pagos". The rules (rules.ts) and the database never
// charge above it.
//
// A client's SIGNED agreement keeps a snapshot of the exact plan version
// (snapshotPlan below, stored in service_agreements.terms.plan, which can
// never change after signing). Billing reads the snapshot, never the
// catalogue.
//
// NOT REVIEWED BY AN ATTORNEY: the payment-terms text generated here is a
// draft. Each plan version records an attorney's approval before it can be
// offered (the agreement's readiness requires it: agreement/readiness.ts).

/** Any change to the wording generated below needs a new version. */
export const PLAN_TEXT_VERSION = "2026-11-22-draft.1";

export const PLAN_TYPES = ["subscription", "per_round", "flat_fee", "pay_per_delete", "diy_subscription"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

/** The plan types of each service option. */
export const PLAN_TYPES_FOR: Record<ServiceOption, readonly PlanType[]> = {
  full_service: ["subscription", "per_round", "flat_fee", "pay_per_delete"],
  diy: ["diy_subscription"],
};

/** Which service option a plan is for (billing_plans.service_option in the database). */
export function planOption(terms: Pick<PlanTerms, "type">): ServiceOption {
  return terms.type === "diy_subscription" ? "diy" : "full_service";
}

/** When a full-service monthly subscription charges a period (the owner's decision, 2026-11-25). */
export type PeriodTiming = "on_mailing" | "period_end";

/** A subscription plan without the field reads as it was written: charged when the period ends. */
export function periodTiming(t: Pick<PlanTerms, "type" | "periodTiming">): PeriodTiming {
  return t.type === "subscription" && t.periodTiming === "on_mailing" ? "on_mailing" : "period_end";
}

export const PERIOD_TIMING_OPTIONS: Array<{ key: PeriodTiming; label: Bilingual; help: Bilingual }> = [
  {
    key: "on_mailing",
    label: { en: "Charge when the period's round is mailed", es: "Cobrar cuando se envía la ronda del periodo" },
    help: {
      en: "The month is charged right after that month's letters are mailed. No round in a period, no charge.",
      es: "El mes se cobra justo después de enviar las cartas de ese mes. Sin ronda en un periodo, no hay cobro.",
    },
  },
  {
    key: "period_end",
    label: { en: "Charge when the period ends", es: "Cobrar al cerrar el periodo" },
    help: {
      en: "The month is charged when the 30-day period with a round mailed in it ends.",
      es: "El mes se cobra cuando termina el periodo de 30 días en que se envió una ronda.",
    },
  },
];

/** CRC's names, in both languages. */
export const PLAN_TYPE_LABEL: Record<PlanType, Bilingual> = {
  subscription: { en: "Subscription (monthly)", es: "Suscripción (mensual)" },
  per_round: { en: "Per round", es: "Por ronda" },
  flat_fee: { en: "Flat fee", es: "Tarifa fija" },
  pay_per_delete: { en: "Pay per delete", es: "Pago por eliminación" },
  diy_subscription: { en: "DIY subscription (monthly)", es: "Suscripción hazlo tú (mensual)" },
};

/** What each type charges for, in one line, for the plan editor. */
export const PLAN_TYPE_HELP: Record<PlanType, Bilingual> = {
  subscription: {
    en: "A monthly fee for each 30-day period in which a round was mailed, charged right after that round is mailed (or when the period ends). No work that month, no charge.",
    es: "Una cuota mensual por cada periodo de 30 días en que se envió una ronda, cobrada justo después de enviar esa ronda (o al cerrar el periodo). Sin trabajo ese mes, no hay cobro.",
  },
  per_round: {
    en: "A fee for each round of letters, charged after the round is mailed.",
    es: "Una cuota por cada ronda de cartas, cobrada después de enviarla.",
  },
  flat_fee: {
    en: "A fixed total for a set number of rounds: in equal installments after each round, or once after the last included round is mailed.",
    es: "Un total fijo por un número de rondas: en pagos iguales después de cada ronda, o en un solo cobro después de enviar la última ronda incluida.",
  },
  pay_per_delete: {
    en: "A fee for each item the client disputed through us that a later report no longer shows. Needs the attorney's approval first.",
    es: "Una cuota por cada punto que el cliente disputó con nosotros y que un reporte posterior ya no muestra. Necesita primero la aprobación del abogado.",
  },
  diy_subscription: {
    en: "Do it yourself, guided: a monthly subscription to the software, charged at the start of each 30-day period after the 3-business-day cancellation window, plus an optional fee per letter we mail for the client.",
    es: "Hazlo tú, con guía: una suscripción mensual al software, cobrada al inicio de cada periodo de 30 días después de los 3 días hábiles para cancelar, más una cuota opcional por cada carta que enviamos por el cliente.",
  },
};

/** Full service: after the first round (or N days after it). A DIY subscription only: after the cancellation window. */
export type DueRule = { kind: "after_first_round" } | { kind: "days_after_first_round"; days: number } | { kind: "after_cancellation_window" };

export type DueRuleKey = "after_first_round" | "days_after_first_round" | "days_after_plan_saved" | "when_letters_saved";

/** CRC's due-date choices. Two are offered; two are shown disabled, with the reason. */
export const DUE_RULE_OPTIONS: Array<{ key: DueRuleKey; allowed: boolean; label: Bilingual; why?: Bilingual }> = [
  { key: "after_first_round", allowed: true, label: { en: "After the first round is mailed", es: "Después de enviar la primera ronda" } },
  { key: "days_after_first_round", allowed: true, label: { en: "N days after the first round is mailed", es: "N días después de enviar la primera ronda" } },
  {
    key: "days_after_plan_saved",
    allowed: false,
    label: { en: "N days after the plan is saved", es: "N días después de guardar el plan" },
    why: {
      en: "Not allowed: it can charge before any work is performed (15 U.S.C. §1679b(b)).",
      es: "No se permite: puede cobrar antes de realizar el trabajo (15 U.S.C. §1679b(b)).",
    },
  },
  {
    key: "when_letters_saved",
    allowed: false,
    label: { en: "When letters are saved", es: "Al guardar las cartas" },
    why: {
      en: "Not allowed: saved letters are not mailed letters, so no work has been performed yet.",
      es: "No se permite: una carta guardada no es una carta enviada; todavía no se ha realizado el trabajo.",
    },
  },
];

export type Duration = { kind: "indefinite" } | { kind: "months"; count: number } | { kind: "rounds"; count: number };

export type FlatSchedule = "installments" | "after_last_round";

export interface FlatTerms {
  totalCents: number;
  /** Rounds the total covers. */
  rounds: number;
  schedule: FlatSchedule;
}

/** One plan's terms, as an administrator sets them. Amounts are list prices, before any household discount. */
export interface PlanTerms {
  type: PlanType;
  /** CRC's "first work fee". 0 = none. Charged once, only after the first round is mailed. */
  firstWorkFeeCents: number;
  /**
   * Subscription: per 30-day period with work. Per round: per round.
   * Pay per delete: per item no longer reported. Flat fee: 0 (see `flat`).
   */
  recurringCents: number;
  /** Flat fee only. */
  flat: FlatTerms | null;
  dueRule: DueRule;
  /** Subscription: indefinite or months. Per round: indefinite or rounds. Flat fee: its rounds. Pay per delete: indefinite. */
  duration: Duration;
  /** The most the client can ever be charged, when the administrator sets one lower than the plan implies. */
  maxTotalCents: number | null;
  /** Percent off for two linked clients (a household or a couple). 0 = none. */
  householdDiscountPercent: number;
  /** Pay per delete only: also charge for an item a later report shows as updated. Off by default. */
  countsUpdated: boolean;
  /** Subscription only: when a period is charged. Absent: "period_end" (plans made before 2026-11-25). */
  periodTiming?: PeriodTiming;
  /** DIY subscription only: the fee per letter Credalti mails when the client asks. 0 or absent: mailing is not offered. */
  mailFeeCents?: number;
}

export const LIMITS = {
  maxFirstWorkFeeCents: 50_000,
  maxRecurringCents: 100_000,
  maxTotalCents: 1_000_000,
  maxHouseholdDiscountPercent: 50,
  maxDueDays: 30,
  maxMonths: 36,
  maxRounds: 24,
  maxMailFeeCents: 2500,
} as const;

/** Words that name a fee before the work. The field is refused, with the reason, not ignored. */
const FORBIDDEN_FEE = /setup|set_up|enrol|signup|sign_up|onboard|activation|upfront|up_front|advance|retainer|deposit|prepay|application/i;

export const NO_SETUP_FEE_WHY: Bilingual = {
  en: "No setup, enrollment or sign-up fee: it would be money taken before any work is performed, which federal law forbids (15 U.S.C. §1679b(b)). The first work fee is the CRC-style alternative: it is charged only after the first round is mailed.",
  es: "No hay cuota de inscripción, apertura ni registro: sería dinero cobrado antes de realizar el trabajo, y la ley federal lo prohíbe (15 U.S.C. §1679b(b)). La cuota de primer trabajo es la alternativa al estilo de CRC: se cobra solo después de enviar la primera ronda.",
};

export const FIRST_WORK_TIMING: Bilingual = {
  en: "Charged after the first round is mailed — never at signup.",
  es: "Se cobra después de enviar la primera ronda — nunca al firmar.",
};

const cents = (max: number) => z.number().int().min(0).max(max);

export const planTermsSchema = z
  .object({
    type: z.enum(PLAN_TYPES),
    firstWorkFeeCents: cents(LIMITS.maxFirstWorkFeeCents),
    recurringCents: cents(LIMITS.maxRecurringCents),
    flat: z
      .object({
        totalCents: z.number().int().min(1).max(LIMITS.maxTotalCents),
        rounds: z.number().int().min(1).max(LIMITS.maxRounds),
        schedule: z.enum(["installments", "after_last_round"]),
      })
      .strict()
      .nullable(),
    dueRule: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("after_first_round") }).strict(),
      z.object({ kind: z.literal("days_after_first_round"), days: z.number().int().min(1).max(LIMITS.maxDueDays) }).strict(),
      z.object({ kind: z.literal("after_cancellation_window") }).strict(),
    ]),
    duration: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("indefinite") }).strict(),
      z.object({ kind: z.literal("months"), count: z.number().int().min(1).max(LIMITS.maxMonths) }).strict(),
      z.object({ kind: z.literal("rounds"), count: z.number().int().min(1).max(LIMITS.maxRounds) }).strict(),
    ]),
    maxTotalCents: z.number().int().min(1).max(LIMITS.maxTotalCents).nullable(),
    householdDiscountPercent: z.number().int().min(0).max(LIMITS.maxHouseholdDiscountPercent),
    countsUpdated: z.boolean(),
    periodTiming: z.enum(["on_mailing", "period_end"]).optional(),
    mailFeeCents: cents(LIMITS.maxMailFeeCents).optional(),
  })
  .strict();

export type PlanProblemCode =
  | "invalid"
  | "setup_fee_refused"
  | "forbidden_due_rule"
  | "recurring_required"
  | "recurring_not_used"
  | "flat_required"
  | "flat_not_used"
  | "duration_not_allowed"
  | "cap_required"
  | "first_work_not_allowed"
  | "updated_only_pay_per_delete"
  | "due_rule_not_for_type"
  | "timing_only_subscription"
  | "mail_fee_only_diy";

export interface PlanProblem {
  code: PlanProblemCode;
  field: string;
  message: Bilingual;
}

const problem = (code: PlanProblemCode, field: string, en: string, es: string): PlanProblem => ({ code, field, message: { en, es } });

/** The duration kinds each type accepts. */
export const DURATIONS_FOR: Record<PlanType, Array<Duration["kind"]>> = {
  subscription: ["indefinite", "months"],
  per_round: ["indefinite", "rounds"],
  flat_fee: ["rounds"],
  pay_per_delete: ["indefinite"],
  diy_subscription: ["indefinite", "months"],
};

/**
 * Everything wrong with a plan, or [] when it can be saved. Takes anything (a
 * request body): a field that names a fee before the work is refused with the
 * reason, and so is a due date CRC offers that could charge before the work.
 */
export function validatePlanTerms(raw: unknown): PlanProblem[] {
  const problems: PlanProblem[] = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of Object.keys(raw)) {
      if (FORBIDDEN_FEE.test(key)) problems.push({ code: "setup_fee_refused", field: key, message: NO_SETUP_FEE_WHY });
    }
    const due = (raw as { dueRule?: { kind?: unknown } }).dueRule;
    const forbidden = DUE_RULE_OPTIONS.find((o) => !o.allowed && o.key === due?.kind);
    if (forbidden) problems.push({ code: "forbidden_due_rule", field: "dueRule", message: forbidden.why! });
  }
  if (problems.length > 0) return problems;
  const parsed = planTermsSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      problem("invalid", issue.path.join(".") || "terms", `Check this field: ${issue.message}`, `Revisa este campo: ${issue.message}`),
    );
  }
  const t = parsed.data as PlanTerms;
  if (t.type === "flat_fee") {
    if (!t.flat) problems.push(problem("flat_required", "flat", "A flat fee needs its total and the rounds it covers.", "Una tarifa fija necesita su total y las rondas que cubre."));
    if (t.recurringCents !== 0) problems.push(problem("recurring_not_used", "recurringCents", "A flat fee has no recurring amount.", "Una tarifa fija no tiene monto recurrente."));
    if (t.flat && (t.duration.kind !== "rounds" || t.duration.count !== t.flat.rounds)) {
      problems.push(problem("duration_not_allowed", "duration", "A flat fee lasts exactly the rounds it covers.", "Una tarifa fija dura exactamente las rondas que cubre."));
    }
  } else {
    if (t.flat) problems.push(problem("flat_not_used", "flat", "Only a flat fee has a total and a number of rounds.", "Solo una tarifa fija tiene un total y un número de rondas."));
    if (t.recurringCents <= 0) {
      problems.push(
        problem(
          "recurring_required",
          "recurringCents",
          t.type === "pay_per_delete" ? "Set the fee per item no longer reported." : "Set the recurring amount.",
          t.type === "pay_per_delete" ? "Escribe la cuota por cada punto que ya no aparece." : "Escribe el monto recurrente.",
        ),
      );
    }
  }
  if (!DURATIONS_FOR[t.type].includes(t.duration.kind)) {
    problems.push(problem("duration_not_allowed", "duration", "That duration does not fit this plan type.", "Esa duración no corresponde a este tipo de plan."));
  }
  if (t.type === "pay_per_delete" && t.firstWorkFeeCents > 0) {
    problems.push(
      problem(
        "first_work_not_allowed",
        "firstWorkFeeCents",
        "Pay per delete has no first work fee: its promise is that the client pays nothing if nothing changes.",
        "El pago por eliminación no tiene cuota de primer trabajo: lo que promete es que el cliente no paga nada si nada cambia.",
      ),
    );
  }
  if (t.type === "diy_subscription") {
    if (t.dueRule.kind !== "after_cancellation_window") {
      problems.push(problem("due_rule_not_for_type", "dueRule", "A DIY subscription is due after the cancellation window.", "Una suscripción hazlo tú se cobra después del periodo de cancelación."));
    }
    if (t.firstWorkFeeCents > 0) {
      problems.push(problem("first_work_not_allowed", "firstWorkFeeCents", "A DIY subscription has no first work fee.", "Una suscripción hazlo tú no tiene cuota de primer trabajo."));
    }
  } else {
    if (t.dueRule.kind === "after_cancellation_window") {
      problems.push(
        problem(
          "due_rule_not_for_type",
          "dueRule",
          "Only a DIY subscription is charged from the start. A full-service plan is charged after the first round is mailed.",
          "Solo una suscripción hazlo tú se cobra desde el inicio. Un plan de servicio completo se cobra después de enviar la primera ronda.",
        ),
      );
    }
    if (t.mailFeeCents !== undefined) {
      problems.push(
        problem(
          "mail_fee_only_diy",
          "mailFeeCents",
          "Only a DIY plan has a mailing fee: full service mails every letter as part of the work.",
          "Solo un plan hazlo tú tiene cuota de envío: el servicio completo envía cada carta como parte del trabajo.",
        ),
      );
    }
  }
  if (t.periodTiming !== undefined && t.type !== "subscription") {
    problems.push(problem("timing_only_subscription", "periodTiming", "Only a monthly subscription has a period timing.", "Solo una suscripción mensual tiene momento de cobro del periodo."));
  }
  if (t.countsUpdated && t.type !== "pay_per_delete") {
    problems.push(problem("updated_only_pay_per_delete", "countsUpdated", "Only pay per delete counts updated items.", "Solo el pago por eliminación cuenta puntos actualizados."));
  }
  if (problems.length === 0 && planMaxTotalCents(t) === null) {
    problems.push(
      problem(
        "cap_required",
        "maxTotalCents",
        "Set the most a client can ever be charged: with no end date the plan needs a cap.",
        "Escribe lo máximo que se le puede cobrar a un cliente: un plan sin fin necesita un tope.",
      ),
    );
  }
  return problems;
}

/** The parsed terms, or null when they cannot be saved. */
export function parsePlanTerms(raw: unknown): PlanTerms | null {
  return validatePlanTerms(raw).length === 0 ? (planTermsSchema.parse(raw) as PlanTerms) : null;
}

/** What the plan itself implies the client could pay at most, before an explicit cap. Null when unbounded. */
export function impliedMaxCents(t: PlanTerms): number | null {
  if (t.type === "flat_fee" && t.flat) return t.firstWorkFeeCents + t.flat.totalCents;
  if ((t.type === "subscription" || t.type === "diy_subscription") && t.duration.kind === "months") return t.firstWorkFeeCents + t.duration.count * t.recurringCents;
  if (t.type === "per_round" && t.duration.kind === "rounds") return t.firstWorkFeeCents + t.duration.count * t.recurringCents;
  return null;
}

/** The most a client on these terms can ever be charged (list price): the lower of the cap and what the plan implies. */
export function planMaxTotalCents(t: PlanTerms): number | null {
  const implied = impliedMaxCents(t);
  if (implied === null) return t.maxTotalCents;
  return t.maxTotalCents === null ? implied : Math.min(implied, t.maxTotalCents);
}

/** Installment k (1-based) of a flat total in n equal parts. The last one carries the remainder. Same formula as the trigger. */
export function installmentCents(totalCents: number, n: number, k: number): number {
  const base = Math.floor(totalCents / n);
  return k < n ? base : totalCents - base * (n - 1);
}

// ── Versions in the catalogue ───────────────────────────────────────────

export type PlanStatus = "draft" | "active" | "retired";

export interface PlanVersion {
  id: string;
  /** Stable across versions: "per-round-89". */
  key: string;
  version: number;
  status: PlanStatus;
  name: Bilingual;
  terms: PlanTerms;
  /** sha256 of the terms and the agreement text generated from them (planTermsHash). */
  termsHash: string;
  textVersion: string;
  /** The plan offered to a client who was not offered another one. One active default at a time. */
  isDefault: boolean;
  /** The attorney's approval of this version, recorded by an administrator. Required before it is offered. */
  attorney: { name: string; approvedOn: string } | null;
  createdBy: string;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
}

/** draft → active → retired, nothing else. A draft may be edited; an active or retired version never. */
export function canMoveTo(from: PlanStatus, to: PlanStatus): boolean {
  return (from === "draft" && to === "active") || (from === "active" && to === "retired");
}

/** Canonical JSON: keys sorted, so the same terms always hash the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The hash an attorney's approval is tied to: the terms, the names and the exact agreement text in both languages. */
export function planTermsHash(terms: PlanTerms, name: Bilingual): string {
  const effective = effectiveAmounts(terms, 0);
  return sha256Hex(
    [
      `plan-text: ${PLAN_TEXT_VERSION}`,
      canonical({ terms, name }),
      ...paymentTermsLines(terms, effective, "en"),
      ...paymentTermsLines(terms, effective, "es"),
    ].join("\n"),
  );
}

// ── What a signed agreement keeps ───────────────────────────────────────

/** The amounts billing uses: after the household discount, if one applies. */
export interface EffectiveAmounts {
  firstWorkFeeCents: number;
  recurringCents: number;
  flatTotalCents: number;
  maxTotalCents: number;
  /** DIY only: the fee per letter mailed for the client (no household discount). Absent on full-service plans. */
  mailFeeCents?: number;
}

export function effectiveAmounts(terms: PlanTerms, householdDiscountPercent: number): EffectiveAmounts {
  const pct = householdDiscountPercent;
  return {
    firstWorkFeeCents: discounted(terms.firstWorkFeeCents, pct),
    recurringCents: discounted(terms.recurringCents, pct),
    flatTotalCents: discounted(terms.flat?.totalCents ?? 0, pct),
    maxTotalCents: discounted(planMaxTotalCents(terms) ?? 0, pct),
    ...(terms.type === "diy_subscription" ? { mailFeeCents: terms.mailFeeCents ?? 0 } : {}),
  };
}

/** The plan as the client signs it: the exact version, and the amounts that apply to them. Never changes afterwards. */
export interface PlanSnapshot {
  planId: string;
  key: string;
  version: number;
  name: Bilingual;
  textVersion: string;
  termsHash: string;
  terms: PlanTerms;
  /** The service option the plan is for (migration 0042). Absent on snapshots taken before: full service. */
  option?: ServiceOption;
  /** True when an attorney's approval of this version was on record when the snapshot was taken. */
  attorneyApproved: boolean;
  /** The household discount that applies to this client (0 when they are not linked or the plan has none). */
  householdDiscountPercent: number;
  effective: EffectiveAmounts;
}

export function snapshotPlan(plan: PlanVersion, options: { household?: boolean } = {}): PlanSnapshot {
  const pct = options.household ? plan.terms.householdDiscountPercent : 0;
  return {
    planId: plan.id,
    key: plan.key,
    version: plan.version,
    name: plan.name,
    textVersion: plan.textVersion,
    termsHash: plan.termsHash,
    // A copy: the snapshot is a record, never a view of the catalogue.
    terms: JSON.parse(JSON.stringify(plan.terms)) as PlanTerms,
    option: planOption(plan.terms),
    attorneyApproved: plan.attorney !== null,
    householdDiscountPercent: pct,
    effective: effectiveAmounts(plan.terms, pct),
  };
}

/** A snapshot read back from storage, or null when it is not one this app wrote. */
export function readPlanSnapshot(raw: unknown): PlanSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<PlanSnapshot>;
  if (typeof s.planId !== "string" || typeof s.version !== "number" || !s.effective || !s.terms) return null;
  if (!PLAN_TYPES.includes(s.terms.type)) return null;
  const e = s.effective;
  if (![e.firstWorkFeeCents, e.recurringCents, e.flatTotalCents, e.maxTotalCents].every((n) => Number.isInteger(n) && n >= 0)) return null;
  return s as PlanSnapshot;
}

// ── Words ───────────────────────────────────────────────────────────────

const money = (n: number) => formatCents(n);

function dueLine(t: PlanTerms, locale: L): string {
  if (t.dueRule.kind === "after_cancellation_window") {
    return locale === "es"
      ? "El primer cobro se hace cuando termina su periodo de cancelación de 3 días hábiles, nunca antes."
      : "The first charge is made when your 3-business-day cancellation period ends, never before.";
  }
  if (t.dueRule.kind === "days_after_first_round") {
    const d = t.dueRule.days;
    return locale === "es"
      ? `El primer cobro se hace ${d} ${d === 1 ? "día" : "días"} después de que enviamos su primera ronda de cartas, o más tarde.`
      : `The first charge is made ${d} ${d === 1 ? "day" : "days"} after we mail your first round of letters, or later.`;
  }
  return locale === "es"
    ? "El primer cobro se hace después de que enviamos su primera ronda de cartas, nunca antes."
    : "The first charge is made after we mail your first round of letters, never before.";
}

/**
 * The payment terms of a plan, as the lines of the contract's "What it costs"
 * section. Generated from the plan, so the contract says exactly what billing
 * does. Draft text for the attorney (PLAN_TEXT_VERSION).
 */
export function paymentTermsLines(t: PlanTerms, e: EffectiveAmounts, locale: L): string[] {
  const es = locale === "es";
  const lines: string[] = [];
  const first = e.firstWorkFeeCents;
  if (first > 0) {
    lines.push(
      es
        ? `Cuota de primer trabajo: ${money(first)}, una sola vez, que se cobra solo después de que enviamos su primera ronda de cartas. No se cobra al firmar ni cuando las cartas solo están preparadas.`
        : `First work fee: ${money(first)}, once, charged only after we mail your first round of letters. It is not charged when you sign or while letters are only prepared.`,
    );
  }
  switch (t.type) {
    case "subscription": {
      const months = t.duration.kind === "months" ? t.duration.count : null;
      const onMailing = periodTiming(t) === "on_mailing";
      lines.push(
        onMailing
          ? es
            ? `Suscripción mensual: ${money(e.recurringCents)} por cada periodo de 30 días en que enviamos al menos una ronda de sus cartas. Se cobra cada mes justo después de que enviamos las cartas de ese mes. Si en un periodo no enviamos ninguna carta, no se cobra nada por ese periodo.`
            : `Monthly subscription: ${money(e.recurringCents)} for each 30-day period in which we mail at least one round of your letters. It is charged each month right after that month's letters are mailed. If we mail no letters in a period, nothing is charged for that period.`
          : es
            ? `Suscripción mensual: ${money(e.recurringCents)} por cada periodo de 30 días en que enviamos al menos una ronda de sus cartas. Se cobra al terminar ese periodo. Si en un periodo no enviamos ninguna carta, no se cobra nada por ese periodo.`
            : `Monthly subscription: ${money(e.recurringCents)} for each 30-day period in which we mail at least one round of your letters. It is charged when that period ends. If we mail no letters in a period, nothing is charged for that period.`,
      );
      if (months) lines.push(es ? `Duración: hasta ${months} periodos de 30 días.` : `Length: up to ${months} periods of 30 days.`);
      break;
    }
    case "per_round": {
      const rounds = t.duration.kind === "rounds" ? t.duration.count : null;
      lines.push(
        es
          ? `Por ronda: ${money(e.recurringCents)} por cada ronda de cartas, que se cobra después de que la enviamos por correo.`
          : `Per round: ${money(e.recurringCents)} for each round of letters, charged after we mail it.`,
      );
      if (rounds) lines.push(es ? `Duración: hasta ${rounds} rondas.` : `Length: up to ${rounds} rounds.`);
      break;
    }
    case "flat_fee": {
      const f = t.flat!;
      if (f.schedule === "installments") {
        const n = f.rounds;
        const each = installmentCents(e.flatTotalCents, n, 1);
        const last = installmentCents(e.flatTotalCents, n, n);
        lines.push(
          es
            ? `Tarifa fija: ${money(e.flatTotalCents)} por ${n} ${n === 1 ? "ronda" : "rondas"} de cartas, en ${n} ${n === 1 ? "pago" : "pagos"} de ${money(each)}${last !== each ? ` (el último de ${money(last)})` : ""}. Cada pago se cobra solo después de que enviamos la ronda que paga.`
            : `Flat fee: ${money(e.flatTotalCents)} for ${n} ${n === 1 ? "round" : "rounds"} of letters, in ${n} ${n === 1 ? "payment" : "payments"} of ${money(each)}${last !== each ? ` (the last one ${money(last)})` : ""}. Each payment is charged only after we mail the round it pays for.`,
        );
      } else {
        lines.push(
          es
            ? `Tarifa fija: ${money(e.flatTotalCents)} por ${f.rounds} ${f.rounds === 1 ? "ronda" : "rondas"} de cartas, en un solo cobro que se hace solo después de que enviamos la ronda ${f.rounds}.`
            : `Flat fee: ${money(e.flatTotalCents)} for ${f.rounds} ${f.rounds === 1 ? "round" : "rounds"} of letters, in one charge made only after we mail round ${f.rounds}.`,
        );
      }
      break;
    }
    case "pay_per_delete":
      lines.push(
        es
          ? `Si un punto que usted disputó con nosotros ya no aparece en un reporte posterior, usted paga ${money(e.recurringCents)} por ese punto. Si nada cambia, no paga nada.${t.countsUpdated ? ` Un punto que un reporte posterior muestra corregido también cuenta.` : ""} Los puntos se cobran juntos, como mucho una vez cada 30 días, después de importar el reporte que lo muestra.`
          : `If an item you disputed through us no longer appears on a later report, you pay ${money(e.recurringCents)} for it. If nothing changes, you pay nothing.${t.countsUpdated ? " An item a later report shows as corrected also counts." : ""} Items are charged together, at most once every 30 days, after the report that shows it is imported.`,
      );
      break;
    case "diy_subscription":
      return diyPaymentTermsLines(t, e, locale);
  }
  lines.push(dueLine(t, locale));
  lines.push(
    es
      ? `Lo máximo que pagará: ${money(e.maxTotalCents)} en total, pase lo que pase. Nunca cobramos más de una vez cada 30 días.`
      : `Most you'll pay: ${money(e.maxTotalCents)} in total, whatever happens. We never charge more than once every 30 days.`,
  );
  return lines;
}

/** The cost lines of a DIY subscription: the subscription from the start, the optional mailing, the cap. */
function diyPaymentTermsLines(t: PlanTerms, e: EffectiveAmounts, locale: L): string[] {
  const es = locale === "es";
  const months = t.duration.kind === "months" ? t.duration.count : null;
  const mail = e.mailFeeCents ?? 0;
  return [
    es
      ? `Suscripción mensual al software: ${money(e.recurringCents)} por cada periodo de 30 días. Usted prepara y envía sus propias disputas con el software, así que cada periodo se cobra al empezar.`
      : `Monthly subscription to the software: ${money(e.recurringCents)} for each 30-day period. You prepare and send your own disputes with the software, so each period is charged when it begins.`,
    ...(months ? [es ? `Duración: hasta ${months} periodos de 30 días.` : `Length: up to ${months} periods of 30 days.`] : []),
    dueLine(t, locale),
    mail > 0
      ? es
        ? `Envío por usted (opcional): si nos pide enviar una carta por usted, cuesta ${money(mail)} por carta. Le mostramos el total antes de que confirme, y lo cobramos después de enviar las cartas.`
        : `Mailing for you (optional): if you ask us to mail a letter for you, it costs ${money(mail)} per letter. We show you the total before you confirm, and charge it after we mail the letters.`
      : es
        ? "Con este plan usted imprime y envía sus cartas; nosotros no las enviamos."
        : "Under this plan you print and mail your letters; we do not mail them.",
    es
      ? `Lo máximo que pagará por la suscripción: ${money(e.maxTotalCents)} en total, pase lo que pase. Nunca cobramos la suscripción más de una vez por periodo de 30 días.`
      : `Most you'll pay for the subscription: ${money(e.maxTotalCents)} in total, whatever happens. We never charge the subscription more than once per 30-day period.`,
  ];
}

/** One short line for "Mis pagos" and the staff card: "Per round · $89.00 per round mailed". */
export function planSummary(s: Pick<PlanSnapshot, "terms" | "effective" | "name">, locale: L): string {
  const e = s.effective;
  const es = locale === "es";
  if (s.terms.type === "diy_subscription") {
    const mail = e.mailFeeCents ?? 0;
    const perMonth = es ? `${money(e.recurringCents)} al mes` : `${money(e.recurringCents)} per month`;
    const mailing = mail > 0 ? (es ? ` · envío opcional ${money(mail)} por carta` : ` · optional mailing ${money(mail)} per letter`) : "";
    return `${s.name[locale]} · ${perMonth}${mailing}`;
  }
  const amount =
    s.terms.type === "subscription"
      ? es ? `${money(e.recurringCents)} por cada mes con trabajo` : `${money(e.recurringCents)} per month with work`
      : s.terms.type === "per_round"
        ? es ? `${money(e.recurringCents)} por ronda enviada` : `${money(e.recurringCents)} per round mailed`
        : s.terms.type === "flat_fee"
          ? es ? `${money(e.flatTotalCents)} por ${s.terms.flat!.rounds} rondas` : `${money(e.flatTotalCents)} for ${s.terms.flat!.rounds} rounds`
          : es ? `${money(e.recurringCents)} por punto que ya no aparece` : `${money(e.recurringCents)} per item no longer reported`;
  const first = e.firstWorkFeeCents > 0 ? (es ? ` + ${money(e.firstWorkFeeCents)} de primer trabajo` : ` + ${money(e.firstWorkFeeCents)} first work fee`) : "";
  return `${s.name[locale]} · ${amount}${first}`;
}

/** "Most you'll pay: $534.00". */
export function mostYoullPay(s: Pick<PlanSnapshot, "effective"> & { terms?: Pick<PlanTerms, "type"> }, locale: L): string {
  if (s.terms?.type === "diy_subscription") {
    return locale === "es"
      ? `Lo máximo que pagará por la suscripción: ${money(s.effective.maxTotalCents)}`
      : `Most you'll pay for the subscription: ${money(s.effective.maxTotalCents)}`;
  }
  return locale === "es" ? `Lo máximo que pagará: ${money(s.effective.maxTotalCents)}` : `Most you'll pay: ${money(s.effective.maxTotalCents)}`;
}

/** The sentence that closes the contract's cost section: when each charge is made. */
export function neverInAdvance(t: PlanTerms, locale: L): string {
  const es = locale === "es";
  if (t.type === "diy_subscription") {
    // Not "never in advance": the owner reports the attorney approved a subscription charged from the start for DIY (2026-11-25).
    return es
      ? "Usted realiza sus disputas con el software: Alti prepara las cartas con nuestros modelos aprobados y usted las imprime, las firma y las envía. Por eso la suscripción se cobra al inicio de cada periodo de 30 días, nunca durante su periodo de cancelación de 3 días hábiles. Un envío que usted nos pida se cobra solo después de que lo hacemos."
      : "You perform your disputes with the software: Alti prepares the letters from our approved templates and you print, sign and mail them. That is why the subscription is charged at the start of each 30-day period, never during your 3-business-day cancellation period. A mailing you ask us for is charged only after we do it.";
  }
  const what =
    t.type === "subscription" && periodTiming(t) === "on_mailing"
      ? es ? "la ronda de cartas de ese periodo de 30 días, ya enviada por correo" : "the round of letters of that 30-day period, already mailed"
      : t.type === "subscription"
      ? es ? "el periodo de 30 días en que enviamos sus cartas" : "the 30-day period in which we mailed your letters"
      : t.type === "pay_per_delete"
        ? es ? "el reporte posterior que ya no muestra el punto disputado" : "the later report that no longer shows the disputed item"
        : es ? "la ronda de cartas que paga, ya enviada por correo" : "the round of letters it pays for, already mailed";
  return es
    ? `Nunca cobramos por adelantado. No cobramos ni recibimos dinero ni ninguna otra cosa de valor por un servicio antes de haberlo realizado por completo (15 U.S.C. §1679b(b)). Cada cobro se hace únicamente después de: ${what}.`
    : `We never charge in advance. We do not charge or receive any money or other valuable consideration for a service before that service has been fully performed (15 U.S.C. §1679b(b)). Each charge is made only after ${what}.`;
}
