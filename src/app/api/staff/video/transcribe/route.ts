import { NextResponse } from "next/server";
import { readUpload } from "@/lib/intake/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { newVideoId } from "@/lib/video/timeline";
import { transcribe, transcribeStatus, TRANSCRIBE_LIMITS } from "@/lib/video/transcribe";

// Automatic captions (src/lib/video/transcribe.ts): OFF until the server has
// TRANSCRIBE_API_KEY. content.edit.
//
// GET   Whether it is connected (the editor shows «not connected» otherwise).
// POST  multipart/form-data: "file" (the clips' own sound, 16 kHz mono WAV,
//       made in the browser), "language" (en|es), "duration" (seconds).
//       Returns timed captions as a draft for a person to read and fix.

export async function GET() {
  const allowed = await requireCapability("content.edit");
  if (!allowed.ok) return allowed.response;
  return NextResponse.json(transcribeStatus());
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-video-transcribe", { limit: TRANSCRIBE_LIMITS.perMemberPerHour, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("content.edit");
  if (!allowed.ok) return allowed.response;
  if (!transcribeStatus().configured) return NextResponse.json({ error: "not_configured", code: "not_configured" }, { status: 503 });
  const upload = await readUpload(req, TRANSCRIBE_LIMITS.maxBytes);
  if (!upload.ok) return NextResponse.json({ error: upload.status === 413 ? "too_large" : "empty", code: upload.status === 413 ? "too_large" : "empty" }, { status: upload.status });
  // A WAV file starts with RIFF....WAVE.
  const b = upload.bytes;
  if (!(b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45)) {
    return NextResponse.json({ error: "wrong_type", code: "wrong_type" }, { status: 415 });
  }
  const duration = Number(upload.fields.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) return NextResponse.json({ error: "bad_input", code: "bad_input" }, { status: 400 });
  try {
    const result = await transcribe(upload.bytes, { language: upload.fields.language === "es" ? "es" : "en", duration, makeId: () => newVideoId("cc") });
    return result.ok ? NextResponse.json({ ok: true, cues: result.cues }) : NextResponse.json({ error: result.code, code: result.code }, { status: result.code === "provider_error" ? 502 : 422 });
  } catch (error) {
    await reportError(error, { where: "api/staff/video/transcribe", userId: allowed.member.userId });
    return NextResponse.json({ error: "provider_error", code: "provider_error" }, { status: 502 });
  }
}
