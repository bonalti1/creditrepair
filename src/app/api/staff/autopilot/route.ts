import { NextResponse } from "next/server";
import { z } from "zod";
import { autopilotBodySchema } from "@/lib/autopilot/api";
import { availabilityFromEnv, channelGaps } from "@/lib/autopilot/channels";
import { loadAutopilotSettings, placeHold, recordOptChange, releaseHold, saveAutopilotSettings } from "@/lib/autopilot/store";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffMember, requireCapability } from "@/lib/staff/access";
import { memberCanSee } from "@/lib/staff/actions";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";

// The autopilot for the console: its switches (read by every member, changed
// by an administrator), holds, and an opt-out a client said out loud. The role
// is checked here from the caller's own row; whether they may see the client
// through their own connection (migration 0012's read policies). Writes use
// the service role (src/lib/autopilot/store.ts).

const CAPABILITY = {
  settings: "autopilot.manage",
  hold: "rounds.send",
  release: "rounds.send",
  opt_out: "clients.followup",
  opt_in: "clients.followup",
} as const;

export async function GET() {
  const db = getAdminClient();
  if (!db || !(await getServerSupabase())) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const member = await getStaffMember();
  if (!member) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  const channels = availabilityFromEnv();
  // What is configured, never the values.
  return NextResponse.json({ settings: await loadAutopilotSettings(db), channels, gaps: channelGaps() });
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-autopilot", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 10_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = autopilotBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;

  const allowed = await requireCapability(CAPABILITY[input.action]);
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const by = { userId: member.userId, handle: member.handle };

  try {
    if (input.action === "settings") {
      const { action: _action, ...patch } = input;
      return NextResponse.json({ ok: true, settings: await saveAutopilotSettings(db, patch, by) });
    }
    const reader = await getServerSupabase();
    if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
    const scope = input.action === "hold" || input.action === "release" ? "case" : "client";
    if ((await memberCanSee(reader, input.clientId, scope)) !== "client") {
      return NextResponse.json({ error: "Este cliente no está entre los tuyos.", message: "Este cliente no está entre los tuyos." }, { status: 404 });
    }
    const result =
      input.action === "hold"
        ? await placeHold(db, input.clientId, input.reason, by)
        : input.action === "release"
          ? await releaseHold(db, input.clientId, by)
          : (await recordOptChange(db, { userId: input.clientId, kind: input.action, channel: "staff", keyword: "equipo", by }), { ok: true as const });
    if (!result.ok) return NextResponse.json({ error: result.message, message: result.message }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: `api/staff/autopilot:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
