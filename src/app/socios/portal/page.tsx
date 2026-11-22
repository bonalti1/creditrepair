import { LocaleProvider } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";
import PortalContent from "@/components/partners/PortalContent";

// The partner portal. With a database, the proxy requires a signed-in session
// (src/proxy.ts) and every read goes through the partner's own connection
// (/api/partners/portal), so row level security decides what they see. In the
// demo it shows an invented partner.

export const metadata = {
  title: `Portal de socios · ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function SociosPortal() {
  return (
    <LocaleProvider>
      <PortalContent />
    </LocaleProvider>
  );
}
