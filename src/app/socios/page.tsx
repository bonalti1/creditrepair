import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import { BRAND } from "@/lib/brand";
import { inRequestLocale } from "@/lib/i18n/server";
import SociosContent from "@/components/partners/SociosContent";

// /socios (server wrapper, so the page keeps its own metadata): the public
// application for referral partners. The page itself follows the visitor's
// language choice (ES/EN), like the landing page.

export async function generateMetadata() {
  return inRequestLocale({
    en: {
      title: `Partner program · ${BRAND.name}`,
      description: `Real estate agents, loan officers and tax preparers: refer your clients to ${BRAND.name}.`,
    },
    es: {
      title: `Programa de socios · ${BRAND.name}`,
      description: `Agentes de bienes raíces, oficiales de préstamos y preparadores de impuestos: refieran a sus clientes a ${BRAND.name}.`,
    },
  });
}

export default function Socios() {
  return (
    <RequestLocaleProvider>
      <SociosContent />
    </RequestLocaleProvider>
  );
}
