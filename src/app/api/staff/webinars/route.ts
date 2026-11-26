import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { can, type Capability } from "@/lib/staff/permissions";
import { getServerSupabase } from "@/lib/supabase/server";
import { matchAttendance, readAttendees } from "@/lib/webinars/attendance";
import { webinarCopyProblems } from "@/lib/webinars/check";
import {
  addCost,
  addPurchase,
  applyAttendance,
  loadCampaignsView,
  loadDetail,
  loadLive,
  loadRegistrations,
  loadSummaries,
  markAttended,
  saveCampaign,
  saveWebinar,
  setWebinarStatus,
  voidCost,
  voidPurchase,
} from "@/lib/webinars/server";
import { texasToIso } from "@/lib/webinars/time";
import { COST_KINDS, PURCHASE_KINDS, WEBINAR_LANGUAGES } from "@/lib/webinars/types";

// Webinars and the campaign scorecard (docs/WEBINARS.md).
//
//   GET                  the webinars with their counts. webinars.view.
//   GET ?id=<webinar>    one webinar: registrants (phones and emails only for
//                        leads.work), counters, reminders sent (administrators). webinars.view.
//   GET ?live=<webinar>  the live console: counters and the newest leads (first
//                        name and initial). webinars.view.
//   GET ?campaigns=1     campaigns, costs, purchases and each scorecard. campaigns.view.
//   POST save_webinar | publish | cancel | attendance (preview or import) |
//        mark_attended                                         webinars.manage
//   POST save_campaign | add_cost | void_cost | add_purchase | void_purchase   campaigns.view
//
// Reads go through the member's own connection (row level security);
// writes use the service role after the capability check.

const uuid = z.string().uuid();
const https = z.string().trim().max(500).regex(/^https:\/\/\S{4,}$/).nullable().optional();
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const webinarSchema = z
  .object({
    action: z.literal("save_webinar"),
    id: uuid.nullable().optional(),
    slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
    titleEn: z.string().trim().min(3).max(120),
    titleEs: z.string().trim().min(3).max(120),
    host: z.string().trim().min(2).max(80),
    day: dayKey,
    time: z.string().regex(/^\d{2}:\d{2}$/),
    durationMinutes: z.number().int().min(15).max(180),
    language: z.enum(WEBINAR_LANGUAGES),
    topic: z.string().max(300),
    campaignTag: z.string().regex(/^[a-z0-9_-]{2,40}$/).nullable().optional(),
    keyword: z.string().regex(/^[A-Za-z0-9]{2,20}$/),
    links: z.object({ zoom: https, facebook: https, youtube: https, instagram: https, tiktok: https }).strict(),
    replayUrl: https,
    campaignId: uuid.nullable().optional(),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [
  webinarSchema,
  z.object({ action: z.literal("publish"), id: uuid }).strict(),
  z.object({ action: z.literal("cancel"), id: uuid }).strict(),
  z.object({ action: z.literal("attendance"), id: uuid, csv: z.string().min(10).max(2_000_000), apply: z.boolean() }).strict(),
  z.object({ action: z.literal("mark_attended"), id: uuid, registrationId: uuid, attended: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("save_campaign"),
      id: uuid.nullable().optional(),
      name: z.string().trim().min(2).max(80),
      startDay: dayKey,
      endDay: dayKey,
      budgetCents: z.number().int().min(0).max(100_000_000).nullable(),
      metaCampaignIds: z.array(z.string().regex(/^\d{3,25}$/)).max(50),
      webinarIds: z.array(uuid).max(50),
      keywords: z.array(z.string().regex(/^[A-Za-z0-9]{2,20}$/)).max(20),
      organicSources: z.array(z.string().regex(/^[a-z0-9_.-]{2,40}$/i)).max(20),
      note: z.string().max(1000).nullable().optional(),
    })
    .strict(),
  z.object({ action: z.literal("add_cost"), campaignId: uuid, label: z.string().trim().min(2).max(120), kind: z.enum(COST_KINDS), amountCents: z.number().int().min(1).max(100_000_000), day: dayKey }).strict(),
  z.object({ action: z.literal("void_cost"), id: uuid }).strict(),
  z.object({ action: z.literal("add_purchase"), clientId: uuid, kind: z.enum(PURCHASE_KINDS), amountCents: z.number().int().min(0).max(100_000_000).nullable(), day: dayKey, note: z.string().max(300).nullable().optional() }).strict(),
  z.object({ action: z.literal("void_purchase"), id: uuid }).strict(),
]);

type Action = z.infer<typeof bodySchema>["action"];
const CAPABILITY: Record<Action, Capability> = {
  save_webinar: "webinars.manage",
  publish: "webinars.manage",
  cancel: "webinars.manage",
  attendance: "webinars.manage",
  mark_attended: "webinars.manage",
  save_campaign: "campaigns.view",
  add_cost: "campaigns.view",
  void_cost: "campaigns.view",
  add_purchase: "campaigns.view",
  void_purchase: "campaigns.view",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const campaigns = url.searchParams.get("campaigns") === "1";
  const allowed = await requireCapability(campaigns ? "campaigns.view" : "webinars.view");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const { db, member } = allowed;
  const now = new Date();
  const contact = can(member.role, "leads.work");
  try {
    if (campaigns) return NextResponse.json(await loadCampaignsView(reader, now));
    const id = url.searchParams.get("id");
    if (id) {
      const detail = await loadDetail(reader, db, id, { contact, admin: member.role === "admin" }, now);
      return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const live = url.searchParams.get("live");
    if (live) {
      const view = await loadLive(reader, db, live, { contact }, now);
      return view ? NextResponse.json(view) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ webinars: await loadSummaries(reader, db, contact, now), sample: false });
  } catch (error) {
    await reportError(error, { where: "api/staff/webinars:get", userId: member.userId });
    return NextResponse.json({ error: "The webinars could not be read right now." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-webinars", { limit: 120, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_100_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const allowed = await requireCapability(CAPABILITY[input.action]);
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  const actor = { userId: member.userId, name: member.name };
  try {
    switch (input.action) {
      case "save_webinar": {
        const startsAt = texasToIso(input.day, input.time);
        if (!startsAt) return NextResponse.json({ error: "Not a date", code: "date" }, { status: 400 });
        // The public words pass the same rules as the website, again here.
        const problems = [input.titleEn, input.titleEs, input.topic].flatMap((t) => webinarCopyProblems(t));
        if (problems.length > 0) return NextResponse.json({ error: "The words break a rule.", code: "copy_rules", problems: [...new Set(problems)] }, { status: 422 });
        const saved = await saveWebinar(
          db,
          {
            slug: input.slug,
            titleEn: input.titleEn,
            titleEs: input.titleEs,
            host: input.host,
            startsAt,
            durationMinutes: input.durationMinutes,
            language: input.language,
            topic: input.topic,
            campaignTag: input.campaignTag ?? null,
            keyword: input.keyword.toUpperCase(),
            links: input.links,
            replayUrl: input.replayUrl ?? null,
            campaignId: input.campaignId ?? null,
          },
          actor,
          input.id ?? null,
        );
        return saved.ok ? NextResponse.json({ ok: true, webinar: saved.value }) : NextResponse.json({ error: saved.code, code: saved.code }, { status: saved.status });
      }
      case "publish":
      case "cancel": {
        const result = await setWebinarStatus(db, input.id, input.action === "publish" ? "published" : "cancelled", actor);
        return result.ok ? NextResponse.json({ ok: true, webinar: result.value }) : NextResponse.json({ error: result.code, code: result.code }, { status: result.status });
      }
      case "attendance": {
        const read = readAttendees(input.csv);
        if (!read.ok) return NextResponse.json({ error: "The file has no attendee list.", code: read.reason }, { status: 422 });
        const plan = matchAttendance(read.attendees, await loadRegistrations(db, [input.id]));
        if (!input.apply) return NextResponse.json({ ok: true, attendees: read.attendees.length, matched: plan.matches.length, unmatched: plan.unmatched.length });
        const saved = await applyAttendance(db, input.id, plan.matches, actor);
        return NextResponse.json({ ok: true, attendees: read.attendees.length, matched: saved, unmatched: plan.unmatched.length });
      }
      case "mark_attended":
        return (await markAttended(db, input.id, input.registrationId, input.attended, actor)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      case "save_campaign": {
        if (input.endDay < input.startDay) return NextResponse.json({ error: "The end is before the start.", code: "dates" }, { status: 400 });
        const saved = await saveCampaign(db, { ...input, note: input.note ?? null }, actor, input.id ?? null);
        return saved.ok ? NextResponse.json({ ok: true, id: saved.value.id }) : NextResponse.json({ error: saved.code }, { status: saved.status });
      }
      case "add_cost":
        await addCost(db, input, actor);
        return NextResponse.json({ ok: true });
      case "void_cost":
        return (await voidCost(db, input.id, actor)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      case "add_purchase":
        await addPurchase(db, { ...input, note: input.note ?? null }, actor);
        return NextResponse.json({ ok: true });
      case "void_purchase":
        return (await voidPurchase(db, input.id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } catch (error) {
    await reportError(error, { where: `api/staff/webinars:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "That could not be saved right now." }, { status: 500 });
  }
}
