import { NextResponse } from "next/server";
import { z } from "zod";
import { CONTENT_BUCKET } from "@/lib/content/assets";
import { contentBodySchema } from "@/lib/content/schemas";
import { ACTION_CAPABILITY, type ContentAction } from "@/lib/content/rules";
import {
  addResult,
  applyOnServer,
  assetFromRow,
  cancelSchedule,
  disconnect,
  loadConnectionViews,
  loadEvents,
  loadLeadTouches,
  loadPiece,
  loadPieces,
  loadPublishSettings,
  loadResults,
  loadSchedules,
  partnerMaterial,
  pieceFromRow,
  savePublishSettings,
  schedulePiece,
} from "@/lib/content/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { can, type Capability } from "@/lib/staff/permissions";
import { getServerSupabase } from "@/lib/supabase/server";

// /equipo/contenido on the database (src/lib/content, migration 0035).
//
// GET   The board (content.view: pieces, results, schedules, settings, the
//       leads' first touches for attribution; connections for content.publish),
//       or one piece with its history and short-lived links to its files
//       (?id=). Sales (content.share only) gets the approved partner material,
//       read through their own connection so the database's policy decides.
// POST  One action. The capability is checked first (ACTION_CAPABILITY and the
//       table below), then the same rules as the demo, then the database.

const EXTRA_CAPABILITY = {
  add_result: "content.edit",
  schedule: "content.edit",
  cancel_schedule: "content.edit",
  settings: "content.publish",
  disconnect: "content.publish",
} as const satisfies Record<string, Capability>;

function capabilityFor(action: z.infer<typeof contentBodySchema>["action"]): Capability {
  return action in EXTRA_CAPABILITY ? EXTRA_CAPABILITY[action as keyof typeof EXTRA_CAPABILITY] : ACTION_CAPABILITY[action as ContentAction["action"]];
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const view = await requireCapability("content.view");
  if (!view.ok) {
    // Sales: approved partner material only, read with their own connection (row level security).
    const share = await requireCapability("content.share");
    if (!share.ok) return view.response;
    const own = await getServerSupabase();
    if (!own) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
    const { data, error } = await own.from("content_pieces").select("*").limit(500);
    if (error) return NextResponse.json({ error: "Could not load." }, { status: 500 });
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const ids = rows.map((r) => String(r.id));
    const { data: assetRows } = ids.length ? await own.from("content_assets").select("*").in("piece_id", ids).is("removed_at", null) : { data: [] };
    const byPiece = new Map<string, ReturnType<typeof assetFromRow>[]>();
    for (const assetRow of (assetRows ?? []) as Array<Record<string, unknown>>) {
      byPiece.set(String(assetRow.piece_id), [...(byPiece.get(String(assetRow.piece_id)) ?? []), assetFromRow(assetRow)]);
    }
    const pieces = partnerMaterial(rows.map((row) => pieceFromRow(row, byPiece.get(String(row.id)) ?? [])));
    // Links to download the flyers: only for files the member's own connection could read.
    const fileUrls: Record<string, string> = {};
    for (const asset of pieces.flatMap((p) => p.assets)) {
      if (asset.kind !== "upload") continue;
      const { data: signed } = await share.db.storage.from(CONTENT_BUCKET).createSignedUrl(asset.ref, 3600);
      if (signed?.signedUrl) fileUrls[asset.id] = signed.signedUrl;
    }
    return NextResponse.json({ scope: "partner", pieces, fileUrls });
  }
  try {
    if (id) {
      if (!/^[a-z]{2}_[a-z0-9]{6,40}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      const loaded = await loadPiece(view.db, id);
      if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const [events, results, schedules] = await Promise.all([loadEvents(view.db, id), loadResults(view.db, id), loadSchedules(view.db, id)]);
      // Short-lived links to view the files (an hour); the bucket itself is private.
      const fileUrls: Record<string, string> = {};
      for (const asset of loaded.piece.assets) {
        if (asset.kind !== "upload") continue;
        const { data } = await view.db.storage.from(CONTENT_BUCKET).createSignedUrl(asset.ref, 3600);
        if (data?.signedUrl) fileUrls[asset.id] = data.signedUrl;
      }
      return NextResponse.json({ piece: loaded.piece, events, results, schedules, fileUrls });
    }
    const [pieces, results, schedules, settings, leads] = await Promise.all([
      loadPieces(view.db),
      loadResults(view.db),
      loadSchedules(view.db),
      loadPublishSettings(view.db),
      loadLeadTouches(view.db),
    ]);
    const connections = can(view.member.role, "content.publish") ? await loadConnectionViews(view.db) : null;
    // Download links for the approved partner material (the partner kit); other files get theirs on the piece's page.
    const fileUrls: Record<string, string> = {};
    for (const asset of partnerMaterial(pieces).flatMap((p) => p.assets)) {
      if (asset.kind !== "upload") continue;
      const { data } = await view.db.storage.from(CONTENT_BUCKET).createSignedUrl(asset.ref, 3600);
      if (data?.signedUrl) fileUrls[asset.id] = data.signedUrl;
    }
    return NextResponse.json({ scope: "team", pieces, results, schedules, settings, leads, connections, fileUrls });
  } catch (error) {
    await reportError(error, { where: "api/staff/content GET", userId: view.member.userId });
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-content", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 64_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = contentBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const allowed = await requireCapability(capabilityFor(input.action));
  if (!allowed.ok) return allowed.response;
  const actor = { userId: allowed.member.userId, handle: allowed.member.handle };
  try {
    switch (input.action) {
      case "add_result": {
        const result = await addResult(allowed.db, actor, input);
        return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not saved", code: result.code }, { status: result.code === "not_found" ? 404 : 422 });
      }
      case "schedule": {
        const result = await schedulePiece(allowed.db, actor, input);
        return result.ok ? NextResponse.json({ ok: true, schedule: result.schedule }) : NextResponse.json({ error: result.message.en, code: result.code, message: result.message }, { status: 422 });
      }
      case "cancel_schedule": {
        const result = await cancelSchedule(allowed.db, actor, input.scheduleId);
        return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Nothing to cancel", code: "not_live" }, { status: 409 });
      }
      case "settings":
        return NextResponse.json({ ok: true, settings: await savePublishSettings(allowed.db, actor, input) });
      case "disconnect":
        await disconnect(allowed.db, actor, input.provider);
        return NextResponse.json({ ok: true, connections: await loadConnectionViews(allowed.db) });
      default: {
        const result = await applyOnServer(allowed.db, actor, input as ContentAction);
        if (!result.ok) {
          const status = result.code === "not_found" ? 404 : result.code === "conflict" ? 409 : result.code === "db_error" ? 500 : 422;
          return NextResponse.json({ error: result.message.en, code: result.code, message: result.message }, { status });
        }
        return NextResponse.json({ ok: true, piece: result.piece });
      }
    }
  } catch (error) {
    await reportError(error, { where: "api/staff/content POST", userId: allowed.member.userId, extra: { action: input.action } });
    return NextResponse.json({ error: "Could not save it. Nothing changed." }, { status: 500 });
  }
}
