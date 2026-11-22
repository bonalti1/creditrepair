import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { DEMO_SAVED_ANSWERS } from "@/lib/staff/answers";
import { loadApprovedAnswers } from "@/lib/staff/answersServer";
import { callDraftModel } from "@/lib/staff/draftModel";
import { draftReply } from "@/lib/staff/drafts";
import { buildDemoClients } from "@/lib/staff/demoClients";
import { loadStaffClients } from "@/lib/staff/load";
import { isStaffRole } from "@/lib/staff/permissions";
import { isDemoMode } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";

// AltiBot's draft of a reply to a client's waiting question (src/lib/staff/drafts.ts).
//
// With a database: only a member whose role answers clients (clients.reply,
// checked on the server from their own row); the client is read through
// their OWN connection, so the read policies decide whether they may see this
// case at all; the facts given to the model are the ones their role may see.
// The draft is checked against the reply rules before it comes back (and
// written again once if it fails). Nothing is sent from here: the teammate
// sends it through the one send path (/api/staff/case), checked again there.
//
// In the demo: the invented client is rebuilt on the server (nothing from the
// browser is trusted as the case), and "Ver como" picks the role.
//
// Without ANTHROPIC_API_KEY: 200 with no draft and the reason.

const bodySchema = z
  .object({
    clientId: z.string().min(1).max(64),
    /** Demo only: the role "Ver como" shows. Ignored with a database. */
    viewAs: z.enum(["admin", "specialist", "sales"]).optional(),
  })
  .strict();

export async function POST(req: Request) {
  // Each draft spends model tokens.
  const limited = rateLimit(req, "staff-drafts", { limit: 30, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const now = new Date();
  const caller = process.env.ANTHROPIC_API_KEY ? callDraftModel : null;

  if (isDemoMode()) {
    const client = buildDemoClients(now).find((c) => c.id === parsed.data.clientId);
    if (!client) return NextResponse.json({ error: "No encontramos a este cliente." }, { status: 404 });
    const role = isStaffRole(parsed.data.viewAs) ? parsed.data.viewAs : "admin";
    const outcome = await draftReply({ client, role, now, savedAnswers: DEMO_SAVED_ANSWERS }, caller);
    return NextResponse.json({ ...outcome, configured: Boolean(caller) });
  }

  const allowed = await requireCapability("clients.reply");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const [client] = await loadStaffClients(reader, { clientId: parsed.data.clientId });
    if (!client) return NextResponse.json({ error: "Este cliente no está entre los tuyos." }, { status: 404 });
    const outcome = await draftReply({ client, role: allowed.member.role, now, savedAnswers: await loadApprovedAnswers(allowed.db) }, caller);
    return NextResponse.json({ ...outcome, configured: Boolean(caller) });
  } catch (error) {
    await reportError(error, { where: "api/staff/drafts", userId: allowed.member.userId });
    return NextResponse.json({ error: "No se pudo preparar el borrador." }, { status: 500 });
  }
}
