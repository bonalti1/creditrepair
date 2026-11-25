import { NextResponse } from "next/server";
import { z } from "zod";
import { currentOptOut } from "@/lib/autopilot/optout";
import { notificationSettingsFromRow } from "@/lib/fulfillment/rows";
import { DEFAULT_NOTIFICATION_SETTINGS, settingsProblem } from "@/lib/fulfillment/notifications";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// The signed-in client's notification settings (Más → Avisos; migration 0041,
// docs/FULFILLMENT.md "Messages"). The user comes from the session, never
// from the request.
//
// GET   through the client's OWN connection: their settings (or the
//       defaults), whether they opted out of automatic messages (the same
//       message_opt_outs records BAJA / STOP and the email link write), and
//       whether their account has an email.
// POST  {action: "save", whatsapp, email, reminders, updates}: at least one
//         channel (the database refuses none). Each save is also kept in
//         notification_setting_changes.
//       {action: "stop_all"}: an opt-out record, like replying STOP
//         (channel "app"); every automatic message stops, queued ones are
//         closed by the next autopilot run.
//       {action: "start_again"}: an opt-in record, like replying START.
// Written with the service role after the session check.

type Row = Record<string, unknown>;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), whatsapp: z.boolean(), email: z.boolean(), reminders: z.boolean(), updates: z.boolean() }).strict(),
  z.object({ action: z.literal("stop_all") }).strict(),
  z.object({ action: z.literal("start_again") }).strict(),
]);

export async function GET(req: Request) {
  const limited = rateLimit(req, "notifications-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const [settings, optOuts] = await Promise.all([
      reader.from("notification_settings").select("*").eq("user_id", user.id).maybeSingle(),
      reader.from("message_opt_outs").select("kind, channel, keyword, at").eq("user_id", user.id),
    ]);
    const records = ((optOuts.data as Row[] | null) ?? []).map((r) => ({ kind: r.kind === "opt_in" ? ("opt_in" as const) : ("opt_out" as const), at: String(r.at), keyword: String(r.keyword ?? "") }));
    const opted = currentOptOut(records);
    return NextResponse.json({
      settings: notificationSettingsFromRow(settings.data as Row | null) ?? DEFAULT_NOTIFICATION_SETTINGS,
      optedOutAt: opted?.at ?? null,
      optedOutKeyword: opted?.keyword ?? null,
      hasEmail: Boolean(user.email),
    });
  } catch (error) {
    await reportError(error, { where: "api/notifications:read", userId: user.id });
    return NextResponse.json({ error: "Could not read your settings." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "notifications", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const db = getAdminClient();
  if (!db || !(await getServerSupabase())) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const input = parsed.data;
  try {
    if (input.action === "save") {
      if (settingsProblem(input)) return NextResponse.json({ error: "Keep at least one channel.", code: "no_channel" }, { status: 400 });
      const at = new Date().toISOString();
      const row = { user_id: user.id, whatsapp: input.whatsapp, email: input.email, reminders: input.reminders, updates: input.updates, updated_at: at, updated_by: "client" };
      const { error } = await db.from("notification_settings").upsert(row, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      const { error: logError } = await db.from("notification_setting_changes").insert({
        user_id: user.id,
        whatsapp: input.whatsapp,
        email: input.email,
        reminders: input.reminders,
        updates: input.updates,
        by_kind: "client",
        by_user: user.id,
        at,
      });
      if (logError) throw new Error(logError.message);
      return NextResponse.json({ ok: true, settings: notificationSettingsFromRow(row) });
    }
    const kind = input.action === "stop_all" ? "opt_out" : "opt_in";
    const { error } = await db.from("message_opt_outs").insert({ user_id: user.id, kind, channel: "app", keyword: kind === "opt_out" ? "APP STOP" : "APP START" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, optedOut: kind === "opt_out" });
  } catch (error) {
    await reportError(error, { where: `api/notifications:${input.action}`, userId: user.id });
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
