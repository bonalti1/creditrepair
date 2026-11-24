import { NextResponse } from "next/server";
import { z } from "zod";
import { callsEnabled } from "@/lib/calls/config";
import { addWindow, closeBooking, loadBookings, loadWindows, removeWindow } from "@/lib/calls/server";
import { SLOT_MINUTES } from "@/lib/calls/slots";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { getServerSupabase } from "@/lib/supabase/server";

// /equipo/llamadas on the database (migration 0032): when the team takes
// calls, and the calls booked. A member with "calls.manage" (administrators
// and sales) adds or removes call hours and closes a booking (done, not
// answered, cancelled). Bookings are read through the member's own
// connection, so the database's scopes decide whom they see. Calls are off
// by default: with NEXT_PUBLIC_CALLS_ENABLED unset this route answers 404.

const off = () => NextResponse.json({ error: "Calls are not turned on." }, { status: 404 });

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add_window"),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      from: z.string().regex(/^\d{1,2}:\d{2}$/),
      to: z.string().regex(/^\d{1,2}:\d{2}$/),
      slotMinutes: z.number().int().refine((n) => (SLOT_MINUTES as readonly number[]).includes(n)),
      timeZone: z.string().regex(/^[A-Za-z]+\/[A-Za-z_]+$/).max(40),
    })
    .strict(),
  z.object({ action: z.literal("remove_window"), windowId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("close_booking"),
      bookingId: z.string().uuid(),
      outcome: z.enum(["completed", "no_answer", "cancelled"]),
      note: z.string().max(500).nullable().optional(),
    })
    .strict(),
]);

export async function GET() {
  if (!callsEnabled()) return off();
  const allowed = await requireCapability("calls.manage");
  if (!allowed.ok) return allowed.response;
  try {
    const reader = (await getServerSupabase()) ?? allowed.db;
    const [windows, bookings] = await Promise.all([loadWindows(allowed.db, { from: new Date(Date.now() - 24 * 3_600_000) }), loadBookings(reader)]);
    return NextResponse.json({ windows, bookings });
  } catch (error) {
    await reportError(error, { where: "api/staff/calls GET", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!callsEnabled()) return off();
  const limited = rateLimit(req, "staff-calls", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 3_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("calls.manage");
  if (!allowed.ok) return allowed.response;
  const by = { userId: allowed.member.userId, name: allowed.member.name };
  const input = parsed.data;
  try {
    if (input.action === "add_window") {
      const result = await addWindow(allowed.db, input, by);
      if (!result.ok) return NextResponse.json({ error: "Those hours cannot be added.", problems: result.problems }, { status: 422 });
      return NextResponse.json({ ok: true, window: result.window });
    }
    if (input.action === "remove_window") {
      const removed = await removeWindow(allowed.db, input.windowId, by);
      return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found, or already removed." }, { status: 404 });
    }
    // Closing a booking: only one this member may see (read through their own connection first).
    const reader = (await getServerSupabase()) ?? allowed.db;
    const { data: visible } = await reader.from("call_bookings").select("id").eq("id", input.bookingId).maybeSingle();
    if (!visible) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const closed = await closeBooking(allowed.db, input.bookingId, input.outcome, by, input.note ?? null);
    return closed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Already closed." }, { status: 409 });
  } catch (error) {
    await reportError(error, { where: "api/staff/calls POST", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed." }, { status: 500 });
  }
}
