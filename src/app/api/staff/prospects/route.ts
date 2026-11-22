import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// "Sent the invitation": the invite page (/equipo/invitar) calls this when the
// salesperson sends or copies the message for a prospect. It records the first
// time on the prospect (prospects.invited_at, migration 0017), which the
// HighLevel stage sync reports as "Invitado". Nothing else changes.
//
// Sales may mark only the people they brought in; an administrator anyone.

const bodySchema = z.object({ action: z.literal("invited"), id: z.string().uuid() });

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-prospects", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  const allowed = await requireCapability("clients.invite");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  try {
    // The id is a prospect's, or the account of a person who was one.
    const { data: prospect } = await db
      .from("prospects")
      .select("id, salesperson, invited_at")
      .or(`id.eq.${parsed.data.id},converted_user_id.eq.${parsed.data.id}`)
      .limit(1)
      .maybeSingle();
    if (!prospect) return NextResponse.json({ ok: true, recorded: false });
    if (member.role === "sales" && prospect.salesperson !== member.handle) {
      return NextResponse.json({ error: "Not allowed", message: "Solo puedes marcar a las personas que tú trajiste." }, { status: 403 });
    }
    if (prospect.invited_at) return NextResponse.json({ ok: true, recorded: false, invitedAt: prospect.invited_at });
    const at = new Date().toISOString();
    const { error } = await db.from("prospects").update({ invited_at: at }).eq("id", prospect.id).is("invited_at", null);
    if (error) throw new Error(error.message);
    await db.from("team_audit").insert({ actor: member.userId, kind: "prospect_invited", prospect_id: prospect.id, member_handle: member.handle });
    return NextResponse.json({ ok: true, recorded: true, invitedAt: at });
  } catch (error) {
    await reportError(error, { where: "api/staff/prospects", userId: member.userId });
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
