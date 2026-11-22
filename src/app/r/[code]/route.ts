import { NextResponse } from "next/server";
import { referralCookie } from "@/lib/partners/attribution";
import { REFERRAL_CODE } from "@/lib/partners/rules";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";

// A partner's referral link: /r/<code>. Sets the referral cookie (60 days,
// first-party; partners/attribution.ts) and goes on to the landing page, or to
// PARTNER_LANDING_URL when set (a HighLevel funnel, which can keep the code
// from the "socio" query parameter in a hidden field and send it back with the
// lead: docs/HIGHLEVEL.md).
//
// With a database, only an approved partner's code sets the cookie; anything
// else is a plain visit. In the demo any well-formed code does. The visitor is
// sent on either way, so the link tells nobody whether a code exists.

export const dynamic = "force-dynamic";

function destination(req: Request, code: string | null): URL {
  const configured = process.env.PARTNER_LANDING_URL;
  const target = configured && /^https:\/\//.test(configured) ? new URL(configured) : new URL("/", req.url);
  if (code && configured) target.searchParams.set("socio", code);
  return target;
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const limited = rateLimit(req, "referral-link", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const raw = (await params).code ?? "";
  const code = REFERRAL_CODE.test(raw.toLowerCase()) ? raw.toLowerCase() : null;

  let valid = Boolean(code);
  const db = getAdminClient();
  if (code && db) {
    const { data } = await db.from("partners").select("id").eq("referral_code", code).eq("status", "approved").maybeSingle();
    valid = Boolean(data);
  }

  const res = NextResponse.redirect(destination(req, valid ? code : null), 302);
  if (valid && code) res.cookies.set(referralCookie(code, new URL(req.url).protocol === "https:"));
  return res;
}
