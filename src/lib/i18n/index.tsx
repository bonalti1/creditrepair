"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { DICTS, type Dict, type Locale } from "./dictionaries";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_QUERY,
  LOCALE_STORAGE_KEY,
  localeCookieString,
  reconcileWithProfile,
  resolveClientLocale,
  type LocaleChoice,
} from "./detect";

// English first, Spanish if needed (detect.ts has the order of precedence).
// The server picks the language for the first render (src/lib/i18n/server.ts)
// and hands it in as `initial`, so a Spanish browser or a saved Spanish choice
// paints in Spanish with no flash. Here, once the page is open, the same order
// runs again with what only the browser knows (localStorage from before the
// cookie, navigator.languages, an invitation's ?lang=). The ES/EN button
// (LocaleToggle) saves the choice on the device (cookie + localStorage) and,
// for a signed-in client, on their profile (profiles.locale), which is the
// language their automatic messages go out in.

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  d: Dict;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  d: DICTS[DEFAULT_LOCALE],
});

function readCookie(): string | null {
  try {
    const hit = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${LOCALE_COOKIE}=`));
    return hit ? decodeURIComponent(hit.slice(LOCALE_COOKIE.length + 1)) : null;
  } catch {
    return null;
  }
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Keep a choice on this device: the cookie (for the server's first render) and localStorage. */
function remember(l: Locale) {
  try {
    document.cookie = localeCookieString(l, window.location.protocol === "https:");
  } catch {
    // ignore
  }
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, l);
  } catch {
    // ignore
  }
}

/** The signed-in client's id, without a network call; null in the demo or when signed out. */
async function signedInUserId(): Promise<string | null> {
  const supabase = getBrowserSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/** Save the language on the client's profile (row-level security: their own row only). */
async function saveOnProfile(l: Locale): Promise<void> {
  const supabase = getBrowserSupabase();
  const userId = await signedInUserId();
  if (!supabase || !userId) return;
  await supabase.from("profiles").update({ locale: l }).eq("id", userId).then(
    () => undefined,
    () => undefined,
  );
}

export function LocaleProvider({ children, initial }: { children: React.ReactNode; /** The server's choice for the first render. */ initial?: LocaleChoice }) {
  const [locale, setLocaleState] = useState<Locale>(initial?.locale ?? DEFAULT_LOCALE);
  /** Set once the person presses the button, so a slower profile read never undoes their choice. */
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const device = resolveClientLocale({
      link: new URLSearchParams(window.location.search).get(LOCALE_QUERY),
      cookie: readCookie(),
      stored: readStored(),
      languages: navigator.languages?.length ? navigator.languages : [navigator.language],
      server: initial ?? null,
    });
    setLocaleState(device.locale);
    // A link's language, or a choice kept only in localStorage, becomes the device's saved choice.
    if (device.source === "link" || device.source === "saved") remember(device.locale);

    // Signed in (real mode): the profile's language, both ways (detect.ts, reconcileWithProfile).
    void (async () => {
      const supabase = getBrowserSupabase();
      const userId = await signedInUserId();
      if (!supabase || !userId || cancelled) return;
      const { data } = await supabase.from("profiles").select("locale").eq("id", userId).maybeSingle().then(
        (r) => r,
        () => ({ data: null }),
      );
      if (cancelled || chosen.current || !data) return;
      const { choice, writeProfile } = reconcileWithProfile(device, (data as { locale?: string }).locale);
      if (choice.source === "profile") {
        setLocaleState(choice.locale);
        remember(choice.locale);
      }
      if (writeProfile) await saveOnProfile(writeProfile);
    })();
    return () => {
      cancelled = true;
    };
    // Once, on arrival: `initial` is the server's first-render value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the page's declared language in step, for screen readers and the browser.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (l: Locale) => {
    chosen.current = true;
    setLocaleState(l);
    remember(l);
    void saveOnProfile(l);
  };

  return <LocaleContext.Provider value={{ locale, setLocale, d: DICTS[locale] }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
