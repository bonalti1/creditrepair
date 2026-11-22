import { LocaleProvider } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";
import HowItWorks from "@/components/partners/HowItWorks";

// "Cómo funciona Credalti", the page a partner shares (/conoce/<their code>).
// Public: it names the partner only while they are approved.

export const metadata = {
  title: `Cómo funciona ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default async function ConocePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = /^[a-z0-9-]{3,30}$/.test(code.toLowerCase()) ? code.toLowerCase() : "";
  return (
    <LocaleProvider>
      <HowItWorks code={clean} />
    </LocaleProvider>
  );
}
