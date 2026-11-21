"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isDemoMode } from "../agreement/readiness";
import { resolveTerms } from "../agreement/terms";
import type { ClientBillingPayload } from "../billing/api";
import { PAYMENT_AUTHORIZATION_VERSION, paymentAuthorizationHash, type AuthorizationTerms } from "../billing/authorization";
import { createMemoryChargeStore, runClientBilling } from "../billing/collect";
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

function demoTerms(): AuthorizationTerms {
  const stored = readStoredAgreement();
  const terms = (stored?.signedAt ? stored.terms : null) ?? resolveTerms();
  return { companyLegalName: terms.companyLegalName, companyEmail: terms.companyEmail, monthlyFee: terms.monthlyFee };
}

function demoView(state: DemoBillingState): BillingView {
  const { fee, configured } = demoFee();
  const stored = readStoredAgreement();
  const scenario = isDemoScenario(state.scenario) ? state.scenario : "live";
  // An example situation brings its own agreement; "live" is whatever was signed on this device.
  const agreement = scenario === "live" ? stored : state.agreement;
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
            }
          : null,
        charges: state.charges,
        pause: null,
      },
    },
    authorizationTerms: demoTerms(),
    showAmounts: configured,
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
    },
    authorizationTerms: payload.authorizationTerms,
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
    async (token: string, locale: L): Promise<BillingActionResult> => {
      if (synced.current) {
        try {
          const current = view;
          const terms = current?.authorizationTerms ?? demoTerms();
          const res = await fetch("/api/billing/payment-method", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              authorization: {
                version: PAYMENT_AUTHORIZATION_VERSION,
                locale,
                hash: paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, locale, terms),
                accepted: true,
              },
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
      const hash = paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, locale, before.authorizationTerms);
      const method = demoMethod(token, now.toISOString(), { version: PAYMENT_AUTHORIZATION_VERSION, hash });
      if (!method) return { ok: false, code: "payment_method_refused" };

      // A charge declined earlier gets one more try with the new method (the same charge).
      const rearmed: DemoBillingState = { ...state, method, charges: state.charges.map((charge) => rearmAfterNewPaymentMethod(charge, now)) };
      const store = createMemoryChargeStore(rearmed.charges, (roundNumber) => demoChargeId(roundNumber, now.toISOString()));
      const report = await runClientBilling(
        { gateway: createDemoGateway(), store },
        demoView(rearmed).context,
        { customerRef: "demo_cus_device", paymentMethodRef: `demo_pm_${method.brand}_${method.last4}` },
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
    const terms = demoTerms();
    const next = demoScenarioState(scenario, new Date(), feeToCents(fee) ?? 0, state, {
      version: PAYMENT_AUTHORIZATION_VERSION,
      hash: paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, "es", terms),
    });
    writeDemoBilling(next);
    setView(demoView(next));
  }, []);

  return { view, hydrated, addMethod, removeMethod, setScenario };
}
