import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDemoGateway } from "../../billing/gateway";
import { PLAN_TEXT_VERSION, snapshotPlan, type PlanTerms, type PlanVersion } from "../../billing/plans";
import { activate, listPlans, offeredSnapshot, recordApproval, saveDraft } from "../../billing/planStore";
import { chargeEligibility } from "../../billing/rules";
import { loadBilling, runBillingForUser } from "../../billing/server";
import { countUpgrades, loadClientOption, recordOptionChoice } from "../../service/server";
import { startHarness, type Harness } from "./pg";
import { addClient, DAY } from "./seed";

// The two service options against the REAL migrations (0011, 0026, 0042) in
// PGlite (docs/SERVICE-OPTIONS.md):
//
//   - Credalti DIY: its monthly subscription may be charged from the start of
//     each 30-day period after the cancellation window, and a mailing the
//     client asked for after we mailed it; nothing else.
//   - Credalti Complete (full service): still blocked from any charge before
//     its work, never paid by a DIY unit, never for a round the client mailed
//     themselves; and the owner's timing of 2026-11-25 (a monthly period
//     charged right after its round is mailed) still needs a round WE mailed.
//   - A switch supersedes the old agreement at the new signature; until then
//     the old one governs; no double charge across the switch.
//
// Inserts use the service role (row level security does not apply): the
// database's own triggers refuse what the law or the plan forbids.

let h: Harness;
const ATTORNEY = { attorneyName: "Lic. Prueba Abogada", approvedOn: new Date().toISOString().slice(0, 10), confirmed: true };
const ACTOR = { userId: null, name: "Carmen Ruiz" };

beforeAll(async () => {
  h = await startHarness();
}, 60_000);
afterAll(async () => {
  await h?.pg.close();
});

const FULL: PlanTerms = {
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

const DIY: PlanTerms = {
  type: "diy_subscription",
  firstWorkFeeCents: 0,
  recurringCents: 3900,
  flat: null,
  dueRule: { kind: "after_cancellation_window" },
  duration: { kind: "indefinite" },
  maxTotalCents: 46800,
  householdDiscountPercent: 0,
  countsUpdated: false,
  mailFeeCents: 400,
};

let n = 0;
async function activePlan(terms: PlanTerms): Promise<PlanVersion> {
  n += 1;
  const draft = await saveDraft(h.service, { name: { en: `Options plan ${n}`, es: `Plan de opciones ${n}` }, terms }, ACTOR);
  if (!draft.ok) throw new Error(JSON.stringify(draft.problems));
  const approved = await recordApproval(h.service, draft.value.id, ATTORNEY, ACTOR);
  if (!approved.ok) throw new Error(JSON.stringify(approved.problems));
  const on = await activate(h.service, draft.value.id);
  if (!on.ok) throw new Error(JSON.stringify(on.problems));
  return (await listPlans(h.service)).find((p) => p.id === draft.value.id)!;
}

/** An agreement signed `daysAgo` days ago (window over five days later) for an option, under a plan. */
async function sign(
  uid: string,
  plan: PlanVersion | null,
  options: { option?: "diy" | "full_service"; daysAgo?: number; snapshot?: (s: Record<string, unknown>) => void } = {},
): Promise<{ id: string | null; error: string | null }> {
  const signed = Date.now() - (options.daysAgo ?? 200) * DAY;
  const snap = plan ? (structuredClone(snapshotPlan(plan)) as unknown as Record<string, unknown>) : null;
  if (snap) options.snapshot?.(snap);
  const terms: Record<string, unknown> = { companyLegalName: "Credalti LLC", monthlyFee: plan ? null : "89.00", ...(snap ? { plan: snap } : {}) };
  if (options.option === "diy") terms.serviceOption = "diy";
  const { data, error } = await h.service
    .from("service_agreements")
    .insert({
      user_id: uid,
      document_version: options.option === "diy" ? "2026-11-25-diy-draft.1" : "2026-11-test",
      disclosure_acknowledged_at: new Date(signed - 600_000).toISOString(),
      disclosure_locale: "en",
      disclosure_hash: "a".repeat(64),
      signer_name: "Rosa Martínez",
      signed_at: new Date(signed).toISOString(),
      locale: "en",
      document_hash: "b".repeat(64),
      terms,
      cancellation_deadline: new Date(signed + 5 * DAY).toISOString(),
    })
    .select("id")
    .single();
  return { id: (data as { id?: string } | null)?.id ?? null, error: error?.message ?? null };
}

async function round(uid: string, num: number, daysAgo: number, options: { via?: "mail" | "client" | null; status?: string } = {}): Promise<string> {
  const status = options.status ?? "mailed";
  const mailed = new Date(Date.now() - daysAgo * DAY).toISOString();
  const [r] = await h.sql<{ id: string }>(
    `insert into public.attack_rounds (user_id, round_number, status, approved_at, mailed_at, mail_via) values ($1, $2, $3, $4, $5, $6) returning id`,
    [uid, num, status, mailed, status === "mailed" ? mailed : null, options.via === undefined ? "mail" : options.via],
  );
  await h.sql(
    `insert into public.letters (user_id, round_id, target_type, target_key, target_name, template_key, escalation_stage, body, status, mailed_at, mail_provider)
     values ($1, $2, 'bureau', 'equifax', 'Equifax', 'initial_dispute', 'initial', 'x', $3, $4, $5)`,
    [uid, r!.id, status === "mailed" ? "mailed" : "draft", status === "mailed" ? mailed : null, status === "mailed" ? (options.via === "client" ? "client" : "lob") : null],
  );
  return r!.id;
}

/** A DIY round with `k` prepared (draft) letters. */
async function preparedRound(uid: string, num: number, k: number): Promise<{ roundId: string; letterIds: string[] }> {
  const [r] = await h.sql<{ id: string }>(`insert into public.attack_rounds (user_id, round_number, status) values ($1, $2, 'draft') returning id`, [uid, num]);
  const letterIds: string[] = [];
  for (let i = 0; i < k; i++) {
    const [l] = await h.sql<{ id: string }>(
      `insert into public.letters (user_id, round_id, target_type, target_key, target_name, template_key, escalation_stage, body, status)
       values ($1, $2, 'bureau', $3, $3, 'initial_dispute', 'initial', 'x', 'draft') returning id`,
      [uid, r!.id, ["equifax", "experian", "transunion"][i % 3]],
    );
    letterIds.push(l!.id);
  }
  return { roundId: r!.id, letterIds };
}

async function charge(uid: string, row: Record<string, unknown>): Promise<{ id: string | null; error: string | null; row: Record<string, unknown> | null }> {
  const { data, error } = await h.service.from("charges").insert({ user_id: uid, ...row }).select("*").single();
  return { id: (data as { id?: string } | null)?.id ?? null, error: error?.message ?? null, row: (data as Record<string, unknown>) ?? null };
}

/** Moves a charge into the past (its creation, and its work date with `work`). A fixture only: triggers suspended. */
async function backdate(id: string, days: number, work = false): Promise<void> {
  await h.pg.exec(`set session_replication_role = replica`);
  await h.sql(`update public.charges set created_at = created_at - make_interval(days => $2::int) where id = $1`, [id, days]);
  if (work) await h.sql(`update public.charges set work_date = work_date - make_interval(days => $2::int) where id = $1`, [id, days]);
  await h.pg.exec(`set session_replication_role = origin`);
}

async function addCard(uid: string): Promise<void> {
  const { data: method } = await h.service
    .from("payment_methods")
    .insert({ user_id: uid, gateway: "demo", brand: "visa", last4: "4242", authorization_version: "test", authorization_locale: "en", authorization_hash: "c".repeat(64) })
    .select("id")
    .single();
  await h.service.from("payment_method_vault").insert({ payment_method_id: (method as { id: string }).id, customer_ref: "demo_cus_test", payment_method_ref: "demo_pm_visa_4242" });
}

// ── Plans ────────────────────────────────────────────────────────────────

describe("plans carry an option", () => {
  const raw = (terms: Record<string, unknown>) => ({
    plan_key: `raw-${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    plan_type: String(terms.type),
    name_en: "Raw plan",
    name_es: "Plan crudo",
    terms,
    terms_hash: "d".repeat(64),
    text_version: PLAN_TEXT_VERSION,
  });

  it("derives the option from the plan type, and keeps one default per option", async () => {
    const diy = await activePlan(DIY);
    const full = await activePlan(FULL);
    const rows = await h.sql<{ id: string; service_option: string }>(`select id, service_option from public.billing_plans where id in ($1, $2)`, [diy.id, full.id]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.service_option]))).toEqual({ [diy.id]: "diy", [full.id]: "full_service" });
    await h.sql(`update public.billing_plans set is_default = false`);
    await h.sql(`update public.billing_plans set is_default = true where id = $1`, [diy.id]);
    // A default for each option at once is allowed; two for one option is not.
    await h.sql(`update public.billing_plans set is_default = true where id = $1`, [full.id]);
    const other = await activePlan({ ...DIY, recurringCents: 4900 });
    await expect(h.sql(`update public.billing_plans set is_default = true where id = $1`, [other.id])).rejects.toThrow(/billing_plans_one_default|duplicate/);
  });

  it("refuses a DIY plan with a first work fee, a full-service due date or a mailing fee over $25; and a full-service plan charged from the start or with a mailing fee", async () => {
    expect((await h.service.from("billing_plans").insert(raw({ ...DIY, firstWorkFeeCents: 100 }))).error?.message).toMatch(/no first work fee/);
    expect((await h.service.from("billing_plans").insert(raw({ ...DIY, dueRule: { kind: "after_first_round" } }))).error?.message).toMatch(/due after the cancellation window/);
    expect((await h.service.from("billing_plans").insert(raw({ ...DIY, mailFeeCents: 9900 }))).error?.message).toMatch(/0 to 2500 cents/);
    expect((await h.service.from("billing_plans").insert(raw({ ...FULL, dueRule: { kind: "after_cancellation_window" } }))).error?.message).toMatch(/after the first round is mailed/);
    expect((await h.service.from("billing_plans").insert(raw({ ...FULL, mailFeeCents: 300 }))).error?.message).toMatch(/only a do-it-yourself plan has a mailing fee/);
    expect((await h.service.from("billing_plans").insert(raw({ ...FULL, periodTiming: "on_mailing" }))).error?.message).toMatch(/only a monthly subscription has a period timing/);
  });

  it("offers a client only plans of their option", async () => {
    const diy = await activePlan(DIY);
    await h.sql(`update public.billing_plans set is_default = false where service_option = 'diy'`);
    await h.sql(`update public.billing_plans set is_default = true where id = $1`, [diy.id]);
    const uid = await addClient(h);
    expect((await offeredSnapshot(h.service, uid))?.option ?? "full_service").toBe("full_service");
    await recordOptionChoice(h.service, uid, "diy", "signup_chat");
    expect(await offeredSnapshot(h.service, uid)).toMatchObject({ planId: diy.id, option: "diy", effective: { mailFeeCents: 400 } });
  });
});

// ── Signing ──────────────────────────────────────────────────────────────

describe("an agreement is for one option, and its plan for the same one", () => {
  it("refuses a DIY plan under a Complete agreement and a Complete plan under a DIY agreement, and a forged mailing fee", async () => {
    const diy = await activePlan(DIY);
    const full = await activePlan(FULL);
    expect((await sign(await addClient(h), diy, { option: "full_service" })).error).toMatch(/other service option/);
    expect((await sign(await addClient(h), full, { option: "diy" })).error).toMatch(/other service option/);
    expect((await sign(await addClient(h), diy, { option: "diy", snapshot: (s) => ((s.effective as Record<string, number>).mailFeeCents = 1) })).error).toMatch(/not the plan's amounts/);
    expect((await sign(await addClient(h), diy, { option: "diy" })).error).toBeNull();
    expect((await sign(await addClient(h), full)).error).toBeNull();
  });
});

// ── Credalti DIY billing ─────────────────────────────────────────────────

describe("Credalti DIY: a subscription from the start (after the window), and mailings asked for", () => {
  it("charges the running 30-day period once, never inside the window, never above the cap or at another amount", async () => {
    const plan = await activePlan(DIY);
    const inWindow = await addClient(h);
    await sign(inWindow, plan, { option: "diy", daysAgo: 1 });
    expect((await charge(inWindow, { unit: "diy_period", amount_cents: 3900 })).error).toMatch(/inside the cancellation window/);

    const uid = await addClient(h);
    await sign(uid, plan, { option: "diy", daysAgo: 20 });
    expect((await charge(uid, { unit: "diy_period", amount_cents: 4000 })).error).toMatch(/expected 3900/);
    const ok = await charge(uid, { unit: "diy_period", amount_cents: 3900 });
    expect(ok.error).toBeNull();
    expect(ok.row).toMatchObject({ plan_type: "diy_subscription", round_id: null, round_number: 0 });
    // Same period: refused, whoever asks.
    expect((await charge(uid, { unit: "diy_period", amount_cents: 3900 })).error).toMatch(/charges_one_per_period|duplicate/);
    // Units of the other option are refused under DIY.
    const r = await round(uid, 1, 2, { via: "client" });
    expect((await charge(uid, { unit: "round", round_id: r, amount_cents: 8900 })).error).toMatch(/only its monthly subscription/);
  });

  it("charges a mailing only after we mailed its letters, at the total the client accepted, once", async () => {
    const plan = await activePlan(DIY);
    const uid = await addClient(h);
    await sign(uid, plan, { option: "diy", daysAgo: 20 });
    const { roundId, letterIds } = await preparedRound(uid, 1, 3);
    // The fee is the signed one.
    expect((await h.service.from("mail_requests").insert({ user_id: uid, round_id: roundId, letter_ids: letterIds, letter_count: 3, fee_cents: 100, total_cents: 300 })).error?.message).toMatch(/fee per letter is the one in the signed plan/);
    const { data: req, error } = await h.service
      .from("mail_requests")
      .insert({ user_id: uid, round_id: roundId, letter_ids: letterIds, letter_count: 3, fee_cents: 400, total_cents: 1200 })
      .select("*")
      .single();
    expect(error).toBeNull();
    const reqId = (req as { id: string }).id;
    // Not mailed yet: no charge.
    expect((await charge(uid, { unit: "mailing", round_id: roundId, mail_request_id: reqId, amount_cents: 1200 })).error).toMatch(/only after we mailed/);
    // A request is "mailed" only when every letter went out through us.
    expect((await h.service.from("mail_requests").update({ status: "mailed", mailed_at: new Date().toISOString() }).eq("id", reqId)).error?.message).toMatch(/mailed every one/);
    await h.sql(`update public.letters set status = 'queued', mail_provider = 'lob', mail_status = 'in_transit', mailed_at = now() where id = any($1::uuid[])`, [letterIds]);
    expect((await h.service.from("mail_requests").update({ status: "mailed", mailed_at: new Date(Date.now() - 1000).toISOString() }).eq("id", reqId)).error).toBeNull();
    expect((await charge(uid, { unit: "mailing", round_id: roundId, mail_request_id: reqId, amount_cents: 1000 })).error).toMatch(/expected 1200/);
    expect((await charge(uid, { unit: "mailing", round_id: roundId, mail_request_id: reqId, amount_cents: 1200 })).error).toBeNull();
    expect((await charge(uid, { unit: "mailing", round_id: roundId, mail_request_id: reqId, amount_cents: 1200 })).error).toMatch(/charges_one_per_mailing|duplicate/);
  });

  it("refuses a mail request from a Complete client, and inside the window", async () => {
    const full = await activePlan(FULL);
    const uid = await addClient(h);
    await sign(uid, full);
    const { roundId, letterIds } = await preparedRound(uid, 1, 1);
    expect((await h.service.from("mail_requests").insert({ user_id: uid, round_id: roundId, letter_ids: letterIds, letter_count: 1, fee_cents: 400, total_cents: 400 })).error?.message).toMatch(/only a do-it-yourself client/);
    const diy = await activePlan(DIY);
    const fresh = await addClient(h);
    await sign(fresh, diy, { option: "diy", daysAgo: 1 });
    const p = await preparedRound(fresh, 1, 1);
    expect((await h.service.from("mail_requests").insert({ user_id: fresh, round_id: p.roundId, letter_ids: p.letterIds, letter_count: 1, fee_cents: 400, total_cents: 400 })).error?.message).toMatch(/cancellation window/);
  });

  it("is what the billing run charges: the period, at the snapshot amount, once", async () => {
    const plan = await activePlan(DIY);
    const uid = await addClient(h);
    await sign(uid, plan, { option: "diy", daysAgo: 10 });
    await addCard(uid);
    const loaded = await loadBilling(h.service, uid);
    expect(chargeEligibility(loaded.context, new Date())).toMatchObject({ eligible: true, unit: "diy_period", amountCents: 3900 });
    expect((await runBillingForUser(h.service, createDemoGateway(), uid, new Date())).paid).toBe(1);
    expect((await runBillingForUser(h.service, createDemoGateway(), uid, new Date())).paid).toBe(0);
    const rows = await h.sql<{ unit: string; amount_cents: number; status: string }>(`select unit, amount_cents, status from public.charges where user_id = $1`, [uid]);
    expect(rows).toEqual([{ unit: "diy_period", amount_cents: 3900, status: "succeeded" }]);
  });
});

// ── Credalti Complete: still blocked before its work ─────────────────────

describe("Credalti Complete (full service) is still never charged before its work", () => {
  it("refuses the DIY units, a round the client mailed themselves, and any charge with nothing mailed by us", async () => {
    const full = await activePlan(FULL);
    const uid = await addClient(h);
    await sign(uid, full);
    expect((await charge(uid, { unit: "diy_period", amount_cents: 8900 })).error).toMatch(/only a do-it-yourself plan/);
    const clientMailed = await round(uid, 1, 100, { via: "client" });
    expect((await charge(uid, { unit: "round", round_id: clientMailed, amount_cents: 8900 })).error).toMatch(/no round has been mailed after the cancellation window|not recorded as mailed by us/);
    const notMailed = await round(uid, 2, 100, { status: "approved" });
    expect((await charge(uid, { unit: "round", round_id: notMailed, amount_cents: 8900 })).error).toMatch(/no round has been mailed|mailed by us/);
    // A round we mailed is still charged as before.
    const ours = await round(uid, 3, 50);
    expect((await charge(uid, { unit: "round", round_id: ours, amount_cents: 8900 })).error).toBeNull();
  });

  it("refuses, without a plan, a round the client mailed and any charge under a DIY agreement", async () => {
    const uid = await addClient(h);
    await sign(uid, null);
    const clientMailed = await round(uid, 1, 100, { via: "client" });
    expect((await charge(uid, { unit: "round", round_id: clientMailed, amount_cents: 8900 })).error).toMatch(/mailed this round themselves/);
    const diyNoPlan = await addClient(h);
    await sign(diyNoPlan, null, { option: "diy" });
    const r = await round(diyNoPlan, 1, 100);
    expect((await charge(diyNoPlan, { unit: "round", round_id: r, amount_cents: 8900 })).error).toMatch(/without a plan is never charged/);
  });
});

describe("the owner's timing (2026-11-25): a monthly period charged right after its round is mailed", () => {
  const MONTHLY: PlanTerms = { ...FULL, type: "subscription", recurringCents: 7900, periodTiming: "on_mailing", maxTotalCents: 60000 };

  it("refuses the period while its round is not mailed; accepts it right after the mailing; never twice in the period", async () => {
    const plan = await activePlan(MONTHLY);
    const uid = await addClient(h);
    await sign(uid, plan, { daysAgo: 20 });
    const draft = await round(uid, 1, 0, { status: "approved", via: null });
    expect((await charge(uid, { unit: "period", round_id: draft, amount_cents: 7900 })).error).toMatch(/no round has been mailed|mailed by us/);
    await h.sql(`delete from public.letters where round_id = $1`, [draft]);
    await h.sql(`delete from public.attack_rounds where id = $1`, [draft]);
    const r1 = await round(uid, 1, 2);
    const ok = await charge(uid, { unit: "period", round_id: r1, amount_cents: 7900 });
    expect(ok.error).toBeNull();
    // Charged with the period still open, dated at the mailing.
    expect(new Date(String(ok.row!.period_end)).getTime()).toBeGreaterThan(Date.now());
    const r2 = await round(uid, 2, 1);
    await backdate(ok.id!, 40);
    // Never twice in the period: refused (by the 30-day spacing, the period's uniqueness, or the first round naming it).
    expect((await charge(uid, { unit: "period", round_id: r1, amount_cents: 7900 })).error).toMatch(/charges_one_per_period|duplicate|fewer than 30 days/);
    expect((await charge(uid, { unit: "period", round_id: r2, amount_cents: 7900 })).error).toMatch(/named by the first round|one_per_period|duplicate|fewer than 30 days/);
  });

  it("keeps 'when the period ends' for plans that say so, and for plans made before the decision", async () => {
    const plan = await activePlan({ ...MONTHLY, periodTiming: "period_end" });
    const uid = await addClient(h);
    await sign(uid, plan, { daysAgo: 20 });
    const r1 = await round(uid, 1, 2);
    expect((await charge(uid, { unit: "period", round_id: r1, amount_cents: 7900 })).error).toMatch(/still open/);
    const { periodTiming: _drop, ...old } = MONTHLY;
    const before = await activePlan(old as PlanTerms);
    const other = await addClient(h);
    await sign(other, before, { daysAgo: 20 });
    const r = await round(other, 1, 2);
    expect((await charge(other, { unit: "period", round_id: r, amount_cents: 7900 })).error).toMatch(/still open/);
  });

  it("is what the billing run charges, the day after the mailing", async () => {
    const plan = await activePlan(MONTHLY);
    const uid = await addClient(h);
    await sign(uid, plan, { daysAgo: 30 });
    await addCard(uid);
    await round(uid, 1, 2);
    expect((await runBillingForUser(h.service, createDemoGateway(), uid, new Date())).paid).toBe(1);
    expect((await runBillingForUser(h.service, createDemoGateway(), uid, new Date())).paid).toBe(0);
  });
});

// ── Switching ────────────────────────────────────────────────────────────

describe("switching option: a new agreement, the old one superseded at the signature, no double charge", () => {
  it("upgrades DIY → Complete: the DIY agreement governs until the new signature, then is superseded; no DIY charge after; Complete waits for its own work", async () => {
    const diy = await activePlan(DIY);
    const full = await activePlan(FULL);
    const uid = await addClient(h);
    const old = await sign(uid, diy, { option: "diy", daysAgo: 60 });
    const paidPeriod = await charge(uid, { unit: "diy_period", amount_cents: 3900 });
    expect(paidPeriod.error).toBeNull();
    await recordOptionChoice(h.service, uid, "full_service", "app");
    expect(await loadClientOption(h.service, uid)).toMatchObject({ option: "diy", signed: "diy", chosen: "full_service", switchPending: true });

    // The client acknowledged the Complete disclosures but has not signed: the DIY agreement still governs.
    await h.service.from("service_agreements").insert({
      user_id: uid,
      document_version: "2026-11-test",
      disclosure_acknowledged_at: new Date(Date.now() - 11 * DAY).toISOString(),
      disclosure_locale: "en",
      disclosure_hash: "e".repeat(64),
    });
    const r = await round(uid, 1, 3, { via: "client" });
    expect((await charge(uid, { unit: "round", round_id: r, amount_cents: 8900 })).error).toMatch(/only its monthly subscription/);

    // A second agreement for the SAME option is refused.
    expect((await sign(uid, diy, { option: "diy", daysAgo: 1 })).error).toMatch(/already has an agreement in force for this option/);

    // Signing Complete supersedes DIY.
    const pending = await h.sql<{ id: string }>(`select id from public.service_agreements where user_id = $1 and signed_at is null`, [uid]);
    const signedAt = new Date(Date.now() - 10 * DAY);
    const snap = snapshotPlan(full);
    const { error } = await h.service
      .from("service_agreements")
      .update({
        signer_name: "Rosa Martínez",
        signed_at: signedAt.toISOString(),
        locale: "en",
        document_hash: "f".repeat(64),
        terms: { companyLegalName: "Credalti LLC", plan: snap },
        cancellation_deadline: new Date(signedAt.getTime() + 5 * DAY).toISOString(),
      })
      .eq("id", pending[0]!.id);
    expect(error).toBeNull();
    const [was] = await h.sql<{ superseded_by: string | null }>(`select superseded_by from public.service_agreements where id = $1`, [old.id]);
    expect(was!.superseded_by).toBe(pending[0]!.id);
    expect(await loadClientOption(h.service, uid)).toMatchObject({ option: "full_service", signed: "full_service", switchPending: false });
    // A superseded agreement stays superseded.
    expect((await h.service.from("service_agreements").update({ superseded_at: null, superseded_by: null }).eq("id", old.id!)).error?.message).toMatch(/stays superseded/);

    // No DIY charge after the switch; the round the client mailed under DIY is not Complete's work.
    expect((await charge(uid, { unit: "diy_period", amount_cents: 3900 })).error).toMatch(/only a do-it-yourself plan/);
    expect((await charge(uid, { unit: "round", round_id: r, amount_cents: 8900 })).error).toMatch(/no round has been mailed after the cancellation window|mailed by us/);
    // Complete's first round, mailed by us after its window: still not charged within 30 days of the DIY month already paid.
    const ours = await round(uid, 2, 2);
    expect((await charge(uid, { unit: "round", round_id: ours, amount_cents: 8900 })).error).toMatch(/fewer than 30 days/);
    // Once the DIY month already paid is over (its start and its creation more than 30 days back), Complete bills its work.
    await backdate(paidPeriod.id!, 31, true);
    expect((await charge(uid, { unit: "round", round_id: ours, amount_cents: 8900 })).error).toBeNull();
  });

  it("downgrades Complete → DIY: the subscription starts at the next cycle after the last Complete charge", async () => {
    const full = await activePlan(FULL);
    const diy = await activePlan(DIY);
    const uid = await addClient(h);
    await sign(uid, full, { daysAgo: 100 });
    const r1 = await round(uid, 1, 50);
    const paid = await charge(uid, { unit: "round", round_id: r1, amount_cents: 8900 });
    expect(paid.error).toBeNull();
    await backdate(paid.id!, 20);
    // The DIY agreement, signed 10 days ago (window over 5 days ago).
    const signedAt = new Date(Date.now() - 10 * DAY);
    const inserted = await h.service.from("service_agreements").insert({
      user_id: uid,
      document_version: "2026-11-25-diy-draft.1",
      disclosure_acknowledged_at: new Date(signedAt.getTime() - 60_000).toISOString(),
      disclosure_locale: "en",
      disclosure_hash: "a".repeat(64),
      signer_name: "Rosa Martínez",
      signed_at: signedAt.toISOString(),
      locale: "en",
      document_hash: "b".repeat(64),
      terms: { companyLegalName: "Credalti LLC", serviceOption: "diy", plan: snapshotPlan(diy) },
      cancellation_deadline: new Date(signedAt.getTime() + 5 * DAY).toISOString(),
    });
    expect(inserted.error).toBeNull();
    // The Complete charge was 20 days ago: the DIY subscription waits until 30 days after it.
    expect((await charge(uid, { unit: "diy_period", amount_cents: 3900 })).error).toMatch(/next 30-day cycle/);
    await backdate(paid.id!, 11);
    expect((await charge(uid, { unit: "diy_period", amount_cents: 3900 })).error).toBeNull();
  });

  it("counts upgrades from the events the signature writes", async () => {
    const uid = await addClient(h);
    await h.service.from("events").insert({ user_id: uid, kind: "service_option_upgraded", payload: { from: "diy", to: "full_service" } });
    const counted = await countUpgrades(h.service, new Date(Date.now() - DAY), new Date(Date.now() + DAY));
    expect(counted.upgrades).toBeGreaterThanOrEqual(1);
    expect(counted.userIds).toContain(uid);
  });
});

describe("row level security on the new tables", () => {
  it("lets a client read only their own option and mail requests, and write none", async () => {
    const a = await addClient(h);
    const b = await addClient(h);
    await recordOptionChoice(h.service, a, "diy", "app");
    expect((await h.as(a).from("client_service_options").select("service_option")).data).toEqual([{ service_option: "diy" }]);
    expect((await h.as(b).from("client_service_options").select("service_option")).data).toEqual([]);
    expect((await h.as(a).from("client_service_options").upsert({ user_id: a, service_option: "full_service", chosen_via: "app" })).error).not.toBeNull();
    expect((await h.anon.from("mail_requests").select("id")).data ?? []).toEqual([]);
  });
});
