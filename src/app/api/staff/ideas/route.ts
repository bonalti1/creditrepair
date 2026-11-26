import { NextResponse } from "next/server";
import { z } from "zod";
import { altiConnected, ideasAltiCaller } from "@/lib/ideas/altiModel";
import { capabilityFor, ideasBodySchema } from "@/lib/ideas/rules";
import { applyIdeaAction, loadIdeasBoard, runAltiIdeas } from "@/lib/ideas/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { getServerSupabase } from "@/lib/supabase/server";

// Ideas and experiments (/equipo/ideas, docs/IDEAS.md).
//
//   GET   the board, through the member's own connection (every active
//         member reads ideas; Alti's proposals and runs only an
//         administrator, by the read policies of migration 0040).
//   POST  one change: add or edit an idea (ideas.add, every role); approve,
//         decline, start, keep or drop it, ask Alti for ideas, add or dismiss
//         a proposal (ideas.approve, administrators). The rules are in
//         src/lib/ideas/rules.ts; the database checks the order again.
//
// Asking Alti reads only aggregate numbers (src/lib/ideas/signals.ts) and
// stores what it proposes as open proposals. Nothing is acted on by itself.

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-ideas-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("ideas.add");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    return NextResponse.json({ board: await loadIdeasBoard(reader, allowed.member, altiConnected()) });
  } catch (error) {
    await reportError(error, { where: "api/staff/ideas:read", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the ideas." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-ideas", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = ideasBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error), code: "invalid" }, { status: 400 });
  const input = parsed.data;
  const allowed = await requireCapability(capabilityFor(input.action));
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const now = new Date();
  try {
    if (input.action === "ask_alti") {
      // Each ask is a paid model call: two a minute per person at most, and ALTI_RUNS_PER_DAY a day.
      const slow = rateLimit(req, "staff-ideas-alti", { limit: 2, windowMs: 60_000, subject: member.userId });
      if (slow) return slow;
      const reader = await getServerSupabase();
      if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
      const result = await runAltiIdeas(db, reader, ideasAltiCaller(), { trigger: "person", member }, now);
      return result.ok ? NextResponse.json({ ...result }) : NextResponse.json({ ok: false, code: result.problem }, { status: result.status });
    }
    const result = await applyIdeaAction(db, member, input, now);
    return result.ok ? NextResponse.json({ ok: true, id: result.id ?? null }) : NextResponse.json({ ok: false, code: result.code }, { status: result.status });
  } catch (error) {
    await reportError(error, { where: `api/staff/ideas:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save the change.", code: "error" }, { status: 500 });
  }
}
