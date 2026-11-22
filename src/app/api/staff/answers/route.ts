import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffMember, requireCapability } from "@/lib/staff/access";
import { answerActionSchema } from "@/lib/staff/answers";
import { changeSavedAnswer, listSavedAnswers } from "@/lib/staff/answersServer";
import { getServerSupabase } from "@/lib/supabase/server";

// "Respuestas guardadas" (src/lib/staff/answers.ts, migration 0020).
//
//   GET   the library as this member may read it (their own connection: the
//         read policies decide).
//   POST  save   a reply sent to a client, offered to the library (whoever may
//                answer clients; an administrator's goes in approved, a
//                specialist's as a proposal)
//         edit, approve, delete   an administrator; a specialist only edits or
//                withdraws their own proposal.
// Every answer passes the staff reply rules and carries nothing of one client
// (answerProblems) before it is stored.

export async function GET() {
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const member = await getStaffMember();
  if (!member) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  try {
    return NextResponse.json({ answers: await listSavedAnswers(reader) });
  } catch (error) {
    await reportError(error, { where: "api/staff/answers:list", userId: member.userId });
    return NextResponse.json({ error: "No pudimos leer las respuestas guardadas." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-answers", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 20_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = answerActionSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  // Answering clients is the floor for touching the library; the finer rule (who approves) is in changeSavedAnswer.
  const allowed = await requireCapability("clients.reply");
  if (!allowed.ok) return allowed.response;
  try {
    const result = await changeSavedAnswer(allowed.db, allowed.member, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.message, message: result.message, code: result.code, problems: result.problems }, { status: result.status });
    const { ok: _ok, ...rest } = result;
    return NextResponse.json({ ok: true, ...rest });
  } catch (error) {
    await reportError(error, { where: `api/staff/answers:${parsed.data.action}`, userId: allowed.member.userId });
    return NextResponse.json({ error: "No se pudo guardar. Nada cambió; intenta de nuevo." }, { status: 500 });
  }
}
