import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import { BRAND } from "@/lib/brand";
import { inRequestLocale } from "@/lib/i18n/server";
import PartnerFlyer from "@/components/partners/PartnerFlyer";

// The partner's printable one-page flyer (/conoce/<code>/imprimir): their
// name, Alti and the QR code of their link. Public, like "How Credalti works":
// it names the partner only while they are approved.

export async function generateMetadata() {
  return { title: await inRequestLocale({ en: `Flyer · ${BRAND.name}`, es: `Volante · ${BRAND.name}` }), robots: { index: false, follow: false } };
}

export default async function FlyerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = /^[a-z0-9-]{3,30}$/.test(code.toLowerCase()) ? code.toLowerCase() : "";
  return (
    <RequestLocaleProvider>
      <PartnerFlyer code={clean} />
    </RequestLocaleProvider>
  );
}
