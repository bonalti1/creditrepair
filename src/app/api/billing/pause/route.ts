import { NextResponse } from "next/server";
import { z } from "zod";
import { PAUSE_REASON_MIN_CHARS, pauseBodySchema } from "@/lib/billing/api";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffAccess, requireCapability } from "@/lib/staff/access";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// Staff only: stop automatic charges for one client, with a reason that is
// kept, or lift that pause. While a pause is open the system creates no charge
// and retries none (src/lib/billing/rules.ts). A pause charges nobody and
// changes no amount; it can only make the system charge less.

export async function POST(req: Request) {
  const limited = rateLimit(req, "billing-pause", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const access = await getStaffAccess();
  if (access === "demo") return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  if (access !== "allowed") return NextResponse.json({ error: "Staff only" }, { status: 403 });
  // Staff is not enough: the role decides, here on the server (only an administrator pauses or resumes billing; src/lib/staff/permissions.ts).
  const role = await requireCapability("billing.pause");
  if (!role.ok) return role.response;
  const staff = await getSessionUser();
  const db = getAdminClient();
  if (!db || !staff) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await readJsonBody(req, 3_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = pauseBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { userId, action } = parsed.data;
  // The record carries the member's own handle, from their staff record; a "by" sent by the browser is ignored.
  const by = role.member.handle;

  try {
    const now = new Date().toISOString();
    if (action === "resume") {
      const { error } = await db.from("billing_pauses").update({ lifted_at: now }).eq("user_id", userId).is("lifted_at", null);
      if (error) throw new Error(error.message);
      await db.from("events").insert({ user_id: userId, kind: "billing_resumed", payload: { by: staff.id } });
      return NextResponse.json({ ok: true, paused: false });
    }

    const reason = (parsed.data.reason ?? "").replace(/\s+/g, " ").trim();
    if (reason.length < PAUSE_REASON_MIN_CHARS) {
      return NextResponse.json({ error: "A reason is required.", code: "reason_required" }, { status: 422 });
    }
    const { data: open } = await db.from("billing_pauses").select("id").eq("user_id", userId).is("lifted_at", null).limit(1);
    if (open && open.length > 0) return NextResponse.json({ ok: true, paused: true });
    const { error } = await db.from("billing_pauses").insert({ user_id: userId, reason, paused_by: staff.id, paused_by_name: by });
    if (error) throw new Error(error.message);
    await db.from("events").insert({ user_id: userId, kind: "billing_paused", payload: { by: staff.id } });
    return NextResponse.json({ ok: true, paused: true });
  } catch (error) {
    await reportError(error, { where: "api/billing/pause", userId: staff.id });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
