import { LocaleProvider } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";
import SociosContent from "@/components/partners/SociosContent";

// /socios (server wrapper, so the page keeps its own metadata): the public
// application for referral partners. The page itself follows the visitor's
// language choice (ES/EN), like the landing page.

export const metadata = {
  title: `Programa de socios · ${BRAND.name}`,
  description: `Agentes de bienes raíces, oficiales de préstamos y preparadores de impuestos: refieran a sus clientes a ${BRAND.name}.`,
};

export default function Socios() {
  return (
    <LocaleProvider>
      <SociosContent />
    </LocaleProvider>
  );
}
