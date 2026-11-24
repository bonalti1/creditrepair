import LegalPage from "@/components/site/LegalPage";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { siteMetadata } from "@/lib/site/seo";

// /terminos: placeholder for the website terms until the attorney-approved
// text exists (copy.ts, `terms`). The service agreement is separate (/acuerdo).

export async function generateMetadata() {
  return siteMetadata("terms", (await requestLocale()).locale);
}

export default async function Terms() {
  const { locale } = await requestLocale();
  const p = SITE_COPY[locale].terms;
  return <LegalPage eyebrow={p.eyebrow} title={p.title} lead={p.lead} sections={p.sections} pending={p.pending} />;
}
