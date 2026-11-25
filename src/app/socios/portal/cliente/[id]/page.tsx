import PartnerLocaleProvider from "@/lib/partners/PartnerLocaleProvider";
import { BRAND } from "@/lib/brand";
import { inRequestLocale } from "@/lib/i18n/server";
import PartnerClientContent from "@/components/partners/PartnerClientContent";

// A client who shares their progress, as their partner sees them. The proxy
// requires a signed-in session (src/proxy.ts, /socios/portal/*); the data
// comes from /api/partners/clients/<id>, which the database limits and logs.

export async function generateMetadata() {
  return { title: await inRequestLocale({ en: `Client progress · ${BRAND.name}`, es: `Avance del cliente · ${BRAND.name}` }), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

export default async function PartnerClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PartnerLocaleProvider>
      <PartnerClientContent id={id} />
    </PartnerLocaleProvider>
  );
}
