import { NextResponse } from "next/server";
import { z } from "zod";
import { activate, discard, listPlans, recordApproval, recordSwitch, retire, saveDraft, setDefault } from "@/lib/billing/planStore";
import { loadSwitches } from "@/lib/billing/server";
import { loadAcceptedCards, saveAcceptedCards } from "@/lib/billing/cardSettings";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// The plan catalogue (/equipo/planes), for administrators only
// (requireCapability("billing.plans")):
//
//   GET   every plan version and the program switches.
//   POST  save_draft | record_approval | activate | retire | set_default |
//         discard | offer (a plan to one client before they sign) |
//         household (link or end two clients) | referral (who referred whom) |
//         switch (pay per delete / referral credits, with the attorney's approval) |
//         card_brands (which card brands clients may put on file; at least one on).
//
// The terms are validated here (validatePlanTerms) whatever the screen
// showed, and the database checks them again (migration 0026). Nothing here
// creates a charge or changes an amount on a signed agreement.

const bilingual = z.object({ en: z.string().max(80), es: z.string().max(80) }).strict();
const approval = { attorneyName: z.string().max(120), approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), confirmed: z.boolean() };

const plansBodySchema = z.discriminatedUnion("action", [
  // `terms` is checked by validatePlanTerms, which explains a refused field (a setup fee…) instead of only rejecting it.
  z.object({ action: z.literal("save_draft"), id: z.string().uuid().nullable().optional(), key: z.string().max(60).nullable().optional(), name: bilingual, terms: z.unknown() }).strict(),
  z.object({ action: z.literal("record_approval"), id: z.string().uuid(), ...approval }).strict(),
  z.object({ action: z.enum(["activate", "retire", "set_default", "discard"]), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("offer"), userId: z.string().uuid(), planId: z.string().uuid().nullable() }).strict(),
  z.object({ action: z.literal("household"), userA: z.string().uuid(), userB: z.string().uuid(), end: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("referral"), referrer: z.string().uuid(), referred: z.string().uuid() }).strict(),
  z.object({ action: z.literal("card_brands"), visa: z.boolean(), mastercard: z.boolean(), amex: z.boolean(), discover: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("switch"),
      switch: z.enum(["pay_per_delete", "referral_credits"]),
      enabled: z.boolean(),
      attorneyName: z.string().max(120).optional(),
      approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      confirmed: z.boolean().optional(),
      referralCreditCents: z.number().int().min(100).max(50000).optional(),
    })
    .strict(),
]);

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-plans-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("billing.plans");
  if (!allowed.ok) return allowed.response;
  try {
    const [plans, switches, cardBrands] = await Promise.all([listPlans(allowed.db), loadSwitches(allowed.db), loadAcceptedCards(allowed.db)]);
    return NextResponse.json({ plans, switches, cardBrands });
  } catch (error) {
    await reportError(error, { where: "api/staff/plans", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the plans." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-plans", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 20_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = plansBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("billing.plans");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  const actor = { userId: member.userId, name: member.name };
  const input = parsed.data;
  const fail = (message: string, status = 409) => NextResponse.json({ ok: false, problems: [{ code: "invalid", field: "plan", message: { en: message, es: message } }] }, { status });

  try {
    switch (input.action) {
      case "save_draft": {
        const result = await saveDraft(db, { id: input.id ?? null, key: input.key ?? null, name: input.name, terms: input.terms }, actor);
        return result.ok ? NextResponse.json({ ok: true, result: result.value }) : NextResponse.json({ ok: false, problems: result.problems }, { status: 422 });
      }
      case "record_approval": {
        const result = await recordApproval(db, input.id, input, actor);
        return result.ok ? NextResponse.json({ ok: true, result: result.value }) : NextResponse.json({ ok: false, problems: result.problems }, { status: 422 });
      }
      case "activate":
      case "retire":
      case "set_default":
      case "discard": {
        const run = { activate, retire, set_default: setDefault, discard }[input.action] as (d: typeof db, id: string) => Promise<{ ok: boolean; problems?: unknown; value?: unknown }>;
        const result = await run(db, input.id);
        return result.ok ? NextResponse.json({ ok: true, result: result.value }) : NextResponse.json({ ok: false, problems: result.problems }, { status: 409 });
      }
      case "offer": {
        if (input.planId === null) {
          await db.from("client_plan_offers").delete().eq("user_id", input.userId);
          return NextResponse.json({ ok: true });
        }
        const { error } = await db
          .from("client_plan_offers")
          .upsert({ user_id: input.userId, plan_id: input.planId, offered_by: member.userId, offered_by_name: member.name.slice(0, 80) });
        return error ? fail(error.message) : NextResponse.json({ ok: true });
      }
      case "household": {
        const [a, b] = [input.userA, input.userB].sort();
        if (a === b) return fail("A household is two different clients.", 422);
        if (input.end) {
          const { error } = await db.from("household_links").update({ ended_at: new Date().toISOString() }).eq("user_a", a!).eq("user_b", b!).is("ended_at", null);
          return error ? fail(error.message) : NextResponse.json({ ok: true });
        }
        const { error } = await db.from("household_links").insert({ user_a: a, user_b: b, created_by: member.userId, created_by_name: member.name.slice(0, 80) });
        return error ? fail(error.message) : NextResponse.json({ ok: true });
      }
      case "referral": {
        const { error } = await db
          .from("client_referrals")
          .insert({ referrer_user_id: input.referrer, referred_user_id: input.referred, recorded_by: member.userId, recorded_by_name: member.name.slice(0, 80) });
        return error ? fail(error.message) : NextResponse.json({ ok: true });
      }
      case "card_brands": {
        const result = await saveAcceptedCards(db, { visa: input.visa, mastercard: input.mastercard, amex: input.amex, discover: input.discover }, actor);
        return result.ok
          ? NextResponse.json({ ok: true, result: result.cards })
          : NextResponse.json({ ok: false, problems: [{ code: "invalid", field: "cards", message: result.message }] }, { status: 422 });
      }
      case "switch": {
        const result = await recordSwitch(db, input, actor);
        return result.ok ? NextResponse.json({ ok: true }) : fail(result.message, 422);
      }
    }
  } catch (error) {
    await reportError(error, { where: "api/staff/plans", userId: member.userId, extra: { action: input.action } });
    return NextResponse.json({ error: "Could not save. Nothing was changed." }, { status: 500 });
  }
}
