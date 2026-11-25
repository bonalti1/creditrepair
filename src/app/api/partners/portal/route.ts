import { NextResponse } from "next/server";
import { z } from "zod";
import { notifyTeam } from "@/lib/agreement/server";
import { reportError } from "@/lib/observability/errors";
import { commissionFromRow, requirePartner } from "@/lib/partners/server";
import { commissionTotals } from "@/lib/partners/rules";
import { addPartnerNote, loadReferrals, requestShare } from "@/lib/partners/portalServer";
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
//   settings      milestone notices by email and/or WhatsApp, and the weekly
//                 summary's channel (or off); never SMS;
//   language      the language the partner reads the portal in, which their
//                 milestone notices go out in (partners.locale, migration 0024);
//   logo          a small image for co-branding, shown to clients only after
//                 an administrator approves it (or null to remove it);
//   ask_share     "Ask to follow progress": a person they referred, with an
//                 account, not sharing, not asked in 14 days (migration 0033;
//                 the database checks again). The client gets a card in their
//                 app and one message; the partner sees only the date;
//   message       a note to the team about a client who shares with them (the
//                 thread on that client's page, migration 0033), after the
//                 guardrails: no promises, no credit data. Never shown to the
//                 client.

type Row = Record<string, unknown>;

export async function GET(req: Request) {
  const limited = rateLimit(req, "partners-portal", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requirePartner();
  if (!allowed.ok) return allowed.response;
  const { member, reader } = allowed;
  try {
    const [list, fees, own, terms] = await Promise.all([
      loadReferrals(reader),
      commissionsEnabled(reader),
      reader.from("partners").select("logo_status, notify_email, notify_whatsapp, digest_channel, email, locale").eq("id", member.partner.id).maybeSingle(),
      reader.from("partner_terms_acceptances").select("accepted_at").eq("version", PARTNER_CLIENT_TERMS_VERSION).limit(1),
    ]);
    let commissions: null | ReturnType<typeof commissionTotals> & { records: Array<{ id: string; kind: "owed" | "paid"; amountCents: number; note: string | null; recordedAt: string }> } = null;
    if (fees) {
      const { data, error } = await reader.from("partner_commissions").select("id, partner_id, kind, amount_cents, referral_id, note, recorded_at, recorded_by_name").order("recorded_at", { ascending: false });
      if (error) throw new Error(error.message);
      const records = ((data as Row[] | null) ?? []).map((row) => commissionFromRow(row));
      commissions = { ...commissionTotals(records), records: records.map((r) => ({ id: r.id, kind: r.kind, amountCents: r.amountCents, note: r.note, recordedAt: r.recordedAt })) };
    }
    const accepted = ((terms.data as Row[] | null) ?? []).length > 0;
    const clients = accepted ? await loadPartnerClients(reader) : [];
    // "Connect me with a loan officer" (migration 0030): only what the client agreed to send.
    const intros = accepted ? await reader.rpc("partner_intro_requests") : { data: [], error: null };
    const introRequests = intros.error
      ? []
      : ((intros.data as Row[] | null) ?? []).map((r) => ({
          id: String(r.request_id),
          name: String(r.display_name ?? "").trim(),
          phone: typeof r.phone_e164 === "string" ? r.phone_e164 : null,
          goal: typeof r.goal === "string" ? r.goal : null,
          at: new Date(String(r.requested_at)).toISOString(),
        }));
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
        digestChannel: settings.digest_channel === "whatsapp" || settings.digest_channel === "email" ? settings.digest_channel : null,
        hasEmail: typeof settings.email === "string" && settings.email !== "",
        locale: settings.locale === "es" ? "es" : "en",
      },
      program: { commissionsEnabled: fees },
      terms: { accepted, version: PARTNER_CLIENT_TERMS_VERSION },
      referrals: list,
      commissions,
      clients,
      introRequests,
    });
  } catch (error) {
    await reportError(error, { where: "api/partners/portal", userId: member.userId });
    return NextResponse.json({ error: "Could not read the portal." }, { status: 500 });
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept_terms"), locale: z.enum(["es", "en"]), version: z.string().max(40), textHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ action: z.literal("settings"), notifyEmail: z.boolean(), notifyWhatsapp: z.boolean(), digestChannel: z.enum(["whatsapp", "email"]).nullable().optional() }),
  z.object({ action: z.literal("ask_share"), referralId: z.string().uuid() }),
  z.object({ action: z.literal("language"), locale: z.enum(["es", "en"]) }),
  z.object({ action: z.literal("logo"), dataUrl: z.string().max(210_000).nullable() }),
  z.object({ action: z.literal("message"), clientId: z.string().uuid(), text: z.string().trim().min(2).max(1500), locale: z.enum(["es", "en"]).optional() }),
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
      const { error } = await db
        .from("partners")
        .update({ notify_email: input.notifyEmail, notify_whatsapp: input.notifyWhatsapp, ...(input.digestChannel !== undefined ? { digest_channel: input.digestChannel } : {}) })
        .eq("id", partnerId);
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

    if (input.action === "ask_share") {
      const result = await requestShare(db, reader, member, input.referralId);
      if (!result.ok) return NextResponse.json({ error: "Not possible", code: result.code }, { status: result.status });
      return NextResponse.json({ ok: true, requestedAt: result.requestedAt });
    }

    // message: only about a client who shares with this partner right now (their own connection decides).
    const result = await addPartnerNote(db, reader, member, input.clientId, input.text, input.locale ?? member.partner.locale ?? "en");
    if (!result.ok) return NextResponse.json({ error: "Not sent", code: result.code, problems: result.problems }, { status: result.status });
    await notifyTeam(`Un socio escribió al equipo sobre un cliente (${input.clientId}). Está en «Notas con el socio» del cliente.`);
    return NextResponse.json({ ok: true, note: result.note });
  } catch (error) {
    await reportError(error, { where: "api/partners/portal:write", userId: member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
