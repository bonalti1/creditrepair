import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { INTAKE_BUCKET, INTAKE_RATE_LIMIT } from "@/lib/intake/config";
import { checkUpload } from "@/lib/intake/files";
import { extractReport } from "@/lib/intake/report/extract";
import { recordIntake, readUpload, storeFile } from "@/lib/intake/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { memberCanSee } from "@/lib/staff/actions";
import { isDemoMode } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";

// A client's 3-bureau credit report as a PDF or a saved page, read by the AI
// (reports.import: administrators and specialists, for clients whose case
// they see). Multipart: clientId, file.
//
// Nothing is saved to the client's report here. The answer is the reading
// (an envelope for the `ai_document` reader) and its validation; the import
// screen shows it with the doubtful items highlighted, and only "Guardar
// reporte" saves it, through /api/staff/reports, which validates it again.
//
// The file is kept in the private intake-files bucket and the reading in
// intake_documents, with its tokens and estimated cost.
//
// Demo (no database): nothing is stored and no AI is called; a simulated
// reading comes back, labelled. With a database and no API key: the same
// simulated reading, which the reader refuses to save to a real client.

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-intake-report", INTAKE_RATE_LIMIT.staffReport);
  if (limited) return limited;

  const upload = await readUpload(req);
  if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: upload.status });
  const fileCheck = checkUpload("credit_report", upload.bytes);
  if (!fileCheck.ok) return NextResponse.json({ error: fileCheck.message }, { status: fileCheck.status });
  const now = new Date();

  if (isDemoMode()) {
    const result = await extractReport({ bytes: upload.bytes, fileName: upload.fileName, now, simulate: true });
    return NextResponse.json({ ok: true, ...result });
  }

  const clientId = upload.fields.clientId ?? "";
  if (!UUID.test(clientId)) return NextResponse.json({ error: "Falta el cliente." }, { status: 400 });
  const allowed = await requireCapability("reports.import");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  if ((await memberCanSee(reader, clientId, "case")) !== "client") {
    return NextResponse.json({ error: "Este cliente no está entre los tuyos." }, { status: 404 });
  }

  try {
    const id = randomUUID();
    const path = `${clientId}/reports/${id}.${fileCheck.extension}`;
    await storeFile(db, INTAKE_BUCKET, path, upload.bytes, fileCheck.mediaType);
    const result = await extractReport({ bytes: upload.bytes, fileName: upload.fileName, now, intakeId: id });
    const v = result.validation;
    await recordIntake(db, {
      id,
      userId: clientId,
      kind: "credit_report",
      status: v.raw ? "read" : "failed",
      simulated: result.simulated,
      reasons: [...v.fatal, ...v.warnings],
      // A discarded answer (SSN- or birth-date-like content) is not stored, not even here.
      result: result.envelope
        ? { envelope: result.envelope, review: { items: v.items.filter((i) => i.confidence === "low" || i.excluded).length, total: v.items.length, pageCount: result.pageCount } }
        : null,
      bucket: INTAKE_BUCKET,
      path,
      fileKind: fileCheck.kind,
      fileBytes: upload.bytes.length,
      model: result.model,
      usage: result.usage,
      costUsd: result.costUsd,
      uploadedBy: member.userId,
      role: "staff",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await reportError(error, { where: "api/staff/intake/report", userId: member.userId });
    return NextResponse.json({ error: "No se pudo leer el reporte. Intenta de nuevo." }, { status: 500 });
  }
}
