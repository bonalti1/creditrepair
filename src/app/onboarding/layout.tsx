import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import OptionPricesProvider from "@/components/service/OptionPricesProvider";
import { monitoringNote, optionPrices } from "@/lib/site/plans";

// Onboarding's language, chosen on the server for the first render (the saved
// choice, an invitation's ?lang= through the proxy, or the browser's language),
// and the two options' prices for the comparison a link's `option=` / `o=`
// opens (the offered, attorney-approved plans; none: "Price set by the team").
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const [en, es] = await Promise.all([optionPrices("en"), optionPrices("es")]);
  return (
    <RequestLocaleProvider>
      <OptionPricesProvider value={{ prices: { en, es }, monitoring: { en: monitoringNote("en"), es: monitoringNote("es") } }}>{children}</OptionPricesProvider>
    </RequestLocaleProvider>
  );
}
