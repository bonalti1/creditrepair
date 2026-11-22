import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDemoGateway } from "../../billing/gateway";
import { PLAN_TEXT_VERSION, planTermsHash, snapshotPlan, type PlanTerms, type PlanVersion } from "../../billing/plans";
import { activate, listPlans, offeredSnapshot, recordApproval, recordSwitch, saveDraft } from "../../billing/planStore";
import { chargeEligibility } from "../../billing/rules";
import { loadBilling, runBillingForUser } from "../../billing/server";
import { startHarness, type Harness } from "./pg";
import { addClient, DAY } from "./seed";

// Every plan type against the REAL migrations (0011 + 0026) in PGlite: each
// thing the law or the plan forbids is refused by the database itself, whoever
// asks (these inserts use the service role, which bypasses row level
// security), and each allowed thing works.
//
// The database clock is real (now()), so the work is dated in the past: the
// agreement signed 200 days ago, rounds mailed 100 days ago and later. To show
// a second charge a month later, a test moves the FIRST charge's creation date
// back with triggers suspended (backdate): a fixture of the past, never
// something the app can do.

let h: Harness;
const ATTORNEY = { attorneyName: "Lic. Prueba Abogada", approvedOn: new Date().toISOString().slice(0, 10), confirmed: true };
const ACTOR = { userId: null, name: "Carmen Ruiz" };

beforeAll(async () => {
  h = await startHarness();
}, 60_000);
afterAll(async () => {
  await h?.pg.close();
});

const BASE: PlanTerms = {
  type: "per_round",
  firstWorkFeeCents: 0,
  recurringCents: 8900,
  flat: null,
  dueRule: { kind: "after_first_round" },
  duration: { kind: "indefinite" },
  maxTotalCents: 60000,
  householdDiscountPercent: 0,
  countsUpdated: false,
};

let planCounter = 0;

/** A plan version, drafted, approved and offered the way /equipo/planes does it. */
async function activePlan(terms: Partial<PlanTerms>, options: { asDefault?: boolean } = {}): Promise<PlanVersion> {
  planCounter += 1;
  const name = { en: `Test plan ${planCounter}`, es: `Plan de prueba ${planCounter}` };
  const draft = await saveDraft(h.service, { name, terms: { ...BASE, ...terms } }, ACTOR);
  if (!draft.ok) throw new Error(JSON.stringify(draft.problems));
  const approved = await recordApproval(h.service, draft.value.id, ATTORNEY, ACTOR);
  if (!approved.ok) throw new Error(JSON.stringify(approved.problems));
  const on = await activate(h.service, draft.value.id);
  if (!on.ok) throw new Error(JSON.stringify(on.problems));
  if (options.asDefault) await h.sql(`update public.billing_plans set is_default = true where id = $1`, [draft.value.id]);
  return (await listPlans(h.service)).find((p) => p.id === draft.value.id)!;
}

/** A client who signed under the plan 200 days ago (window over 195 days ago). */
async function signedUnder(plan: PlanVersion, options: { household?: boolean; snapshot?: (s: Record<string, unknown>) => void } = {}): Promise<{ id: string; error: string | null }> {
  const id = await addClient(h);
  const signed = Date.now() - 200 * DAY;
  const snap = structuredClone(snapshotPlan(plan, { household: options.household })) as unknown as Record<string, unknown>;
  options.snapshot?.(snap);
  const { error } = await h.service.from("service_agreements").insert({
    user_id: id,
    document_version: "2026-11-test",
    disclosure_acknowledged_at: new Date(signed - 600_000).toISOString(),
    disclosure_locale: "en",
    disclosure_hash: "a".repeat(64),
    signer_name: "Rosa Martínez",
    signed_at: new Date(signed).toISOString(),
    locale: "en",
    document_hash: "b".repeat(64),
    terms: { companyLegalName: "Credalti LLC", monthlyFee: null, plan: snap },
    cancellation_deadline: new Date(signed + 5 * DAY).toISOString(),
  });
  return { id, error: error?.message ?? null };
}

async function client(terms: Partial<PlanTerms>): Promise<{ id: string; plan: PlanVersion }> {
  const plan = await activePlan(terms);
  const signed = await signedUnder(plan);
  if (signed.error) throw new Error(signed.error);
  return { id: signed.id, plan };
}

/** A round marked mailed `daysAgo` days ago, with one letter that went out. Returns the round id. */
async function mailRound(uid: string, n: number, daysAgo: number, status = "mailed"): Promise<string> {
  const mailed = new Date(Date.now() - daysAgo * DAY).toISOString();
  const [round] = await h.sql<{ id: string }>(
    `insert into public.attack_rounds (user_id, round_number, status, approved_at, mailed_at) values ($1, $2, $3, $4, $5) returning id`,
    [uid, n, status, mailed, status === "mailed" ? mailed : null],
  );
  await h.sql(
    `insert into public.letters (user_id, round_id, target_type, target_key, target_name, template_key, escalation_stage, body, status, mailed_at)
     values ($1, $2, 'bureau', 'equifax', 'Equifax', 'initial_dispute', 'initial', 'x', $3, $4)`,
    [uid, round!.id, status === "mailed" ? "mailed" : "draft", status === "mailed" ? mailed : null],
  );
  return round!.id;
}

type Charge = { round_id?: string | null; amount_cents: number; unit?: string; first_work_cents?: number; credit_cents?: number; result_item_ids?: string[] };

async function charge(uid: string, row: Charge): Promise<{ id: string | null; error: string | null; row: Record<string, unknown> | null }> {
  const { data, error } = await h.service.from("charges").insert({ user_id: uid, ...row }).select("*").single();
  return { id: (data as { id?: string } | null)?.id ?? null, error: error?.message ?? null, row: (data as Record<string, unknown>) ?? null };
}

/** Moves a charge's creation back, as if it had been made `days` days ago. Triggers are suspended for the fixture only. */
async function backdate(id: string, days: number): Promise<void> {
  await h.pg.exec(`set session_replication_role = replica`);
  await h.sql(`update public.charges set created_at = created_at - make_interval(days => $2::int) where id = $1`, [id, days]);
  await h.pg.exec(`set session_replication_role = origin`);
}

async function paid(id: string): Promise<void> {
  await h.sql(`update public.charges set status = 'succeeded', attempts = 1, charged_at = now(), last_attempt_at = now(), gateway = 'demo', gateway_reference = $2 where id = $1`, [id, `demo_ch_${id.slice(0, 8)}`]);
}

async function addCard(uid: string): Promise<void> {
  const { data: method } = await h.service
    .from("payment_methods")
    .insert({ user_id: uid, gateway: "demo", brand: "visa", last4: "4242", authorization_version: "test", authorization_locale: "en", authorization_hash: "c".repeat(64) })
    .select("id")
    .single();
  await h.service.from("payment_method_vault").insert({ payment_method_id: (method as { id: string }).id, customer_ref: "demo_cus_test", payment_method_ref: "demo_pm_visa_4242" });
}

// ── The catalogue ───────────────────────────────────────────────────────

describe("the plan catalogue: draft → active → retired, nothing before the work", () => {
  const row = (terms: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    plan_key: `raw-${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    plan_type: String(terms.type),
    name_en: "Raw plan",
    name_es: "Plan crudo",
    terms,
    terms_hash: "d".repeat(64),
    text_version: PLAN_TEXT_VERSION,
    ...extra,
  });

  it("refuses a setup, enrollment or signup fee: the field cannot be stored at all", async () => {
    for (const field of ["setupFeeCents", "enrollmentFeeCents", "signupFeeCents", "retainerCents"]) {
      const { error } = await h.service.from("billing_plans").insert(row({ ...BASE, [field]: 4900 }));
      expect(error?.message, field).toMatch(/billing_plans_no_fee_before_work/);
    }
  });

  it("refuses CRC's due dates that can charge before the work: N days after the plan is saved, when letters are saved", async () => {
    for (const kind of ["days_after_plan_saved", "when_letters_saved"]) {
      const { error } = await h.service.from("billing_plans").insert(row({ ...BASE, dueRule: { kind, days: 5 } }));
      expect(error?.message, kind).toMatch(/before any work is performed/);
    }
  });

  it("refuses a first work fee on pay per delete, and a plan with no end and no cap", async () => {
    expect((await h.service.from("billing_plans").insert(row({ ...BASE, type: "pay_per_delete", firstWorkFeeCents: 100 }))).error?.message).toMatch(/no first work fee/);
    expect((await h.service.from("billing_plans").insert(row({ ...BASE, maxTotalCents: null }))).error?.message).toMatch(/needs a maximum total/);
  });

  it("is offered only with the attorney's approval on record, and an offered version never changes", async () => {
    const draft = await saveDraft(h.service, { name: { en: "Unapproved", es: "Sin aprobar" }, terms: BASE }, ACTOR);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const raw = await h.service.from("billing_plans").update({ status: "active", activated_at: new Date().toISOString() }).eq("id", draft.value.id);
    expect(raw.error?.message).toMatch(/billing_plans_approved_when_offered/);
    expect((await activate(h.service, draft.value.id)).ok).toBe(false);

    const plan = await activePlan({});
    const edit = await h.service.from("billing_plans").update({ terms: { ...BASE, recurringCents: 9900 } }).eq("id", plan.id);
    expect(edit.error?.message).toMatch(/cannot be changed; make a new version/);
    const back = await h.service.from("billing_plans").update({ status: "draft", activated_at: null }).eq("id", plan.id);
    expect(back.error).not.toBeNull();
    expect((await h.service.from("billing_plans").delete().eq("id", plan.id)).error?.message).toMatch(/cannot be deleted/);
  });

  it("keeps pay per delete off until an administrator records the attorney's approval of the program", async () => {
    const draft = await saveDraft(h.service, { name: { en: "Per delete A", es: "Por eliminación A" }, terms: { ...BASE, type: "pay_per_delete", recurringCents: 5000 } }, ACTOR);
    if (!draft.ok) throw new Error("draft");
    await recordApproval(h.service, draft.value.id, ATTORNEY, ACTOR);
    const off = await h.service.from("billing_plans").update({ status: "active", activated_at: new Date().toISOString() }).eq("id", draft.value.id);
    expect(off.error?.message).toMatch(/pay per delete is off/);
    // Turning the switch on needs a name, a date and the box ticked.
    expect((await recordSwitch(h.service, { switch: "pay_per_delete", enabled: true }, ACTOR)).ok).toBe(false);
  });
});

// ── Signing ─────────────────────────────────────────────────────────────

describe("a signature under a plan carries exactly that plan version", () => {
  it("refuses amounts that are not the plan's, a household discount without a household, and a plan not on offer", async () => {
    const plan = await activePlan({ householdDiscountPercent: 20 });
    expect((await signedUnder(plan, { snapshot: (s) => ((s.effective as Record<string, number>).recurringCents = 100) })).error).toMatch(/not the plan's amounts/);
    expect((await signedUnder(plan, { household: true })).error).toMatch(/linked household/);
    expect((await signedUnder(plan, { snapshot: (s) => ((s.terms as Record<string, number>).recurringCents = 100) })).error).toMatch(/not exactly the plan version/);
    expect((await signedUnder({ ...plan, id: crypto.randomUUID() })).error).toMatch(/not an active plan version/);
    expect((await signedUnder(plan)).error).toBeNull();
  });

  it("applies the household discount to two linked clients, and the server offers it", async () => {
    const plan = await activePlan({ householdDiscountPercent: 20 }, { asDefault: false });
    const a = await addClient(h);
    const b = await addClient(h);
    const [x, y] = [a, b].sort();
    await h.service.from("household_links").insert({ user_a: x, user_b: y, created_by_name: "Carmen" });
    await h.service.from("client_plan_offers").insert({ user_id: a, plan_id: plan.id });
    const offered = await offeredSnapshot(h.service, a);
    expect(offered).toMatchObject({ planId: plan.id, householdDiscountPercent: 20, effective: { recurringCents: 7120, maxTotalCents: 48000 } });
    // A third client cannot join a household that is already two people.
    const c = await addClient(h);
    expect((await h.service.from("household_links").insert({ user_a: [a, c].sort()[0], user_b: [a, c].sort()[1] })).error?.message).toMatch(/one household at a time/);
  });
});

// ── Per round ───────────────────────────────────────────────────────────

describe("per round: one charge per mailed round, the first work fee only with the first", () => {
  it("refuses a charge before the work, for a round mailed inside the window, a wrong amount, and a second charge for the round", async () => {
    const { id } = await client({ firstWorkFeeCents: 4900 });
    const notMailed = await mailRound(id, 1, 100, "approved");
    expect((await charge(id, { round_id: notMailed, amount_cents: 13800, unit: "round", first_work_cents: 4900 })).error).toMatch(/no round has been mailed|not recorded as mailed/);

    const other = await client({});
    const inWindow = await mailRound(other.id, 1, 198);
    expect((await charge(other.id, { round_id: inWindow, amount_cents: 8900, unit: "round" })).error).toMatch(/no round has been mailed after the cancellation window/);

    await h.sql(`delete from public.letters where round_id = $1`, [notMailed]);
    await h.sql(`delete from public.attack_rounds where id = $1`, [notMailed]);
    const r1 = await mailRound(id, 1, 100);
    // The first work fee goes with the first round's charge: without it, refused.
    expect((await charge(id, { round_id: r1, amount_cents: 8900, unit: "round" })).error).toMatch(/expected 13800/);
    expect((await charge(id, { round_id: r1, amount_cents: 13800, unit: "round", first_work_cents: 0 })).error).toMatch(/first work fee part/);
    const ok = await charge(id, { round_id: r1, amount_cents: 13800, unit: "round", first_work_cents: 4900 });
    expect(ok.error).toBeNull();
    expect(ok.row).toMatchObject({ round_number: 1, plan_type: "per_round", invoice_number: expect.stringMatching(/^INV-\d{4}-\d{6}$/) });
    // Never twice for the round (a re-mailed round is the same round).
    await backdate(ok.id!, 40);
    expect((await charge(id, { round_id: r1, amount_cents: 8900, unit: "round" })).error).toMatch(/charges_one_per_round_work|duplicate key/);
  });

  it("refuses charging one client for another client's round, even when both have signed agreements", async () => {
    const a = await client({});
    const b = await client({});
    const aRound = await mailRound(a.id, 1, 100);
    const stolen = await charge(b.id, { round_id: aRound, amount_cents: 8900, unit: "round" });
    expect(stolen.error).toMatch(/another client|no round has been mailed/);
    expect(stolen.id).toBeNull();
  });

  it("refuses a charge written by the client or by staff directly, even a correct one", async () => {
    const { id } = await client({});
    const r1 = await mailRound(id, 1, 100);
    const staff = await h.sql<{ user_id: string }>(`select user_id from public.staff_members where active limit 1`);
    for (const writer of [h.as(id), ...(staff[0] ? [h.as(staff[0].user_id)] : [])]) {
      const { error } = await writer.from("charges").insert({ user_id: id, round_id: r1, amount_cents: 8900, unit: "round" });
      expect(error).not.toBeNull();
    }
    expect(await h.sql(`select 1 from public.charges where round_id = $1`, [r1])).toHaveLength(0);
  });

  it("refuses a second charge within 30 days of the last one's creation, even for old work, and allows it after", async () => {
    const { id } = await client({});
    const r1 = await mailRound(id, 1, 100);
    const r2 = await mailRound(id, 2, 60);
    const first = await charge(id, { round_id: r1, amount_cents: 8900, unit: "round" });
    expect(first.error).toBeNull();
    expect((await charge(id, { round_id: r2, amount_cents: 8900, unit: "round" })).error).toMatch(/fewer than 30 days since the last charge/);
    await backdate(first.id!, 31);
    expect((await charge(id, { round_id: r2, amount_cents: 8900, unit: "round" })).error).toBeNull();
  });

  it("never goes past the plan's rounds or its most-you'll-pay total; the last charge is trimmed to what is left", async () => {
    const { id } = await client({ duration: { kind: "rounds", count: 2 }, maxTotalCents: 15000 });
    const r1 = await mailRound(id, 1, 150);
    const r2 = await mailRound(id, 2, 110);
    const r3 = await mailRound(id, 3, 70);
    const first = await charge(id, { round_id: r1, amount_cents: 8900, unit: "round" });
    await backdate(first.id!, 120);
    // Cap 150.00: 89.00 charged, 61.00 left.
    expect((await charge(id, { round_id: r2, amount_cents: 8900, unit: "round" })).error).toMatch(/expected 6100/);
    const second = await charge(id, { round_id: r2, amount_cents: 6100, unit: "round" });
    expect(second.error).toBeNull();
    await backdate(second.id!, 60);
    expect((await charge(id, { round_id: r3, amount_cents: 100, unit: "round" })).error).toMatch(/covers only 2 rounds|maximum total/);
  });

  it("charges nothing after a cancellation or a request to end the service", async () => {
    const ended = await client({});
    const r = await mailRound(ended.id, 1, 100);
    await h.sql(`update public.service_agreements set service_end_requested_at = now() where user_id = $1`, [ended.id]);
    expect((await charge(ended.id, { round_id: r, amount_cents: 8900, unit: "round" })).error).toMatch(/asked to end the service/);
  });

  it("the billing run charges the first round with its first work fee, once, at the signed amounts", async () => {
    const { id } = await client({ firstWorkFeeCents: 4900 });
    await mailRound(id, 1, 40);
    await addCard(id);
    const loaded = await loadBilling(h.service, id);
    expect(loaded.context.plan).toMatchObject({ terms: { type: "per_round" } });
    expect(chargeEligibility(loaded.context, new Date())).toMatchObject({ eligible: true, unit: "round", amountCents: 13800, firstWorkCents: 4900 });
    expect((await runBillingForUser(h.service, createDemoGateway(), id, new Date())).paid).toBe(1);
    expect((await runBillingForUser(h.service, createDemoGateway(), id, new Date())).paid).toBe(0);
    const rows = await h.sql<{ amount_cents: number; first_work_cents: number; status: string; method_kind: string }>(
      `select amount_cents, first_work_cents, status, method_kind from public.charges where user_id = $1`,
      [id],
    );
    expect(rows).toEqual([{ amount_cents: 13800, first_work_cents: 4900, status: "succeeded", method_kind: "card" }]);
  });
});

// ── Subscription ────────────────────────────────────────────────────────

describe("subscription (monthly): a fee per 30-day period with a round mailed, charged when the period ends", () => {
  it("first work fee after round 1, then each period with work once it is over; never an open period or one without work", async () => {
    const { id } = await client({ type: "subscription", firstWorkFeeCents: 9900, recurringCents: 7900, duration: { kind: "months", count: 3 }, maxTotalCents: null });
    const r1 = await mailRound(id, 1, 100);
    // A period before the first work fee: refused.
    expect((await charge(id, { round_id: r1, amount_cents: 7900, unit: "period" })).error).toMatch(/first work fee comes first/);
    const fw = await charge(id, { round_id: r1, amount_cents: 9900, unit: "first_work", first_work_cents: 9900 });
    expect(fw.error).toBeNull();
    await backdate(fw.id!, 99);
    const period1 = await charge(id, { round_id: r1, amount_cents: 7900, unit: "period" });
    expect(period1.error).toBeNull();
    expect(period1.row).toMatchObject({ unit: "period" });
    expect(new Date(String(period1.row!.period_end)).getTime() - new Date(String(period1.row!.period_start)).getTime()).toBe(30 * DAY);
    await backdate(period1.id!, 60);
    // The same period again: refused.
    expect((await charge(id, { round_id: r1, amount_cents: 7900, unit: "period" })).error).toMatch(/duplicate key|one_per/);
    // A round mailed 10 days ago: its period is still open.
    const recent = await mailRound(id, 2, 10);
    expect((await charge(id, { round_id: recent, amount_cents: 7900, unit: "period" })).error).toMatch(/period is still open/);
  });

  it("a period is named by its first round: a second round in the same period cannot be charged as another month", async () => {
    const { id } = await client({ type: "subscription", recurringCents: 7900, duration: { kind: "months", count: 6 }, maxTotalCents: null });
    const r1 = await mailRound(id, 1, 100);
    const r2 = await mailRound(id, 2, 95);
    expect((await charge(id, { round_id: r2, amount_cents: 7900, unit: "period" })).error).toMatch(/named by the first round/);
    expect((await charge(id, { round_id: r1, amount_cents: 7900, unit: "period" })).error).toBeNull();
  });

  it("stops at the plan's months", async () => {
    const { id } = await client({ type: "subscription", recurringCents: 7900, duration: { kind: "months", count: 1 }, maxTotalCents: null });
    const r1 = await mailRound(id, 1, 100);
    const r2 = await mailRound(id, 2, 60);
    const first = await charge(id, { round_id: r1, amount_cents: 7900, unit: "period" });
    await backdate(first.id!, 60);
    expect((await charge(id, { round_id: r2, amount_cents: 7900, unit: "period" })).error).toMatch(/covers only 1 months|maximum total/);
  });
});

// ── Flat fee ────────────────────────────────────────────────────────────

describe("flat fee: N installments after N rounds, or one charge after the last round", () => {
  it("installments: each only after its round is mailed, the last carries the remainder, never more than N", async () => {
    const { id } = await client({ type: "flat_fee", recurringCents: 0, flat: { totalCents: 50000, rounds: 3, schedule: "installments" }, duration: { kind: "rounds", count: 3 }, maxTotalCents: null });
    const rounds = [await mailRound(id, 1, 150), await mailRound(id, 2, 110), await mailRound(id, 3, 70), await mailRound(id, 4, 32)];
    const expected = [16666, 16666, 16668];
    for (let k = 0; k < 3; k++) {
      expect((await charge(id, { round_id: rounds[k], amount_cents: 16667, unit: "installment" })).error).toMatch(new RegExp(`expected ${expected[k]}`));
      const ok = await charge(id, { round_id: rounds[k], amount_cents: expected[k]!, unit: "installment" });
      expect(ok.error).toBeNull();
      expect(ok.row).toMatchObject({ installment_number: k + 1 });
      await backdate(ok.id!, 35);
    }
    expect((await charge(id, { round_id: rounds[3], amount_cents: 100, unit: "installment" })).error).toMatch(/covers only 3 rounds|maximum total|every installment/);
  });

  it("after the last round: the first work fee after round 1; the flat fee never before round N is mailed", async () => {
    const { id } = await client({ type: "flat_fee", firstWorkFeeCents: 5000, recurringCents: 0, flat: { totalCents: 45000, rounds: 2, schedule: "after_last_round" }, duration: { kind: "rounds", count: 2 }, maxTotalCents: null });
    const r1 = await mailRound(id, 1, 100);
    expect((await charge(id, { round_id: r1, amount_cents: 45000, unit: "flat" })).error).toMatch(/after round 2 is mailed|first work fee comes first/);
    const fw = await charge(id, { round_id: r1, amount_cents: 5000, unit: "first_work", first_work_cents: 5000 });
    expect(fw.error).toBeNull();
    await backdate(fw.id!, 60);
    expect((await charge(id, { round_id: r1, amount_cents: 45000, unit: "flat" })).error).toMatch(/after round 2 is mailed/);
    const r2 = await mailRound(id, 2, 50);
    expect((await charge(id, { round_id: r2, amount_cents: 45000, unit: "flat" })).error).toBeNull();
  });
});

// ── Due date ────────────────────────────────────────────────────────────

describe("due date: N days after the first round is mailed, never earlier", () => {
  it("refuses the first charge before N days have passed since round 1 was mailed", async () => {
    const { id } = await client({ dueRule: { kind: "days_after_first_round", days: 10 } });
    const r1 = await mailRound(id, 1, 5);
    expect((await charge(id, { round_id: r1, amount_cents: 8900, unit: "round" })).error).toMatch(/before the plan's due date/);
    await h.sql(`update public.attack_rounds set mailed_at = now() - interval '11 days' where id = $1`, [r1]);
    expect((await charge(id, { round_id: r1, amount_cents: 8900, unit: "round" })).error).toBeNull();
  });
});

// ── Pay per delete ──────────────────────────────────────────────────────

describe("pay per delete: only items disputed through us that a later report no longer shows", () => {
  let id: string;
  let disputed: string;
  let notDisputed: string;
  let noProof: string;
  let updated: string;

  async function pull(daysAgo: number): Promise<string> {
    const [p] = await h.sql<{ id: string }>(`insert into public.report_pulls (user_id, source, pulled_at, raw) values ($1, 'test', now() - make_interval(days => $2::int), '{}') returning id`, [id, daysAgo]);
    return p!.id;
  }
  async function item(name: string, seenIn: string): Promise<string> {
    const [i] = await h.sql<{ id: string }>(
      `insert into public.report_items (user_id, fingerprint, bureau, category, name, last_seen_pull) values ($1, $2, 'equifax', 'tradeline', $3, $4) returning id`,
      [id, `fp-${name}-${Math.random()}`, name, seenIn],
    );
    return i!.id;
  }

  beforeAll(async () => {
    expect((await recordSwitch(h.service, { switch: "pay_per_delete", enabled: true, ...ATTORNEY }, ACTOR)).ok).toBe(true);
    ({ id } = await client({ type: "pay_per_delete", recurringCents: 5000, maxTotalCents: 12000 }));
    const before = await pull(120);
    disputed = await item("CAPITAL ONE", before);
    notDisputed = await item("SYNCB", before);
    noProof = await item("MIDLAND", before);
    updated = await item("LVNV", before);
    const round = await mailRound(id, 1, 100);
    const [letter] = await h.sql<{ id: string }>(`select id from public.letters where round_id = $1`, [round]);
    for (const it of [disputed, noProof, updated]) {
      await h.sql(`insert into public.letter_items (letter_id, item_id, escalation_stage) values ($1, $2, 'initial')`, [letter!.id, it]);
    }
    const after = await pull(60);
    await h.sql(`update public.report_items set status = 'deleted', deleted_detected_at = now() where id = any($1::uuid[])`, [[disputed, notDisputed]]);
    await h.sql(`update public.report_items set last_seen_pull = $2 where id = $1`, [updated, after]);
    for (const it of [disputed, notDisputed]) expect((await h.service.from("item_results").insert({ user_id: id, item_id: it, outcome: "deleted", proof_pull_id: after })).error).toBeNull();
    expect((await h.service.from("item_results").insert({ user_id: id, item_id: updated, outcome: "updated", proof_pull_id: after })).error).toBeNull();
    // A proof for an item the report still lists is refused at the source.
    expect((await h.service.from("item_results").insert({ user_id: id, item_id: updated, outcome: "deleted", proof_pull_id: after })).error?.message).toMatch(/still lists the item/);
  });

  it("refuses an item not disputed through us, one no later report proves, and one shown only as updated", async () => {
    expect((await charge(id, { round_id: null, amount_cents: 5000, unit: "results", result_item_ids: [notDisputed] })).error).toMatch(/not disputed through us/);
    expect((await charge(id, { round_id: null, amount_cents: 5000, unit: "results", result_item_ids: [noProof] })).error).toMatch(/not disputed through us, or no later report/);
    expect((await charge(id, { round_id: null, amount_cents: 5000, unit: "results", result_item_ids: [updated] })).error).toMatch(/no later report/);
  });

  it("charges a proven item once, records it, and never again", async () => {
    const ok = await charge(id, { round_id: null, amount_cents: 5000, unit: "results", result_item_ids: [disputed] });
    expect(ok.error).toBeNull();
    expect(ok.row).toMatchObject({ round_number: 0, unit: "results" });
    expect(await h.sql(`select item_id from public.charge_items where charge_id = $1`, [ok.id])).toEqual([{ item_id: disputed }]);
    await backdate(ok.id!, 40);
    expect((await charge(id, { round_id: null, amount_cents: 5000, unit: "results", result_item_ids: [disputed] })).error).toMatch(/already charged/);
  });

  it("refuses an item that a still later report shows again, and everything once the switch is off", async () => {
    const other = await client({ type: "pay_per_delete", recurringCents: 5000, maxTotalCents: 12000 });
    const loaded = await loadBilling(h.service, id);
    expect(loaded.context.results?.map((r) => r.itemId).sort()).toEqual([disputed, updated].sort());
    await h.sql(`update public.report_items set status = 'active' where id = $1`, [disputed]);
    expect((await loadBilling(h.service, id)).context.results?.find((r) => r.itemId === disputed)?.stillGone).toBe(false);
    expect(other.id).toBeTruthy();
    await recordSwitch(h.service, { switch: "pay_per_delete", enabled: false }, ACTOR);
    expect((await charge(id, { round_id: null, amount_cents: 5000, unit: "results", result_item_ids: [updated] })).error).toMatch(/pay per delete is off/);
  });
});

// ── Credits, returns, refunds, chargebacks ──────────────────────────────

describe("referral credits, ACH returns, refunds and chargebacks", () => {
  it("a credit needs the program switch, a referral on record and a referred client past the window; it never exceeds the balance", async () => {
    const referrer = await client({});
    const referred = await client({});
    const r = await mailRound(referrer.id, 1, 100);
    expect((await charge(referrer.id, { round_id: r, amount_cents: 8900, unit: "round", credit_cents: 2000 })).error).toMatch(/referral credits are off/);
    expect((await h.service.from("client_credits").insert({ user_id: referrer.id, kind: "referral", cents: 2500, referred_user_id: referred.id })).error?.message).toMatch(/off until/);
    await recordSwitch(h.service, { switch: "referral_credits", enabled: true, referralCreditCents: 2500, ...ATTORNEY }, ACTOR);
    expect((await h.service.from("client_credits").insert({ user_id: referrer.id, kind: "referral", cents: 2500, referred_user_id: referred.id })).error?.message).toMatch(/no referral on record/);
    await h.service.from("client_referrals").insert({ referred_user_id: referred.id, referrer_user_id: referrer.id });
    expect((await h.service.from("client_credits").insert({ user_id: referrer.id, kind: "referral", cents: 9999, referred_user_id: referred.id })).error?.message).toMatch(/amount the program set/);
    expect((await h.service.from("client_credits").insert({ user_id: referrer.id, kind: "referral", cents: 2500, referred_user_id: referred.id })).error).toBeNull();
    expect((await charge(referrer.id, { round_id: r, amount_cents: 8900, unit: "round", credit_cents: 3000 })).error).toMatch(/more than the client's credit/);
    const ok = await charge(referrer.id, { round_id: r, amount_cents: 8900, unit: "round", credit_cents: 2500 });
    expect(ok.error).toBeNull();
    expect(await h.sql(`select public.client_credit_balance($1) as balance`, [referrer.id])).toEqual([{ balance: 0 }]);
    // A refund returns what was collected: the charge less the credit.
    await paid(ok.id!);
    expect((await h.service.from("refunds").insert({ charge_id: ok.id, user_id: referrer.id, amount_cents: 8900, reason: "Cobro por error de prueba." })).error?.message).toMatch(/full amount collected/);
    expect((await h.service.from("refunds").insert({ charge_id: ok.id, user_id: referrer.id, amount_cents: 6400, reason: "Cobro por error de prueba." })).error).toBeNull();
    await recordSwitch(h.service, { switch: "referral_credits", enabled: false }, ACTOR);
  });

  it("an ACH charge goes back to the dunning schedule only once its return is on record", async () => {
    const { id } = await client({});
    const r = await mailRound(id, 1, 100);
    const c = await charge(id, { round_id: r, amount_cents: 8900, unit: "round" });
    await paid(c.id!);
    const failed = await h.service.from("charges").update({ status: "failed", charged_at: null, gateway_reference: null, next_attempt_at: new Date().toISOString() }).eq("id", c.id!);
    expect(failed.error?.message).toMatch(/date and reference cannot be changed|can only become refunded/);
    const [{ gateway_reference }] = await h.sql<{ gateway_reference: string }>(`select gateway_reference from public.charges where id = $1`, [c.id]);
    expect((await h.service.from("payment_returns").insert({ charge_id: c.id, user_id: id, code: "R01", gateway_reference: "other", returned_at: new Date().toISOString(), source: "webhook" })).error?.message).toMatch(/paid attempt on record/);
    expect((await h.service.from("payment_returns").insert({ charge_id: c.id, user_id: id, code: "R01", gateway_reference, returned_at: new Date().toISOString(), source: "webhook" })).error).toBeNull();
    const back = await h.service.from("charges").update({ status: "failed", charged_at: null, gateway_reference: null, return_code: "R01", next_attempt_at: new Date().toISOString() }).eq("id", c.id!);
    expect(back.error).toBeNull();
    // The amount and the work never change.
    expect((await h.service.from("charges").update({ amount_cents: 1 }).eq("id", c.id!)).error).not.toBeNull();
  });

  it("a chargeback is recorded only for money taken, and a closed one stays closed", async () => {
    const { id } = await client({});
    const r = await mailRound(id, 1, 100);
    const c = await charge(id, { round_id: r, amount_cents: 8900, unit: "round" });
    const row = { charge_id: c.id, user_id: id, amount_cents: 8900, received_at: new Date().toISOString(), source: "manual" };
    expect((await h.service.from("chargebacks").insert(row)).error?.message).toMatch(/only money that was taken/);
    await paid(c.id!);
    const { data: cb } = await h.service.from("chargebacks").insert(row).select("id").single();
    expect(cb).toBeTruthy();
    const id2 = (cb as { id: string }).id;
    expect((await h.service.from("chargebacks").update({ status: "won", closed_at: new Date().toISOString() }).eq("id", id2)).error).toBeNull();
    expect((await h.service.from("chargebacks").update({ status: "open", closed_at: null }).eq("id", id2)).error?.message).toMatch(/stays closed/);
    expect((await h.service.from("chargebacks").delete().eq("id", id2)).error?.message).toMatch(/cannot be deleted/);
  });

  it("a bank account or routing number is never stored as a token", async () => {
    const id = await addClient(h);
    const { data: method } = await h.service
      .from("payment_methods")
      .insert({ user_id: id, gateway: "nmi", kind: "ach", brand: "checking", last4: "6789", authorization_version: "ach-test", authorization_locale: "en", authorization_hash: "e".repeat(64) })
      .select("id")
      .single();
    for (const ref of ["021000021", "123456789012", "4111 1111 1111 1111"]) {
      const { error } = await h.service.from("payment_method_vault").insert({ payment_method_id: (method as { id: string }).id, customer_ref: "cus", payment_method_ref: ref });
      expect(error, ref).not.toBeNull();
    }
    expect((await h.service.from("payment_method_vault").insert({ payment_method_id: (method as { id: string }).id, customer_ref: "nmi:cus", payment_method_ref: "nmi:vault:1234567890" })).error).toBeNull();
  });
});

describe("the hash an approval is tied to", () => {
  it("changes when any term or the name changes", () => {
    const name = { en: "A", es: "A" };
    expect(planTermsHash(BASE, name)).not.toBe(planTermsHash({ ...BASE, recurringCents: 8901 }, name));
    expect(planTermsHash(BASE, name)).not.toBe(planTermsHash(BASE, { en: "B", es: "A" }));
  });
});

describe("processor events, applied once", () => {
  it("an ACH return from a webhook puts the charge back on the dunning schedule; the same event twice is applied once", async () => {
    const { applyGatewayEvent } = await import("../../billing/webhooks");
    const { id } = await client({});
    const r = await mailRound(id, 1, 100);
    const c = await charge(id, { round_id: r, amount_cents: 8900, unit: "round" });
    await paid(c.id!);
    const [{ gateway_reference }] = await h.sql<{ gateway_reference: string }>(`select gateway_reference from public.charges where id = $1`, [c.id]);
    const event = { kind: "ach_return" as const, eventId: `evt-${c.id}`, reference: gateway_reference, code: "R01", at: new Date().toISOString() };
    expect(await applyGatewayEvent(h.service, "nmi", event)).toMatchObject({ outcome: "applied" });
    expect(await applyGatewayEvent(h.service, "nmi", event)).toMatchObject({ outcome: "duplicate" });
    const [row] = await h.sql<{ status: string; return_code: string; next_attempt_at: string | null; charged_at: string | null }>(
      `select status, return_code, next_attempt_at, charged_at from public.charges where id = $1`,
      [c.id],
    );
    expect(row).toMatchObject({ status: "failed", return_code: "R01", charged_at: null });
    expect(row!.next_attempt_at).not.toBeNull();
    expect(await h.sql(`select code, source from public.payment_returns where charge_id = $1`, [c.id])).toEqual([{ code: "R01", source: "webhook" }]);
  });

  it("a chargeback from a webhook is recorded open on the charge it names", async () => {
    const { applyGatewayEvent } = await import("../../billing/webhooks");
    const { id } = await client({});
    const r = await mailRound(id, 1, 100);
    const c = await charge(id, { round_id: r, amount_cents: 8900, unit: "round" });
    await paid(c.id!);
    const [{ gateway_reference }] = await h.sql<{ gateway_reference: string }>(`select gateway_reference from public.charges where id = $1`, [c.id]);
    const opened = { kind: "chargeback_opened" as const, eventId: `cb-${c.id}`, reference: gateway_reference, amountCents: null, reasonCode: "13.1", caseId: "case-1", at: new Date().toISOString() };
    expect(await applyGatewayEvent(h.service, "nmi", opened)).toMatchObject({ outcome: "applied" });
    expect(await h.sql(`select status, amount_cents, source from public.chargebacks where charge_id = $1`, [c.id])).toEqual([{ status: "open", amount_cents: 8900, source: "webhook" }]);
    expect(await applyGatewayEvent(h.service, "nmi", { kind: "chargeback_closed", eventId: `cbw-${c.id}`, reference: gateway_reference, outcome: "won", at: new Date().toISOString() })).toMatchObject({ outcome: "applied" });
    expect(await applyGatewayEvent(h.service, "nmi", { ...opened, eventId: "unknown", reference: "no-such-ref" })).toMatchObject({ outcome: "no_charge" });
  });
});
