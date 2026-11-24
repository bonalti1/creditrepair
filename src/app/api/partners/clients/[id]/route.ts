import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/errors";
import { requirePartner } from "@/lib/partners/server";
import { viewPartnerClient } from "@/lib/partners/sharingServer";
import { loadPartnerHomeReady } from "@/lib/aftercare/server";
import { rateLimit } from "@/lib/security/rateLimit";

// One client's page for the signed-in partner: partner_client_view(), through
// the partner's OWN connection. The database returns the row only while the
// client shares with this partner, the partner is approved and has accepted
// the current terms, and it writes the view to partner_view_log in the same
// call (the client sees "María vio tu avance el …"). 404 for everything else,
// the same for a client who does not exist and one who does not share.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "partners-client", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const id = (await params).id ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const allowed = await requirePartner();
  if (!allowed.ok) return allowed.response;
  const { member, reader } = allowed;
  try {
    const client = await viewPartnerClient(reader, id);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Home-ready milestones (migration 0030): only when the client also chose to share them; [] otherwise.
    const homeReady = await loadPartnerHomeReady(reader, id);
    return NextResponse.json({ client, homeReady, partner: { name: member.partner.name } });
  } catch (error) {
    await reportError(error, { where: "api/partners/clients", userId: member.userId });
    return NextResponse.json({ error: "Could not read the client." }, { status: 500 });
  }
}
