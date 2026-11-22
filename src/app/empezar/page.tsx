import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import EmpezarContent from "@/components/marketing/EmpezarContent";
import { BRAND } from "@/lib/brand";
import { inRequestLocale } from "@/lib/i18n/server";

// /empezar (server wrapper, so the page keeps its own metadata). The page
// itself is in EmpezarContent, a client component, because it follows the
// visitor's language (English first; Spanish for a Spanish browser or choice).

export async function generateMetadata() {
  return inRequestLocale({
    en: {
      title: BRAND.startTitle,
      description:
        "Credit services in English and Spanish. You tell us what is wrong on your report; our team prepares and mails the letters for you. Results vary.",
    },
    es: {
      title: BRAND.startTitleEs,
      description:
        "Servicio de crédito en inglés y en español. Tú nos dices qué está mal en tu reporte; nuestro equipo prepara y envía las cartas por ti. Los resultados varían.",
    },
  });
}

export default function Empezar() {
  return (
    <RequestLocaleProvider>
      <EmpezarContent />
    </RequestLocaleProvider>
  );
}
