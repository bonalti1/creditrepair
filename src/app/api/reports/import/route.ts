import { NextResponse } from "next/server";
import { z } from "zod";
import { parseReport } from "@/lib/domain/parser";
import { importReportForUser } from "@/lib/domain/importReport";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveActingUser } from "@/lib/supabase/server";

// Manual import: accepts a provider-agnostic normalized payload directly.
// Normal traffic should use /api/reports/pull (adapter-driven); this route
// exists for testing and for partners that push reports to us.

const bodySchema = z.object({
  userId: z.string().uuid().optional(),
  report: z.unknown(),
});

export async function POST(req: Request) {
  const parsedBody = bodySchema.safeParse(await req.json());
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
  }

  const acting = await resolveActingUser(req, parsedBody.data.userId);
  if (!acting) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { report } = parsedBody.data;
  try {
    parseReport(report);
  } catch (e) {
    return NextResponse.json({ error: `Unparseable report: ${(e as Error).message}` }, { status: 422 });
  }

  const db = getAdminClient();
  if (!db) {
    return NextResponse.json({ persisted: false, items: parseReport(report).items });
  }

  try {
    const result = await importReportForUser(db, acting.userId, report);
    return NextResponse.json({ persisted: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
