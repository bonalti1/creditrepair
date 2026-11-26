import { NextResponse } from "next/server";
import { z } from "zod";
import { cancellationDeadline } from "@/lib/agreement/businessDays";
import { agreementVersionFor, disclosureHash, documentHash } from "@/lib/agreement/documents";
import { agreementReadiness } from "@/lib/agreement/readiness";
import { agreementFromRow } from "@/lib/agreement/record";
import { AGREEMENT_TABLE, loadAgreementRow, loadGoverningAgreementRow, loadSigningState } from "@/lib/agreement/server";
import { isFullName, signerNameMatches } from "@/lib/agreement/signature";
import { resolveTerms, withOption, withPlan } from "@/lib/agreement/terms";
import { optionOfTerms } from "@/lib/service/options";
import { loadClientOption, recordOptionChoice } from "@/lib/service/server";
import { offeredSnapshot } from "@/lib/billing/planStore";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// Step 2 of the agreement: the signature.
//
// Everything that makes the record is decided here, on the server: the time,
// the cancellation deadline (the end of the 3rd business day after signing),
// the terms printed in the contract and the hash of the text. The browser only
// says what it was showing; if that is not what the server would show now, the
// signature is refused and the client reloads.
//
// Refused when:
//   - the text is not attorney-approved or the terms are incomplete (409);
//   - there is no earlier acknowledgement of the disclosure for this version (409);
//   - the typed name is not a full name, or does not match the profile (422).

const bodySchema = z.object({
  fullName: z.string().min(3).max(120),
  version: z.string().min(1).max(60),
  locale: z.enum(["es", "en"]),
  documentHash: z.string().regex(/^[0-9a-f]{64}$/),
  // Each consent is its own checkbox on the screen; all three are required.
  consents: z.object({
    contract: z.literal(true),
    authorization: z.literal(true),
    esign: z.literal(true),
  }),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "agreement-sign", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await readJsonBody(req, 3_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { locale } = parsed.data;
  const fullName = parsed.data.fullName.replace(/\s+/g, " ").trim();

  // The plan offered to this client, as the snapshot the signature keeps (terms.plan). The database
  // checks it is exactly an active, attorney-approved plan version (migration 0026).
  // The option the client chose decides which agreement they sign (migration 0042).
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
  if (parsed.data.version !== AGREEMENT_VERSION) {
    return NextResponse.json({ error: "The agreement text changed. Reload the page.", code: "version_changed" }, { status: 409 });
  }
  const expectedHash = documentHash(AGREEMENT_VERSION, locale, terms);
  if (parsed.data.documentHash !== expectedHash) {
    return NextResponse.json({ error: "The agreement text changed. Reload the page.", code: "document_changed" }, { status: 409 });
  }
  if (!isFullName(fullName)) {
    return NextResponse.json({ error: "Type your full legal name.", code: "name_invalid" }, { status: 422 });
  }

  try {
    const current = await loadAgreementRow(db, user.id);
    if (current?.signed_at && !current.cancelled_at) {
      return NextResponse.json(
        { error: "The agreement is already signed.", code: "already_signed", agreement: agreementFromRow(current) },
        { status: 409 },
      );
    }
    // The disclosure comes first, as its own step, for this same version of the text.
    if (!current || current.cancelled_at || current.document_version !== AGREEMENT_VERSION) {
      return NextResponse.json(
        { error: "The disclosure statement has to be acknowledged before the contract.", code: "disclosure_not_acknowledged" },
        { status: 409 },
      );
    }

    // ...and for the same text: if the terms printed in the disclosure changed since, it is read again.
    const acknowledgedLocale = current.disclosure_locale === "en" ? "en" : "es";
    if (current.disclosure_hash !== disclosureHash(AGREEMENT_VERSION, acknowledgedLocale, terms)) {
      return NextResponse.json(
        { error: "The disclosure statement changed and has to be acknowledged again.", code: "disclosure_not_acknowledged" },
        { status: 409 },
      );
    }

    const { data: profile } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    if (!signerNameMatches(fullName, profile?.full_name as string | undefined)) {
      return NextResponse.json(
        { error: "The name does not match the name on the account.", code: "name_mismatch" },
        { status: 422 },
      );
    }

    // The agreement in force before this signature: when it is for the other option, this signature is a switch
    // and supersedes it (trigger service_agreements_supersede).
    const previous = await loadGoverningAgreementRow(db, user.id);
    const switchedFrom = previous?.signed_at && !previous.cancelled_at && previous.id !== current.id ? optionOfTerms(previous.terms) : null;

    const now = new Date();
    const deadline = cancellationDeadline(now);
    const { data: row, error } = await db
      .from(AGREEMENT_TABLE)
      .update({
        signer_name: fullName,
        signed_at: now.toISOString(),
        locale,
        document_hash: expectedHash,
        signer_ip: clientIp(req).slice(0, 80),
        signer_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400),
        terms,
        cancellation_deadline: deadline.toISOString(),
      })
      .eq("id", current.id as string)
      .is("signed_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      // Signed a moment ago from another tab: answer with what is on record.
      const latest = await loadAgreementRow(db, user.id);
      return NextResponse.json(
        { error: "The agreement is already signed.", code: "already_signed", agreement: latest ? agreementFromRow(latest) : null },
        { status: 409 },
      );
    }

    // A profile without a name takes the legal name just signed: letters go out under it.
    if (!profile?.full_name) {
      await db.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    }
    await db.from("events").insert({
      user_id: user.id,
      kind: "agreement_signed",
      payload: {
        version: AGREEMENT_VERSION,
        locale,
        cancellationDeadline: deadline.toISOString(),
        option,
        ...(terms.plan ? { plan: { key: terms.plan.key, version: terms.plan.version, termsHash: terms.plan.termsHash } } : {}),
      },
    });
    // The client's option is now the one they signed.
    if (choice.chosen !== option) await recordOptionChoice(db, user.id, option, "app", now);
    if (switchedFrom && switchedFrom !== option) {
      // Counted by the campaign scorecard (countUpgrades, docs/SERVICE-OPTIONS.md).
      await db.from("events").insert({
        user_id: user.id,
        kind: option === "full_service" ? "service_option_upgraded" : "service_option_downgraded",
        payload: { from: switchedFrom, to: option, fromAgreementId: previous?.id ?? null, toAgreementId: current.id },
      });
      // Credalti Complete mails every letter from now on: open "Mail them for me" requests end, never charged.
      if (option === "full_service") {
        await db
          .from("mail_requests")
          .update({ status: "cancelled", cancelled_at: now.toISOString(), cancel_reason: "Switched to Credalti Complete: the team mails every letter." })
          .eq("user_id", user.id)
          .eq("status", "requested");
      }
    }
    return NextResponse.json({ ok: true, agreement: agreementFromRow(row as Record<string, unknown>) });
  } catch (error) {
    await reportError(error, { where: "api/agreement/sign", userId: user.id });
    return NextResponse.json({ error: "Could not record the signature. Nothing was signed; please try again." }, { status: 500 });
  }
}
