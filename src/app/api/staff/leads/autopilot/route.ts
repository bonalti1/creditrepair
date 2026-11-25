import { NextResponse } from "next/server";
import { z } from "zod";
import { availabilityFromEnv } from "@/lib/autopilot/channels";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { loadAutopilotSettings, recentAutoMessages, saveAutopilotSettings } from "@/lib/leads/inboxServer";
import { AUTOPILOT_LIMITS } from "@/lib/leads/types";
import { getServerSupabase } from "@/lib/supabase/server";

// The lead autopilot's switch (docs/CONTROL.md, "Autopilot for leads"). OFF
// by default. Read by whoever works leads; changed only by an administrator
// (autopilot.manage, from their own row). Every change is recorded with who,
// when and what (lead_autopilot_changes). Turning it on dates it: it never
// answers a message older than that.

const int = (range: readonly [number, number]) => z.number().int().min(range[0]).max(range[1]);
const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    replyDelaySeconds: int(AUTOPILOT_LIMITS.replyDelaySeconds).optional(),
    perLeadDailyCap: int(AUTOPILOT_LIMITS.perLeadDailyCap).optional(),
    dailyCap: int(AUTOPILOT_LIMITS.dailyCap).optional(),
    quietStartHour: int(AUTOPILOT_LIMITS.hour).optional(),
    quietEndHour: int(AUTOPILOT_LIMITS.hour).optional(),
    sendSignupLink: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "Nothing to change");

export async function GET() {
  const allowed = await requireCapability("leads.work");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const [settings, recent] = await Promise.all([loadAutopilotSettings(reader), recentAutoMessages(reader)]);
    return NextResponse.json({ settings, recent, whatsapp: availabilityFromEnv().whatsapp });
  } catch (error) {
    await reportError(error, { where: "api/staff/leads/autopilot:get", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the settings." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-leads-autopilot", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("autopilot.manage");
  if (!allowed.ok) return allowed.response;
  try {
    return NextResponse.json({ ok: true, settings: await saveAutopilotSettings(allowed.db, allowed.member, parsed.data, new Date()) });
  } catch (error) {
    await reportError(error, { where: "api/staff/leads/autopilot:post", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
