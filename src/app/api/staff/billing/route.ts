import { NextResponse } from "next/server";
import { z } from "zod";
import { invoiceRows, quickBooksCsv, transactionsCsv } from "@/lib/billing/invoices";
import { recordAchReturn, recordChargeback } from "@/lib/billing/webhooks";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { loadStaffClients } from "@/lib/staff/load";

// Invoices and disputes, for administrators (requireCapability("billing.plans")):
//
//   GET ?format=transactions|quickbooks   the CSV file of every charge.
//   POST chargeback        record a chargeback the processor's portal shows (no webhook).
//   POST chargeback_status won | lost | accepted, or mark the evidence sent.
//   POST ach_return        record an ACH return the processor's portal shows.
//
// None of these creates a charge or changes an amount.

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("chargeback"),
      chargeId: z.string().uuid(),
      reasonCode: z.string().max(40).nullable().optional(),
      caseId: z.string().max(120).nullable().optional(),
      receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  z.object({ action: z.literal("chargeback_status"), chargebackId: z.string().uuid(), status: z.enum(["won", "lost", "accepted", "responded"]) }).strict(),
  z.object({ action: z.literal("ach_return"), chargeId: z.string().uuid(), code: z.string().regex(/^R[0-9A-Z]{2}$/), returnedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
]);

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-billing-export", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("billing.plans");
  if (!allowed.ok) return allowed.response;
  const format = new URL(req.url).searchParams.get("format") === "quickbooks" ? "quickbooks" : "transactions";
  try {
    const clients = await loadStaffClients(allowed.db);
    const rows = invoiceRows(
      clients.map((c) => ({
        clientId: c.id,
        clientName: `${c.firstName} ${c.lastName}`.trim(),
        charges: c.billing.charges,
        planType: c.agreementPlan?.terms.type ?? null,
        methodKind: c.billing.paymentMethod?.kind ?? null,
      })),
    );
    const csv = format === "quickbooks" ? quickBooksCsv(rows) : transactionsCsv(rows);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="credalti-${format}-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    await reportError(error, { where: "api/staff/billing", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not build the file." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-billing", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 5_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("billing.plans");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  const input = parsed.data;
  try {
    if (input.action === "chargeback") {
      const result = await recordChargeback(db, input.chargeId, {
        amountCents: null,
        reasonCode: input.reasonCode ?? null,
        caseId: input.caseId ?? null,
        receivedAt: new Date(`${input.receivedOn}T12:00:00Z`).toISOString(),
        source: "manual",
        note: input.note ?? null,
        by: { userId: member.userId, name: member.name },
      });
      return result.ok ? NextResponse.json({ ok: true, id: result.id }) : NextResponse.json({ ok: false, message: result.message }, { status: 409 });
    }
    if (input.action === "chargeback_status") {
      const now = new Date().toISOString();
      const patch = input.status === "responded" ? { responded_at: now } : { status: input.status, closed_at: now };
      const { error } = await db.from("chargebacks").update(patch).eq("id", input.chargebackId);
      return error ? NextResponse.json({ ok: false, message: error.message }, { status: 409 }) : NextResponse.json({ ok: true });
    }
    const result = await recordAchReturn(db, input.chargeId, input.code, "manual", new Date(`${input.returnedOn}T12:00:00Z`));
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, message: result.message }, { status: 409 });
  } catch (error) {
    await reportError(error, { where: "api/staff/billing", userId: member.userId, extra: { action: input.action } });
    return NextResponse.json({ error: "Could not save. Nothing was changed." }, { status: 500 });
  }
}
