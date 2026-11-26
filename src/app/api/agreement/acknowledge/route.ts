import { NextResponse } from "next/server";
import { z } from "zod";
import { agreementVersionFor, disclosureHash } from "@/lib/agreement/documents";
import { agreementReadiness } from "@/lib/agreement/readiness";
import { agreementFromRow } from "@/lib/agreement/record";
import { AGREEMENT_TABLE, loadAgreementRow, loadSigningState } from "@/lib/agreement/server";
import { resolveTerms, withOption, withPlan } from "@/lib/agreement/terms";
import { optionOfTerms } from "@/lib/service/options";
import { loadClientOption } from "@/lib/service/server";
import { offeredSnapshot } from "@/lib/billing/planStore";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// Step 1 of the agreement: the client received and read the disclosure
// statements. Federal law wants them given as a separate document before the
// contract (15 U.S.C. §1679c(b)), so the acknowledgement is its own record
// with its own time, and the signing endpoint refuses a signature that has no
// earlier acknowledgement.
//
// The time is the server's. The client says which version and language it was
// shown and a hash of the text; the server checks that hash against the text
// it would show, so the record is of exactly what was on screen.

const bodySchema = z.object({
  version: z.string().min(1).max(60),
  locale: z.enum(["es", "en"]),
  disclosureHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Consent to receive and sign these records electronically. Must be given. */
  esignConsent: z.literal(true),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "agreement-acknowledge", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { version, locale } = parsed.data;

  // Unreviewed text is never put in front of a real client for acknowledgement or signature.
  // The plan the client is offered is part of the text (the Texas statement prints its costs).
  // The option they chose decides which agreement (Credalti Complete or Credalti DIY, migration 0042).
  const choice = await loadClientOption(db, user.id);
  const option = choice.chosen ?? choice.option;
  const AGREEMENT_VERSION = agreementVersionFor(option);
  const terms = withOption(withPlan(resolveTerms(), await offeredSnapshot(db, user.id, option).catch(() => null)), option);
  // The client's state: opened by Credalti (migration 0030), and with its own agreement documents (stateDocuments.ts).
  const signing = await loadSigningState(db, user.id);
  if (!signing.open) {
    return NextResponse.json({ error: "We are not taking clients in this state yet.", code: "state_not_open" }, { status: 409 });
  }
  const readiness = agreementReadiness({ terms, state: signing.state });
  if (!readiness.ready) {
    return NextResponse.json(
      { error: "The agreement is not ready to be signed yet.", code: "agreement_not_ready" },
      { status: 409 },
    );
  }
  if (version !== AGREEMENT_VERSION) {
    return NextResponse.json({ error: "The agreement text changed. Reload the page.", code: "version_changed" }, { status: 409 });
  }
  const expectedHash = disclosureHash(AGREEMENT_VERSION, locale, terms);
  if (parsed.data.disclosureHash !== expectedHash) {
    return NextResponse.json({ error: "The disclosure text changed. Reload the page.", code: "document_changed" }, { status: 409 });
  }

  try {
    const current = await loadAgreementRow(db, user.id);
    // A signed agreement for the OTHER option is a switch: the new option's disclosures are acknowledged as a new row.
    const switching = Boolean(current?.signed_at && !current.cancelled_at && optionOfTerms(current.terms) !== option);
    if (current && !current.cancelled_at && !switching) {
      if (current.signed_at) {
        return NextResponse.json(
          { error: "The agreement is already signed.", code: "already_signed", agreement: agreementFromRow(current) },
          { status: 409 },
        );
      }
      // Already acknowledged this same text: the first acknowledgement stands, with its time.
      if (current.document_version === AGREEMENT_VERSION && current.disclosure_hash === expectedHash) {
        return NextResponse.json({ ok: true, agreement: agreementFromRow(current) });
      }
    }

    const { data: row, error } = await db
      .from(AGREEMENT_TABLE)
      .insert({
        user_id: user.id,
        document_version: AGREEMENT_VERSION,
        disclosure_locale: locale,
        disclosure_hash: expectedHash,
        disclosure_acknowledged_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "insert returned no row");

    await db.from("events").insert({
      user_id: user.id,
      kind: "agreement_disclosure_acknowledged",
      payload: { version: AGREEMENT_VERSION, locale, option, ...(switching ? { switching: true } : {}) },
    });
    return NextResponse.json({ ok: true, agreement: agreementFromRow(row as Record<string, unknown>) });
  } catch (error) {
    await reportError(error, { where: "api/agreement/acknowledge", userId: user.id });
    return NextResponse.json({ error: "Could not record the acknowledgement. Please try again." }, { status: 500 });
  }
}
