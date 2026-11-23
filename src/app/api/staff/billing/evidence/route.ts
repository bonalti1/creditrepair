import { NextResponse } from "next/server";
import { resolveTerms } from "@/lib/agreement/terms";
import { evidenceHtml, evidencePack } from "@/lib/billing/evidence";
import { loadProvenResults } from "@/lib/billing/server";
import { BRAND } from "@/lib/brand";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { loadStaffClients } from "@/lib/staff/load";

// The chargeback evidence pack for one charge, as a page to save as PDF or
// attach to the processor's dispute form. GET ?charge=<id>[&client=<id>].
// Administrators only. Built from the records; nothing in it is typed by staff.

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-evidence", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("billing.plans");
  if (!allowed.ok) return allowed.response;
  const url = new URL(req.url);
  const chargeId = url.searchParams.get("charge") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(chargeId)) return NextResponse.json({ error: "charge id required" }, { status: 400 });
  try {
    const { data: charge } = await allowed.db.from("charges").select("user_id").eq("id", chargeId).maybeSingle();
    if (!charge) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
    const userId = String((charge as { user_id: string }).user_id);
    const [client] = await loadStaffClients(allowed.db, { clientId: userId });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const [rounds, letters] = await Promise.all([
      allowed.db.from("attack_rounds").select("id, round_number, status, mailed_at").eq("user_id", userId),
      allowed.db.from("letters").select("id, round_id, status").eq("user_id", userId),
    ]);
    const results = await loadProvenResults(allowed.db, userId, (rounds.data as Record<string, unknown>[]) ?? [], (letters.data as Record<string, unknown>[]) ?? []);
    const terms = resolveTerms();
    const pack = evidencePack(client, chargeId, { legalName: terms.companyLegalName ?? BRAND.name, email: terms.companyEmail }, { results });
    if (!pack) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
    await allowed.db.from("events").insert({ user_id: userId, kind: "evidence_pack_generated", payload: { chargeId, hash: pack.hash, by: allowed.member.userId } });
    if (url.searchParams.get("format") === "json") return NextResponse.json(pack);
    return new Response(evidenceHtml(pack), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        ...(url.searchParams.get("download") === "1" ? { "content-disposition": `attachment; filename="${pack.invoice}-evidence.html"` } : {}),
      },
    });
  } catch (error) {
    await reportError(error, { where: "api/staff/billing/evidence", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not build the evidence pack." }, { status: 500 });
  }
}
