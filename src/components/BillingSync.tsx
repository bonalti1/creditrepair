"use client";

import { useEffect } from "react";
import { writePaymentMethodOnFile } from "@/lib/ux/billingLocal";

// The journey may nudge a client to add a payment method (ux/journey.ts), and
// it reads whether one is on file from this device. For a signed-in client the
// truth is on the server, so this asks once per visit and writes the answer
// down. Signed out (demo), nothing is asked: the demo's own state is already
// on the device.

export default function BillingSync() {
  useEffect(() => {
    try {
      // Signed in means Supabase has set its session cookie ("sb-…-auth-token").
      const signedIn = document.cookie.split(";").some((c) => (c.split("=")[0] ?? "").includes("-auth-token"));
      if (!signedIn) return;
      fetch("/api/billing")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { authenticated?: boolean; account?: { paymentMethod: unknown } } | null) => {
          if (data?.authenticated && data.account) writePaymentMethodOnFile(data.account.paymentMethod !== null);
        })
        .catch(() => undefined);
    } catch {
      // ignore
    }
  }, []);
  return null;
}
