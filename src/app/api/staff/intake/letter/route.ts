import { NextResponse } from "next/server";
import { readBureauLetter } from "@/lib/intake/bureauLetter";
import { INTAKE_RATE_LIMIT } from "@/lib/intake/config";
import { checkUpload } from "@/lib/intake/files";
import { processLetterUpload, readUpload } from "@/lib/intake/server";
import { DEMO_REPORT } from "@/lib/demo";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { memberCanSee } from "@/lib/staff/actions";
import { isDemoMode } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";

// A bureau's letter that reached the team some other way (mailed to the
// office, sent by WhatsApp), uploaded on the client's behalf. Optional, like
// the client's own upload: round results come from the next report.
// Multipart: clientId, file. reports.import (administrators and specialists),
// for clients whose case they see.

export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-intake-letter", INTAKE_RATE_LIMIT.bureauLetter);
  if (limited) return limited;
  const upload = await readUpload(req);
  if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: upload.status });
  const fileCheck = checkUpload("bureau_letter", upload.bytes);
  if (!fileCheck.ok) return NextResponse.json({ error: fileCheck.message }, { status: fileCheck.status });
  const now = new Date();

  if (isDemoMode()) {
    const result = await readBureauLetter({ bytes: upload.bytes, reportItems: DEMO_REPORT.items, now, live: false });
    return NextResponse.json({ ok: true, id: null, status: result.status, reasons: result.reasons, letter: result.summary, simulated: result.simulated });
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
    const done = await processLetterUpload(db, { userId: clientId, bytes: upload.bytes, uploadedBy: member.userId, role: "staff", now });
    if ("error" in done) return NextResponse.json({ error: done.error }, { status: done.status });
    const r = done.result;
    return NextResponse.json({ ok: true, id: done.id, status: r.status, reasons: r.reasons, letter: r.summary, simulated: r.simulated });
  } catch (error) {
    await reportError(error, { where: "api/staff/intake/letter", userId: member.userId });
    return NextResponse.json({ error: "No se pudo guardar la carta. Intenta de nuevo." }, { status: 500 });
  }
}
