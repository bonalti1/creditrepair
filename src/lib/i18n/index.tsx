"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DICTS, type Dict, type Locale } from "./dictionaries";

// Spanish default, English toggle (spec §4.3). The locale persists per device;
// once auth carries profiles.locale it also syncs there.

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  d: Dict;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "es",
  setLocale: () => undefined,
  d: DICTS.es,
});

const STORAGE_KEY = "bonalti.locale";

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("es");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "es") setLocaleState(saved);
    } catch {
      // ignore
    }
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale, d: DICTS[locale] }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
