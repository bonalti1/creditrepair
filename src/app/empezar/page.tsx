import { LocaleProvider } from "@/lib/i18n";
import EmpezarContent from "@/components/marketing/EmpezarContent";

// /empezar (server wrapper, so the page keeps its own metadata). The page
// itself is in EmpezarContent, a client component, because it follows the
// visitor's language choice (ES/EN), which is kept on the device.

export const metadata = {
  title: "CreditCapi — Empieza en 5 minutos",
  description:
    "Software gratuito de disputas de crédito en español. Tú revisas, tú apruebas, tú envías. Los resultados varían.",
};

export default function Empezar() {
  return (
    <LocaleProvider>
      <EmpezarContent />
    </LocaleProvider>
  );
}
