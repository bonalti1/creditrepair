import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { importStaffReport, readStaffReport, saveStaffSample } from "@/lib/staff/actions";
import { MAX_REPORT_SOURCE_CHARS, reportsBodySchema } from "@/lib/staff/api";
import { getServerSupabase } from "@/lib/supabase/server";

// A report staff bring in from the client's page (reports.import:
// administrators and specialists, for clients whose case they see).
//
//   import  The text exactly as pasted or uploaded, and the reader to use.
//           The server reads it again itself: a report parsed in the browser
//           is never trusted. Then the same rules as the preview
//           (reports/merge.ts): nothing older than the report on file,
//           nothing missing a bureau the old one had, never an answer written.
//   sample  A page from a provider that has no reader yet, kept untouched.
//
// GET ?clientId=&pull=: one report in the client's file exactly as it was
// stored (the Reports tab's open, print and download). Staff who see the case
// only (case.view: administrators, and specialists for their assigned
// clients), read through the member's own connection so the read policies
// decide. Clients never get the raw import: their own page shows the audit.

const idSchema = z.string().uuid();

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-reports-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const params = new URL(req.url).searchParams;
  const clientId = params.get("clientId") ?? "";
  const pull = params.get("pull") ?? "";
  if (!idSchema.safeParse(clientId).success || !idSchema.safeParse(pull).success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const allowed = await requireCapability("case.view");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const result = await readStaffReport(reader, clientId, pull);
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
    return NextResponse.json({ report: result.report }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await reportError(error, { where: "api/staff/reports:read", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the report." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-reports", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  // 5 MB of text, with room for JSON escaping.
  const body = await readJsonBody(req, Math.ceil(MAX_REPORT_SOURCE_CHARS * 1.3) + 10_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = reportsBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;

  const allowed = await requireCapability("reports.import");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  try {
    const result =
      input.action === "import"
        ? await importStaffReport(db, reader, member, { clientId: input.clientId, readerKey: input.readerKey, source: input.source })
        : await saveStaffSample(db, reader, member, { clientId: input.clientId, provider: input.provider, text: input.text, fileName: input.fileName ?? null });
    if (!result.ok) {
      return NextResponse.json({ error: result.message, message: result.message, code: result.code, problems: result.problems }, { status: result.status });
    }
    const { ok: _ok, ...rest } = result;
    return NextResponse.json({ ok: true, ...rest });
  } catch (error) {
    await reportError(error, { where: `api/staff/reports:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save the report. Please try again." }, { status: 500 });
  }
}
