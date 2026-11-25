import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { commissionLineFromRow, type CommissionsView } from "@/lib/fulfillment/commissionData";
import { incomeSource, postingPlan, reconcileMonth, type CommissionClient } from "@/lib/fulfillment/commissions";
import { CHECK_METHODS } from "@/lib/fulfillment/monitoring";
import { monitoringCheckFromRow } from "@/lib/fulfillment/rows";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { memberCanSee } from "@/lib/staff/actions";
import { getServerSupabase } from "@/lib/supabase/server";

// Credit monitoring (migration 0041; docs/FULFILLMENT.md "Monitoring").
//
//   POST {action: "check", clientId, …}  a teammate records what they saw
//        about one client's monitoring: requireCapability("clients.followup")
//        and the client must be theirs (memberCanSee, through their own
//        connection). Append-only.
//
//   The referral commissions, administrators only
//   (requireCapability("monitoring.commissions")):
//   GET  every line, the clients with their checks (to reconcile per client
//        and month), and the monitoring income Accounting already has.
//   POST record (by hand) · import (the statement's lines, once per file and
//        once per line) · match (a line to a client, or unmatched) · void
//        (with a reason) · post (one month's unposted lines → ONE other_income
//        row, dated the day the provider paid: the books' money rule).

type Row = Record<string, unknown>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const cents = z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 10_000_000);
const memberRef = z.string().max(120).refine((s) => !/\d{3}-?\d{2}-?\d{4}/.test(s), "No SSN-like numbers");

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("check"),
      clientId: z.string().uuid(),
      provider: z.enum(["identityiq", "other"]),
      providerName: z.string().trim().min(2).max(60).nullable().optional(),
      enrolledViaLink: z.enum(["yes", "no", "unknown"]),
      status: z.enum(["active", "cancelled", "unknown"]),
      checkedOn: day,
      method: z.enum(CHECK_METHODS as unknown as [string, ...string[]]),
      note: z.string().max(300).optional(),
    })
    .strict(),
  z.object({ action: z.literal("record"), clientId: z.string().uuid().nullable(), month, amountCents: cents, memberRef, paidOn: day.nullable(), note: z.string().max(300).optional() }).strict(),
  z
    .object({
      action: z.literal("import"),
      fileName: z.string().min(1).max(200),
      fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
      lines: z.array(z.object({ month, amountCents: cents, memberRef, paidOn: day.nullable(), clientId: z.string().uuid().nullable() }).strict()).max(5000),
    })
    .strict(),
  z.object({ action: z.literal("match"), lineId: z.string().uuid(), clientId: z.string().uuid().nullable() }).strict(),
  z.object({ action: z.literal("void"), lineId: z.string().uuid(), reason: z.string().trim().min(5).max(300) }).strict(),
  z.object({ action: z.literal("post"), month, receivedOn: day, confirmNotDuplicate: z.boolean() }).strict(),
]);

const texasToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

async function loadView(db: import("@supabase/supabase-js").SupabaseClient): Promise<CommissionsView> {
  const [lines, profiles, prospects, checks, income] = await Promise.all([
    db.from("monitoring_commissions").select("*"),
    db.from("profiles").select("id, full_name"),
    db.from("prospects").select("converted_user_id, email"),
    db.from("monitoring_checks").select("*"),
    db.from("other_income").select("received_on, amount_cents, voided_at").eq("kind", "monitoring_commission"),
  ]);
  for (const r of [lines, profiles, prospects, checks, income]) if (r.error) throw new Error(r.error.message);
  const staffIds = new Set(((await db.from("staff_members").select("user_id")).data as Row[] | null ?? []).map((s) => String(s.user_id)));
  const emailOf = new Map(((prospects.data as Row[] | null) ?? []).filter((p) => p.converted_user_id).map((p) => [String(p.converted_user_id), p.email ? String(p.email) : null]));
  const checksBy = new Map<string, ReturnType<typeof monitoringCheckFromRow>[]>();
  for (const r of (checks.data as Row[] | null) ?? []) checksBy.set(String(r.user_id), [...(checksBy.get(String(r.user_id)) ?? []), monitoringCheckFromRow(r)]);
  const clients: CommissionClient[] = ((profiles.data as Row[] | null) ?? [])
    .filter((p) => !staffIds.has(String(p.id)))
    .map((p) => ({ id: String(p.id), name: String(p.full_name ?? "").trim() || "—", email: emailOf.get(String(p.id)) ?? null, checks: checksBy.get(String(p.id)) ?? [] }));
  const booksByMonth: Record<string, number> = {};
  for (const r of (income.data as Row[] | null) ?? []) {
    if (r.voided_at) continue;
    const m = String(r.received_on).slice(0, 7);
    booksByMonth[m] = (booksByMonth[m] ?? 0) + Number(r.amount_cents);
  }
  return { lines: ((lines.data as Row[] | null) ?? []).map(commissionLineFromRow), clients, booksByMonth };
}

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-monitoring-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("monitoring.commissions");
  if (!allowed.ok) return allowed.response;
  try {
    return NextResponse.json(await loadView(allowed.db));
  } catch (error) {
    await reportError(error, { where: "api/staff/monitoring:read", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the commissions." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-monitoring", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 600_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;

  if (input.action === "check") {
    const allowed = await requireCapability("clients.followup");
    if (!allowed.ok) return allowed.response;
    const reader = await getServerSupabase();
    if (!reader || (await memberCanSee(reader, input.clientId, "client")) !== "client") return NextResponse.json({ error: "Not your client", code: "not_visible" }, { status: 403 });
    if (input.checkedOn > texasToday()) return NextResponse.json({ error: "The day checked can't be in the future.", code: "future_day" }, { status: 400 });
    const note = (input.note ?? "").replace(/\s+/g, " ").trim();
    if (/\d{3}-?\d{2}-?\d{4}/.test(note)) return NextResponse.json({ error: "No SSN-like numbers in the note.", code: "ssn_in_note" }, { status: 400 });
    if (input.provider === "other" && !input.providerName) return NextResponse.json({ error: "Name the provider.", code: "provider_name" }, { status: 400 });
    try {
      const { data, error } = await allowed.db
        .from("monitoring_checks")
        .insert({
          user_id: input.clientId,
          provider: input.provider,
          provider_name: input.provider === "other" ? input.providerName : null,
          enrolled_via_link: input.enrolledViaLink,
          status: input.status,
          checked_on: input.checkedOn,
          method: input.method,
          note,
          recorded_by: allowed.member.userId,
          recorded_by_name: allowed.member.name.slice(0, 80),
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, check: monitoringCheckFromRow(data as Row) });
    } catch (error) {
      await reportError(error, { where: "api/staff/monitoring:check", userId: allowed.member.userId });
      return NextResponse.json({ error: "Could not save the check." }, { status: 500 });
    }
  }

  const allowed = await requireCapability("monitoring.commissions");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  const by = { created_by: member.userId, created_by_name: member.name.slice(0, 80) };
  try {
    switch (input.action) {
      case "record": {
        const { error } = await db.from("monitoring_commissions").insert({
          user_id: input.clientId,
          month: input.month,
          amount_cents: input.amountCents,
          kind: input.amountCents < 0 ? "reversal" : "commission",
          member_ref: input.memberRef.trim(),
          paid_on: input.paidOn,
          source: "manual",
          note: (input.note ?? "").trim(),
          ...by,
        });
        if (error) throw new Error(error.message);
        break;
      }
      case "import": {
        const { data: existing } = await db.from("monitoring_commission_imports").select("id").eq("file_sha256", input.fileSha256).maybeSingle();
        if (existing) return NextResponse.json({ error: "This file was imported already.", code: "same_file" }, { status: 409 });
        const { data: imp, error } = await db
          .from("monitoring_commission_imports")
          .insert({ file_name: input.fileName, file_sha256: input.fileSha256, line_count: input.lines.length, ...by })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        const rows = input.lines.map((l) => ({
          user_id: l.clientId,
          month: l.month,
          amount_cents: l.amountCents,
          kind: l.amountCents < 0 ? "reversal" : "commission",
          member_ref: l.memberRef.trim(),
          paid_on: l.paidOn,
          source: "csv",
          import_id: (imp as Row).id,
          line_fingerprint: createHash("sha256").update([l.month, l.amountCents, l.memberRef.trim().toLowerCase(), l.paidOn ?? ""].join("|")).digest("hex"),
          ...by,
        }));
        // A line already recorded (same month, amount, member and day) is skipped, not doubled.
        const { data: added, error: lineError } = rows.length > 0 ? await db.from("monitoring_commissions").upsert(rows, { onConflict: "line_fingerprint", ignoreDuplicates: true }).select("id") : { data: [], error: null };
        if (lineError) throw new Error(lineError.message);
        const count = ((added as Row[] | null) ?? []).length;
        return NextResponse.json({ ok: true, added: count, skipped: rows.length - count });
      }
      case "match": {
        const { error } = await db.from("monitoring_commissions").update({ user_id: input.clientId }).eq("id", input.lineId);
        if (error) return NextResponse.json({ error: error.message, code: "refused" }, { status: 409 });
        break;
      }
      case "void": {
        const { error } = await db.from("monitoring_commissions").update({ voided_at: new Date().toISOString(), void_reason: input.reason }).eq("id", input.lineId);
        if (error) return NextResponse.json({ error: error.message, code: "refused" }, { status: 409 });
        break;
      }
      case "post": {
        if (input.receivedOn > texasToday()) return NextResponse.json({ error: "The day received can't be in the future.", code: "future_day" }, { status: 400 });
        const view = await loadView(db);
        const rec = reconcileMonth(input.month, view.lines, view.clients);
        const plan = postingPlan(rec, { receivedOn: input.receivedOn, existingMonitoringIncomeCents: view.booksByMonth[input.receivedOn.slice(0, 7)] ?? 0, confirmNotDuplicate: input.confirmNotDuplicate });
        if (!plan.ok) return NextResponse.json({ error: plan.problem, code: plan.problem }, { status: 409 });
        const provider = view.lines.find((l) => plan.lineIds.includes(l.id))?.provider ?? "IdentityIQ";
        const { data: income, error } = await db
          .from("other_income")
          .insert({
            kind: "monitoring_commission",
            source: incomeSource(provider, input.month, plan.lineIds.length),
            received_on: plan.receivedOn,
            amount_cents: plan.amountCents,
            note: `Posted from Monitoring commissions (${input.month}).`,
            ...by,
          })
          .select("id")
          .single();
        // A closed month refuses it (accounting_closed_month_guard): say so plainly.
        if (error) return NextResponse.json({ error: error.message, code: /closed/i.test(error.message) ? "closed_month" : "refused" }, { status: 409 });
        const incomeId = String((income as Row).id);
        const { error: markError } = await db.from("monitoring_commissions").update({ posted_income_id: incomeId, posted_at: new Date().toISOString() }).in("id", plan.lineIds).is("posted_income_id", null);
        if (markError) throw new Error(markError.message);
        await db.from("accounting_audit").insert({ actor: member.userId, actor_name: member.name.slice(0, 80), action: "monitoring_posted", entity: "other_income", entity_id: incomeId, detail: { month: input.month, lines: plan.lineIds.length, amountCents: plan.amountCents } });
        return NextResponse.json({ ok: true, incomeId, amountCents: plan.amountCents });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: `api/staff/monitoring:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
