import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { REMINDERS_CONSENT } from "@/lib/webinars/publicCopy";
import { cleanRegistration, registerBodySchema } from "@/lib/webinars/register";
import { loadPublicWebinar, registerForWebinar } from "@/lib/webinars/server";
import { getAdminClient } from "@/lib/supabase/admin";

// The public webinar registration (/webinar/<slug>, docs/WEBINARS.md).
//
//   POST  a registration: name, WhatsApp, optional email, state, language,
//         goal, timeline, biggest question, the reminders consent (its
//         version is checked: a page with old words is refused), and an ad
//         link's marketing tags. Public, rate-limited, a strict schema.
//         Texas is served; other states register to learn (out_of_state);
//         Georgia is refused with the restricted explanation (422 "georgia").
//         The same number twice: "already registered", nothing duplicated.
//         In the demo (no database): checked, nothing stored.

export async function POST(req: Request) {
  const limited = rateLimit(req, "webinar-register", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = registerBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  if (input.remindersConsent && input.consentVersion !== REMINDERS_CONSENT.version) return NextResponse.json({ error: "The consent text changed.", code: "consent_changed" }, { status: 409 });
  const clean = cleanRegistration(input);
  if (!clean.ok) return NextResponse.json({ error: "Some answers need a fix.", code: clean.problems.includes("georgia") ? "georgia" : "invalid", problems: clean.problems }, { status: 422 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ ok: true, live: false, already: false, served: clean.value.served });
  try {
    const webinar = await loadPublicWebinar(db, input.slug);
    if (!webinar) return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });
    const result = await registerForWebinar(db, webinar, clean.value, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    if (!result.ok) return NextResponse.json({ error: "Registration is closed.", code: result.code }, { status: 409 });
    return NextResponse.json({ ok: true, live: true, already: result.already, served: clean.value.served });
  } catch (error) {
    await reportError(error, { where: "api/webinars register" });
    return NextResponse.json({ error: "Could not register. Please try again." }, { status: 500 });
  }
}
