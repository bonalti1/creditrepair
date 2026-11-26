import { NextResponse } from "next/server";
import { z } from "zod";
import { publicPlans } from "@/lib/site/plans";
import { demoReviews } from "@/lib/live/demo";
import { parseKeywords } from "@/lib/live/keywords";
import { reviewNeedsYou } from "@/lib/live/review";
import {
  attachLeadFacts,
  confirmVideo,
  importReview,
  LIVE_VIDEOS_BUCKET,
  loadReviews,
  loadSendContext,
  purgeReview,
  readReview,
  sendVideo,
  videoUploadUrl,
} from "@/lib/live/server";
import { smsFunnelReady } from "@/lib/live/sms";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { isDemoMode } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";

// The review queue and the personal video (docs/LIVE-FUNNEL.md, /equipo/revisiones).
// reviews.video (administrators and specialists) for everything, and
// reports.import for «Import as the first report» (the existing import).
//
//   GET                the queue, read through the member's own connection
//                      (the read policies decide), with the approved plans'
//                      names and the funnel's settings (never a secret).
//   GET ?needs=1       how many reviews wait for a person (the red count).
//   GET ?play=<video>  a short-lived link to watch a recorded video.
//   GET ?send=<video>  what each channel can do for this lead now.
//   POST upload_url    a one-time signed upload link for a recording.
//   POST confirm_video the recording arrived: checked by its first bytes, recorded.
//   POST send          send the video's private link (WhatsApp, SMS when on, email, copy).
//   POST delete_video  remove a recording (the file and its link).
//   POST reread        read the report again (after a failed reading).
//   POST import        signed: the report becomes the case's first report.
//   POST delete_review the person asked: delete the report, the overview and the video now.
//
// Demo (no database): the sample queue; nothing is stored or sent.

const id = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("upload_url"), reviewId: id, mediaType: z.enum(["video/webm", "video/mp4"]), bytes: z.number().int().positive() }),
  z.object({ action: z.literal("confirm_video"), reviewId: id, videoId: id, path: z.string().max(200), duration: z.number().min(5).max(330) }),
  z.object({ action: z.literal("send"), videoId: id, channel: z.enum(["whatsapp", "sms", "email", "copy"]) }),
  z.object({ action: z.literal("delete_video"), videoId: id }),
  z.object({ action: z.literal("reread"), reviewId: id }),
  z.object({ action: z.literal("import"), reviewId: id }),
  z.object({ action: z.literal("delete_review"), reviewId: id }),
]);

const settings = () => ({ keywords: parseKeywords().map((k) => ({ word: k.word, campaign: k.campaign })), sms: smsFunnelReady() });

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-live", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const params = new URL(req.url).searchParams;
  const now = new Date();
  if (isDemoMode()) {
    const items = demoReviews(now);
    if (params.get("needs")) return NextResponse.json({ count: items.filter(reviewNeedsYou).length, demo: true });
    return NextResponse.json({ items, plans: [], demo: true, ...settings() });
  }
  const allowed = await requireCapability("reviews.video");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const play = params.get("play");
    if (play) {
      if (!id.safeParse(play).success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      const { data } = await reader.from("live_videos").select("storage_path, deleted_at").eq("id", play).maybeSingle();
      if (!data || data.deleted_at) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const { data: signed } = await allowed.db.storage.from(LIVE_VIDEOS_BUCKET).createSignedUrl(String(data.storage_path), 600);
      return NextResponse.json({ url: signed?.signedUrl ?? null }, { headers: { "cache-control": "no-store" } });
    }
    const send = params.get("send");
    if (send) {
      if (!id.safeParse(send).success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      const context = await loadSendContext(allowed.db, send, now);
      return context ? NextResponse.json({ options: context.options, locale: context.locale }) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const items = await attachLeadFacts(allowed.db, await loadReviews(reader));
    if (params.get("needs")) return NextResponse.json({ count: items.filter(reviewNeedsYou).length });
    const plans = (await publicPlans("en")).map((p) => p.name);
    return NextResponse.json({ items, plans, ...settings() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await reportError(error, { where: "api/staff/live:get", userId: allowed.member.userId });
    return NextResponse.json({ error: "The reviews couldn't be read." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-live-post", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true });
  const allowed = await requireCapability(input.action === "import" ? "reports.import" : "reviews.video");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  const now = new Date();
  try {
    switch (input.action) {
      case "upload_url": {
        const result = await videoUploadUrl(db, input);
        return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.code, code: result.code }, { status: result.status });
      }
      case "confirm_video": {
        const result = await confirmVideo(db, member, input, now);
        return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.code, code: result.code }, { status: result.status });
      }
      case "send": {
        const result = await sendVideo(db, member, { videoId: input.videoId, channel: input.channel, appUrl: process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin, now });
        return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.code, code: result.code }, { status: result.status });
      }
      case "delete_video": {
        const { data } = await db.from("live_videos").select("storage_path, deleted_at").eq("id", input.videoId).maybeSingle();
        if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!data.deleted_at) {
          await db.storage.from(LIVE_VIDEOS_BUCKET).remove([String(data.storage_path)]);
          await db.from("live_videos").update({ deleted_at: now.toISOString() }).eq("id", input.videoId);
        }
        return NextResponse.json({ ok: true });
      }
      case "reread": {
        await db.from("live_report_files").update({ status: "received" }).eq("review_id", input.reviewId).eq("status", "failed");
        const result = await readReview(db, input.reviewId, now);
        return NextResponse.json({ ok: true, ...result });
      }
      case "import": {
        const reader = await getServerSupabase();
        if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
        const result = await importReview(db, reader, member, input.reviewId, now);
        return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.code, code: result.code, message: result.message, problems: result.problems }, { status: result.status });
      }
      case "delete_review": {
        await purgeReview(db, input.reviewId, now);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    await reportError(error, { where: `api/staff/live:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "That didn't work. Nothing changed; try again." }, { status: 500 });
  }
}
