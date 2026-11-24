import SiteShell from "@/components/site/SiteShell";
import { Container, CtaGroup, FaqList, PageHero } from "@/components/site/ui";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { faqJsonLd, jsonLd, siteMetadata } from "@/lib/site/seo";

// /preguntas: the honest answers, with FAQPage structured data built from the
// same list the page shows (so the two can never differ).

export async function generateMetadata() {
  return siteMetadata("faq", (await requestLocale()).locale);
}

export default async function Faq() {
  const { locale } = await requestLocale();
  const f = SITE_COPY[locale].faq;
  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={f.eyebrow} title={f.title} lead={f.lead} />
        <section aria-label={f.title} className="py-12 sm:py-16">
          <Container narrow>
            <FaqList items={f.items} />
          </Container>
        </section>
        <section aria-label={f.still} className="pb-16 sm:pb-24">
          <Container narrow>
            <div className="rounded-3xl bg-blue-900 p-7 text-white sm:p-10">
              <p className="font-display text-[24px] font-bold leading-tight">{f.still}</p>
              <div className="mt-6">
                <CtaGroup locale={locale} secondary={false} />
              </div>
            </div>
          </Container>
        </section>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqJsonLd(f.items)) }} />
      </main>
    </SiteShell>
  );
}
