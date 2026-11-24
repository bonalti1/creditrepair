import { NextResponse } from "next/server";
import { z } from "zod";
import { offerFromRow, offerInputSchema, offerToRow, rankOffers } from "@/lib/aftercare/offers";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// Partner offers and loan officers accepting new clients (/equipo/ofertas),
// administrators only (requireCapability("partners.manage")). Migration 0030.
//
//   GET   every offer (active or not), the marketplace switch, and the
//         approved loan officers with their "accepting new clients" mark.
//   POST  save {id?, …offer}: checked here (offerInputSchema) and again by
//           the database's constraints; there is no commission field.
//         switch {enabled}: the marketplace on or off (append-only record).
//         accepting {partnerId, accepting}: a loan officer accepts new clients
//           (the database refuses it for a partner who is not a loan officer).

type Row = Record<string, unknown>;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullable(), offer: offerInputSchema }).strict(),
  z.object({ action: z.literal("switch"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("accepting"), partnerId: z.string().uuid(), accepting: z.boolean() }).strict(),
]);

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-offers-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("partners.manage");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  try {
    const [offers, enabled, officers] = await Promise.all([
      db.from("partner_offers").select("*"),
      db.rpc("offers_enabled"),
      db.from("partners").select("id, name, company, kind, status, accepting_clients").eq("kind", "loan_officer").eq("status", "approved"),
    ]);
    for (const r of [offers, enabled, officers]) if (r.error) throw new Error(r.error.message);
    const all = ((offers.data as Row[] | null) ?? []).map(offerFromRow);
    return NextResponse.json({
      enabled: enabled.data === true,
      // Active ones in the order clients see them, then the inactive ones.
      offers: [...rankOffers(all), ...all.filter((o) => !o.active).sort((a, b) => a.name.localeCompare(b.name))],
      loanOfficers: ((officers.data as Row[] | null) ?? [])
        .map((p) => ({ id: String(p.id), name: String(p.name), company: typeof p.company === "string" ? p.company : null, accepting: p.accepting_clients === true }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    await reportError(error, { where: "api/staff/offers", userId: member.userId });
    return NextResponse.json({ error: "Could not read the offers." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-offers", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("partners.manage");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  const input = parsed.data;
  try {
    switch (input.action) {
      case "save": {
        const row = { ...offerToRow(input.offer), updated_at: new Date().toISOString() };
        const query = input.id
          ? db.from("partner_offers").update(row).eq("id", input.id).select("*").single()
          : db.from("partner_offers").insert({ ...row, created_by: member.userId }).select("*").single();
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, offer: offerFromRow(data as Row) });
      }
      case "switch": {
        const { error } = await db.from("offer_marketplace_changes").insert({ enabled: input.enabled, changed_by: member.userId, changed_by_name: member.name.slice(0, 80) });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, enabled: input.enabled });
      }
      case "accepting": {
        const { data, error } = await db.from("partners").update({ accepting_clients: input.accepting }).eq("id", input.partnerId).eq("kind", "loan_officer").select("id");
        if (error) throw new Error(error.message);
        if (((data as unknown[] | null) ?? []).length === 0) return NextResponse.json({ error: "Not a loan officer", code: "not_loan_officer" }, { status: 409 });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    await reportError(error, { where: `api/staff/offers:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
