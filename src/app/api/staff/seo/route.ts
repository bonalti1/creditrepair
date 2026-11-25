import { NextResponse } from "next/server";
import { z } from "zod";
import { capabilityFor, newSeoId, type GuideAction } from "@/lib/seo/guides";
import { phraseProblem, PHRASE_PROBLEM_TEXT, targetOptions } from "@/lib/seo/keywords";
import { seoBodySchema } from "@/lib/seo/schemas";
import { defaultRange, grandTotal, totalsBy, validRange } from "@/lib/seo/search";
import { connectionView } from "@/lib/seo/searchConsole";
import { addStarterGuides, applyOnServer, forgetPublishedCache, loadGuideEvents, loadGuides, loadPhrases, loadSearchRows, loadSettings, saveLocalTick } from "@/lib/seo/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { can, type Capability } from "@/lib/staff/permissions";
import { seoNeeds } from "@/lib/seo/needs";

// /equipo/seo on the database (src/lib/seo, migration 0039).
//
// GET   seo.view. The department: guides, tracked phrases, the last site
//       health, the local ticks and whether Search Console is connected
//       (never a secret); ?id=<guide> adds that guide's history;
//       ?view=search&from=&to= the Search Console totals per page and per
//       query for those dates (from seo_search_rows, synced by the cron).
// POST  One action, its capability checked first (guides: GUIDE_ACTION_CAPABILITY;
//       publishing is seo.publish), then the same rules as the demo, then the database.

const EXTRA: Record<"add_starters" | "add_phrase" | "remove_phrase" | "local_tick", Capability> = {
  add_starters: "seo.edit",
  add_phrase: "seo.edit",
  remove_phrase: "seo.edit",
  local_tick: "seo.edit",
};

export async function GET(req: Request) {
  const allowed = await requireCapability("seo.view");
  if (!allowed.ok) return allowed.response;
  const url = new URL(req.url);
  const db = allowed.db;
  try {
    // The red count on the menu (navBadges.ts): numbers only.
    if (url.searchParams.get("view") === "needs") {
      const [guides, settings] = await Promise.all([loadGuides(db), loadSettings(db)]);
      return NextResponse.json(seoNeeds({ guides, health: settings.health, canPublish: can(allowed.member.role, "seo.publish"), canEdit: can(allowed.member.role, "seo.edit") }));
    }
    if (url.searchParams.get("view") === "search") {
      const range = validRange(url.searchParams.get("from"), url.searchParams.get("to")) ?? defaultRange(new Date());
      const connection = connectionView();
      const settings = await loadSettings(db);
      const rows = connection.connected ? await loadSearchRows(db, range) : [];
      return NextResponse.json({
        connection,
        range,
        syncedAt: settings.searchSyncedAt,
        syncError: settings.searchSyncError,
        total: grandTotal(rows),
        byPage: totalsBy(rows, "page").slice(0, 200),
        byQuery: totalsBy(rows, "query").slice(0, 500),
      });
    }
    const [guides, phrases, settings] = await Promise.all([loadGuides(db), loadPhrases(db), loadSettings(db)]);
    const id = url.searchParams.get("id");
    const events = id && /^gd_[a-z0-9_]{3,60}$/.test(id) ? await loadGuideEvents(db, id) : [];
    return NextResponse.json({ guides, phrases, health: settings.health, localTicks: settings.localTicks, connection: connectionView(), syncedAt: settings.searchSyncedAt, syncError: settings.searchSyncError, events });
  } catch (error) {
    await reportError(error, { where: "api/staff/seo GET", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-seo", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 260_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = seoBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const capability = input.action in EXTRA ? EXTRA[input.action as keyof typeof EXTRA] : capabilityFor(input as GuideAction);
  const allowed = await requireCapability(capability);
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  const actor = { userId: member.userId, handle: member.handle };
  const now = new Date();
  try {
    switch (input.action) {
      case "add_starters":
        return NextResponse.json({ ok: true, added: await addStarterGuides(db, actor, now) });
      case "add_phrase": {
        const [phrases, guides] = await Promise.all([loadPhrases(db), loadGuides(db)]);
        const problem = phraseProblem(input, phrases, targetOptions(guides).map((t) => t.path));
        if (problem) return NextResponse.json({ error: problem, message: PHRASE_PROBLEM_TEXT[problem] }, { status: 422 });
        const row = { id: newSeoId("kw"), phrase: input.phrase.replace(/\s+/g, " ").trim(), lang: input.lang, city: input.city, target_path: input.targetPath, note: (input.note ?? "").trim(), created_by: member.userId, created_by_handle: member.handle };
        const { error } = await db.from("seo_keywords").insert(row);
        if (error) return NextResponse.json({ error: "db_error", message: { en: "It could not be saved.", es: "No se pudo guardar." } }, { status: 422 });
        return NextResponse.json({ ok: true });
      }
      case "remove_phrase": {
        const { error } = await db.from("seo_keywords").update({ removed_at: now.toISOString() }).eq("id", input.phraseId);
        if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
        return NextResponse.json({ ok: true });
      }
      case "local_tick":
        return NextResponse.json({ ok: true, localTicks: await saveLocalTick(db, input.key, input.done, actor, now) });
      default: {
        // Archiving a live guide takes it off the site: an administrator's, like unpublishing.
        if (input.action === "archive") {
          const live = (await loadGuides(db)).find((g) => g.id === input.id)?.published;
          if (live) {
            const publisher = await requireCapability("seo.publish");
            if (!publisher.ok) return publisher.response;
          }
        }
        const result = await applyOnServer(db, actor, input as GuideAction, now);
        if (!result.ok) return NextResponse.json({ error: result.code, message: result.message }, { status: result.code === "conflict" ? 409 : result.code === "not_found" ? 404 : 422 });
        if (input.action === "publish" || input.action === "unpublish") forgetPublishedCache();
        return NextResponse.json({ ok: true, guide: result.guide });
      }
    }
  } catch (error) {
    await reportError(error, { where: "api/staff/seo POST", userId: member.userId, extra: { action: input.action } });
    return NextResponse.json({ error: "The change could not be saved. Nothing changed." }, { status: 500 });
  }
}
