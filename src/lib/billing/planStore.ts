import type { SupabaseClient } from "@supabase/supabase-js";
import {
  offeredPlan,
  planActivate,
  planDiscard,
  planRecordApproval,
  planRetire,
  planSaveDraft,
  planSetDefault,
  type ApprovalInput,
  type CatalogueResult,
  type DraftInput,
} from "./catalogue";
import { snapshotPlan, type PlanSnapshot, type PlanTerms, type PlanVersion } from "./plans";
import { loadSwitches } from "./server";
import { clientOption } from "../service/server";
import type { ServiceOption } from "../service/options";
import type { BillingSwitches } from "./types";

// The plan catalogue in the database (migration 0026). Every change is
// worked out by the pure functions in catalogue.ts, then written with the
// service role; the trigger checks it again. Only administrators reach this
// (requireCapability('billing.plans') in /api/staff/plans).

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export interface Actor {
  userId: string | null;
  name: string;
}

export function planFromRow(row: Row): PlanVersion {
  const status = row.status === "active" || row.status === "retired" ? row.status : "draft";
  return {
    id: text(row.id),
    key: text(row.plan_key),
    version: Number(row.version),
    status,
    name: { en: text(row.name_en), es: text(row.name_es) },
    terms: row.terms as PlanTerms,
    termsHash: text(row.terms_hash),
    textVersion: text(row.text_version),
    isDefault: row.is_default === true,
    attorney: row.attorney_name ? { name: text(row.attorney_name), approvedOn: String(row.attorney_approved_on).slice(0, 10) } : null,
    createdBy: text(row.created_by_name),
    createdAt: iso(row.created_at) ?? "",
    activatedAt: iso(row.activated_at),
    retiredAt: iso(row.retired_at),
  };
}

function rowOf(plan: PlanVersion): Row {
  return {
    plan_key: plan.key,
    version: plan.version,
    plan_type: plan.terms.type,
    name_en: plan.name.en,
    name_es: plan.name.es,
    terms: plan.terms,
    terms_hash: plan.termsHash,
    text_version: plan.textVersion,
  };
}

export async function listPlans(db: SupabaseClient): Promise<PlanVersion[]> {
  const { data, error } = await db.from("billing_plans").select("*").order("plan_key", { ascending: true }).order("version", { ascending: true });
  if (error) throw new Error(`billing_plans: ${error.message}`);
  return ((data as Row[] | null) ?? []).map(planFromRow);
}

const dbFail = (message: string): CatalogueResult<never> => ({ ok: false, problems: [{ code: "invalid", field: "plan", message: { en: message, es: message } }] });

export async function saveDraft(db: SupabaseClient, input: DraftInput, actor: Actor, now = new Date()): Promise<CatalogueResult<PlanVersion>> {
  const all = await listPlans(db);
  const planned = planSaveDraft(all, input, actor.name, now, () => crypto.randomUUID());
  if (!planned.ok) return planned;
  const { version, replaces } = planned.value;
  const write = replaces
    ? db.from("billing_plans").update({ ...rowOf(version), attorney_name: null, attorney_approved_on: null }).eq("id", replaces.id).select("*").single()
    : db.from("billing_plans").insert({ ...rowOf(version), created_by: actor.userId, created_by_name: actor.name }).select("*").single();
  const { data, error } = await write;
  if (error || !data) return dbFail(error?.message ?? "not saved");
  return { ok: true, value: planFromRow(data as Row) };
}

export async function recordApproval(db: SupabaseClient, id: string, input: ApprovalInput, actor: Actor, now = new Date()): Promise<CatalogueResult<PlanVersion>> {
  const planned = planRecordApproval(await listPlans(db), id, input, now);
  if (!planned.ok) return planned;
  const { data, error } = await db
    .from("billing_plans")
    .update({ attorney_name: planned.value.attorney!.name, attorney_approved_on: planned.value.attorney!.approvedOn, attorney_recorded_by: actor.userId, attorney_recorded_at: now.toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("*")
    .single();
  if (error || !data) return dbFail(error?.message ?? "not saved");
  return { ok: true, value: planFromRow(data as Row) };
}

export async function activate(db: SupabaseClient, id: string, now = new Date(), switches?: BillingSwitches): Promise<CatalogueResult<PlanVersion[]>> {
  const planned = planActivate(await listPlans(db), id, now, switches ?? (await loadSwitches(db)));
  if (!planned.ok) return planned;
  // The old version is retired first: one active version per plan (unique index).
  for (const plan of planned.value) {
    const { error } = await db
      .from("billing_plans")
      .update({ status: plan.status, activated_at: plan.activatedAt, retired_at: plan.retiredAt, is_default: false })
      .eq("id", plan.id);
    if (error) return dbFail(error.message);
  }
  const next = planned.value.find((p) => p.status === "active")!;
  if (next.isDefault) await db.from("billing_plans").update({ is_default: true }).eq("id", next.id);
  return planned;
}

export async function retire(db: SupabaseClient, id: string, now = new Date()): Promise<CatalogueResult<PlanVersion>> {
  const planned = planRetire(await listPlans(db), id, now);
  if (!planned.ok) return planned;
  const { error } = await db.from("billing_plans").update({ status: "retired", retired_at: planned.value.retiredAt, is_default: false }).eq("id", id);
  return error ? dbFail(error.message) : planned;
}

export async function setDefault(db: SupabaseClient, id: string): Promise<CatalogueResult<PlanVersion[]>> {
  const planned = planSetDefault(await listPlans(db), id);
  if (!planned.ok) return planned;
  for (const plan of [...planned.value].sort((a) => (a.isDefault ? 1 : -1))) {
    const { error } = await db.from("billing_plans").update({ is_default: plan.isDefault }).eq("id", plan.id);
    if (error) return dbFail(error.message);
  }
  return planned;
}

export async function discard(db: SupabaseClient, id: string): Promise<CatalogueResult<PlanVersion>> {
  const planned = planDiscard(await listPlans(db), id);
  if (!planned.ok) return planned;
  const { error } = await db.from("billing_plans").delete().eq("id", id);
  return error ? dbFail(error.message) : planned;
}

/**
 * The plan a client would sign today, as its snapshot: the one an
 * administrator offered them, else the default; with the household discount
 * when they are linked to another client, or in an open household from the
 * signup flow (household_discount_applies, migration 0027). Null when the catalogue has none
 * (then the agreement carries the monthly fee from the settings, as before).
 */
export async function offeredSnapshot(db: SupabaseClient, userId: string, option?: ServiceOption): Promise<PlanSnapshot | null> {
  // The client's option decides which plans may be offered (Credalti Complete or Credalti DIY).
  const forOption = option ?? (await clientOption(db, userId));
  const [plans, offer, household] = await Promise.all([
    listPlans(db),
    db.from("client_plan_offers").select("plan_id").eq("user_id", userId).maybeSingle(),
    // Linked to another client, or in an open household from the signup flow (migration 0027).
    db.rpc("household_discount_applies", { uid: userId }),
  ]);
  const plan = offeredPlan(plans, (offer.data as Row | null)?.plan_id ? text((offer.data as Row).plan_id) : null, forOption);
  if (!plan) return null;
  let linked = !household.error && household.data === true;
  if (household.error) {
    // A database without migration 0027: the link alone, as before.
    const partner = await db.rpc("household_partner", { uid: userId });
    linked = !partner.error && typeof partner.data === "string" && partner.data.length > 0;
  }
  return snapshotPlan(plan, { household: linked });
}

/** Turn a program switch on (with the attorney's approval) or off. Append-only. */
export async function recordSwitch(
  db: SupabaseClient,
  input: { switch: "pay_per_delete" | "referral_credits"; enabled: boolean; attorneyName?: string; approvedOn?: string; confirmed?: boolean; referralCreditCents?: number },
  actor: Actor,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await db.from("billing_program_changes").insert({
    switch: input.switch,
    enabled: input.enabled,
    attorney_name: input.enabled ? (input.attorneyName ?? "").trim() || null : null,
    attorney_approved_on: input.enabled ? input.approvedOn ?? null : null,
    confirmed: input.enabled ? input.confirmed === true : false,
    referral_credit_cents: input.switch === "referral_credits" && input.enabled ? (input.referralCreditCents ?? null) : null,
    changed_by: actor.userId,
    changed_by_name: actor.name.slice(0, 80),
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}
