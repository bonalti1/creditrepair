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
      const goal = read(KEYS.goal);
      const state = read(KEYS.state);
      const assisted = read(KEYS.assisted);
      const ref = read(KEYS.ref);
      if (!goal && !state && !assisted && !ref) return;

      const fingerprint = [goal, state, assisted, ref].join("|");
      if (read(SYNCED) === fingerprint) return;

      fetch("/api/profile/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal ?? undefined,
          state: state ?? undefined,
          assisted: assisted === null ? undefined : assisted === "1",
          referredBy: ref ?? undefined,
        }),
      })
        .then((res) => {
          if (res.ok) window.localStorage.setItem(SYNCED, fingerprint);
        })
        .catch(() => undefined);
    } catch {
      // localStorage unavailable — nothing to sync.
    }
  }, []);
  return null;
}
