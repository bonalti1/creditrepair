import { NextResponse } from "next/server";
import { getPartnerMember, hasPartnerApplication } from "@/lib/partners/server";
import { rateLimit } from "@/lib/security/rateLimit";
import { getSessionUser } from "@/lib/supabase/server";

// Who is signed in, as far as the partner program is concerned. The login page
// asks right after the code is verified (like /api/staff/me), to send an
// approved partner to their portal instead of the client app, and someone
// whose application is still pending to the portal's "not approved yet" page,
// without creating a client profile for either.

export async function GET(req: Request) {
  const limited = rateLimit(req, "partners-me", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const member = await getPartnerMember();
  if (member) return NextResponse.json({ partner: true, name: member.partner.name });
  const user = await getSessionUser();
  const applied = user ? await hasPartnerApplication(user) : false;
  return NextResponse.json({ partner: false, applied });
}
