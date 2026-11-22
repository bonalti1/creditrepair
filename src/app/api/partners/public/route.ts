import { NextResponse } from "next/server";
import { commissionsEnabled, partnerByCode } from "@/lib/partners/sharingServer";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";

// Public facts about the partner program, for pages a person sees before
// signing in: the referred client's welcome ("Te recomendó María López, ABC
// Realty"), the signup page and the "Cómo funciona" page.
//
//   ?code=<code>  an APPROVED partner's name, company, kind and logo (only once
//                 an administrator approved the logo); 404 otherwise, the same
//                 for a code that does not exist and one that is not approved.
//   always        whether the program pays referral fees ("Comisiones a socios").
// Nothing else: never the partner's phone, email or terms.

export async function GET(req: Request) {
  const limited = rateLimit(req, "partners-public", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const code = new URL(req.url).searchParams.get("code")?.trim().toLowerCase() ?? null;
  const fees = await commissionsEnabled(db);
  if (!code) return NextResponse.json({ commissionsEnabled: fees });
  const partner = await partnerByCode(db, code);
  if (!partner) return NextResponse.json({ error: "Not found", commissionsEnabled: fees }, { status: 404 });
  return NextResponse.json({ partner: { name: partner.name, company: partner.company, kind: partner.kind, logo: partner.logo }, commissionsEnabled: fees });
}
