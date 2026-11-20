"use client";

import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";

// The ES/EN switch. One control for the app header and for the pages a visitor
// sees first (landing, /empezar, onboarding): the choice is saved on the
// device, so it carries from those pages into the app and back.

export default function LocaleToggle({ tone = "light" }: { /** "dark" for navy backgrounds. */ tone?: "light" | "dark" }) {
  const { locale, setLocale } = useLocale();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
      className={`pressable flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold ${
        tone === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-slate-100 text-slate-700"
      }`}
      aria-label={locale === "es" ? "Switch to English" : "Cambiar a español"}
    >
      <Icon name="globe" size={16} />
      {locale === "es" ? "EN" : "ES"}
    </button>
  );
}
