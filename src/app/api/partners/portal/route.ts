import { NextResponse } from "next/server";
import { z } from "zod";
import { notifyTeam } from "@/lib/agreement/server";
import { reportError } from "@/lib/observability/errors";
import { commissionFromRow, requirePartner } from "@/lib/partners/server";
import { commissionTotals, REFERRAL_STATUSES, type PartnerReferral, type ReferralStatus } from "@/lib/partners/rules";
import { commissionsEnabled, loadPartnerClients } from "@/lib/partners/sharingServer";
import { checkLogo } from "@/lib/partners/logo";
import { PARTNER_CLIENT_TERMS_VERSION, partnerTermsHash } from "@/lib/partners/terms";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";

// The partner portal's data, read through the partner's OWN connection only:
// their partner row, partner_referrals() (first name, last initial, date,
// coarse status), their commission records (only while "Comisiones a socios"
// is on), whether they accepted the current partner terms, and, once they
// did, partner_clients(): the clients who chose to share with them (migration
// 0023). Row level security and those functions are what limit it; nothing
// here READS with the service role.
//
// POST, the partner's own actions (written with the service role after the
// partner check):
//   accept_terms  the current terms, with the hash of the text they saw;
//   settings      milestone notices by email and/or WhatsApp (never SMS);
//   language      the language the partner reads the portal in, which their
//                 milestone notices go out in (partners.locale, migration 0024);
//   logo          a small image for co-branding, shown to clients only after
//                 an administrator approves it (or null to remove it);
//   message       "Escribir al equipo" about a client who shares with them: a
//                 note in the staff console, never shown to the client.

type Row = Record<string, unknown>;

export async function GET(req: Request) {
  const limited = rateLimit(req, "partners-portal", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requirePartner();
  if (!allowed.ok) return allowed.response;
  const { member, reader } = allowed;
  try {
    const [referrals, fees, own, terms] = await Promise.all([
      reader.rpc("partner_referrals"),
      commissionsEnabled(reader),
      reader.from("partners").select("logo_status, notify_email, notify_whatsapp, email, locale").eq("id", member.partner.id).maybeSingle(),
      reader.from("partner_terms_acceptances").select("accepted_at").eq("version", PARTNER_CLIENT_TERMS_VERSION).limit(1),
    ]);
    if (referrals.error) throw new Error(referrals.error.message);
    const list: PartnerReferral[] = (((referrals.data as Row[] | null) ?? []) as Row[]).map((r) => ({
      id: String(r.referral_id),
      firstName: String(r.first_name ?? ""),
      lastInitial: String(r.last_initial ?? ""),
      referredAt: String(r.referred_at ?? ""),
      status: ((REFERRAL_STATUSES as readonly string[]).includes(String(r.status)) ? r.status : "contacted") as ReferralStatus,
    }));
    let commissions: null | ReturnType<typeof commissionTotals> & { records: Array<{ id: string; kind: "owed" | "paid"; amountCents: number; note: string | null; recordedAt: string }> } = null;
    if (fees) {
      const { data, error } = await reader.from("partner_commissions").select("id, partner_id, kind, amount_cents, referral_id, note, recorded_at, recorded_by_name").order("recorded_at", { ascending: false });
      if (error) throw new Error(error.message);
      const records = ((data as Row[] | null) ?? []).map((row) => commissionFromRow(row));
      commissions = { ...commissionTotals(records), records: records.map((r) => ({ id: r.id, kind: r.kind, amountCents: r.amountCents, note: r.note, recordedAt: r.recordedAt })) };
    }
    const accepted = ((terms.data as Row[] | null) ?? []).length > 0;
    const clients = accepted ? await loadPartnerClients(reader) : [];
    const settings = (own.data as Row | null) ?? {};
    const p = member.partner;
    return NextResponse.json({
      partner: {
        name: p.name,
        company: p.company,
        kind: p.kind,
        referralCode: p.referralCode,
        logoStatus: typeof settings.logo_status === "string" ? settings.logo_status : "none",
        notifyEmail: settings.notify_email === true,
        notifyWhatsapp: settings.notify_whatsapp === true,
        hasEmail: typeof settings.email === "string" && settings.email !== "",
        locale: settings.locale === "es" ? "es" : "en",
      },
      program: { commissionsEnabled: fees },
      terms: { accepted, version: PARTNER_CLIENT_TERMS_VERSION },
      referrals: list,
      commissions,
      clients,
    });
  } catch (error) {
    await reportError(error, { where: "api/partners/portal", userId: member.userId });
    return NextResponse.json({ error: "Could not read the portal." }, { status: 500 });
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept_terms"), locale: z.enum(["es", "en"]), version: z.string().max(40), textHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ action: z.literal("settings"), notifyEmail: z.boolean(), notifyWhatsapp: z.boolean() }),
  z.object({ action: z.literal("language"), locale: z.enum(["es", "en"]) }),
  z.object({ action: z.literal("logo"), dataUrl: z.string().max(210_000).nullable() }),
  z.object({ action: z.literal("message"), clientId: z.string().uuid(), text: z.string().trim().min(2).max(1500) }),
]);

export async function POST(req: Request) {
  const limited = rateLimit(req, "partners-portal-write", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 220_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const allowed = await requirePartner();
  if (!allowed.ok) return allowed.response;
  const { member, reader, db } = allowed;
  const partnerId = member.partner.id;
  try {
    if (input.action === "accept_terms") {
      const fees = await commissionsEnabled(reader);
      if (input.version !== PARTNER_CLIENT_TERMS_VERSION || input.textHash !== partnerTermsHash(input.locale, fees)) {
        return NextResponse.json({ error: "The terms changed. Reload the page.", code: "terms_changed" }, { status: 409 });
      }
      const { error } = await db.from("partner_terms_acceptances").insert({ partner_id: partnerId, user_id: member.userId, version: input.version, locale: input.locale, text_hash: input.textHash });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "settings") {
      const { error } = await db.from("partners").update({ notify_email: input.notifyEmail, notify_whatsapp: input.notifyWhatsapp }).eq("id", partnerId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "language") {
      const { error } = await db.from("partners").update({ locale: input.locale }).eq("id", partnerId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "logo") {
      if (input.dataUrl === null) {
        const { error } = await db.from("partners").update({ logo_data: null, logo_status: "none", logo_decided_at: null, logo_decided_by: null }).eq("id", partnerId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, logoStatus: "none" });
      }
      const logo = checkLogo(input.dataUrl);
      if (!logo.ok) return NextResponse.json({ error: "Invalid image", message: logo.message }, { status: 422 });
      // A new image waits for an administrator again.
      const { error } = await db.from("partners").update({ logo_data: logo.dataUrl, logo_status: "pending", logo_decided_at: null, logo_decided_by: null }).eq("id", partnerId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, logoStatus: "pending" });
    }

    // message: only about a client who shares with this partner right now (their own connection decides).
    const clients = await loadPartnerClients(reader);
    const client = clients.find((c) => c.clientId === input.clientId);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const who = member.partner.company ? `${member.partner.name} (${member.partner.company})` : member.partner.name;
    const { error } = await db.from("staff_notes").insert({
      user_id: client.clientId,
      author: member.userId,
      author_name: `Socio · ${member.partner.name}`.slice(0, 80),
      body: `Mensaje del socio ${who}, para el especialista. No lo ve el cliente.\n\n${input.text}`.slice(0, 2000),
    });
    if (error) throw new Error(error.message);
    await notifyTeam(`Un socio escribió al equipo sobre un cliente (${client.clientId}). Está en las notas del cliente.`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: "api/partners/portal:write", userId: member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
