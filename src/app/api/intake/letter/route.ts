import { NextResponse } from "next/server";
import { readBureauLetter } from "@/lib/intake/bureauLetter";
import { INTAKE_RATE_LIMIT } from "@/lib/intake/config";
import { checkUpload } from "@/lib/intake/files";
import { intakeRecordFromRow, processLetterUpload, readUpload } from "@/lib/intake/server";
import { DEMO_REPORT } from "@/lib/demo";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/config";
import { getSessionUser } from "@/lib/supabase/server";

// "Llegó una carta de un buró": the signed-in client photographs a bureau's
// letter. OPTIONAL: round results come from the next report, and nothing
// waits for a letter. Multipart: file. The user comes from the session.
//
// Answer: what the letter says, item by item (bureauLetter.ts), and whether
// a person will look at it (only when it asks for more information or calls
// the dispute "frivolous").
//
// GET: the client's letters, newest first.
//
// Demo (no database): nothing stored, no AI; a simulated Equifax letter about
// the demo report comes back.

export const maxDuration = 120;

export async function POST(req: Request) {
  const limited = rateLimit(req, "intake-letter", INTAKE_RATE_LIMIT.bureauLetter);
  if (limited) return limited;
  const upload = await readUpload(req);
  if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: upload.status });
  const fileCheck = checkUpload("bureau_letter", upload.bytes);
  if (!fileCheck.ok) return NextResponse.json({ error: fileCheck.message }, { status: fileCheck.status });
  const now = new Date();

  if (isDemoMode()) {
    const result = await readBureauLetter({ bytes: upload.bytes, reportItems: DEMO_REPORT.items, now, live: false });
    return NextResponse.json({ ok: true, status: result.status, letter: result.summary, simulated: true });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión para subir una carta." }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const done = await processLetterUpload(db, { userId: user.id, bytes: upload.bytes, uploadedBy: user.id, role: "client", now });
    if ("error" in done) return NextResponse.json({ error: done.error }, { status: done.status });
    // The client gets the letter's facts and whether a person looks; the staff notes stay with staff.
    return NextResponse.json({ ok: true, status: done.result.status, letter: done.result.summary, simulated: done.result.simulated });
  } catch (error) {
    await reportError(error, { where: "api/intake/letter", userId: user.id });
    return NextResponse.json({ error: "No se pudo guardar la carta. Intenta de nuevo." }, { status: 500 });
  }
}

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ letters: [] });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ letters: [] });
  const { data } = await db
    .from("intake_documents")
    .select("id, kind, status, simulated, reasons, created_at, cost_usd, result")
    .eq("user_id", user.id)
    .eq("kind", "bureau_letter")
    .order("created_at", { ascending: false })
    .limit(20);
  const letters = ((data as Record<string, unknown>[] | null) ?? [])
    .map(intakeRecordFromRow)
    .filter((r) => r !== null)
    .map((r) => ({ id: r.id, at: r.at, status: r.status, letter: r.letter ?? null, simulated: r.simulated }));
  return NextResponse.json({ letters });
}
