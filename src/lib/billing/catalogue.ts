import type { ServiceOption } from "../service/options";
import {
  canMoveTo,
  planOption,
  PLAN_TEXT_VERSION,
  planTermsHash,
  validatePlanTerms,
  type PlanProblem,
  type PlanTerms,
  type PlanVersion,
} from "./plans";
import type { Bilingual, BillingSwitches } from "./types";

// Changes to the plan catalogue, as pure functions of the catalogue and the
// clock. The demo applies them to this browser's copy; the server applies the
// same ones and writes the rows, where the trigger (migration 0026) checks
// them again: a draft is edited until it is approved and offered; an offered
// version never changes (a change is a new version); draft → active → retired.

export type CatalogueResult<T> = { ok: true; value: T } | { ok: false; problems: PlanProblem[] };

const fail = (en: string, es: string, field = "plan"): CatalogueResult<never> => ({ ok: false, problems: [{ code: "invalid", field, message: { en, es } }] });

export interface DraftInput {
  /** Edit this draft. Absent: a new plan, or a new version of `key`. */
  id?: string | null;
  key?: string | null;
  name: Bilingual;
  terms: unknown;
}

export function planKeyFrom(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug.length >= 2 ? slug : `plan-${slug || "1"}`;
}

/** Save a draft: a new plan, a new version of an offered one, or an edit of a draft. */
export function planSaveDraft(
  all: PlanVersion[],
  input: DraftInput,
  by: string,
  now: Date,
  newId: () => string,
): CatalogueResult<{ version: PlanVersion; replaces: PlanVersion | null }> {
  const problems = validatePlanTerms(input.terms);
  if (problems.length > 0) return { ok: false, problems };
  const name = { en: input.name.en.replace(/\s+/g, " ").trim(), es: input.name.es.replace(/\s+/g, " ").trim() };
  if (name.en.length < 2 || name.en.length > 80 || name.es.length < 2 || name.es.length > 80) {
    return fail("Give the plan a name in English and in Spanish (2 to 80 characters).", "Ponle nombre al plan en inglés y en español (2 a 80 letras).", "name");
  }
  const terms = input.terms as PlanTerms;
  const termsHash = planTermsHash(terms, name);
  if (input.id) {
    const current = all.find((p) => p.id === input.id);
    if (!current) return fail("That plan version no longer exists.", "Esa versión del plan ya no existe.");
    if (current.status !== "draft") return fail("An offered plan version cannot be changed: save a new version.", "Una versión ofrecida no se puede cambiar: guarda una versión nueva.");
    const version: PlanVersion = { ...current, name, terms, termsHash, textVersion: PLAN_TEXT_VERSION, attorney: null };
    return { ok: true, value: { version, replaces: current } };
  }
  const key = input.key ? input.key : planKeyFrom(name.en);
  if (!/^[a-z0-9-]{2,60}$/.test(key)) return fail("The plan key is letters, numbers and dashes.", "La clave del plan lleva letras, números y guiones.", "key");
  const same = all.filter((p) => p.key === key);
  if (!input.key && same.length > 0) return fail("A plan with that name exists: open it and save a new version.", "Ya hay un plan con ese nombre: ábrelo y guarda una versión nueva.", "name");
  if (same.some((p) => p.status === "draft")) return fail("This plan already has a draft: finish that one first.", "Este plan ya tiene un borrador: termina ese primero.");
  const version: PlanVersion = {
    id: newId(),
    key,
    version: same.reduce((n, p) => Math.max(n, p.version), 0) + 1,
    status: "draft",
    name,
    terms,
    termsHash,
    textVersion: PLAN_TEXT_VERSION,
    isDefault: false,
    attorney: null,
    createdBy: by,
    createdAt: now.toISOString(),
    activatedAt: null,
    retiredAt: null,
  };
  return { ok: true, value: { version, replaces: null } };
}

export interface ApprovalInput {
  attorneyName: string;
  /** YYYY-MM-DD */
  approvedOn: string;
  /** "I confirm the attorney approved this exact version." */
  confirmed: boolean;
}

/** Record the attorney's approval of a draft (the attorney is not a user: a name and a date). */
export function planRecordApproval(all: PlanVersion[], id: string, input: ApprovalInput, now: Date): CatalogueResult<PlanVersion> {
  const plan = all.find((p) => p.id === id);
  if (!plan) return fail("That plan version no longer exists.", "Esa versión del plan ya no existe.");
  if (plan.status !== "draft") return fail("Only a draft takes an approval.", "Solo un borrador recibe una aprobación.");
  const attorneyName = input.attorneyName.replace(/\s+/g, " ").trim();
  if (attorneyName.length < 3 || attorneyName.length > 120) return fail("Write the attorney's name.", "Escribe el nombre del abogado.", "attorneyName");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.approvedOn) || new Date(`${input.approvedOn}T12:00:00Z`).getTime() > now.getTime() + 24 * 3600 * 1000) {
    return fail("Give the date of the approval (not in the future).", "Escribe la fecha de la aprobación (no en el futuro).", "approvedOn");
  }
  if (!input.confirmed) return fail("Confirm the attorney approved this exact version.", "Confirma que el abogado aprobó esta versión exacta.", "confirmed");
  return { ok: true, value: { ...plan, attorney: { name: attorneyName, approvedOn: input.approvedOn } } };
}

/**
 * Offer a draft. It needs the attorney's approval; pay per delete also needs
 * its program switch. The version it replaces (the same plan's active one) is
 * retired, and keeps being billed for the clients who signed it.
 */
export function planActivate(all: PlanVersion[], id: string, now: Date, switches: BillingSwitches): CatalogueResult<PlanVersion[]> {
  const plan = all.find((p) => p.id === id);
  if (!plan) return fail("That plan version no longer exists.", "Esa versión del plan ya no existe.");
  if (!canMoveTo(plan.status, "active")) return fail("Only a draft can be offered.", "Solo un borrador se puede ofrecer.");
  if (!plan.attorney) return fail("Record the attorney's approval of this version first.", "Primero registra la aprobación del abogado de esta versión.", "attorney");
  if (plan.terms.type === "pay_per_delete" && !switches.payPerDelete) {
    return fail("Pay per delete is off until the attorney's approval of the program is recorded.", "El pago por eliminación está apagado hasta que se registre la aprobación del abogado del programa.");
  }
  const at = now.toISOString();
  const previous = all.find((p) => p.key === plan.key && p.status === "active");
  const changed: PlanVersion[] = [];
  if (previous) changed.push({ ...previous, status: "retired", retiredAt: at, isDefault: false });
  changed.push({ ...plan, status: "active", activatedAt: at, isDefault: previous?.isDefault ?? false });
  return { ok: true, value: changed };
}

export function planRetire(all: PlanVersion[], id: string, now: Date): CatalogueResult<PlanVersion> {
  const plan = all.find((p) => p.id === id);
  if (!plan) return fail("That plan version no longer exists.", "Esa versión del plan ya no existe.");
  if (!canMoveTo(plan.status, "retired")) return fail("Only an offered plan can be retired.", "Solo un plan ofrecido se puede retirar.");
  return { ok: true, value: { ...plan, status: "retired", retiredAt: now.toISOString(), isDefault: false } };
}

/** The plan offered to clients of its option who were not offered another one. One default per option (migration 0042). */
export function planSetDefault(all: PlanVersion[], id: string): CatalogueResult<PlanVersion[]> {
  const plan = all.find((p) => p.id === id);
  if (!plan || plan.status !== "active") return fail("Only an offered plan can be the default.", "Solo un plan ofrecido puede ser el predeterminado.");
  const option = planOption(plan.terms);
  return {
    ok: true,
    value: all.filter((p) => planOption(p.terms) === option && (p.isDefault || p.id === id)).map((p) => ({ ...p, isDefault: p.id === id })),
  };
}

/** Only a draft can be thrown away. */
export function planDiscard(all: PlanVersion[], id: string): CatalogueResult<PlanVersion> {
  const plan = all.find((p) => p.id === id);
  if (!plan) return fail("That plan version no longer exists.", "Esa versión del plan ya no existe.");
  if (plan.status !== "draft") return fail("An offered plan version is a record and cannot be deleted.", "Una versión ofrecida es un registro y no se puede borrar.");
  return { ok: true, value: plan };
}

/**
 * The plan a client is offered: the one staff chose for them, else the
 * default, both for the client's option (Credalti Complete or Credalti DIY).
 * A plan for the other option is never offered.
 */
export function offeredPlan(all: PlanVersion[], chosenId: string | null = null, option: ServiceOption = "full_service"): PlanVersion | null {
  const ofOption = all.filter((p) => p.status === "active" && planOption(p.terms) === option);
  const chosen = chosenId ? ofOption.find((p) => p.id === chosenId) : null;
  return chosen ?? ofOption.find((p) => p.isDefault) ?? null;
}

// ── The demo's catalogue ────────────────────────────────────────────────

/** Example plans for the demo, one of each kind CRC staff know. Not approved by anyone: marked so on screen. */
export function demoCatalogue(now: Date = new Date()): PlanVersion[] {
  const at = new Date(now.getTime() - 20 * 24 * 3600 * 1000).toISOString();
  const make = (id: string, key: string, name: Bilingual, terms: PlanTerms, status: PlanVersion["status"], isDefault = false): PlanVersion => ({
    id,
    key,
    version: 1,
    status,
    name,
    terms,
    termsHash: planTermsHash(terms, name),
    textVersion: PLAN_TEXT_VERSION,
    isDefault,
    attorney: null,
    createdBy: "Carmen Ruiz",
    createdAt: at,
    activatedAt: status === "draft" ? null : at,
    retiredAt: null,
  });
  const base = { firstWorkFeeCents: 0, flat: null, dueRule: { kind: "after_first_round" as const }, maxTotalCents: null, householdDiscountPercent: 0, countsUpdated: false };
  return [
    make(
      "demo-plan-per-round",
      "per-round",
      { en: "Credalti Complete · per round", es: "Credalti Complete · por ronda" },
      { ...base, type: "per_round", recurringCents: 8900, duration: { kind: "rounds", count: 6 }, householdDiscountPercent: 15 },
      "active",
      true,
    ),
    make(
      "demo-plan-monthly",
      "monthly",
      { en: "Credalti Complete · monthly", es: "Credalti Complete · mensual" },
      { ...base, type: "subscription", firstWorkFeeCents: 9900, recurringCents: 7900, duration: { kind: "months", count: 8 }, householdDiscountPercent: 10, periodTiming: "on_mailing" },
      "active",
    ),
    make(
      "demo-plan-flat",
      "flat-3-rounds",
      { en: "Credalti Complete · flat fee, 3 rounds", es: "Credalti Complete · tarifa fija, 3 rondas" },
      { ...base, type: "flat_fee", recurringCents: 0, flat: { totalCents: 49900, rounds: 3, schedule: "installments" }, duration: { kind: "rounds", count: 3 } },
      "active",
    ),
    make(
      "demo-plan-per-delete",
      "pay-per-delete",
      { en: "Pay per delete", es: "Pago por punto que ya no aparece" },
      { ...base, type: "pay_per_delete", recurringCents: 5000, duration: { kind: "indefinite" }, maxTotalCents: 60000 },
      "draft",
    ),
    // The other option (migration 0042): a monthly subscription from the start, after the cancellation window.
    make(
      "demo-plan-diy",
      "diy-monthly",
      { en: "Credalti DIY · monthly", es: "Credalti DIY · mensual" },
      {
        ...base,
        type: "diy_subscription",
        recurringCents: 3900,
        dueRule: { kind: "after_cancellation_window" },
        duration: { kind: "indefinite" },
        maxTotalCents: 46800,
        mailFeeCents: 400,
      },
      "active",
      true,
    ),
  ];
}
