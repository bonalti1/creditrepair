import { NextResponse } from "next/server";
import { z } from "zod";
import { ASSET_LIMITS, assetLinkProblem, assetPath, checkAsset, CONTENT_BUCKET, isAssetType } from "@/lib/content/assets";
import { newContentId } from "@/lib/content/rules";
import { assetBodySchema } from "@/lib/content/schemas";
import { applyOnServer, loadPiece } from "@/lib/content/server";
import type { ContentAsset } from "@/lib/content/types";
import { readUpload, storeFile } from "@/lib/intake/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// Files and links for a content piece (src/lib/content/assets.ts). content.edit.
//
//   multipart/form-data (field "file", field "id", optional "altText"):
//     a picture or a PDF, up to 20 MB, through the server: its first bytes
//     decide the type, then it is kept in the private bucket and recorded.
//   JSON {action: "upload_url"}: a video (up to 500 MB) is too large to pass
//     through the server, so this hands back a one-time signed upload link for
//     one path. Then JSON {action: "confirm"}: the server reads the file's
//     first bytes from storage; a file that is not a video is deleted.
//   JSON {action: "link"}: an https link (Canva, Drive, CapCut) instead of a file.
//
// Every file changes what would be published, so an approved piece goes back
// to review (rules.ts and the database trigger).

async function attach(allowed: Extract<Awaited<ReturnType<typeof requireCapability>>, { ok: true }>, pieceId: string, asset: ContentAsset) {
  const result = await applyOnServer(allowed.db, { userId: allowed.member.userId, handle: allowed.member.handle }, { action: "add_asset", id: pieceId, asset });
  if (!result.ok) {
    return NextResponse.json({ error: result.message.en, code: result.code, message: result.message }, { status: result.code === "not_found" ? 404 : result.code === "conflict" ? 409 : 422 });
  }
  return NextResponse.json({ ok: true, piece: result.piece, asset });
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-content-assets", { limit: 40, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("content.edit");
  if (!allowed.ok) return allowed.response;
  const handle = allowed.member.handle;
  const now = new Date().toISOString();

  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const upload = await readUpload(req, ASSET_LIMITS.imageBytes);
      if (!upload.ok) return NextResponse.json({ error: upload.status === 413 ? "too_large" : "no_file", code: upload.status === 413 ? "too_large" : "empty" }, { status: upload.status });
      const pieceId = upload.fields.id ?? "";
      if (!/^[a-z]{2}_[a-z0-9]{6,40}$/.test(pieceId)) return NextResponse.json({ error: "Invalid piece" }, { status: 400 });
      const check = checkAsset(upload.bytes.subarray(0, 64), upload.bytes.length);
      if (!check.ok) return NextResponse.json({ error: check.code, code: check.code }, { status: check.status });
      if (check.mediaType.startsWith("video/")) return NextResponse.json({ error: "Videos use the upload link", code: "use_upload_url" }, { status: 415 });
      const loaded = await loadPiece(allowed.db, pieceId);
      if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (loaded.piece.assets.length >= ASSET_LIMITS.perPiece) return NextResponse.json({ error: "too_many", code: "too_many" }, { status: 422 });
      const assetId = newContentId("as");
      const path = assetPath(pieceId, assetId, check.extension);
      await storeFile(allowed.db, CONTENT_BUCKET, path, upload.bytes, check.mediaType);
      return attach(allowed, pieceId, {
        id: assetId,
        kind: "upload",
        ref: path,
        name: (upload.fileName ?? `${assetId}.${check.extension}`).slice(0, 160),
        mediaType: check.mediaType,
        bytes: upload.bytes.length,
        altText: (upload.fields.altText ?? "").slice(0, 500),
        addedBy: handle,
        addedAt: now,
      });
    }

    const body = await readJsonBody(req, 4_000);
    if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
    const parsed = assetBodySchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    const input = parsed.data;

    if (input.action === "link") {
      if (assetLinkProblem(input.url)) return NextResponse.json({ error: "not_https", code: "not_https" }, { status: 422 });
      return attach(allowed, input.id, { id: newContentId("as"), kind: "url", ref: input.url.trim(), name: input.name, mediaType: null, bytes: null, altText: input.altText ?? "", addedBy: handle, addedAt: now });
    }

    const loaded = await loadPiece(allowed.db, input.id);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (input.action === "upload_url") {
      if (loaded.piece.assets.length >= ASSET_LIMITS.perPiece) return NextResponse.json({ error: "too_many", code: "too_many" }, { status: 422 });
      const assetId = newContentId("as");
      const extension = input.mediaType === "video/quicktime" ? "mov" : input.mediaType === "video/webm" ? "webm" : "mp4";
      const path = assetPath(input.id, assetId, extension);
      const { data, error } = await allowed.db.storage.from(CONTENT_BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new Error(`storage upload url: ${error?.message ?? "none"}`);
      return NextResponse.json({ ok: true, assetId, path, signedUrl: data.signedUrl, token: data.token });
    }

    // confirm: the file must be there, and be a video by its first bytes.
    const extensionOf = /^as_[a-z0-9]{6,40}$/.test(input.assetId) ? ["mp4", "mov", "webm"] : [];
    let found: { path: string; size: number; head: Uint8Array } | null = null;
    for (const extension of extensionOf) {
      const path = assetPath(input.id, input.assetId, extension);
      const signed = await allowed.db.storage.from(CONTENT_BUCKET).createSignedUrl(path, 120);
      if (!signed.data?.signedUrl) continue;
      const res = await fetch(signed.data.signedUrl, { headers: { range: "bytes=0-63" } });
      if (!res.ok) continue;
      const size = Number(res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length") ?? 0);
      found = { path, size, head: new Uint8Array(await res.arrayBuffer()).subarray(0, 64) };
      break;
    }
    if (!found) return NextResponse.json({ error: "The file did not arrive", code: "empty" }, { status: 400 });
    const check = checkAsset(found.head, found.size, "video/mp4");
    if (!check.ok || !check.mediaType.startsWith("video/") || !isAssetType(check.mediaType)) {
      await allowed.db.storage.from(CONTENT_BUCKET).remove([found.path]);
      return NextResponse.json({ error: check.ok ? "wrong_type" : check.code, code: check.ok ? "wrong_type" : check.code }, { status: 415 });
    }
    return attach(allowed, input.id, {
      id: input.assetId,
      kind: "upload",
      ref: found.path,
      name: input.name,
      mediaType: check.mediaType,
      bytes: found.size,
      altText: input.altText ?? "",
      addedBy: handle,
      addedAt: now,
    });
  } catch (error) {
    await reportError(error, { where: "api/staff/content/assets", userId: allowed.member.userId });
    return NextResponse.json({ error: "The file could not be kept. Nothing changed." }, { status: 500 });
  }
}
