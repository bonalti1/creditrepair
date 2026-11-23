"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isDemoMode } from "../agreement/readiness";
import { resolveTerms } from "../agreement/terms";
import type { ClientBillingPayload } from "../billing/api";
import { PAYMENT_AUTHORIZATION_VERSION, paymentAuthorizationHash, type AuthorizationTerms } from "../billing/authorization";
import { ACH_AUTHORIZATION_VERSION, achAuthorizationHash } from "../billing/achAuthorization";
import { createMemoryChargeStore, runClientBilling } from "../billing/collect";
import type { HostedFieldsConfig } from "../billing/gateway";
import { demoOfferedPlan, loadDemoCardBrands } from "../billing/planData";
import { brandRefused, DEFAULT_ACCEPTED_CARDS, type AcceptedCards } from "../billing/cardBrands";
import { readPlanSnapshot, type PlanSnapshot } from "../billing/plans";
import { rearmAfterNewPaymentMethod } from "../billing/dunning";
import { createDemoGateway } from "../billing/gateway";
import { paymentAuthorizationApproved } from "../billing/readiness";
import { feeToCents } from "../billing/rules";
import type { BillingContext, L } from "../billing/types";
import { readStoredAgreement } from "./agreementLocal";
import { demoChargeId, demoMethod, demoScenarioState, isDemoScenario, type DemoScenario } from "./billingDemo";
import { readDemoBilling, writeDemoBilling, writePaymentMethodOnFile, type DemoBillingState } from "./billingLocal";

// The client's billing, for the "Mis pagos" screen. Signed in: the server's
// record (GET /api/billing, RLS-scoped) is the source of truth and every
// change goes through the server. Signed out / demo: this device's storage
// only, with simulated payments, for demonstration.
// Same shape as the agreement store in agreementStore.ts.

export interface BillingView {
  /** True when nothing here is real: the device's own demo state. */
  demo: boolean;
  /** Demo only: which example situation is shown. "live" otherwise. */
  scenario: DemoScenario;
  /** What every sentence on the screen is derived from, with the same rules that charge. */
  context: BillingContext;
  authorizationTerms: AuthorizationTerms;
  /** False in the demo when no plan fee is configured: then no amount is printed anywhere. */
  showAmounts: boolean;
  /** A payment method can only be added under a signed agreement that was not cancelled. */
  agreementSigned: boolean;
  /** Whether a payment method can be put on file right now. */
  canAddMethod: boolean;
  /** True when the processor is the demo one: the form offers test cards and no money moves. */
  simulated: boolean;
  /** True when the authorization text is still a draft (not attorney-approved). */
  draft: boolean;
  /** The processor's hosted fields; null in the demo or when none is configured. */
  hostedFields: HostedFieldsConfig | null;
  /** True when a bank account (ACH) can be put on file. */
  canAddBank: boolean;
  /** The card brands the business takes: the screen says so before a card of another brand is sent. */
  acceptedCards: AcceptedCards;
}

/** The plan of the signed agreement on this device (demo), or, for an example situation, the catalogue's default. */
function demoPlan(scenario: string): PlanSnapshot | null {
  if (scenario === "live") {
    const stored = readStoredAgreement();
    return stored?.signedAt ? readPlanSnapshot((stored.terms as { plan?: unknown } | null)?.plan) : null;
  }
  return demoOfferedPlan();
}

/** An invoice number for an invented charge: stable per charge. */
function demoInvoice(id: string, at: string): string {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) % 1_000_000;
  return `INV-${at.slice(0, 4)}-${String(n).padStart(6, "0")}`;
}

export type BillingActionResult =
  | { ok: true; settled: number; declined: number }
  | {
      ok: false;
      /** A code the screen can turn into a sentence: the server's, or "network". */
      code: string;
    };

/** The amount the demo's rules work with when no plan fee is configured. Never printed. */
const DEMO_HIDDEN_FEE = "1.00";

function demoFee(): { fee: string; configured: boolean } {
  const stored = readStoredAgreement();
  const fee = (stored?.signedAt ? stored.terms?.monthlyFee : null) ?? resolveTerms().monthlyFee;
  return fee && feeToCents(fee) !== null ? { fee, configured: true } : { fee: DEMO_HIDDEN_FEE, configured: false };
}

function demoTerms(plan: PlanSnapshot | null = null): AuthorizationTerms {
  const stored = readStoredAgreement();
  const terms = (stored?.signedAt ? stored.terms : null) ?? resolveTerms();
  return { companyLegalName: terms.companyLegalName, companyEmail: terms.companyEmail, monthlyFee: terms.monthlyFee, ...(plan ? { plan } : {}) };
}

function demoView(state: DemoBillingState): BillingView {
  const { fee, configured } = demoFee();
  const stored = readStoredAgreement();
  const scenario = isDemoScenario(state.scenario) ? state.scenario : "live";
  // An example situation brings its own agreement; "live" is whatever was signed on this device.
  const agreement = scenario === "live" ? stored : state.agreement;
  const plan = demoPlan(scenario);
  return {
    demo: true,
    scenario,
    context: {
      agreement,
      signedMonthlyFee: agreement?.signedAt ? fee : null,
      rounds: state.rounds,
      account: {
        paymentMethod: state.method
          ? {
              brand: state.method.brand,
              last4: state.method.last4,
              addedAt: state.method.addedAt,
              authorizationVersion: state.method.authorizationVersion,
              authorizedAt: state.method.authorizedAt,
              ...(state.method.kind ? { kind: state.method.kind } : {}),
            }
          : null,
        charges: state.charges.map((c) => ({ ...c, invoiceNumber: c.invoiceNumber ?? demoInvoice(c.id, c.createdAt), methodKind: c.methodKind ?? state.method?.kind ?? "card" })),
        pause: null,
      },
      ...(plan ? { plan, switches: { payPerDelete: false, referralCredits: false } } : {}),
    },
    authorizationTerms: demoTerms(plan),
    showAmounts: configured || plan !== null,
    hostedFields: null,
    canAddBank: true,
    acceptedCards: loadDemoCardBrands(),
    agreementSigned: Boolean(agreement?.signedAt) && !agreement?.cancelledAt,
    canAddMethod: true,
    simulated: true,
    draft: !paymentAuthorizationApproved(),
  };
}

function serverView(payload: ClientBillingPayload): BillingView {
  return {
    demo: false,
    scenario: "live",
    context: {
      agreement: payload.agreement,
      signedMonthlyFee: payload.signedMonthlyFee,
      rounds: payload.rounds,
      account: payload.account,
      ...(payload.plan ? { plan: payload.plan } : {}),
      ...(payload.results ? { results: payload.results } : {}),
      ...(payload.switches ? { switches: payload.switches } : {}),
      creditBalanceCents: payload.creditBalanceCents ?? 0,
    },
    authorizationTerms: { ...payload.authorizationTerms, ...(payload.plan ? { plan: payload.plan } : {}) },
    hostedFields: payload.processor.hostedFields,
    canAddBank: payload.processor.canAddBank,
    acceptedCards: payload.processor.acceptedCards ?? DEFAULT_ACCEPTED_CARDS,
    showAmounts: true,
    agreementSigned: Boolean(payload.agreement?.signedAt) && !payload.agreement?.cancelledAt,
    canAddMethod: payload.processor.canAddMethod,
    simulated: payload.processor.configured && !payload.processor.live,
    draft: !paymentAuthorizationApproved(),
  };
}

export function useBilling() {
  const [view, setView] = useState<BillingView | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const synced = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/billing");
      const data = res.ok ? ((await res.json()) as ClientBillingPayload | { authenticated: false }) : null;
      if (data && data.authenticated) {
        synced.current = true;
        writePaymentMethodOnFile(data.account.paymentMethod !== null);
        setView(serverView(data));
        return;
      }
    } catch {
      // Offline or the demo: fall through to this device's state.
    }
    // A real database with nobody signed in never falls back to simulated payments.
    if (!isDemoMode()) {
      setView(null);
      return;
    }
    setView(demoView(readDemoBilling()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().finally(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  /** Put a payment method on file: the processor's token and the accepted authorization. Never a card number. */
  const addMethod = useCallback(
    async (token: string, locale: L, kind: "card" | "ach" = "card"): Promise<BillingActionResult> => {
      if (synced.current) {
        try {
          const current = view;
          const terms = current?.authorizationTerms ?? demoTerms();
          const res = await fetch("/api/billing/payment-method", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              kind,
              authorization:
                kind === "ach"
                  ? { version: ACH_AUTHORIZATION_VERSION, locale, hash: achAuthorizationHash(ACH_AUTHORIZATION_VERSION, locale, terms), accepted: true }
                  : { version: PAYMENT_AUTHORIZATION_VERSION, locale, hash: paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, locale, terms), accepted: true },
            }),
          });
          const data = (await res.json().catch(() => ({}))) as { code?: string; settled?: number; declined?: number };
          if (!res.ok) return { ok: false, code: typeof data.code === "string" ? data.code : `http_${res.status}` };
          await load();
          return { ok: true, settled: data.settled ?? 0, declined: data.declined ?? 0 };
        } catch {
          return { ok: false, code: "network" };
        }
      }

      // Demo: the same steps the server takes, on this device, with the demo processor.
      const now = new Date();
      const state = readDemoBilling();
      const before = demoView(state);
      if (!before.agreementSigned) return { ok: false, code: "agreement_required" };
      const hash =
        kind === "ach"
          ? achAuthorizationHash(ACH_AUTHORIZATION_VERSION, locale, before.authorizationTerms)
          : paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, locale, before.authorizationTerms);
      const method = demoMethod(token, now.toISOString(), { version: kind === "ach" ? ACH_AUTHORIZATION_VERSION : PAYMENT_AUTHORIZATION_VERSION, hash });
      if (!method) return { ok: false, code: "payment_method_refused" };
      // The same refusal the server makes: a card brand the business does not take is not put on file.
      if (kind === "card" && brandRefused(method.brand, before.acceptedCards)) return { ok: false, code: "card_brand_not_accepted" };

      // A charge declined earlier gets one more try with the new method (the same charge).
      const rearmed: DemoBillingState = { ...state, method, charges: state.charges.map((charge) => rearmAfterNewPaymentMethod(charge, now)) };
      const store = createMemoryChargeStore(rearmed.charges, (roundNumber) => demoChargeId(roundNumber, now.toISOString()));
      const report = await runClientBilling(
        { gateway: createDemoGateway(), store },
        demoView(rearmed).context,
        { customerRef: "demo_cus_device", paymentMethodRef: `demo_pm_${method.brand}_${method.last4}`, methodKind: method.kind ?? "card" },
        now,
      );
      const next = { ...rearmed, charges: report.charges };
      writeDemoBilling(next);
      setView(demoView(next));
      return {
        ok: true,
        settled: report.attempts.filter((a) => a.outcome === "paid").length,
        declined: report.attempts.filter((a) => a.outcome === "declined" || a.outcome === "exhausted").length,
      };
    },
    [load, view],
  );

  /** Remove the payment method: the authorization is withdrawn and nothing is charged automatically. */
  const removeMethod = useCallback(async (): Promise<BillingActionResult> => {
    if (synced.current) {
      try {
        const res = await fetch("/api/billing/payment-method", { method: "DELETE" });
        if (!res.ok) return { ok: false, code: `http_${res.status}` };
        await load();
        return { ok: true, settled: 0, declined: 0 };
      } catch {
        return { ok: false, code: "network" };
      }
    }
    const next = { ...readDemoBilling(), method: null };
    writeDemoBilling(next);
    setView(demoView(next));
    return { ok: true, settled: 0, declined: 0 };
  }, [load]);

  /** Demo only: show one of the example situations. */
  const setScenario = useCallback((scenario: DemoScenario) => {
    if (synced.current) return;
    const state = readDemoBilling();
    const { fee } = demoFee();
    const plan = demoPlan(scenario);
    const terms = demoTerms(plan);
    // Under the example plan, each round costs the plan's amount; without one, the fee in the settings.
    const next = demoScenarioState(scenario, new Date(), plan ? plan.effective.recurringCents : (feeToCents(fee) ?? 0), state, {
      version: PAYMENT_AUTHORIZATION_VERSION,
      hash: paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, "es", terms),
    });
    writeDemoBilling(next);
    setView(demoView(next));
  }, []);

  return { view, hydrated, addMethod, removeMethod, setScenario };
}
