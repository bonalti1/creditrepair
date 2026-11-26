import { NextResponse } from "next/server";
import { z } from "zod";
import { trackVideo, VIDEO_EVENTS } from "@/lib/live/server";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/config";

// What the person does on their private video page (/v/[token]): opened (the
// page ran in a browser, so a link preview does not count), watched (most of
// the video, or to the end), «Get started», «Chat with us». Public, token in
// the body, rate limited; only a live link counts. Facts only move forward.

const bodySchema = z.object({ token: z.string().min(20).max(64), event: z.enum(VIDEO_EVENTS) });

export async function POST(req: Request) {
  const limited = rateLimit(req, "live-video-event", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 1_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const ok = await trackVideo(db, parsed.data.token, parsed.data.event, new Date()).catch(() => false);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
