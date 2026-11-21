import { LocaleProvider } from "@/lib/i18n";
import EmpezarContent from "@/components/marketing/EmpezarContent";
import { BRAND } from "@/lib/brand";

// /empezar (server wrapper, so the page keeps its own metadata). The page
// itself is in EmpezarContent, a client component, because it follows the
// visitor's language choice (ES/EN), which is kept on the device.

export const metadata = {
  title: BRAND.startTitle,
  description:
    "Servicio de crédito en español. Tú nos dices qué está mal en tu reporte; nuestro equipo prepara y envía las cartas por ti. Los resultados varían.",
};

export default function Empezar() {
  return (
    <LocaleProvider>
      <EmpezarContent />
    </LocaleProvider>
  );
}
