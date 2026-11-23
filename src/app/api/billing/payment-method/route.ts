import { NextResponse } from "next/server";
import { z } from "zod";
import { loadAgreement, notifyTeam } from "@/lib/agreement/server";
import { looksLikeCardNumber, paymentMethodBodySchema } from "@/lib/billing/api";
import { PAYMENT_AUTHORIZATION_VERSION, paymentAuthorizationHash } from "@/lib/billing/authorization";
import { getPaymentGateway } from "@/lib/billing/gateway";
import { ACH_AUTHORIZATION_VERSION, achAuthorizationHash } from "@/lib/billing/achAuthorization";
import { readPlanSnapshot } from "@/lib/billing/plans";
import { achAuthorizationApproved, paymentAuthorizationApproved } from "@/lib/billing/readiness";
import { loadBilling, runBillingForUser } from "@/lib/billing/server";
import { BRAND } from "@/lib/brand";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// The client's payment method.
//
// POST accepts exactly two things: a TOKEN from the processor's hosted fields,
// and the client's acceptance of the recurring-payment authorization (its
// version, language and the hash of the text they were shown). It never
// accepts a card number: a body that carries one is refused before anything
// is stored or logged, and no field of this app could hold it.
//
// What is stored: the processor's reference to the method (server only), the
// brand and the last four digits, and the record of the authorization.
//
// Putting a method on file charges nothing by itself. If a charge for a round
// already mailed was declined earlier, it gets one more try at once, so that
// fixing the payment resumes the case without waiting for the hourly run.
//
// DELETE withdraws the authorization: the method is marked removed, its token
// is wiped, and no automatic charge is made from then on.

export async function POST(req: Request) {
  const limited = rateLimit(req, "billing-payment-method", { limit: 6, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  // Said plainly, and first: this endpoint takes a token, never a card.
  const raw = body.data as { token?: unknown } | null;
  if (raw && typeof raw.token === "string" && looksLikeCardNumber(raw.token)) {
    return NextResponse.json(
      { error: "Card numbers are never sent to this app. Use the payment processor's secure fields.", code: "card_number_refused" },
      { status: 400 },
    );
  }
  const parsed = paymentMethodBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { token, authorization } = parsed.data;
  const kind = parsed.data.kind ?? "card";

  const resolution = getPaymentGateway();
  if (!resolution.configured) {
    return NextResponse.json({ error: resolution.message, code: "gateway_not_configured" }, { status: 503 });
  }
  const gateway = resolution.gateway;
  if (kind === "ach" && !gateway.attachBankAccount) {
    return NextResponse.json({ error: "This payment processor does not take bank accounts.", code: "ach_not_available" }, { status: 409 });
  }
  // Real money: only under an authorization text an attorney approved (the ACH one for a bank account).
  if (gateway.live && !(kind === "ach" ? achAuthorizationApproved() : paymentAuthorizationApproved())) {
    return NextResponse.json(
      { error: "The payment authorization is not ready to be accepted yet.", code: "authorization_not_ready" },
      { status: 409 },
    );
  }

  try {
    // A payment method belongs to a signed agreement: the authorization quotes its fee.
    const agreement = await loadAgreement(db, user.id);
    if (!agreement?.signedAt || agreement.cancelledAt) {
      return NextResponse.json(
        { error: "A signed service agreement comes first.", code: "agreement_required" },
        { status: 409 },
      );
    }
    const terms = {
      companyLegalName: agreement.terms?.companyLegalName ?? null,
      companyEmail: agreement.terms?.companyEmail ?? null,
      monthlyFee: agreement.terms?.monthlyFee ?? null,
      plan: readPlanSnapshot((agreement.terms as { plan?: unknown } | null)?.plan),
    };
    // The browser says what it was showing; it must be what the server would show.
    const version = kind === "ach" ? ACH_AUTHORIZATION_VERSION : PAYMENT_AUTHORIZATION_VERSION;
    const expected = kind === "ach" ? achAuthorizationHash(version, authorization.locale, terms) : paymentAuthorizationHash(version, authorization.locale, terms);
    if (authorization.version !== version || authorization.hash !== expected) {
      return NextResponse.json(
        { error: "The authorization text changed. Reload the page.", code: "authorization_changed" },
        { status: 409 },
      );
    }

    const before = await loadBilling(db, user.id, { withHandle: true });
    const customerRef = before.handle?.customerRef ?? (await gateway.createCustomer({ userId: user.id })).customerRef;
    const bank = kind === "ach" ? await gateway.attachBankAccount!({ customerRef, token }) : null;
    const attached = bank
      ? bank.ok
        ? { ok: true as const, paymentMethodRef: bank.paymentMethodRef, brand: bank.accountType, last4: bank.last4 }
        : bank
      : await gateway.attachPaymentMethod({ customerRef, token });
    if (!attached.ok) {
      return NextResponse.json(
        { error: "The payment method was not accepted. Nothing was saved or charged.", code: "payment_method_refused" },
        { status: 422 },
      );
    }

    const now = new Date();
    // One method in use at a time: the old one is marked removed and its token wiped.
    if (before.paymentMethodId) {
      await db.from("payment_method_vault").delete().eq("payment_method_id", before.paymentMethodId);
      const { error: removeError } = await db
        .from("payment_methods")
        .update({ removed_at: now.toISOString() })
        .eq("id", before.paymentMethodId);
      if (removeError) throw new Error(removeError.message);
      if (before.handle && gateway.detachPaymentMethod) await gateway.detachPaymentMethod(before.handle).catch(() => undefined);
    }
    const { data: method, error: methodError } = await db
      .from("payment_methods")
      .insert({
        user_id: user.id,
        gateway: gateway.name,
        kind,
        brand: attached.brand.toLowerCase().slice(0, 30),
        last4: attached.last4,
        authorization_version: version,
        authorization_locale: authorization.locale,
        authorization_hash: authorization.hash,
        authorized_at: now.toISOString(),
        authorized_ip: clientIp(req).slice(0, 80),
        authorized_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400),
      })
      .select("id")
      .single();
    if (methodError || !method) throw new Error(methodError?.message ?? "insert returned no row");
    const { error: vaultError } = await db
      .from("payment_method_vault")
      .insert({ payment_method_id: method.id, customer_ref: customerRef, payment_method_ref: attached.paymentMethodRef });
    if (vaultError) throw new Error(vaultError.message);

    await db.from("events").insert({
      user_id: user.id,
      kind: "payment_method_added",
      payload: { kind, brand: attached.brand, last4: attached.last4, authorizationVersion: version },
    });

    // A charge declined earlier gets one more try now (the same charge, never a new one).
    await db.from("charges").update({ next_attempt_at: now.toISOString() }).eq("user_id", user.id).eq("status", "failed");
    // The same run the hourly billing makes, with every rule (no charge before the work, one per round,
    // never more often than every 30 days): only a charge already owed is tried, never a new one early.
    const run = await runBillingForUser(db, gateway, user.id, now, { afterCardUpdate: true });

    return NextResponse.json({ ok: true, paymentMethod: { brand: attached.brand, last4: attached.last4 }, settled: run.paid, declined: run.declined + run.exhausted });
  } catch (error) {
    await reportError(error, { where: "api/billing/payment-method", userId: user.id });
    return NextResponse.json({ error: "Could not save the payment method. Please try again." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const limited = rateLimit(req, "billing-payment-method", { limit: 6, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  try {
    // Withdrawing never depends on a processor being configured.
    const before = await loadBilling(db, user.id, { withHandle: true });
    if (!before.paymentMethodId) return NextResponse.json({ ok: true, removed: false });
    await db.from("payment_method_vault").delete().eq("payment_method_id", before.paymentMethodId);
    const { error } = await db.from("payment_methods").update({ removed_at: new Date().toISOString() }).eq("id", before.paymentMethodId);
    if (error) throw new Error(error.message);
    const resolution = getPaymentGateway();
    if (resolution.configured && before.handle && resolution.gateway.detachPaymentMethod) {
      await resolution.gateway.detachPaymentMethod(before.handle).catch(() => undefined);
    }
    await db.from("events").insert({ user_id: user.id, kind: "payment_method_removed", payload: {} });
    await notifyTeam(`${BRAND.name}: un cliente quitó su método de pago y retiró su autorización de cobros. No se le cobra nada de forma automática. Cuenta: ${user.id}`);
    return NextResponse.json({ ok: true, removed: true });
  } catch (error) {
    await reportError(error, { where: "api/billing/payment-method", userId: user.id });
    return NextResponse.json({ error: "Could not remove the payment method. Please try again, or write to the team." }, { status: 500 });
  }
}
