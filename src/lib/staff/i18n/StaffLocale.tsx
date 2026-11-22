"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isDemoMode } from "../../supabase/config";
import { useViewer } from "../useStaff";
import { readDemoPreferences, writeDemoPreferences } from "../usePreferences";
import { DEFAULT_STAFF_LOCALE, localeFromBrowser, type StaffLocale } from "./locale";
import type { StaffText, TextShape } from "./text";

// The console's language in the browser. The layout works out the first
// value on the server (the member's saved choice, else the browser's
// Accept-Language, else English), so the first paint is already in the right
// language. In the demo the choice lives in this browser, per member of the
// demo team, and is read once the page has loaded.

interface StaffLocaleState {
  locale: StaffLocale;
  /** Show the console in this language, and keep it as the member's choice. */
  setLocale: (locale: StaffLocale) => void;
}

const StaffLocaleContext = createContext<StaffLocaleState>({ locale: DEFAULT_STAFF_LOCALE, setLocale: () => undefined });

export function StaffLocaleProvider({ initial, saved, children }: { initial: StaffLocale; saved: boolean; children: React.ReactNode }) {
  const [locale, setState] = useState<StaffLocale>(initial);
  const { viewer } = useViewer();
  const demo = isDemoMode();
  const handle = viewer?.handle ?? null;

  // The demo keeps each member's choice in this browser; with nothing chosen, the browser's language.
  useEffect(() => {
    // With a database the server already read the saved choice (or the browser's Accept-Language).
    if (!demo || saved || !handle) return;
    const chosen = readDemoPreferences(handle).locale;
    setState(chosen ?? localeFromBrowser(typeof navigator === "undefined" ? null : navigator.languages));
  }, [demo, handle, saved]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: StaffLocale) => {
      setState(next);
      if (demo) {
        if (handle) writeDemoPreferences(handle, { locale: next });
        return;
      }
      void fetch("/api/staff/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => undefined);
    },
    [demo, handle],
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <StaffLocaleContext.Provider value={value}>{children}</StaffLocaleContext.Provider>;
}

/** The console's language and the way to change it. */
export function useStaffLocale(): StaffLocaleState {
  return useContext(StaffLocaleContext);
}

/** A string table in the console's language. */
export function useText<T extends TextShape>(table: StaffText<T>): T {
  return table[useContext(StaffLocaleContext).locale];
}

/** Picks one of a pair: the Spanish original first, then the English. */
export type Tx = <T = string>(es: T, en: T) => T;

/**
 * For a screen's own words, written where they are shown as a pair:
 * `t("Clientes", "Clients")`. The pair is the table: a test reads every
 * `t(…, …)` in the console's source and checks both are there and that the
 * English one has no Spanish left in it.
 */
export function useTx(): Tx {
  const { locale } = useContext(StaffLocaleContext);
  return useCallback(<T,>(es: T, en: T): T => (locale === "es" ? es : en), [locale]) as Tx;
}

/** The same outside React, for a known locale. */
export function txFor(locale: StaffLocale): Tx {
  return (<T,>(es: T, en: T): T => (locale === "es" ? es : en)) as Tx;
}
