import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_STATES } from "@/lib/compliance/states";
import { stripForbiddenFields } from "@/lib/highlevel/lead";
import { receiveLead } from "@/lib/leads/server";
import { reportError } from "@/lib/observability/errors";
import { PARTNER_COPY } from "@/lib/partners/copy";
import { requirePartner } from "@/lib/partners/server";
import { GOALS, type GoalKey } from "@/lib/sales/invite";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { cleanPersonName, normalizePhone } from "@/lib/staff/team";

// "Enviar un referido", from the partner portal. The person becomes a prospect
// (source "partner", the partner on it, the partner's salesperson or the next
// one in turn) through the same path as a HighLevel lead (leads/server.ts).
//
// Only a name and a phone, and the partner's confirmation that the person
// agreed to be contacted (stored with the prospect). Never an SSN, a date of
// birth or a report: a field that looks like one is dropped before anything
// reads the body. The answer is the same whether the person was new or
// already in touch with us, so a partner cannot use the form to learn who is
// a client; someone already in touch is not attributed to the partner.

const bodySchema = z.object({
  firstName: z.string().max(80),
  lastName: z.string().max(80),
  phone: z.string().max(40),
  state: z.string().max(4).optional().nullable(),
  goal: z.string().max(20).optional().nullable(),
  consent: z.literal(true),
});

export async function POST(req: Request) {
  const allowed = await requirePartner();
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const limited = rateLimit(req, "partner-referrals", { limit: 30, windowMs: 60 * 60_000, subject: member.partner.id });
  if (limited) return limited;

  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const { body: clean } = stripForbiddenFields(body.data);
  const parsed = bodySchema.safeParse(clean);
  if (!parsed.success) return NextResponse.json({ error: "Invalid", problems: { consent: parsed.error.issues.some((i) => i.path[0] === "consent") } }, { status: 400 });

  const firstName = cleanPersonName(parsed.data.firstName, 40);
  const lastName = cleanPersonName(parsed.data.lastName, 40);
  const phone = normalizePhone(parsed.data.phone);
  const state = (parsed.data.state ?? member.partner.state ?? "TX").toUpperCase();
  const problems = {
    ...(firstName ? {} : { firstName: "invalid" }),
    ...(lastName ? {} : { lastName: "invalid" }),
    ...(phone ? {} : { phone: "invalid" }),
    ...((ALL_STATES as readonly string[]).includes(state) ? {} : { state: "invalid" }),
  };
  if (Object.keys(problems).length > 0) return NextResponse.json({ error: "Invalid", problems }, { status: 422 });
  const goal: GoalKey = GOALS.some((g) => g.key === parsed.data.goal) ? (parsed.data.goal as GoalKey) : "general";

  try {
    const now = new Date();
    await receiveLead(
      db,
      {
        source: "partner",
        firstName: firstName!,
        lastName: lastName!,
        phone: phone!,
        email: null,
        state,
        goal,
        contactId: null,
        campaign: null,
        utm: null,
        consentText: PARTNER_COPY.es.referralConsent,
        consentAt: now.toISOString(),
        salespersonHint: null,
        partner: { id: member.partner.id, salesperson: member.partner.salesperson },
      },
      now,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportError(error, { where: "api/partners/referrals", userId: member.userId });
    return NextResponse.json({ error: "Could not send it." }, { status: 500 });
  }
}
