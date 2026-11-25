import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkUpload } from "@/lib/intake/files";
import { readUpload, storeFile } from "@/lib/intake/server";
import { EXTRA_DOCUMENT_KINDS, POA_VERSION, uploadableExtraKinds, type ExtraDocumentKind } from "@/lib/fulfillment/documents";
import { clientFileFromRow, documentReviewFromRow } from "@/lib/fulfillment/rows";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// The signed-in client's documents (Más → Mis documentos; migration 0041,
// docs/FULFILLMENT.md "Documents"). The user comes from the session.
//
// GET   through the client's OWN connection: which identity documents are on
//       file and when, the other documents they gave us, and every review a
//       person made (with the reason they read).
// POST  multipart {kind, description, file}: another document (proof for a
//         disputed item, a creditor's letter, court papers; the power of
//         attorney only once the attorney approved its text). Checked by its
//         first bytes (PDF, JPG, PNG), kept in the private client-files
//         bucket. Never a Social Security card: there is no such kind.
//       JSON {action: "withdraw", id}: take one back; the file is removed and
//         the record says when.

const CLIENT_FILES_BUCKET = "client-files";
const MAX_FILE_BYTES = 15 * 1024 * 1024;

type Row = Record<string, unknown>;

const SSN_LIKE = /\d{3}-?\d{2}-?\d{4}/;

export async function GET(req: Request) {
  const limited = rateLimit(req, "documents-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const [docs, files, reviews] = await Promise.all([
      reader.from("identity_documents").select("kind, uploaded_at").eq("user_id", user.id),
      reader.from("client_files").select("id, user_id, kind, file_name, content_type, bytes, description, uploaded_by, uploaded_at, withdrawn_at").eq("user_id", user.id),
      reader.from("document_reviews").select("*").eq("user_id", user.id),
    ]);
    return NextResponse.json({
      identity: ((docs.data as Row[] | null) ?? []).filter((d) => d.kind !== "ssn_card").map((d) => ({ kind: String(d.kind), uploadedAt: String(d.uploaded_at) })),
      files: ((files.data as Row[] | null) ?? []).flatMap((r) => clientFileFromRow(r) ?? []).filter((f) => !f.withdrawnAt),
      reviews: ((reviews.data as Row[] | null) ?? []).map(documentReviewFromRow),
      kinds: uploadableExtraKinds(),
    });
  } catch (error) {
    await reportError(error, { where: "api/documents:read", userId: user.id });
    return NextResponse.json({ error: "Could not read your documents." }, { status: 500 });
  }
}

const withdrawSchema = z.object({ action: z.literal("withdraw"), id: z.string().uuid() }).strict();

export async function POST(req: Request) {
  const limited = rateLimit(req, "documents", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const db = getAdminClient();
  if (!db || !(await getServerSupabase())) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await readJsonBody(req, 1_000);
    if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
    const parsed = withdrawSchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    try {
      const { data: row } = await db.from("client_files").select("id, storage_path, withdrawn_at").eq("id", parsed.data.id).eq("user_id", user.id).maybeSingle();
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if ((row as Row).withdrawn_at) return NextResponse.json({ ok: true });
      await db.storage.from(CLIENT_FILES_BUCKET).remove([String((row as Row).storage_path)]);
      const { error } = await db.from("client_files").update({ withdrawn_at: new Date().toISOString() }).eq("id", parsed.data.id).eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    } catch (error) {
      await reportError(error, { where: "api/documents:withdraw", userId: user.id });
      return NextResponse.json({ error: "Could not take it back." }, { status: 500 });
    }
  }

  const upload = await readUpload(req, MAX_FILE_BYTES);
  if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: upload.status });
  const kind = upload.fields.kind as ExtraDocumentKind;
  // The power of attorney slot is off until the attorney approves its text (fulfillment/documents.ts).
  if (!EXTRA_DOCUMENT_KINDS.includes(kind) || !uploadableExtraKinds().includes(kind)) {
    return NextResponse.json({ error: "This kind of document is not taken.", code: "kind_not_open" }, { status: 400 });
  }
  const description = (upload.fields.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (SSN_LIKE.test(description)) return NextResponse.json({ error: "Please don't write a Social Security number here.", code: "ssn_in_text" }, { status: 400 });
  const check = checkUpload("bureau_letter", upload.bytes);
  if (!check.ok || !["pdf", "jpeg", "png"].includes(check.kind)) {
    return NextResponse.json({ error: check.ok ? "Send a PDF, JPG or PNG." : check.message }, { status: check.ok ? 415 : check.status });
  }
  try {
    const id = randomUUID();
    const path = `${user.id}/${id}.${check.extension}`;
    await storeFile(db, CLIENT_FILES_BUCKET, path, upload.bytes, check.mediaType);
    const { data, error } = await db
      .from("client_files")
      .insert({
        id,
        user_id: user.id,
        kind,
        storage_path: path,
        file_name: (upload.fileName ?? "").replace(SSN_LIKE, "").slice(0, 120),
        content_type: check.mediaType,
        bytes: upload.bytes.length,
        description,
        poa_version: kind === "power_of_attorney" ? POA_VERSION : null,
        uploaded_by: "client",
      })
      .select("id, user_id, kind, file_name, content_type, bytes, description, uploaded_by, uploaded_at, withdrawn_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, file: clientFileFromRow(data as Row) });
  } catch (error) {
    await reportError(error, { where: "api/documents:upload", userId: user.id });
    return NextResponse.json({ error: "Could not upload it. Please try again." }, { status: 500 });
  }
}
