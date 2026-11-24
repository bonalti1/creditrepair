import LegalPage from "@/components/site/LegalPage";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { siteMetadata } from "@/lib/site/seo";

// /privacidad: placeholder for the privacy and GLBA notice until the
// attorney-approved text exists (copy.ts, `privacy`). What it says now is only
// what the code does: the data the app collects, the cookies it sets
// (credalti.locale; credalti_socio for 60 days, docs/PARTNERS.md; the session),
// and that card and bank numbers stay with the processor (docs/BILLING.md).

export async function generateMetadata() {
  return siteMetadata("privacy", (await requestLocale()).locale);
}

export default async function Privacy() {
  const { locale } = await requestLocale();
  const p = SITE_COPY[locale].privacy;
  return <LegalPage eyebrow={p.eyebrow} title={p.title} lead={p.lead} sections={p.sections} pending={p.pending} />;
}
