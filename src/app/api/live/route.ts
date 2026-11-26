import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeAttribution } from "@/lib/ads/capture";
import { isStateCode } from "@/lib/compliance/states";
import { originFromParams } from "@/lib/live/keywords";
import { submitForm } from "@/lib/live/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/config";

// The /live form (docs/LIVE-FUNNEL.md, step 3): first name, a US WhatsApp
// number, an optional email, the state, the language, the goal, and the
// consents. Public, so: rate limited, the body capped and checked, only an
// opened state proceeds (Texas today; another state is told to use the
// waitlist; Georgia is refused), and never a Social Security number, a date
// of birth or a card number (there is no field for them).
//
// Answers a short-lived token for the report upload (/api/live/report). In
// the demo (no database) nothing is stored and the token is a demo one.

const bodySchema = z.object({
  firstName: z.string().trim().min(1).max(40),
  phone: z.string().min(7).max(30),
  email: z.string().trim().max(200).email().optional().nullable().or(z.literal("")),
  state: z.string().length(2),
  goal: z.enum(["mortgage", "auto", "card", "general"]),
  locale: z.enum(["en", "es"]),
  consentMessages: z.literal(true),
  consentReport: z.literal(true),
  consentSms: z.boolean().optional().default(false),
  origin: z.object({ src: z.string().max(80).nullable().optional(), kw: z.string().max(40).nullable().optional(), c: z.string().max(80).nullable().optional(), p: z.string().max(40).nullable().optional() }).optional(),
  attribution: z.unknown().optional(),
});

function usPhone(value: string): string | null {
  const digits = value.replace(/[^\d]/g, "");
  if (/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+${digits}`;
  if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  return null;
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "live-form", { limit: 8, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 6_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid", fields: Object.keys(z.flattenError(parsed.error).fieldErrors) }, { status: 400 });
  const input = parsed.data;
  const phone = usPhone(input.phone);
  if (!phone) return NextResponse.json({ error: "invalid", fields: ["phone"] }, { status: 400 });
  const state = input.state.toUpperCase();
  if (!isStateCode(state)) return NextResponse.json({ error: "invalid", fields: ["state"] }, { status: 400 });
  const firstName = input.firstName.replace(/[^\p{L}\s'-]/gu, "").replace(/\s+/g, " ").trim();
  if (firstName.length < 1) return NextResponse.json({ error: "invalid", fields: ["firstName"] }, { status: 400 });

  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true, uploadToken: "demo-token-not-stored-anywhere-0000" });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const o = input.origin ?? {};
  const origin = originFromParams({ get: (name: string) => (o as Record<string, string | null | undefined>)[name] ?? null });
  const attribution = sanitizeAttribution(input.attribution);
  try {
    const result = await submitForm(db, {
      firstName,
      phone,
      email: input.email ? input.email.toLowerCase() : null,
      state,
      goal: input.goal,
      locale: input.locale,
      consentMessages: input.consentMessages,
      consentReport: input.consentReport,
      consentSms: input.consentSms,
      origin,
      utm: (attribution?.utm as Record<string, string> | undefined) ?? null,
      ad: (attribution?.ad as Record<string, unknown> | undefined) ?? null,
      now: new Date(),
    });
    if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, uploadToken: result.uploadToken });
  } catch (error) {
    await reportError(error, { where: "api/live" });
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
