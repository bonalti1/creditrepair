import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { addStaffPartnerReply, loadStaffPartnerThreads } from "@/lib/partners/portalServer";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { memberCanSee } from "@/lib/staff/actions";
import { getServerSupabase } from "@/lib/supabase/server";

// Notes between a referral partner and the team about one client (migration
// 0033), on the client's page in the staff console.
//
// GET   ?client=<id>: the threads with each partner the client shares with (or
//       once did), read through the member's OWN connection, so the client's
//       scope decides (staff_can_see_client).
// POST  {clientId, partnerId, text}: a teammate's reply to the partner, after
//       the same guardrails as the partner's note (no promises, no credit
//       data). Only while the client shares with that partner: the database
//       refuses it otherwise. The client never sees these notes; a teammate who
//       wants to tell the client something writes in the client's own
//       conversation.
//
// Whoever follows up a client may do both (clients.followup, every role).

const bodySchema = z.object({
  clientId: z.string().uuid(),
  partnerId: z.string().uuid(),
  text: z.string().trim().min(2).max(1500),
  locale: z.enum(["es", "en"]).optional(),
});

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-partner-notes-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("clients.followup");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const clientId = new URL(req.url).searchParams.get("client") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    if ((await memberCanSee(reader, clientId, "client")) !== "client") return NextResponse.json({ threads: [] });
    return NextResponse.json({ threads: await loadStaffPartnerThreads(reader, db, clientId) });
  } catch (error) {
    await reportError(error, { where: "api/staff/partner-notes:read", userId: member.userId });
    return NextResponse.json({ error: "Could not read the notes." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-partner-notes", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 6_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const allowed = await requireCapability("clients.followup");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const result = await addStaffPartnerReply(db, reader, member, input.clientId, input.partnerId, input.text, input.locale ?? "en");
    if (!result.ok) return NextResponse.json({ error: "Not sent", code: result.code, problems: result.problems }, { status: result.status });
    return NextResponse.json({ ok: true, note: result.note });
  } catch (error) {
    await reportError(error, { where: "api/staff/partner-notes", userId: member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
