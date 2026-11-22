import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { PARTNER_TERMS_VERSION } from "@/lib/partners/copy";
import { checkPartnerApplication } from "@/lib/partners/rules";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";

// A partner application from the public /socios page. It becomes a PENDING
// partner (migration 0017) that an administrator approves on /equipo/socios.
// Nothing is granted here: no code, no link, no portal until approval.
//
// Public, so: rate limited per address, a small body, a hidden field that
// people never fill in (bots do), and the same answer whether or not the phone
// already applied, so the form tells nobody who is a partner.

const bodySchema = z.object({
  name: z.string().max(120),
  company: z.string().max(160).optional().nullable(),
  kind: z.string().max(30),
  phone: z.string().max(40),
  email: z.string().max(200).optional().nullable(),
  state: z.string().max(4).optional().nullable(),
  acceptsTerms: z.boolean(),
  /** The hidden field. */
  website: z.string().max(200).optional(),
});

async function tellTeam(name: string): Promise<void> {
  const url = process.env.TEAM_WEBHOOK_URL || process.env.SALES_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `Nueva solicitud de socio: ${name}. Revísala en /equipo/socios.` }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // The application is saved; a missed ping must not fail it.
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "partner-apply", { limit: 5, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ ok: true });

  const check = checkPartnerApplication(parsed.data);
  if (!check.ok) return NextResponse.json({ error: "Invalid", problems: check.problems }, { status: 422 });

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const now = new Date().toISOString();
  try {
    const { data, error } = await db
      .from("partners")
      .insert({
        name: check.value.name,
        company: check.value.company,
        kind: check.value.kind,
        phone_e164: check.value.phone,
        email: check.value.email,
        state: check.value.state,
        status: "pending",
        terms_version: PARTNER_TERMS_VERSION,
        terms_accepted_at: now,
      })
      .select("id")
      .single();
    // 23505: this phone already has an open application or partnership. Same answer.
    if (error && error.code !== "23505") throw new Error(error.message);
    if (data) {
      await db.from("team_audit").insert({ actor: null, kind: "partner_applied", detail: { partner: (data as { id: string }).id } });
      await tellTeam(check.value.name);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: "api/partners/apply" });
    return NextResponse.json({ error: "Could not save the application." }, { status: 500 });
  }
}
