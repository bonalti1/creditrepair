import { after, NextResponse } from "next/server";
import { MAX_REPORT_FILE_BYTES } from "@/lib/intake/config";
import { checkUpload } from "@/lib/intake/files";
import { MAX_REPORT_FILES, readReview, receiveReport } from "@/lib/live/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/config";

// The report a person uploads on /live (docs/LIVE-FUNNEL.md, step 3):
// multipart, the upload token the form gave (field "token") and one to three
// files (field "file"): a PDF or a saved page of THEIR OWN report, from
// annualcreditreport.com or IdentityIQ. Each file is checked by its first
// bytes (intake/files.ts) and kept in the private live-reports bucket; the AI
// report reader then reads it after the answer is sent (the person can close
// the page), and the cron tries again any reading that did not finish.
//
// Demo (no database): the files are checked and nothing is kept.

export const maxDuration = 300;

const MAX_BODY = MAX_REPORT_FILES * MAX_REPORT_FILE_BYTES + 256 * 1024;

export async function POST(req: Request) {
  const limited = rateLimit(req, "live-report", { limit: 6, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  const token = String(form.get("token") ?? "");
  const files: Array<{ bytes: Uint8Array; fileName: string | null }> = [];
  for (const value of form.getAll("file")) {
    if (typeof value === "string") continue;
    if (value.size > MAX_REPORT_FILE_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
    files.push({ bytes: new Uint8Array(await value.arrayBuffer()), fileName: value.name ? value.name.slice(0, 120) : null });
  }
  if (files.length === 0) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (files.length > MAX_REPORT_FILES) return NextResponse.json({ error: "too_many" }, { status: 400 });

  if (isDemoMode()) {
    const bad = files.map((f) => checkUpload("credit_report", f.bytes)).find((c) => !c.ok);
    if (bad && !bad.ok) return NextResponse.json({ error: "file" }, { status: bad.status });
    return NextResponse.json({ ok: true, demo: true, files: files.length });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const now = new Date();
    const result = await receiveReport(db, { token, files, now });
    if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.status });
    const read = () => readReview(db, result.reviewId, new Date()).catch((error) => reportError(error, { where: "api/live/report:read" }));
    try {
      after(read);
    } catch {
      // Outside a request (a test, a script): read now.
      await read();
    }
    return NextResponse.json({ ok: true, files: result.files });
  } catch (error) {
    await reportError(error, { where: "api/live/report" });
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
