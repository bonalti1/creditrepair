import { NextResponse } from "next/server";
import { z } from "zod";
import { MANUAL_ITEMS } from "@/lib/launch/checklist";
import { PROBE_SERVICES } from "@/lib/launch/probes";
import { checkService, loadLaunch, recordTick } from "@/lib/launch/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// Launch readiness (/equipo/lanzamiento, docs/LAUNCH.md): administrators only
// (requireCapability("launch")).
//
//   GET   the checklist with every item's status and the summary, and the
//         system health view. Never a secret's value, length or prefix: only
//         set / not set, "test" / "live", yes / no and times.
//   POST  tick or untick an item the software cannot detect (who and when are
//         recorded), or «Check now» one service: one harmless read, at most
//         once a minute per service and a few a minute per person.

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("tick"),
      item: z.string().refine((key) => MANUAL_ITEMS.includes(key)),
      done: z.boolean(),
      note: z.string().trim().max(300).optional(),
    })
    .strict(),
  z.object({ action: z.literal("probe"), service: z.enum(PROBE_SERVICES as [string, ...string[]]) }).strict(),
]);

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-launch-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("launch");
  if (!allowed.ok) return allowed.response;
  try {
    return NextResponse.json(await loadLaunch(allowed.db, new Date()));
  } catch (error) {
    await reportError(error, { where: "api/staff/launch:read", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read launch readiness." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-launch", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error), code: "invalid" }, { status: 400 });
  const allowed = await requireCapability("launch");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const input = parsed.data;
  try {
    if (input.action === "tick") {
      const result = await recordTick(db, member, input.item, input.done, input.note?.replace(/<[^>]*>/g, "") || null);
      return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, code: result.code }, { status: result.status });
    }
    const slow = rateLimit(req, "staff-launch-probe", { limit: 6, windowMs: 60_000, subject: member.userId });
    if (slow) return slow;
    const result = await checkService(db, member, input.service as (typeof PROBE_SERVICES)[number], new Date());
    return result.ok ? NextResponse.json({ ok: true, outcome: result.outcome }) : NextResponse.json({ ok: false, code: result.code }, { status: result.status });
  } catch (error) {
    // Only where and which service: never a key or a provider's answer.
    await reportError(error, { where: `api/staff/launch:${input.action}`, userId: member.userId, extra: input.action === "probe" ? { service: input.service } : undefined });
    return NextResponse.json({ error: "Could not save it.", code: "error" }, { status: 500 });
  }
}
