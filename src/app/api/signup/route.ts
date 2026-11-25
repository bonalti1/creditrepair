import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeAttribution } from "@/lib/ads/capture";
import { NO_SOFT_PULL, SOFT_PULL_CONSENT, softPullProvider } from "@/lib/credit/softPull";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { sha256Hex } from "@/lib/agreement/sha256";
import { newCaseRef } from "@/lib/signup/caseRef";
import { reportCounts, reportSummaryLines } from "@/lib/signup/reportSummary";
import { ownSignupCase, startSignupCase, updateSignupCase } from "@/lib/signup/server";
import { SIGNUP_STEPS } from "@/lib/signup/steps";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// The chat signup's record (signup_cases, migration 0032; docs/SIGNUP-CHAT.md).
//
//   POST {action: "start"}     a new case reference for this device, with a
//                              resume token (only its hash is stored). Public,
//                              rate-limited. In the demo: a reference, nothing stored.
//   POST {action: "progress"}  the step reached, the state, the language, "wants
//                              a person"; and, once signed in, the account link.
//                              Needs the token, or the account it is linked to.
//   POST {action: "soft_pull"} the instant report (src/lib/credit/softPull.ts).
//                              With no provider (the default) it answers 409.
//   GET                        the signed-in person's own signup, if any.
//
// Everything else the chat collects is written by the routes that already
// own it: the profile (/api/profile/onboarding), the documents
// (/api/intake/document), the address, the agreement (/api/agreement/*).

const stages = [...SIGNUP_STEPS, "done"] as [string, ...string[]];

const bodySchema = z.discriminatedUnion("action", [
  // `attribution`: an ad link's marketing tags (src/lib/ads/capture.ts), checked again by sanitizeAttribution.
  z.object({ action: z.literal("start"), locale: z.enum(["es", "en"]).optional(), attribution: z.unknown().optional() }).strict(),
  z
    .object({
      action: z.literal("progress"),
      caseRef: z.string().max(12),
      token: z.string().max(64).nullable().optional(),
      step: z.enum(stages).optional(),
      state: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
      locale: z.enum(["es", "en"]).optional(),
      wantsPerson: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("soft_pull"), consentVersion: z.string().max(40), locale: z.enum(["es", "en"]).optional() }).strict(),
]);

export async function GET() {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false, signup: null });
  try {
    return NextResponse.json({ authenticated: true, signup: await ownSignupCase(supabase, user.id), softPull: softPullProvider().id });
  } catch (error) {
    await reportError(error, { where: "api/signup GET", userId: user.id });
    return NextResponse.json({ authenticated: true, signup: null });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "signup-chat", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const db = getAdminClient();

  if (input.action === "start") {
    // A reference is shown from the first screen; starts are limited harder than the rest.
    const again = rateLimit(req, "signup-chat-start", { limit: 6, windowMs: 60_000 });
    if (again) return again;
    if (!db) return NextResponse.json({ caseRef: newCaseRef(), token: null, live: false });
    try {
      const started = await startSignupCase(db, { locale: input.locale ?? "en", attribution: sanitizeAttribution(input.attribution) });
      return NextResponse.json({ ...started, live: true });
    } catch (error) {
      await reportError(error, { where: "api/signup start" });
      return NextResponse.json({ error: "Could not start. Please try again." }, { status: 500 });
    }
  }

  const user = db ? await getSessionUser() : null;

  if (input.action === "soft_pull") {
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const provider = softPullProvider();
    if (provider.id === NO_SOFT_PULL.id) return NextResponse.json({ error: "No soft pull provider is connected.", code: "provider_none" }, { status: 409 });
    if (input.consentVersion !== SOFT_PULL_CONSENT.version) return NextResponse.json({ error: "The consent text changed.", code: "consent_changed" }, { status: 409 });
    const locale = input.locale ?? "en";
    try {
      const result = await provider.pull({
        userId: user.id,
        consent: { version: SOFT_PULL_CONSENT.version, textHash: sha256Hex(`${SOFT_PULL_CONSENT.version}\n${SOFT_PULL_CONSENT[locale]}`), at: new Date().toISOString() },
        locale,
      });
      if (!result.ok) return NextResponse.json({ error: "No report came back.", code: result.reason }, { status: 422 });
      // Counts only go back to the chat. Saving the report into the case is the
      // existing import's job, to be wired with the provider (docs/SIGNUP-CHAT.md).
      return NextResponse.json({ ok: true, lines: reportSummaryLines(reportCounts(result.report.items), locale) });
    } catch (error) {
      await reportError(error, { where: "api/signup soft_pull", userId: user.id });
      return NextResponse.json({ error: "The report could not be read." }, { status: 502 });
    }
  }

  if (!db) return NextResponse.json({ ok: true, live: false });
  try {
    const result = await updateSignupCase(
      db,
      { caseRef: input.caseRef, token: input.token ?? null, step: input.step as never, state: input.state, locale: input.locale, wantsPerson: input.wantsPerson },
      user?.id ?? null,
    );
    if (!result.ok) return NextResponse.json({ error: "That signup was not found.", code: result.code }, { status: result.code === "not_found" ? 404 : 409 });
    return NextResponse.json({ ok: true, live: true, signup: result.signup });
  } catch (error) {
    await reportError(error, { where: "api/signup progress", userId: user?.id });
    return NextResponse.json({ error: "Could not save your progress." }, { status: 500 });
  }
}
