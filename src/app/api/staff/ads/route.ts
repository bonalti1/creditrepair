import { NextResponse } from "next/server";
import { z } from "zod";
import { AD_COPY_LIMITS, AD_CTAS, AD_FORMATS, AD_GOALS, AD_LANGUAGES, checkAdDraft, draftAdCopy, type AdCopyOutput } from "@/lib/ads/copy";
import { adCopyCaller } from "@/lib/ads/copyModel";
import { metaAdsConfig, MetaAdsError, readVideo } from "@/lib/ads/meta";
import { loadAdsPayload, loadAdsSummary, loadBriefs, loadMonthlySpend, runAdsSync } from "@/lib/ads/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import type { Capability } from "@/lib/staff/permissions";
import { getServerSupabase } from "@/lib/supabase/server";

// The Ads Manager (docs/ADS.md). READ ONLY against Meta: nothing here creates,
// edits, pauses or pays for an ad.
//
//   GET                    the window's numbers (?preset=7|14|30|90, or
//                          ?preset=custom&since=&until=), the leads, the
//                          spend per month and the briefs. ads.view.
//   GET ?summary=1         the last 7 days in short (the menu's red circle). ads.view.
//   GET ?monthly=1         Meta's spend per month (Accounting's reconciliation card). ads.view.
//   GET ?briefs=1          the video briefs. ads.draft.
//   GET ?video=<ad id>     a video ad's playable file, read from Meta when a
//                          person taps play (links expire: never stored). ads.view.
//   POST {action:"draft"}  ad copy by Alti (AI), checked; nothing is saved. ads.draft.
//   POST {action:"brief"}  a video brief for Video Studio from a draft that
//                          passes every check. ads.draft.
//   POST {action:"sync"}   «Sync now»: the cron's read of Meta, at once. ads.view.
//
// Reads go through the member's own connection (row level security: the
// numbers are administrators'; the leads follow the lead inbox's policies).
// Writes (a brief, a sync) use the service role after the capability check.

const bi = (max: number) => z.object({ en: z.string().max(max), es: z.string().max(max) }).strict();
const copySchema = z
  .object({
    hooks: z.array(bi(200)).min(1).max(5),
    primaryText: bi(1200),
    headline: bi(80),
    description: bi(120),
    script: bi(1500),
    onScreen: bi(200),
    cta: z.enum(AD_CTAS),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("draft"),
      angle: z.string().trim().min(3).max(AD_COPY_LIMITS.angleMax),
      format: z.enum(AD_FORMATS),
      goal: z.enum(AD_GOALS),
      language: z.enum(AD_LANGUAGES),
      example: z.object({ headline: z.string().max(200), body: z.string().max(2000) }).strict().nullable().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("brief"),
      title: z.string().trim().min(2).max(120),
      format: z.enum(AD_FORMATS),
      goal: z.enum(AD_GOALS),
      language: z.enum(AD_LANGUAGES),
      sourceAdId: z.string().regex(/^\d{3,25}$/).nullable().optional(),
      copy: copySchema,
    })
    .strict(),
  z.object({ action: z.literal("sync") }).strict(),
]);

const CAPABILITY: Record<z.infer<typeof bodySchema>["action"], Capability> = { draft: "ads.draft", brief: "ads.draft", sync: "ads.view" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  // The briefs are the content team's (ads.draft); everything else is the numbers (ads.view).
  const briefsOnly = url.searchParams.get("briefs") === "1";
  const allowed = await requireCapability(briefsOnly ? "ads.draft" : "ads.view");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const now = new Date();
  try {
    if (briefsOnly) return NextResponse.json({ briefs: await loadBriefs(reader) });
    if (url.searchParams.get("monthly") === "1") {
      const since = `${new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 7)}-01`;
      return NextResponse.json({ monthly: await loadMonthlySpend(reader, since) });
    }
    const video = url.searchParams.get("video");
    if (video !== null) {
      if (!/^\d{3,25}$/.test(video)) return NextResponse.json({ error: "Not an ad" }, { status: 400 });
      const setup = metaAdsConfig(process.env);
      if (!setup.ok) return NextResponse.json({ src: null, poster: null, reason: "not_configured" });
      const { data } = await reader.from("ads_objects").select("creative").eq("id", video).eq("level", "ad").maybeSingle();
      const videoId = (data?.creative as { videoId?: unknown } | undefined)?.videoId;
      if (typeof videoId !== "string") return NextResponse.json({ src: null, poster: null, reason: "not_a_video" });
      try {
        return NextResponse.json({ ...(await readVideo(setup.config, fetch, videoId)), reason: null });
      } catch (error) {
        return NextResponse.json({ src: null, poster: null, reason: error instanceof MetaAdsError && error.kind === "auth" ? "no_permission" : "meta_error" });
      }
    }
    if (url.searchParams.get("summary") === "1") return NextResponse.json({ summary: await loadAdsSummary(reader, now, process.env) });
    const input = { preset: url.searchParams.get("preset") ?? undefined, since: url.searchParams.get("since") ?? undefined, until: url.searchParams.get("until") ?? undefined };
    return NextResponse.json(await loadAdsPayload(reader, input, now, process.env));
  } catch (error) {
    await reportError(error, { where: "api/staff/ads:get", userId: allowed.member.userId });
    return NextResponse.json({ error: "The ads could not be read right now." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-ads", { limit: 40, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 16_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const allowed = await requireCapability(CAPABILITY[input.action]);
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  try {
    if (input.action === "draft") {
      const request = { angle: input.angle, format: input.format, goal: input.goal, language: input.language, example: input.example ?? null };
      try {
        return NextResponse.json(await draftAdCopy(request, adCopyCaller()));
      } catch (error) {
        await reportError(error, { where: "api/staff/ads:draft", userId: member.userId });
        return NextResponse.json(await draftAdCopy(request, null));
      }
    }
    if (input.action === "brief") {
      const copy: AdCopyOutput = input.copy;
      // The same check again, on the exact words: a brief is never made from words that break a rule.
      const blocking = checkAdDraft(copy, input.language).filter((i) => i.severity === "block");
      if (blocking.length > 0) {
        return NextResponse.json(
          { error: "The draft breaks a rule.", code: "blocking_issues", issues: blocking.map((i) => i.rule), message: { en: "Fix what the check marks before sending it to Video Studio.", es: "Corrige lo que marca la revisión antes de mandarlo a Video Studio." } },
          { status: 422 },
        );
      }
      const { data, error } = await db
        .from("ads_briefs")
        .insert({ created_by: member.userId, created_by_handle: member.handle, title: input.title, source_ad_id: input.sourceAdId ?? null, format: input.format, goal: input.goal, language: input.language, copy, ai_draft: true, blocking_issues: 0 })
        .select("id, created_at, title, status")
        .single();
      if (error || !data) throw new Error(`ads_briefs: ${error?.message ?? "no row"}`);
      return NextResponse.json({ ok: true, brief: { id: String(data.id), createdAt: String(data.created_at), title: String(data.title), status: String(data.status) } });
    }
    // «Sync now»: at most a few times an hour, on top of the cron.
    const again = rateLimit(req, "staff-ads-sync", { limit: 6, windowMs: 60 * 60_000 });
    if (again) return again;
    const outcome = await runAdsSync(db, new Date(), { http: fetch, env: process.env, by: member.handle });
    return NextResponse.json(outcome, { status: outcome.ok || outcome.missing ? 200 : 502 });
  } catch (error) {
    await reportError(error, { where: `api/staff/ads:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "It could not be done right now." }, { status: 500 });
  }
}
