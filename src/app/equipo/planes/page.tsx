"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getPlanCatalogue } from "@/lib/billing/planData";
import { formatCents } from "@/lib/billing/money";
import {
  DUE_RULE_OPTIONS,
  DURATIONS_FOR,
  FIRST_WORK_TIMING,
  LIMITS,
  NO_SETUP_FEE_WHY,
  PLAN_TYPE_HELP,
  PLAN_TYPE_LABEL,
  PLAN_TYPES,
  effectiveAmounts,
  paymentTermsLines,
  planMaxTotalCents,
  snapshotPlan,
  validatePlanTerms,
  type PlanProblem,
  type PlanTerms,
  type PlanType,
  type PlanVersion,
} from "@/lib/billing/plans";
import { paymentTimeline } from "@/lib/billing/schedule";
import { SWITCHES_OFF, type BillingSwitches } from "@/lib/billing/types";
import { deniedReason } from "@/lib/staff/permissions";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { Chip, NoAccess, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";

// Billing plans, the way Credit Repair Cloud's "Manage Plans" lays them out
// (name, first work fee, recurring amount, due date, duration, household
// discount), with the payment timeline the rules would actually produce. What
// differs from CRC is the law: nothing is charged before the work it pays for
// (15 U.S.C. §1679b(b)). A setup fee cannot be entered; the due dates that
// could charge first are shown disabled with the reason. Administrators only.
//
// A plan version is a draft until an administrator records the attorney's
// approval and offers it; an offered version never changes (a change is a new
// version), and a client's signed agreement keeps the version they signed.

type L = "es" | "en";

interface Form {
  id: string | null;
  key: string | null;
  nameEn: string;
  nameEs: string;
  type: PlanType;
  firstWork: boolean;
  firstWorkFee: string;
  recurring: string;
  flatTotal: string;
  flatRounds: string;
  flatSchedule: "installments" | "after_last_round";
  due: "after_first_round" | "days_after_first_round";
  dueDays: string;
  durationKind: "indefinite" | "months" | "rounds";
  durationCount: string;
  cap: string;
  household: string;
  countsUpdated: boolean;
}

const EMPTY: Form = {
  id: null,
  key: null,
  nameEn: "",
  nameEs: "",
  type: "per_round",
  firstWork: false,
  firstWorkFee: "",
  recurring: "89.00",
  flatTotal: "499.00",
  flatRounds: "3",
  flatSchedule: "installments",
  due: "after_first_round",
  dueDays: "7",
  durationKind: "rounds",
  durationCount: "6",
  cap: "",
  household: "0",
  countsUpdated: false,
};

const cents = (dollars: string): number => {
  const n = Number(dollars.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : -1;
};
const dollars = (c: number) => (c / 100).toFixed(2);

function formToTerms(f: Form): PlanTerms {
  const flat = f.type === "flat_fee";
  const rounds = Number(f.flatRounds) || 0;
  return {
    type: f.type,
    firstWorkFeeCents: f.firstWork && f.type !== "pay_per_delete" ? cents(f.firstWorkFee) : 0,
    recurringCents: flat ? 0 : cents(f.recurring),
    flat: flat ? { totalCents: cents(f.flatTotal), rounds, schedule: f.flatSchedule } : null,
    dueRule: f.due === "days_after_first_round" ? { kind: "days_after_first_round", days: Number(f.dueDays) || 0 } : { kind: "after_first_round" },
    duration: flat
      ? { kind: "rounds", count: rounds }
      : f.durationKind === "indefinite" || !DURATIONS_FOR[f.type].includes(f.durationKind)
        ? { kind: "indefinite" }
        : { kind: f.durationKind, count: Number(f.durationCount) || 0 },
    maxTotalCents: f.cap.trim() === "" ? null : cents(f.cap),
    householdDiscountPercent: Number(f.household) || 0,
    countsUpdated: f.type === "pay_per_delete" && f.countsUpdated,
  } as PlanTerms;
}

function planToForm(p: PlanVersion): Form {
  const t = p.terms;
  return {
    id: p.status === "draft" ? p.id : null,
    key: p.key,
    nameEn: p.name.en,
    nameEs: p.name.es,
    type: t.type,
    firstWork: t.firstWorkFeeCents > 0,
    firstWorkFee: t.firstWorkFeeCents > 0 ? dollars(t.firstWorkFeeCents) : "",
    recurring: dollars(t.recurringCents),
    flatTotal: t.flat ? dollars(t.flat.totalCents) : EMPTY.flatTotal,
    flatRounds: t.flat ? String(t.flat.rounds) : EMPTY.flatRounds,
    flatSchedule: t.flat?.schedule ?? "installments",
    due: t.dueRule.kind,
    dueDays: t.dueRule.kind === "days_after_first_round" ? String(t.dueRule.days) : EMPTY.dueDays,
    durationKind: t.duration.kind,
    durationCount: t.duration.kind === "indefinite" ? EMPTY.durationCount : String(t.duration.count),
    cap: t.maxTotalCents === null ? "" : dollars(t.maxTotalCents),
    household: String(t.householdDiscountPercent),
    countsUpdated: t.countsUpdated,
  };
}

const STATUS_TONE: Record<PlanVersion["status"], string> = {
  draft: "bg-slate-100 text-slate-600",
  active: "bg-green-50 text-green-700",
  retired: "bg-slate-100 text-slate-500",
};

const FIELD = "h-11 w-full min-w-0 rounded-xl bg-white px-3 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none focus:ring-2 focus:ring-blue-300";
const LABEL = "block text-[13px] font-semibold text-slate-800";
const HINT = "mt-1 text-[12.5px] leading-snug text-slate-500";

function durationText(t: PlanTerms, l: L): string {
  if (t.duration.kind === "indefinite") return l === "es" ? "Indefinida" : "Indefinite";
  const n = t.duration.count;
  if (t.duration.kind === "months") return l === "es" ? `${n} meses` : `${n} months`;
  return l === "es" ? `${n} rondas` : `${n} rounds`;
}

function amountText(t: PlanTerms, l: L): string {
  if (t.type === "flat_fee" && t.flat) return `${formatCents(t.flat.totalCents)} / ${t.flat.rounds} ${l === "es" ? "rondas" : "rounds"}`;
  const per = t.type === "subscription" ? (l === "es" ? "mes con trabajo" : "month with work") : t.type === "per_round" ? (l === "es" ? "ronda" : "round") : l === "es" ? "punto" : "item";
  return `${formatCents(t.recurringCents)} / ${per}`;
}

function Timeline({ terms, l }: { terms: PlanTerms | null; l: L }) {
  const t = useTx();
  const events = useMemo(() => {
    if (!terms) return null;
    const plan: PlanVersion = {
      id: "preview",
      key: "preview",
      version: 1,
      status: "draft",
      name: { en: "Preview", es: "Vista previa" },
      terms,
      termsHash: "",
      textVersion: "",
      isDefault: false,
      attorney: null,
      createdBy: "",
      createdAt: "",
      activatedAt: null,
      retiredAt: null,
    };
    return paymentTimeline(snapshotPlan(plan), { rounds: 6, everyDays: 40, days: 300 });
  }, [terms]);
  return (
    <section aria-labelledby="timeline" data-testid="payment-timeline">
      <SectionTitle>
        <span id="timeline">{t("Vista previa de cobros", "Payment timeline preview")}</span>
      </SectionTitle>
      <div className="card px-5 py-4">
        <p className="text-[12.5px] leading-snug text-slate-500">
          {t(
            "Un cliente de ejemplo: rondas enviadas cada 40 días. Calculado por las mismas reglas que cobran.",
            "An example client: rounds mailed every 40 days. Worked out by the same rules that charge.",
          )}
        </p>
        {!events ? (
          <p className="mt-3 text-[14px] text-slate-600">{t("Completa el plan para ver cuándo se cobraría.", "Complete the plan to see when each charge would happen.")}</p>
        ) : (
          <ol className="mt-3 space-y-0">
            {events.map((e, i) => (
              <li key={i} className="flex gap-3 border-t hairline py-2 first:border-t-0">
                <span className="w-16 shrink-0 text-right text-[12.5px] tabular-nums text-slate-500">
                  {t(`día ${e.day}`, `day ${e.day}`)}
                </span>
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.kind === "charge" ? "bg-amber-400" : e.kind === "round" ? "bg-blue-700" : e.kind === "no_work" ? "bg-slate-300" : "bg-slate-400"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-slate-800">
                  {e.kind === "charge" ? <span className="font-semibold">{t("Cobro", "Charge")}: </span> : null}
                  {e.label[l]}
                </span>
                {e.amountCents !== undefined && (
                  <span className="shrink-0 text-right text-[13.5px] tabular-nums">
                    <span className="font-semibold text-slate-900">{formatCents(e.amountCents)}</span>
                    <span className="block text-[11.5px] text-slate-500">{t("total", "total")} {formatCents(e.totalCents ?? 0)}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Problems({ problems, l }: { problems: PlanProblem[]; l: L }) {
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="space-y-1 rounded-2xl bg-red-50 px-4 py-3 text-[13.5px] leading-snug text-red-700" data-testid="plan-problems">
      {problems.map((p, i) => (
        <li key={i}>{p.message[l]}</li>
      ))}
    </ul>
  );
}

function Editor({ form, setForm, onSave, saving, problems, l, switches }: { form: Form; setForm: (f: Form) => void; onSave: () => void; saving: boolean; problems: PlanProblem[]; l: L; switches: BillingSwitches }) {
  const t = useTx();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const terms = formToTerms(form);
  const live = validatePlanTerms(terms);
  const max = live.length === 0 ? planMaxTotalCents(terms) : null;
  const recurringLabel =
    form.type === "subscription"
      ? t("Monto recurrente (por mes con trabajo)", "Recurring amount (per month with work)")
      : form.type === "per_round"
        ? t("Monto recurrente (por ronda enviada)", "Recurring amount (per round mailed)")
        : t("Cuota por punto que ya no aparece", "Fee per item no longer reported");
  return (
    <div className="card px-5 py-5" data-testid="plan-editor">
      <h2 className="text-[19px] font-semibold text-slate-900">{form.id ? t("Editar borrador", "Edit draft") : form.key ? t("Nueva versión", "New version") : t("Nuevo plan", "New plan")}</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="min-w-0">
          <span className={LABEL}>{t("Nombre del plan (inglés)", "Plan name (English)")}</span>
          <input className={`${FIELD} mt-1.5`} value={form.nameEn} maxLength={80} onChange={(e) => set("nameEn", e.target.value)} placeholder="Standard per round" />
        </label>
        <label className="min-w-0">
          <span className={LABEL}>{t("Nombre del plan (español)", "Plan name (Spanish)")}</span>
          <input className={`${FIELD} mt-1.5`} value={form.nameEs} maxLength={80} onChange={(e) => set("nameEs", e.target.value)} placeholder="Estándar por ronda" />
        </label>
      </div>

      <fieldset className="mt-5">
        <legend className={LABEL}>{t("Tipo de plan", "Plan type")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PLAN_TYPES.map((type) => {
            const off = type === "pay_per_delete" && !switches.payPerDelete;
            return (
              <label key={type} className={`flex cursor-pointer gap-3 rounded-2xl px-3.5 py-3 ${form.type === type ? "bg-blue-50 ring-2 ring-blue-300" : "bg-slate-50"}`}>
                <input
                  type="radio"
                  name="plan-type"
                  checked={form.type === type}
                  onChange={() => setForm({ ...form, type, durationKind: DURATIONS_FOR[type].includes(form.durationKind) ? form.durationKind : DURATIONS_FOR[type][0]! })}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
                  data-testid={`plan-type-${type}`}
                />
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold text-slate-900">
                    {PLAN_TYPE_LABEL[type][l]}
                    {type === "pay_per_delete" && <Chip tone="ml-1.5 bg-amber-100 text-blue-900">{t("Abogado pendiente", "Attorney pending")}</Chip>}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-600">{PLAN_TYPE_HELP[type][l]}</span>
                  {off && <span className="mt-1 block text-[12px] font-medium text-blue-900">{t("Apagado hasta registrar la aprobación del abogado (abajo).", "Off until the attorney's approval is recorded (below).")}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <span className={LABEL}>{t("Cuota de primer trabajo", "First work fee")}</span>
          <div className="mt-1.5 flex gap-1 rounded-xl bg-slate-100 p-1" role="group">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={form.firstWork === v}
                disabled={form.type === "pay_per_delete" && v}
                onClick={() => set("firstWork", v)}
                className={`h-9 flex-1 rounded-lg text-[13px] font-semibold disabled:opacity-40 ${form.firstWork === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                {v ? t("Sí", "Yes") : t("No", "No")}
              </button>
            ))}
          </div>
          {form.firstWork && form.type !== "pay_per_delete" && (
            <input className={`${FIELD} mt-2`} inputMode="decimal" value={form.firstWorkFee} onChange={(e) => set("firstWorkFee", e.target.value)} placeholder="99.00" aria-label={t("Monto de primer trabajo", "First work fee amount")} />
          )}
          <p className={`${HINT} font-medium text-blue-900`} data-testid="first-work-timing">
            {FIRST_WORK_TIMING[l]}
          </p>
          {form.type === "pay_per_delete" && <p className={HINT}>{t("El pago por eliminación no lleva cuota de primer trabajo.", "Pay per delete has no first work fee.")}</p>}
        </div>

        {form.type === "flat_fee" ? (
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <label className="min-w-0">
              <span className={LABEL}>{t("Total", "Total")}</span>
              <input className={`${FIELD} mt-1.5`} inputMode="decimal" value={form.flatTotal} onChange={(e) => set("flatTotal", e.target.value)} />
            </label>
            <label className="min-w-0">
              <span className={LABEL}>{t("Rondas incluidas", "Rounds included")}</span>
              <input className={`${FIELD} mt-1.5`} inputMode="numeric" value={form.flatRounds} onChange={(e) => set("flatRounds", e.target.value)} />
            </label>
            <label className="col-span-2 min-w-0">
              <span className={LABEL}>{t("Cómo se cobra", "How it's charged")}</span>
              <select className={`${FIELD} mt-1.5`} value={form.flatSchedule} onChange={(e) => set("flatSchedule", e.target.value as Form["flatSchedule"])}>
                <option value="installments">{t("En pagos iguales, uno después de cada ronda", "Equal installments, one after each round")}</option>
                <option value="after_last_round">{t("Un solo cobro después de la última ronda incluida", "One charge after the last included round is mailed")}</option>
              </select>
            </label>
          </div>
        ) : (
          <label className="min-w-0">
            <span className={LABEL}>{recurringLabel}</span>
            <input className={`${FIELD} mt-1.5`} inputMode="decimal" value={form.recurring} onChange={(e) => set("recurring", e.target.value)} data-testid="plan-recurring" />
            {form.type === "pay_per_delete" && (
              <label className="mt-2 flex items-start gap-2 text-[13px] text-slate-700">
                <input type="checkbox" checked={form.countsUpdated} onChange={(e) => set("countsUpdated", e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-700" />
                {t("Contar también un punto que un reporte posterior muestra actualizado", "Also count an item a later report shows as updated")}
              </label>
            )}
          </label>
        )}
      </div>

      <fieldset className="mt-5" data-testid="due-date">
        <legend className={LABEL}>{t("Fecha de cobro", "Due date")}</legend>
        <div className="mt-2 space-y-1.5">
          {DUE_RULE_OPTIONS.map((o) => (
            <label key={o.key} className={`flex items-start gap-3 rounded-xl px-3 py-2 ${o.allowed ? "cursor-pointer bg-slate-50" : "cursor-not-allowed bg-slate-50/60"}`} title={o.why?.[l]}>
              <input
                type="radio"
                name="due"
                disabled={!o.allowed}
                checked={o.allowed && form.due === o.key}
                onChange={() => set("due", o.key as Form["due"])}
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-700 disabled:opacity-40"
              />
              <span className="min-w-0">
                <span className={`block text-[14px] ${o.allowed ? "font-medium text-slate-900" : "text-slate-400 line-through"}`}>{o.label[l]}</span>
                {o.why && <span className="block text-[12px] leading-snug text-slate-500">{o.why[l]}</span>}
                {o.key === "days_after_first_round" && form.due === o.key && (
                  <input className={`${FIELD} mt-1.5 max-w-28`} inputMode="numeric" value={form.dueDays} onChange={(e) => set("dueDays", e.target.value)} aria-label={t("Días", "Days")} />
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="min-w-0">
          <span className={LABEL}>{t("Duración", "Duration")}</span>
          {form.type === "flat_fee" ? (
            <p className="mt-2.5 text-[14px] text-slate-700">{t(`${form.flatRounds} rondas (la tarifa fija)`, `${form.flatRounds} rounds (the flat fee)`)}</p>
          ) : (
            <div className="mt-1.5 flex gap-2">
              <select className={`${FIELD} min-w-32`} value={form.durationKind} onChange={(e) => set("durationKind", e.target.value as Form["durationKind"])}>
                {DURATIONS_FOR[form.type].map((k) => (
                  <option key={k} value={k}>
                    {k === "indefinite" ? t("Indefinida", "Indefinite") : k === "months" ? t("Meses", "Months") : t("Rondas", "Rounds")}
                  </option>
                ))}
              </select>
              {form.durationKind !== "indefinite" && <input className={`${FIELD} max-w-20`} inputMode="numeric" value={form.durationCount} onChange={(e) => set("durationCount", e.target.value)} aria-label={t("Cuántos", "How many")} />}
            </div>
          )}
        </label>
        <label className="min-w-0">
          <span className={LABEL}>{t("Lo máximo que pagará (tope)", "Most they'll pay (cap)")}</span>
          <input className={`${FIELD} mt-1.5`} inputMode="decimal" value={form.cap} onChange={(e) => set("cap", e.target.value)} placeholder={max !== null ? dollars(max) : t("obligatorio si no tiene fin", "required with no end")} data-testid="plan-cap" />
          <p className={HINT}>{max !== null ? t(`El cliente ve: «Lo máximo que pagará: ${formatCents(max)}»`, `The client sees: "Most you'll pay: ${formatCents(max)}"`) : t("Se muestra en el acuerdo y en Mis pagos.", "Shown in the agreement and on My payments.")}</p>
        </label>
        <label className="min-w-0">
          <span className={LABEL}>{t("Descuento de hogar (%)", "Household discount (%)")}</span>
          <input className={`${FIELD} mt-1.5`} inputMode="numeric" value={form.household} onChange={(e) => set("household", e.target.value)} />
          <p className={HINT}>{t(`Para dos clientes ligados (pareja u hogar). 0 a ${LIMITS.maxHouseholdDiscountPercent}.`, `For two linked clients (a couple or household). 0 to ${LIMITS.maxHouseholdDiscountPercent}.`)}</p>
        </label>
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3" data-testid="no-setup-fee">
        <p className="text-[13px] font-semibold text-slate-800">{t("Cuota de inscripción o apertura", "Setup or enrollment fee")}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">{NO_SETUP_FEE_WHY[l]}</p>
      </div>

      <div className="mt-5">
        <Problems problems={problems.length > 0 ? problems : []} l={l} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={PRIMARY_BUTTON} disabled={saving || live.length > 0} onClick={onSave} data-testid="plan-save">
          {t("Guardar borrador", "Save draft")}
        </button>
        {live.length > 0 && <p className="self-center text-[13px] text-slate-500">{live[0]!.message[l]}</p>}
      </div>

      {live.length === 0 && (
        <details className="mt-5" open>
          <summary className="cursor-pointer text-[13px] font-semibold text-blue-700">{t("Lo que dirá el contrato (borrador para el abogado)", "What the contract will say (draft for the attorney)")}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-snug text-slate-700" data-testid="plan-contract-text">
            {paymentTermsLines(terms, effectiveAmounts(terms, 0), l).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SwitchCard({ name, on, onSave, label, help, withAmount }: { name: "pay_per_delete" | "referral_credits"; on: boolean; onSave: (input: { enabled: boolean; attorneyName?: string; approvedOn?: string; confirmed?: boolean; referralCreditCents?: number }) => Promise<string | null>; label: string; help: string; withAmount?: boolean }) {
  const t = useTx();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ attorneyName: "", approvedOn: "", confirmed: false, amount: "25.00" });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="border-t hairline px-5 py-4 first:border-t-0" data-testid={`switch-${name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-slate-900">{label}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-600">{help}</p>
        </div>
        <Chip tone={on ? "bg-green-50 text-green-700" : "bg-amber-100 text-blue-900"}>{on ? t("Encendido", "On") : t("Apagado · abogado pendiente", "Off · attorney pending")}</Chip>
      </div>
      {!open ? (
        <button type="button" className={`${QUIET_BUTTON} mt-2 -ml-3`} onClick={() => (on ? void onSave({ enabled: false }) : setOpen(true))}>
          {on ? t("Apagar", "Turn off") : t("Registrar la aprobación del abogado y encender", "Record the attorney's approval and turn on")}
        </button>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input className={FIELD} placeholder={t("Nombre del abogado", "Attorney's name")} value={f.attorneyName} onChange={(e) => setF({ ...f, attorneyName: e.target.value })} />
          <input className={FIELD} type="date" value={f.approvedOn} onChange={(e) => setF({ ...f, approvedOn: e.target.value })} />
          {withAmount && <input className={FIELD} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label={t("Crédito por referido", "Credit per referral")} />}
          <label className="flex items-start gap-2 text-[13px] text-slate-700 sm:col-span-3">
            <input type="checkbox" checked={f.confirmed} onChange={(e) => setF({ ...f, confirmed: e.target.checked })} className="mt-0.5 h-4 w-4 accent-blue-700" />
            {t("Confirmo que el abogado lo aprobó por escrito.", "I confirm the attorney approved this in writing.")}
          </label>
          {error && <p className="text-[13px] text-red-700 sm:col-span-3">{error}</p>}
          <div className="flex gap-2 sm:col-span-3">
            <button
              type="button"
              className={ROW_BUTTON}
              onClick={async () => {
                const message = await onSave({ enabled: true, attorneyName: f.attorneyName, approvedOn: f.approvedOn, confirmed: f.confirmed, ...(withAmount ? { referralCreditCents: cents(f.amount) } : {}) });
                if (message) setError(message);
                else setOpen(false);
              }}
            >
              {t("Encender", "Turn on")}
            </button>
            <button type="button" className={QUIET_BUTTON} onClick={() => setOpen(false)}>
              {t("Cancelar", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlanesPage() {
  const { ready, can, locale } = useStaff();
  const t = useTx();
  const l: L = locale;
  const data = useMemo(() => getPlanCatalogue(), []);
  const [plans, setPlans] = useState<PlanVersion[] | null>(null);
  const [switches, setSwitches] = useState<BillingSwitches>(SWITCHES_OFF);
  const [form, setForm] = useState<Form | null>(null);
  const [problems, setProblems] = useState<PlanProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [approval, setApproval] = useState({ attorneyName: "", approvedOn: "", confirmed: false });
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await data.list();
    setPlans(list.plans);
    setSwitches(list.switches);
  }, [data]);
  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).get("nuevo") === "1") setForm({ ...EMPTY });
  }, [load]);

  if (!ready || !plans) return null;
  if (!can("billing.plans")) return <NoAccess title={t("Planes", "Plans")} reason={deniedReason("billing.plans", locale)} />;

  const act = async (run: () => Promise<{ ok: boolean; problems?: PlanProblem[] }>, done?: string) => {
    setSaving(true);
    const result = await run();
    setSaving(false);
    if (!result.ok) {
      setMessage(result.problems?.[0]?.message[l] ?? t("No se pudo guardar.", "Could not save."));
      return false;
    }
    setMessage(done ?? null);
    await load();
    return true;
  };

  const save = async () => {
    if (!form) return;
    const result = await data.saveDraft({ id: form.id, key: form.key, name: { en: form.nameEn, es: form.nameEs }, terms: formToTerms(form) }, staffAuthor());
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    setProblems([]);
    setForm(null);
    setSelected(result.value.id);
    setMessage(t("Borrador guardado. Envíalo al abogado y registra su aprobación para ofrecerlo.", "Draft saved. Send it to the attorney and record the approval to offer it."));
    await load();
  };

  const byKey = new Map<string, PlanVersion[]>();
  for (const p of [...plans].sort((a, b) => b.version - a.version)) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  const current = selected ? plans.find((p) => p.id === selected) ?? null : null;

  return (
    <main className="animate-rise" data-testid="planes">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("Planes de cobro", "Manage plans")}</h1>
          <p className="mt-0.5 max-w-3xl text-[14px] leading-snug text-slate-500">
            {t(
              "Como en Credit Repair Cloud, con una diferencia que manda la ley: cada cobro se hace solo después del trabajo que paga. Cada cliente queda con la versión exacta que firmó.",
              "Like Credit Repair Cloud, with one difference the law requires: every charge happens only after the work it pays for. Each client keeps the exact version they signed.",
            )}
          </p>
        </div>
        <button type="button" className={PRIMARY_BUTTON} onClick={() => { setForm({ ...EMPTY }); setSelected(null); setProblems([]); }} data-testid="plan-new">
          {t("Nuevo plan", "New plan")}
        </button>
      </div>

      {data.demo && (
        <p role="note" className="mt-4 rounded-2xl bg-amber-100 px-4 py-3 text-[13.5px] leading-snug text-blue-900">
          {t(
            "Demo: planes de ejemplo guardados en este navegador. Ningún abogado los ha revisado: «Abogado pendiente» es real.",
            "Demo: example plans kept in this browser. No attorney has reviewed them: “Attorney pending” is real.",
          )}
        </p>
      )}
      {message && (
        <p role="status" className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-[13.5px] leading-snug text-blue-900">
          {message}
        </p>
      )}

      <section className="mt-6" aria-labelledby="catalogo">
        <SectionTitle>
          <span id="catalogo">{t("Catálogo", "Catalogue")}</span>
        </SectionTitle>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[56rem] text-[14px]" data-testid="plan-list">
            <thead>
              <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5">{t("Plan", "Plan")}</th>
                <th className="px-3 py-2.5">{t("Tipo", "Type")}</th>
                <th className="px-3 py-2.5">{t("Primer trabajo", "First work fee")}</th>
                <th className="px-3 py-2.5">{t("Monto", "Amount")}</th>
                <th className="px-3 py-2.5">{t("Duración", "Duration")}</th>
                <th className="px-3 py-2.5 text-right">{t("Máximo", "Most they'll pay")}</th>
                <th className="px-3 py-2.5">{t("Estado", "Status")}</th>
                <th className="px-3 py-2.5 pr-5">{t("Abogado", "Attorney")}</th>
              </tr>
            </thead>
            <tbody>
              {[...byKey.values()].map((versions) =>
                versions.map((p, i) => (
                  <tr
                    key={p.id}
                    className={`cursor-pointer border-b hairline last:border-b-0 hover:bg-slate-50 ${selected === p.id ? "bg-blue-50/60" : ""} ${i > 0 ? "text-slate-500" : ""}`}
                    onClick={() => { setSelected(p.id); setForm(null); setMessage(null); }}
                  >
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-slate-900">{p.name[l]}</span>
                      <span className="ml-1.5 text-[12px] text-slate-500">v{p.version}</span>
                      {p.isDefault && <Chip tone="ml-1.5 bg-blue-50 text-blue-700">{t("Predeterminado", "Default")}</Chip>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{PLAN_TYPE_LABEL[p.terms.type][l]}</td>
                    <td className="px-3 py-2.5 tabular-nums">{p.terms.firstWorkFeeCents > 0 ? formatCents(p.terms.firstWorkFeeCents) : t("No", "No")}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{amountText(p.terms, l)}</td>
                    <td className="px-3 py-2.5">{durationText(p.terms, l)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCents(planMaxTotalCents(p.terms) ?? 0)}</td>
                    <td className="px-3 py-2.5">
                      <Chip tone={STATUS_TONE[p.status]}>{p.status === "draft" ? t("Borrador", "Draft") : p.status === "active" ? t("Ofrecido", "Active") : t("Retirado", "Retired")}</Chip>
                    </td>
                    <td className="px-3 py-2.5 pr-5 text-[13px]">{p.attorney ? `${p.attorney.name} · ${p.attorney.approvedOn}` : <span className="text-blue-900">{t("Pendiente", "Pending")}</span>}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>

      {current && !form && (
        <section className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-testid="plan-detail">
          <div className="card px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-[19px] font-semibold text-slate-900">
                {current.name[l]} <span className="text-[14px] font-normal text-slate-500">v{current.version}</span>
              </h2>
              <Chip tone={STATUS_TONE[current.status]}>{current.status}</Chip>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[13.5px] leading-snug text-slate-700">
              {paymentTermsLines(current.terms, effectiveAmounts(current.terms, 0), l).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 break-all font-mono text-[11.5px] text-slate-400">sha256 {current.termsHash.slice(0, 16)}… · {current.textVersion}</p>

            {current.status === "draft" && !current.attorney && (
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[13.5px] font-semibold text-slate-900">{t("Aprobación del abogado de esta versión", "The attorney's approval of this version")}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input className={FIELD} placeholder={t("Nombre del abogado", "Attorney's name")} value={approval.attorneyName} onChange={(e) => setApproval({ ...approval, attorneyName: e.target.value })} />
                  <input className={FIELD} type="date" value={approval.approvedOn} onChange={(e) => setApproval({ ...approval, approvedOn: e.target.value })} />
                  <label className="flex items-start gap-2 text-[13px] text-slate-700 sm:col-span-2">
                    <input type="checkbox" checked={approval.confirmed} onChange={(e) => setApproval({ ...approval, confirmed: e.target.checked })} className="mt-0.5 h-4 w-4 accent-blue-700" />
                    {t("Confirmo que el abogado aprobó esta versión exacta.", "I confirm the attorney approved this exact version.")}
                  </label>
                </div>
                <button type="button" className={`${ROW_BUTTON} mt-2`} disabled={saving} onClick={() => act(() => data.recordApproval(current.id, approval), t("Aprobación registrada.", "Approval recorded."))}>
                  {t("Registrar aprobación", "Record approval")}
                </button>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {current.status === "draft" && (
                <>
                  <button type="button" className={PRIMARY_BUTTON} disabled={saving || !current.attorney} onClick={() => act(() => data.activate(current.id), t("Plan ofrecido.", "Plan offered."))}>
                    {t("Ofrecer este plan", "Offer this plan")}
                  </button>
                  <button type="button" className={SECONDARY_BUTTON} onClick={() => setForm(planToForm(current))}>
                    {t("Editar borrador", "Edit draft")}
                  </button>
                  <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.discard(current.id)).then(() => setSelected(null))}>
                    {t("Descartar", "Discard")}
                  </button>
                </>
              )}
              {current.status === "active" && (
                <>
                  <button type="button" className={SECONDARY_BUTTON} onClick={() => setForm({ ...planToForm(current), id: null })}>
                    {t("Nueva versión", "New version")}
                  </button>
                  {!current.isDefault && (
                    <button type="button" className={SECONDARY_BUTTON} onClick={() => act(() => data.setDefault(current.id))}>
                      {t("Hacer predeterminado", "Make default")}
                    </button>
                  )}
                  <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.retire(current.id), t("Retirado. Quien ya lo firmó sigue con su versión.", "Retired. Clients who signed it keep their version."))}>
                    {t("Retirar", "Retire")}
                  </button>
                </>
              )}
            </div>
            {current.status === "draft" && !current.attorney && (
              <p className="mt-2 text-[12.5px] text-slate-500">{t("Un plan se ofrece solo con la aprobación del abogado registrada.", "A plan is offered only with the attorney's approval on record.")}</p>
            )}
          </div>
          <Timeline terms={current.terms} l={l} />
        </section>
      )}

      {form && (
        <section className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Editor form={form} setForm={setForm} onSave={save} saving={saving} problems={problems} l={l} switches={switches} />
          <Timeline terms={validatePlanTerms(formToTerms(form)).length === 0 ? formToTerms(form) : null} l={l} />
        </section>
      )}

      <section className="mt-7" aria-labelledby="programa">
        <SectionTitle>
          <span id="programa">{t("Programas que necesitan al abogado", "Programs that need the attorney")}</span>
        </SectionTitle>
        <div className="card overflow-hidden">
          <SwitchCard
            name="pay_per_delete"
            on={switches.payPerDelete}
            label={t("Pago por eliminación", "Pay per delete")}
            help={t(
              "Cobrar por puntos que un reporte posterior ya no muestra puede sugerir resultados (CROA, TSR y Texas cap. 393). Apagado hasta que el abogado lo apruebe.",
              "Charging for items a later report no longer shows can imply results (CROA, the TSR and Texas ch. 393). Off until the attorney approves it.",
            )}
            onSave={async (input) => {
              const r = await data.setSwitch({ switch: "pay_per_delete", ...input });
              await load();
              return r.ok ? null : (r.problems[0]?.message[l] ?? "");
            }}
          />
          <SwitchCard
            name="referral_credits"
            on={switches.referralCredits}
            withAmount
            label={t("Créditos por referir a un cliente", "Client referral credits")}
            help={t(
              "Un cliente que refiere a otro que firma recibe un crédito en su siguiente cobro. Nunca crea un cobro ni paga antes del trabajo. Aparte de las comisiones a socios.",
              "A client who refers another client who signs gets a credit on their next charge. It never creates a charge or pays before the work. Separate from partner commissions.",
            )}
            onSave={async (input) => {
              const r = await data.setSwitch({ switch: "referral_credits", ...input });
              await load();
              return r.ok ? null : (r.problems[0]?.message[l] ?? "");
            }}
          />
        </div>
      </section>
    </main>
  );
}
