import { NextResponse } from "next/server";
import { recordOptChange } from "@/lib/autopilot/store";
import { verifyUnsubscribeToken } from "@/lib/autopilot/unsubscribe";
import { reportError } from "@/lib/observability/errors";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";

// The unsubscribe link of every automatic email (CAN-SPAM), and the mail
// providers' one-click unsubscribe (RFC 8058: a POST to the List-Unsubscribe
// address with "List-Unsubscribe=One-Click"). No sign-in: the link's signature
// (UNSUBSCRIBE_SECRET) proves it was ours. Recorded in message_opt_outs like
// a WhatsApp "BAJA": no automatic message of any kind goes to the client after.
//
// A GET does nothing (mail scanners open links); the /baja page asks for one tap.

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`unsubscribe:${ip}`, 20, 60_000).allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  let userId = url.searchParams.get("u") ?? "";
  let token = url.searchParams.get("t") ?? "";
  let fromForm = false;
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (form?.get("u")) {
      userId = String(form.get("u"));
      token = String(form.get("t") ?? "");
      fromForm = true;
    }
  }
  if (!verifyUnsubscribeToken(userId, token, process.env.UNSUBSCRIBE_SECRET)) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    await recordOptChange(db, { userId, kind: "opt_out", channel: "email", keyword: "UNSUBSCRIBE" });
  } catch (error) {
    await reportError(error, { where: "api/unsubscribe", userId });
    return NextResponse.json({ error: "Could not record it. Please try again." }, { status: 500 });
  }
  return fromForm ? NextResponse.redirect(new URL("/baja?hecho=1", req.url), 303) : NextResponse.json({ ok: true });
}
