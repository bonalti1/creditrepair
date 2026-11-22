import { NextResponse } from "next/server";
import { IDENTITY_BUCKET, INTAKE_RATE_LIMIT } from "@/lib/intake/config";
import { checkUpload } from "@/lib/intake/files";
import { checkIdentityDocument, simulatedIdentityCheck, type IdentityDocumentKind } from "@/lib/intake/identity";
import { intakeRecordFromRow, readUpload, recordIntake, storeFile } from "@/lib/intake/server";
import { reportError } from "@/lib/observability/errors";
import { recordResolution } from "@/lib/autopilot/resolutions";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/config";
import { getSessionUser } from "@/lib/supabase/server";

// The client's photo ID or proof of address. Multipart: kind, file. Only for
// the signed-in client themselves: the user comes from the session, never
// from the request.
//
// The file goes to the private identity-docs bucket at {userId}/{kind}.{ext}
// (the path letters attach as enclosures) and identity_documents records it,
// as before. Then the automatic check (src/lib/intake/identity.ts): accepted
// shows "Revisado automáticamente" with its reasons; needs_person puts it on
// the console's "needs a person" list. Only the status and the reasons are
// kept.
//
// GET: the newest check of each kind, for the documents card.
//
// Demo (no database): nothing is stored and no AI is called; a simulated
// check comes back (ID accepted, proof of address needs a person).

export const maxDuration = 120;

const KINDS: readonly IdentityDocumentKind[] = ["government_id", "proof_of_address"];

export async function POST(req: Request) {
  const limited = rateLimit(req, "intake-document", INTAKE_RATE_LIMIT.clientDocument);
  if (limited) return limited;
  const upload = await readUpload(req);
  if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: upload.status });
  const kind = upload.fields.kind as IdentityDocumentKind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "Tipo de documento desconocido." }, { status: 400 });
  const fileCheck = checkUpload("identity", upload.bytes);
  if (!fileCheck.ok) return NextResponse.json({ error: fileCheck.message }, { status: fileCheck.status });

  if (isDemoMode()) {
    const result = simulatedIdentityCheck(kind, false);
    return NextResponse.json({ ok: true, kind, status: result.status, reasons: result.reasons, simulated: true });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión para subir tus documentos." }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  try {
    const path = `${user.id}/${kind}.${fileCheck.extension}`;
    await storeFile(db, IDENTITY_BUCKET, path, upload.bytes, fileCheck.mediaType, true);
    const { error: docError } = await db
      .from("identity_documents")
      .upsert({ user_id: user.id, kind, storage_path: path, uploaded_at: new Date().toISOString() }, { onConflict: "user_id,kind" });
    if (docError) throw new Error(`identity_documents: ${docError.message}`);

    const { data: profile } = await db.from("profiles").select("full_name, address_lines").eq("id", user.id).maybeSingle();
    const onFile = { fullName: String(profile?.full_name ?? ""), addressLines: Array.isArray(profile?.address_lines) ? (profile.address_lines as string[]) : [] };
    const result = await checkIdentityDocument({ kind, bytes: upload.bytes, onFile, now: new Date(), live: true });
    // The check before this one, of the same kind: a document that was not accepted and now is was fixed by the client.
    const { data: before } = await db.from("intake_documents").select("id, status").eq("user_id", user.id).eq("kind", kind).order("created_at", { ascending: false }).limit(1);
    const previous = ((before as Array<{ id: string; status: string }> | null) ?? [])[0];
    if (previous?.status === "needs_person" && result.status === "accepted") {
      await recordResolution(db, { userId: user.id, kind: "document_reuploaded", detail: { kind, previous: previous.id }, dedupeKey: `document_reuploaded:${previous.id}` });
    }
    await recordIntake(db, {
      userId: user.id,
      kind,
      status: result.status,
      simulated: result.simulated,
      reasons: result.reasons,
      bucket: IDENTITY_BUCKET,
      path,
      fileKind: fileCheck.kind,
      fileBytes: upload.bytes.length,
      model: result.model,
      usage: result.usage,
      costUsd: result.costUsd,
      uploadedBy: user.id,
      role: "client",
    });
    return NextResponse.json({ ok: true, kind, status: result.status, reasons: result.reasons, simulated: result.simulated });
  } catch (error) {
    await reportError(error, { where: "api/intake/document", userId: user.id });
    return NextResponse.json({ error: "No se pudo guardar tu documento. Intenta de nuevo." }, { status: 500 });
  }
}

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ checks: [] });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ checks: [] });
  const { data } = await db
    .from("intake_documents")
    .select("id, kind, status, simulated, reasons, created_at, cost_usd, result")
    .eq("user_id", user.id)
    .in("kind", KINDS as string[])
    .order("created_at", { ascending: false })
    .limit(20);
  const newest = new Map<string, unknown>();
  for (const row of (data as Record<string, unknown>[] | null) ?? []) {
    const record = intakeRecordFromRow(row);
    if (record && !newest.has(record.kind)) newest.set(record.kind, { kind: record.kind, status: record.status, reasons: record.reasons, simulated: record.simulated, at: record.at });
  }
  return NextResponse.json({ checks: [...newest.values()] });
}
