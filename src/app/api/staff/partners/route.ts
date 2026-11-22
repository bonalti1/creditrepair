import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { commissionFromRow, partnerFromRow } from "@/lib/partners/server";
import { checkCommissionTerms, decidePartner, dollarsToCents } from "@/lib/partners/rules";
import { checkProgramChange } from "@/lib/partners/program";
import { currentShares, type ConsentRecord } from "@/lib/partners/sharingStaff";
import { loadProgram } from "@/lib/partners/sharingServer";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { loadTeam } from "@/lib/staff/server";

// Referral partners, for the staff screen /equipo/socios.
//
// GET   administrators and sales (partners.view): the partners. Administrators
//       also get the commission records; sales does not.
// POST  administrators only (partners.manage):
//         set_status       approve (gives the referral code), decline, suspend, reactivate;
//         set_commission   how a commission is earned and how much (never per result);
//         set_salesperson  who follows up the partner's referrals;
//         record_commission an amount owed or paid, recorded by hand. The app pays nobody.
//         set_program      "Comisiones a socios" on or off. On needs the attorney's
//                          name, the approval date and the confirmation box;
//                          recorded with who and when (partner_program_changes).
//                          While off, set_commission (other than none) and
//                          record_commission are refused here and by the database.
//         set_logo         approve or reject a partner's co-branding logo.
// Every change goes to team_audit (the program and logos to their own records).
// Writes use the service role after the role check.
//
// GET also returns the program setting, and who shares with which partner at
// what level (administrators and sales), and, for administrators, the log of
// partner views of client pages.

type Row = Record<string, unknown>;

const id = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_status"), id, status: z.string().max(20) }),
  z.object({ action: z.literal("set_commission"), id, basis: z.string().max(20), amount: z.union([z.string().max(20), z.number()]).optional().nullable(), note: z.string().max(500).optional().nullable() }),
  z.object({ action: z.literal("set_salesperson"), id, handle: z.string().regex(/^[a-z0-9-]{2,30}$/).nullable() }),
  z.object({ action: z.literal("record_commission"), id, kind: z.enum(["owed", "paid"]), amount: z.union([z.string().max(20), z.number()]), note: z.string().max(300).optional().nullable(), referralId: id.optional().nullable() }),
  z.object({ action: z.literal("set_program"), enabled: z.boolean(), attorneyName: z.string().max(200).optional().nullable(), attorneyApprovedOn: z.string().max(20).optional().nullable(), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal("set_logo"), id, status: z.enum(["approved", "rejected"]) }),
]);

/** Sharing as the staff screen shows it: the current pairs, and (administrators) the view log. */
async function loadSharing(db: import("@supabase/supabase-js").SupabaseClient, admin: boolean) {
  const [{ data: consents, error }, { data: views }] = await Promise.all([
    db.from("partner_share_consents").select("seq, user_id, partner_id, level, how, created_at").order("seq", { ascending: true }),
    admin ? db.from("partner_view_log").select("partner_id, user_id, viewed_at").order("viewed_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] as Row[] }),
  ]);
  if (error) throw new Error(error.message);
  const records: ConsentRecord[] = ((consents as Row[] | null) ?? []).map((r) => ({
    seq: Number(r.seq),
    clientId: String(r.user_id),
    partnerId: String(r.partner_id),
    level: String(r.level) as ConsentRecord["level"],
    how: r.how === "added_by_code" ? "added_by_code" : "referred",
    at: new Date(String(r.created_at)).toISOString(),
  }));
  const viewRows = (views as Row[] | null) ?? [];
  const ids = [...new Set([...records.map((r) => r.clientId), ...viewRows.map((v) => String(v.user_id))])];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await db.from("profiles").select("id, full_name").in("id", ids);
    for (const p of (profiles as Row[] | null) ?? []) names.set(String(p.id), String(p.full_name ?? "").trim());
  }
  const nameOf = (id: string) => names.get(id) || "Cliente";
  return {
    shares: currentShares(records, nameOf),
    views: viewRows.map((v) => ({ partnerId: String(v.partner_id), clientId: String(v.user_id), clientName: nameOf(String(v.user_id)), at: new Date(String(v.viewed_at)).toISOString() })),
  };
}

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-partners-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("partners.view");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  try {
    const { data, error } = await db.from("partners").select("*").order("applied_at", { ascending: false });
    if (error) throw new Error(error.message);
    const admin = member.role === "admin";
    // Only an administrator sees a logo waiting for review.
    const partners = ((data as Row[] | null) ?? []).map(partnerFromRow).map((p) => (admin || p.logoStatus === "approved" ? p : { ...p, logo: null }));
    const [program, sharing] = await Promise.all([loadProgram(db), loadSharing(db, admin)]);
    if (!admin) return NextResponse.json({ partners, commissions: [], program, ...sharing });
    const { data: records, error: recordsError } = await db.from("partner_commissions").select("*").order("recorded_at", { ascending: true });
    if (recordsError) throw new Error(recordsError.message);
    return NextResponse.json({ partners, commissions: ((records as Row[] | null) ?? []).map((r) => commissionFromRow(r)), program, ...sharing });
  } catch (error) {
    await reportError(error, { where: "api/staff/partners:read", userId: member.userId });
    return NextResponse.json({ error: "Could not read the partners." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-partners", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;

  const allowed = await requireCapability("partners.manage");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const now = new Date();
  try {
    if (input.action === "set_program") {
      const change = checkProgramChange(input, now);
      if (!change.ok) return NextResponse.json({ error: "Invalid", message: change.message }, { status: 422 });
      const current = await loadProgram(db);
      if (current.commissionsEnabled === change.value.enabled) return NextResponse.json({ ok: true, program: current });
      const { error } = await db.from("partner_program_changes").insert({
        commissions_enabled: change.value.enabled,
        attorney_name: change.value.attorneyName,
        attorney_approved_on: change.value.attorneyApprovedOn,
        confirmed: change.value.confirmed,
        changed_by: member.userId,
        changed_by_name: member.handle,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, program: await loadProgram(db) });
    }

    const { data: row } = await db.from("partners").select("*").eq("id", input.id).maybeSingle();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const partner = partnerFromRow(row as Row);
    const audit = (kind: string, detail: Record<string, unknown>) =>
      db.from("team_audit").insert({ actor: member.userId, kind, detail: { partner: partner.id, ...detail } });

    if (input.action === "set_status") {
      const { data: codes } = await db.from("partners").select("referral_code");
      const taken = ((codes as Row[] | null) ?? []).map((c) => c.referral_code).filter((c): c is string => typeof c === "string");
      const change = decidePartner(partner, input.status, taken, now);
      if (!change.ok) return NextResponse.json({ error: "Not allowed", message: change.message }, { status: 409 });
      if (change.partner.status === partner.status) return NextResponse.json({ ok: true, partner });
      const { error } = await db
        .from("partners")
        .update({ status: change.partner.status, referral_code: change.partner.referralCode, decided_at: now.toISOString(), decided_by: member.userId })
        .eq("id", partner.id);
      if (error) throw new Error(error.message);
      await audit("partner_status_changed", { from: partner.status, to: change.partner.status });
      return NextResponse.json({ ok: true, partner: change.partner });
    }

    if (input.action === "set_logo") {
      if (partner.logoStatus === "none") return NextResponse.json({ error: "Not found", message: "Este socio no ha enviado un logo." }, { status: 404 });
      const { error } = await db.from("partners").update({ logo_status: input.status, logo_decided_at: now.toISOString(), logo_decided_by: member.userId }).eq("id", partner.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, partner: { ...partner, logoStatus: input.status } });
    }

    const feesOff = !(await loadProgram(db)).commissionsEnabled;
    const OFF = { error: "Not allowed", message: "Las comisiones a socios están apagadas. Una persona administradora las enciende cuando el abogado lo apruebe." };

    if (input.action === "set_commission") {
      if (feesOff && input.basis !== "none") return NextResponse.json(OFF, { status: 409 });
      const terms = checkCommissionTerms(input.basis, input.amount);
      if (!terms.ok) return NextResponse.json({ error: "Invalid", message: terms.message }, { status: 422 });
      const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
      const { error } = await db.from("partners").update({ commission_basis: terms.basis, commission_cents: terms.cents, commission_note: note }).eq("id", partner.id);
      if (error) throw new Error(error.message);
      await audit("partner_commission_set", { basis: terms.basis, cents: terms.cents });
      return NextResponse.json({ ok: true, partner: { ...partner, commissionBasis: terms.basis, commissionCents: terms.cents, commissionNote: note } });
    }

    if (input.action === "set_salesperson") {
      if (input.handle) {
        const { state } = await loadTeam(db);
        const target = state.members.find((m) => m.handle === input.handle);
        if (!target || !target.active || target.role === "specialist") {
          return NextResponse.json({ error: "Not allowed", message: "Elige a alguien activo de ventas o de administración." }, { status: 409 });
        }
      }
      const { error } = await db.from("partners").update({ salesperson: input.handle }).eq("id", partner.id);
      if (error) throw new Error(error.message);
      await audit("partner_status_changed", { salesperson: input.handle });
      return NextResponse.json({ ok: true, partner: { ...partner, salesperson: input.handle } });
    }

    // record_commission
    if (feesOff) return NextResponse.json(OFF, { status: 409 });
    const cents = dollarsToCents(input.amount);
    if (cents === null || cents < 1 || cents > 1_000_000) return NextResponse.json({ error: "Invalid", message: "Escribe un monto entre $0.01 y $10,000." }, { status: 422 });
    if (partner.status === "pending" || partner.status === "declined") {
      return NextResponse.json({ error: "Not allowed", message: "Solo se registran comisiones de socios aprobados o suspendidos." }, { status: 409 });
    }
    const { data: record, error } = await db
      .from("partner_commissions")
      .insert({
        partner_id: partner.id,
        kind: input.kind,
        amount_cents: cents,
        referral_id: input.referralId ?? null,
        note: input.note?.trim() ? input.note.trim().slice(0, 300) : null,
        recorded_by: member.userId,
        recorded_by_name: member.handle,
      })
      .select("*")
      .single();
    if (error || !record) throw new Error(error?.message ?? "no row");
    await audit("partner_commission_recorded", { kind: input.kind, cents });
    return NextResponse.json({ ok: true, record: commissionFromRow(record as Row) });
  } catch (error) {
    await reportError(error, { where: "api/staff/partners", userId: member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
