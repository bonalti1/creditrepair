import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/errors";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { unsubscribeRegistration } from "@/lib/webinars/server";
import { verifyWebinarUnsubscribe } from "@/lib/webinars/unsubscribe";

// The unsubscribe link of a webinar reminder email (CAN-SPAM), and the mail
// providers' one-click unsubscribe (RFC 8058). The link's signature
// (UNSUBSCRIBE_SECRET) proves it was ours. A GET does nothing (mail scanners
// open links): /webinar/baja asks for one tap. Recorded on the registration
// and as an opt-out of the number: no automatic message goes to it after.

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`webinar-unsubscribe:${ip}`, 20, 60_000).allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const url = new URL(req.url);
  let registrationId = url.searchParams.get("r") ?? "";
  let token = url.searchParams.get("t") ?? "";
  let fromForm = false;
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (form?.get("r")) {
      registrationId = String(form.get("r"));
      token = String(form.get("t") ?? "");
      fromForm = true;
    }
  }
  if (!verifyWebinarUnsubscribe(registrationId, token, process.env.UNSUBSCRIBE_SECRET)) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    if (!(await unsubscribeRegistration(db, registrationId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    await reportError(error, { where: "api/webinars/unsubscribe" });
    return NextResponse.json({ error: "Could not record it. Please try again." }, { status: 500 });
  }
  return fromForm ? NextResponse.redirect(new URL("/webinar/baja?hecho=1", req.url), 303) : NextResponse.json({ ok: true });
}
