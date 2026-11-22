"use client";

import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";

// The language switch. One control for the app header and for the pages a
// visitor sees first (landing, /empezar, onboarding). It names the other
// language in that language ("Español" while reading English, "English" while
// reading Spanish), so someone who cannot read the current one still finds it.
// The choice is saved on the device (and on a signed-in client's profile), so
// it carries from those pages into the app and back (src/lib/i18n).

export default function LocaleToggle({ tone = "light" }: { /** "dark" for navy backgrounds. */ tone?: "light" | "dark" }) {
  const { locale, setLocale } = useLocale();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
      className={`pressable flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold ${
        tone === "dark" ? "bg-white/10 text-white hover:bg-white/15" : "bg-slate-100 text-slate-700"
      }`}
      lang={locale === "es" ? "en" : "es"}
      aria-label={locale === "es" ? "Switch to English" : "Cambiar a español"}
    >
      <Icon name="globe" size={16} />
      {locale === "es" ? "English" : "Español"}
    </button>
  );
}
