import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import { BRAND } from "@/lib/brand";
import { inRequestLocale } from "@/lib/i18n/server";
import HowItWorks from "@/components/partners/HowItWorks";

// "Cómo funciona Credalti", the page a partner shares (/conoce/<their code>).
// Public: it names the partner only while they are approved.

export async function generateMetadata() {
  return { title: await inRequestLocale({ en: `How ${BRAND.name} works`, es: `Cómo funciona ${BRAND.name}` }), robots: { index: false, follow: false } };
}

export default async function ConocePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = /^[a-z0-9-]{3,30}$/.test(code.toLowerCase()) ? code.toLowerCase() : "";
  return (
    <RequestLocaleProvider>
      <HowItWorks code={clean} />
    </RequestLocaleProvider>
  );
}
