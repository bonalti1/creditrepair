import { NextResponse } from "next/server";
import { z } from "zod";
import { accountingBodySchema, MAX_ACCOUNTING_BODY_BYTES } from "@/lib/accounting/api";
import { loadBook, runAction } from "@/lib/accounting/store";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { loadStaffClients } from "@/lib/staff/load";
import { getServerSupabase } from "@/lib/supabase/server";

// The accounting department (/equipo/contabilidad), for staff with the
// accounting capability only (requireCapability("accounting"): today,
// administrators). Sales, specialists, clients and partners get a 403.
//
//   GET   the books: expenses, monthly rules, other income, imports, the
//         processor's export, decisions, collections steps, closed months,
//         the audit trail, settings, partners' 1099 details, and each
//         charge's processor and reference (to tell test charges apart and to
//         reconcile). The clients and their charges come from
//         /api/staff/clients, through the member's own connection.
//   POST  one change (src/lib/accounting/api.ts), worked out by the same rules
//         as the demo (actions.ts) and written with the service role; the
//         database checks closed months and append-only records again.
//
// Nothing here creates, changes or retries a charge, or moves money.

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-accounting-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("accounting");
  if (!allowed.ok) return allowed.response;
  try {
    return NextResponse.json({ book: await loadBook(allowed.db) });
  } catch (error) {
    await reportError(error, { where: "api/staff/accounting:read", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the books." }, { status: 500 });
  }
}

// Steps that need the clients as this member reads them.
const NEEDS_CLIENTS = new Set(["collection", "close_month"]);

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-accounting", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("accounting");
  if (!allowed.ok) return allowed.response;
  const body = await readJsonBody(req, MAX_ACCOUNTING_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = accountingBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { db, member } = allowed;
  try {
    let clients = null;
    if (NEEDS_CLIENTS.has(parsed.data.action)) {
      const reader = await getServerSupabase();
      if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
      clients = await loadStaffClients(reader);
    }
    const result = await runAction(db, parsed.data, { userId: member.userId, name: member.name }, clients);
    return result.ok ? NextResponse.json({ ok: true, message: result.message ?? null }) : NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  } catch (error) {
    await reportError(error, { where: `api/staff/accounting:${parsed.data.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
  }
}
