import OptionSwitcher from "@/components/service/OptionSwitcher";
import { requestLocale } from "@/lib/i18n/server";
import { monitoringNote, optionPrices } from "@/lib/site/plans";

// More → My option: the two options side by side with the client's own marked,
// and a calm way to change (docs/SERVICE-OPTIONS.md). Changing after signing
// is a new agreement for the other option, signed at /acuerdo; the current one
// stays in force until then, and everything done so far is kept.

export default async function MyOptionPage() {
  const { locale } = await requestLocale();
  const [en, es] = await Promise.all([optionPrices("en"), optionPrices("es")]);
  return <OptionSwitcher prices={{ en, es }} monitoring={{ en: monitoringNote("en"), es: monitoringNote("es") }} initialLocale={locale} />;
}
