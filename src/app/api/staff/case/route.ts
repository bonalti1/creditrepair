import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { addStaffNote, markExceptionHandled, sendStaffReply } from "@/lib/staff/actions";
import { caseBodySchema } from "@/lib/staff/api";
import { getServerSupabase } from "@/lib/supabase/server";

// Three things a member of staff does on a client's page:
//
//   note     a note for the team (every role: clients.followup)
//   resolve  mark one of the console's notices as handled (clients.followup;
//            sales only the notices that are theirs, permissions.ts)
//   reply    write to the client in their app (clients.reply). The same claim
//            rules ads and the assistant pass; the client sees the teammate's first
//            name, from their own staff record.
//
// The role is checked here from the caller's own row; whether they may see
// this client is checked through their own connection (the read policies of
// migration 0012). Writes use the service role (src/lib/staff/actions.ts).

const CAPABILITY = { note: "clients.followup", resolve: "clients.followup", reply: "clients.reply" } as const;

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-case", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const body = await readJsonBody(req, 20_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = caseBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;

  const allowed = await requireCapability(CAPABILITY[input.action]);
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  try {
    const result =
      input.action === "note"
        ? await addStaffNote(db, reader, member, input.clientId, input.text)
        : input.action === "resolve"
          ? await markExceptionHandled(db, reader, member, input.clientId, input.key)
          : await sendStaffReply(db, reader, member, input.clientId, input.text);
    if (!result.ok) {
      return NextResponse.json({ error: result.message, message: result.message, code: result.code, problems: result.problems }, { status: result.status });
    }
    const { ok: _ok, ...rest } = result;
    return NextResponse.json({ ok: true, ...rest });
  } catch (error) {
    await reportError(error, { where: `api/staff/case:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
