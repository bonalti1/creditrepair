"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "../supabase/config";
import { OPTION_PENDING_KEY, readStoredOption, writeStoredOption } from "./optionLocal";
import { effectiveOption, type ServiceOption } from "./options";

// The signed-in client's option (or this device's, in the demo), for any
// client screen: Credalti Complete or Credalti DIY. `choose` records a choice
// before signing, or starts a switch after (the new option's agreement is then
// signed at /acuerdo).

export interface ServiceOptionView {
  option: ServiceOption;
  chosen: ServiceOption | null;
  signed: ServiceOption | null;
  /** They chose the other option after signing: its agreement waits for their signature. */
  switchPending: boolean;
  hydrated: boolean;
  choose(option: ServiceOption, via?: "signup_chat" | "invitation" | "onboarding" | "app"): Promise<boolean>;
}

export function useServiceOption(): ServiceOptionView {
  const [chosen, setChosen] = useState<ServiceOption | null>(null);
  const [signed, setSigned] = useState<ServiceOption | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const local = () => {
      const stored = readStoredOption();
      setChosen(stored.chosen);
      setSigned(stored.signed);
    };
    local();
    let cancelled = false;
    if (isSupabaseConfigured()) {
      fetch("/api/service-option", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ authenticated?: boolean; chosen?: ServiceOption | null; signed?: ServiceOption | null }>) : null))
        .then((body) => {
          if (cancelled || !body?.authenticated) return;
          setChosen(body.chosen ?? null);
          setSigned(body.signed ?? null);
          writeStoredOption({ chosen: body.chosen ?? null, signed: body.signed ?? null });
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setHydrated(true));
    } else {
      setHydrated(true);
    }
    window.addEventListener("credalti:service-option", local);
    return () => {
      cancelled = true;
      window.removeEventListener("credalti:service-option", local);
    };
  }, []);

  const choose = useCallback(
    async (option: ServiceOption, via: "signup_chat" | "invitation" | "onboarding" | "app" = "app") => {
      if (isSupabaseConfigured()) {
        const res = await fetch("/api/service-option", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ option, via }),
        }).catch(() => null);
        // Signed out with a database (a visitor before sign-in): kept on this device and sent once they sign in.
        if (res?.status === 401) {
          try {
            window.localStorage.setItem(OPTION_PENDING_KEY, option);
          } catch {
            // storage unavailable
          }
        } else if (!res?.ok) {
          return false;
        }
      }
      setChosen(option);
      writeStoredOption({ chosen: option, signed: readStoredOption().signed });
      return true;
    },
    [],
  );

  return {
    option: effectiveOption({ signedOption: signed, chosenOption: chosen }),
    chosen,
    signed,
    switchPending: signed !== null && chosen !== null && chosen !== signed,
    hydrated,
    choose,
  };
}
