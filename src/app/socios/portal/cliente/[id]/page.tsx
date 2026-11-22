import { LocaleProvider } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";
import PartnerClientContent from "@/components/partners/PartnerClientContent";

// A client who shares their progress, as their partner sees them. The proxy
// requires a signed-in session (src/proxy.ts, /socios/portal/*); the data
// comes from /api/partners/clients/<id>, which the database limits and logs.

export const metadata = {
  title: `Avance del cliente · ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PartnerClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <LocaleProvider>
      <PartnerClientContent id={id} />
    </LocaleProvider>
  );
}
