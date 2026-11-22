"use client";

import { useEffect } from "react";

// Onboarding happens before sign-in, so its answers wait in the browser. Once
// the customer is inside the app and signed in, this sends them to the profile
// one time. Signed out (demo), nothing is sent: the request would only be refused.

const KEYS = { goal: "bonalti.goal", state: "bonalti.state", assisted: "bonalti.assisted", ref: "bonalti.ref" };
const SYNCED = "bonalti.onboardingSynced";

export default function OnboardingSync() {
  useEffect(() => {
    try {
      // Signed in means Supabase has set its session cookie ("sb-…-auth-token").
      const signedIn = document.cookie.split(";").some((c) => (c.split("=")[0] ?? "").includes("-auth-token"));
      if (!signedIn) return;

      const read = (key: string) => window.localStorage.getItem(key);
      // A partner-sharing choice made during onboarding, recorded once signed in
      // (after the profile, so the partner on the link is credited first).
      const pendingShare = read("bonalti.partnerShare");
      const sendShare = () => {
        if (!pendingShare) return;
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(pendingShare) as Record<string, unknown>;
        } catch {
          window.localStorage.removeItem("bonalti.partnerShare");
          return;
        }
        fetch("/api/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set", ...body }) })
          .then((res) => {
            // Saved, or refused for good (a changed text, a partner no longer approved): either way not retried.
            if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429)) window.localStorage.removeItem("bonalti.partnerShare");
          })
          .catch(() => undefined);
      };
      const goal = read(KEYS.goal);
      const state = read(KEYS.state);
      const assisted = read(KEYS.assisted);
      const ref = read(KEYS.ref);
      // A partner's code from an invitation link (sales/invite.ts "p"). The /r/<code> cookie travels by itself.
      const partner = read("bonalti.partner");
      if (!goal && !state && !assisted && !ref && !partner) return sendShare();

      const fingerprint = [goal, state, assisted, ref, ...(partner ? [partner] : [])].join("|");
      if (read(SYNCED) === fingerprint) return sendShare();

      fetch("/api/profile/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal ?? undefined,
          state: state ?? undefined,
          assisted: assisted === null ? undefined : assisted === "1",
          referredBy: ref ?? undefined,
          partnerCode: partner ?? undefined,
        }),
      })
        .then((res) => {
          if (res.ok) window.localStorage.setItem(SYNCED, fingerprint);
          sendShare();
        })
        .catch(() => undefined);
    } catch {
      // localStorage unavailable — nothing to sync.
    }
  }, []);
  return null;
}
