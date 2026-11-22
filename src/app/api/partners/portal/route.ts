import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/errors";
import { commissionFromRow, requirePartner } from "@/lib/partners/server";
import { commissionTotals, REFERRAL_STATUSES, type PartnerReferral, type ReferralStatus } from "@/lib/partners/rules";
import { rateLimit } from "@/lib/security/rateLimit";

// The partner portal's data, read through the partner's OWN connection only:
// their partner row, partner_referrals() (first name, last initial, date,
// coarse status) and their commission records. Row level security (migration
// 0017) is what limits it; nothing here reads with the service role.

type Row = Record<string, unknown>;

export async function GET(req: Request) {
  const limited = rateLimit(req, "partners-portal", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requirePartner();
  if (!allowed.ok) return allowed.response;
  const { member, reader } = allowed;
  try {
    const [referrals, commissions] = await Promise.all([
      reader.rpc("partner_referrals"),
      reader.from("partner_commissions").select("id, partner_id, kind, amount_cents, referral_id, note, recorded_at, recorded_by_name").order("recorded_at", { ascending: false }),
    ]);
    if (referrals.error) throw new Error(referrals.error.message);
    if (commissions.error) throw new Error(commissions.error.message);
    const list: PartnerReferral[] = (((referrals.data as Row[] | null) ?? []) as Row[]).map((r) => ({
      id: String(r.referral_id),
      firstName: String(r.first_name ?? ""),
      lastInitial: String(r.last_initial ?? ""),
      referredAt: String(r.referred_at ?? ""),
      status: ((REFERRAL_STATUSES as readonly string[]).includes(String(r.status)) ? r.status : "contacted") as ReferralStatus,
    }));
    const records = ((commissions.data as Row[] | null) ?? []).map((row) => commissionFromRow(row));
    const p = member.partner;
    return NextResponse.json({
      partner: { name: p.name, company: p.company, kind: p.kind, referralCode: p.referralCode },
      referrals: list,
      commissions: {
        ...commissionTotals(records),
        records: records.map((r) => ({ id: r.id, kind: r.kind, amountCents: r.amountCents, note: r.note, recordedAt: r.recordedAt })),
      },
    });
  } catch (error) {
    await reportError(error, { where: "api/partners/portal", userId: member.userId });
    return NextResponse.json({ error: "Could not read the portal." }, { status: 500 });
  }
}
