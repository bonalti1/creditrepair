import { NextResponse } from "next/server";
import { z } from "zod";
import { callConsentHash, callsEnabled, CALL_TIME_ZONE, usPhone } from "@/lib/calls/config";
import { demoWindows } from "@/lib/calls/demo";
import { availableSlots, createBooking, runCallMessages } from "@/lib/calls/server";
import { openSlots, slotEnd, slotProblem } from "@/lib/calls/slots";
import { isCaseRef } from "@/lib/signup/caseRef";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// Booking a call with a person (migration 0032; docs/SIGNUP-CHAT.md). OFF by
// default: with NEXT_PUBLIC_CALLS_ENABLED unset this route answers 404 and
// nothing else about calls is shown anywhere.
//
//   GET   the free slots (times only: nothing about anyone else's booking).
//   POST  books one, with the person's explicit consent to be called at the
//         number they gave (TCPA). Written with the service role: the anon
//         key can neither read nor write bookings. Then the confirmation is
//         sent at once when it may be (WhatsApp or email, never SMS, under
//         opt-out and quiet hours); the hourly run sends the rest.
//
// The call is for questions only. Signing up and any payment happen
// afterwards, in writing, in the app (Telemarketing Sales Rule, 16 C.F.R.
// 310.4(a)(2)).

const off = () => NextResponse.json({ enabled: false, error: "Calls are not available." }, { status: 404 });

const bodySchema = z
  .object({
    windowId: z.string().min(1).max(80),
    start: z.string().datetime(),
    firstName: z.string().trim().min(1).max(60),
    phone: z.string().max(30),
    email: z.string().trim().max(120).email().nullable().optional(),
    confirmChannel: z.enum(["whatsapp", "email"]),
    locale: z.enum(["es", "en"]),
    timeZone: z.string().regex(/^[A-Za-z]+\/[A-Za-z_]+$/).max(40).optional(),
    state: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
    question: z.string().max(500).nullable().optional(),
    caseRef: z.string().max(12).nullable().optional(),
    consent: z.literal(true),
    consentTextHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export async function GET(req: Request) {
  if (!callsEnabled()) return off();
  const limited = rateLimit(req, "calls-slots", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const db = getAdminClient();
  const now = new Date();
  const user = db ? await getSessionUser() : null;
  try {
    const slots = db ? await availableSlots(db, now) : openSlots(demoWindows(now), [], now);
    return NextResponse.json({ enabled: true, live: Boolean(db), signedIn: Boolean(user), timeZone: CALL_TIME_ZONE, slots });
  } catch (error) {
    await reportError(error, { where: "api/calls GET" });
    return NextResponse.json({ enabled: true, live: true, signedIn: Boolean(user), timeZone: CALL_TIME_ZONE, slots: [] });
  }
}

export async function POST(req: Request) {
  if (!callsEnabled()) return off();
  const limited = rateLimit(req, "calls-book", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error), code: "invalid" }, { status: 400 });
  const input = parsed.data;
  const phone = usPhone(input.phone);
  if (!phone) return NextResponse.json({ error: "Please write a US cell phone number.", code: "phone" }, { status: 422 });
  if (input.confirmChannel === "email" && !input.email) return NextResponse.json({ error: "Please write your email.", code: "email" }, { status: 422 });
  if (input.consentTextHash !== callConsentHash(input.locale)) return NextResponse.json({ error: "The consent text changed. Reload the page.", code: "consent_changed" }, { status: 409 });

  const db = getAdminClient();
  const now = new Date();
  const timeZone = input.timeZone ?? CALL_TIME_ZONE;
  if (!db) {
    // The demo: checked like a real one, nothing stored, nothing sent.
    const windows = demoWindows(now);
    const problem = slotProblem({ windowId: input.windowId, start: input.start }, windows, [], now);
    if (problem) return NextResponse.json({ error: "That time is not available.", code: problem }, { status: 409 });
    const w = windows.find((x) => x.id === input.windowId)!;
    return NextResponse.json({ ok: true, live: false, booking: { slotStart: input.start, slotEnd: slotEnd(input.start, w.slotMinutes), timeZone, caseRef: input.caseRef ?? null } });
  }

  const user = await getSessionUser();
  try {
    const result = await createBooking(
      db,
      {
        windowId: input.windowId,
        start: input.start,
        firstName: input.firstName,
        phone,
        email: input.email ?? null,
        confirmChannel: input.confirmChannel,
        locale: input.locale,
        timeZone,
        state: input.state ?? null,
        question: input.question ?? null,
        caseRef: input.caseRef && isCaseRef(input.caseRef) ? input.caseRef : null,
        consent: true,
        consentTextHash: input.consentTextHash,
      },
      { userId: user?.id ?? null, ip: clientIp(req), userAgent: req.headers.get("user-agent") },
      now,
    );
    if (!result.ok) {
      const status = result.code === "consent_changed" ? 409 : result.code === "email_needs_account" ? 422 : 409;
      return NextResponse.json({ error: "That time could not be booked.", code: result.code }, { status });
    }
    // The confirmation, now if it may go (quiet hours and opt-outs apply); otherwise the hourly run sends it.
    await runCallMessages(db, now, { bookingIds: [result.booking.id] }).catch((error) => reportError(error, { where: "api/calls confirmation" }));
    const b = result.booking;
    return NextResponse.json({ ok: true, live: true, booking: { slotStart: b.slotStart, slotEnd: b.slotEnd, timeZone: b.timeZone, caseRef: b.caseRef } });
  } catch (error) {
    await reportError(error, { where: "api/calls POST" });
    return NextResponse.json({ error: "Could not book it. Nothing was saved." }, { status: 500 });
  }
}
