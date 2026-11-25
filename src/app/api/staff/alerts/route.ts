import { NextResponse } from "next/server";
import { z } from "zod";
import { ALERT_TOPICS, DEFAULT_WAITING_MINUTES, topicsFor, WAITING_MINUTES_RANGE } from "@/lib/control/alerts";
import { deliverAlerts, loadAlertMembers, loadAlertPrefs, saveAlertPref, takePendingAlerts } from "@/lib/control/alertsServer";
import { reportError } from "@/lib/observability/errors";
import { allowedEndpoint, pushConfig } from "@/lib/push/webPush";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { getServerSupabase } from "@/lib/supabase/server";

// A member's own phone alerts (docs/CONTROL.md, "Phone alerts"). Off until
// they turn a topic on; only the topics about their role's work. Everything
// here is about the signed-in member and nobody else: there is no field for
// whose alerts these are.
//
// GET: their topics, whether push is configured (the VAPID public key the
// browser subscribes with), their recent alerts. GET ?pending=1: what the
// service worker shows after a push (and marks shown).
// POST: a topic on or off, a browser subscribed or removed, a test alert.

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("topic"),
      topic: z.enum(ALERT_TOPICS),
      enabled: z.boolean(),
      waitingMinutes: z.number().int().min(WAITING_MINUTES_RANGE[0]).max(WAITING_MINUTES_RANGE[1]).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("subscribe"),
      endpoint: z.string().url().max(1000),
      keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }).strict(),
    })
    .strict(),
  z.object({ action: z.literal("unsubscribe"), endpoint: z.string().max(1000) }).strict(),
  z.object({ action: z.literal("test") }).strict(),
]);

export async function GET(req: Request) {
  const allowed = await requireCapability("clients.followup");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const now = new Date();
    if (new URL(req.url).searchParams.get("pending") === "1") return NextResponse.json({ alerts: await takePendingAlerts(db, member.userId, now) });
    const [prefs, recent, subs] = await Promise.all([
      loadAlertPrefs(reader, member.userId),
      reader.from("staff_alerts").select("id, topic, title, body, url, created_at, pushed_at").eq("user_id", member.userId).order("created_at", { ascending: false }).limit(20),
      reader.from("staff_push_subscriptions").select("id").eq("user_id", member.userId).is("revoked_at", null),
    ]);
    const config = pushConfig();
    return NextResponse.json({
      prefs,
      topics: topicsFor(member.role),
      push: { configured: Boolean(config), publicKey: config?.publicKey ?? null, devices: (subs.data ?? []).length },
      recent: recent.data ?? [],
    });
  } catch (error) {
    await reportError(error, { where: "api/staff/alerts:get", userId: member.userId });
    return NextResponse.json({ error: "Could not read your alerts." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-alerts", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("clients.followup");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const input = parsed.data;
  const now = new Date();
  try {
    switch (input.action) {
      case "topic": {
        if (!topicsFor(member.role).includes(input.topic)) return NextResponse.json({ error: "Not a topic for your role" }, { status: 403 });
        await saveAlertPref(db, member.userId, input.topic, { enabled: input.enabled, waitingMinutes: input.waitingMinutes ?? DEFAULT_WAITING_MINUTES }, now);
        return NextResponse.json({ ok: true });
      }
      case "subscribe": {
        // Only a browser vendor's push service: a stored address can never make the server call anywhere else.
        if (!allowedEndpoint(input.endpoint)) return NextResponse.json({ error: "Not a push service address" }, { status: 400 });
        await db.from("staff_push_subscriptions").delete().eq("endpoint", input.endpoint);
        const { error } = await db.from("staff_push_subscriptions").insert({
          user_id: member.userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
        });
        if (error) throw new Error(`staff_push_subscriptions: ${error.message}`);
        return NextResponse.json({ ok: true });
      }
      case "unsubscribe": {
        await db.from("staff_push_subscriptions").update({ revoked_at: now.toISOString() }).eq("endpoint", input.endpoint).eq("user_id", member.userId);
        return NextResponse.json({ ok: true });
      }
      case "test": {
        const me = (await loadAlertMembers(db)).find((m) => m.userId === member.userId);
        if (!me) return NextResponse.json({ error: "Staff only" }, { status: 403 });
        const words = me.locale === "es" ? { title: "Prueba de Credalti", body: "Así se verán tus alertas." } : { title: "Credalti test", body: "This is how your alerts will look." };
        const result = await deliverAlerts(db, [{ member: me, topic: "test", key: `test:${now.getTime()}`, url: "/equipo/alertas", text: words }], now);
        return NextResponse.json({ ok: true, ...result, configured: Boolean(pushConfig()) });
      }
    }
  } catch (error) {
    await reportError(error, { where: `api/staff/alerts:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
