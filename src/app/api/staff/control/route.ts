import { NextResponse } from "next/server";
import { z } from "zod";
import { escalateToOwner } from "@/lib/control/alertsServer";
import { loadControlExtras } from "@/lib/control/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { can } from "@/lib/staff/permissions";
import { getServerSupabase } from "@/lib/supabase/server";

// The Overview and the Today list (docs/CONTROL.md): what they need beyond
// the clients list (partner notes waiting, review requests, possible
// complaints, the owner's escalations, the tech health times), and
// "Escalate to the owner". Every member of the team may open the Overview
// (clients.followup, every role); what each card shows is scoped by the role
// and by the read policies, through the member's own connection.

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("escalate"), key: z.string().min(3).max(200), title: z.string().min(1).max(160), note: z.string().max(500).optional() }).strict(),
  z.object({ action: z.literal("resolve"), id: z.string().uuid() }).strict(),
]);

export async function GET() {
  const allowed = await requireCapability("clients.followup");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    return NextResponse.json({ extras: await loadControlExtras(reader, allowed.db, allowed.member, new Date()) });
  } catch (error) {
    await reportError(error, { where: "api/staff/control:get", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the overview." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-control", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("clients.followup");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const input = parsed.data;
  const now = new Date();
  try {
    if (input.action === "escalate") {
      const strip = (s: string) => s.replace(/<[^>]*>/g, "").trim();
      const result = await escalateToOwner(db, member, { key: input.key, title: strip(input.title), note: input.note ? strip(input.note) : null }, now);
      return NextResponse.json({ ok: true, ...result });
    }
    // Resolving an escalation is the owner's.
    if (!can(member.role, "business.view")) return NextResponse.json({ error: "Not allowed for this role" }, { status: 403 });
    const { error } = await db.from("control_escalations").update({ resolved_at: now.toISOString(), resolved_by: member.userId }).eq("id", input.id).is("resolved_at", null);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: `api/staff/control:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
