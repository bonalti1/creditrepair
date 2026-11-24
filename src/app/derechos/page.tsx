import SiteShell from "@/components/site/SiteShell";
import { CheckList, Container, PageHero, PendingBadge } from "@/components/site/ui";
import { agreementDocument } from "@/lib/agreement/documents";
import { resolveTerms } from "@/lib/agreement/terms";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { siteMetadata } from "@/lib/site/seo";

// /derechos: the consumer's rights, in plain words, then the federal
// "Consumer Credit File Rights Under State and Federal Law" statement
// (15 U.S.C. §1679c) exactly as the agreement shows it before signing
// (src/lib/agreement/documents.ts → statutes.ts): in Spanish, the translation
// first and the official English after it. Reused, never retyped, so the two
// can never drift. Attorney-pending, like the agreement.

export async function generateMetadata() {
  return siteMetadata("rights", (await requestLocale()).locale);
}


export default async function Rights() {
  const { locale } = await requestLocale();
  const r = SITE_COPY[locale].rights;
  const doc = agreementDocument("federal_disclosure", locale, resolveTerms());

  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={r.eyebrow} title={r.title} lead={r.lead} />
        <section aria-labelledby="plain" className="py-12 sm:py-16">
          <Container narrow>
            <div className="card p-7 sm:p-9">
              <h2 id="plain" className="font-display text-[24px] font-bold text-blue-900">{r.selfTitle}</h2>
              <CheckList items={r.self} className="mt-5" />
            </div>
          </Container>
        </section>

        <section aria-labelledby="statement" className="pb-12 sm:pb-16">
          <Container narrow>
            <h2 id="statement" className="font-display text-[24px] font-bold text-blue-900 sm:text-[28px]">{r.statementTitle}</h2>
            <p className="mt-2 text-[14px] text-slate-500">{doc.law}</p>
            <div className="mt-4">
              <PendingBadge>{r.officialNote}</PendingBadge>
            </div>
            <article className="mt-6 space-y-4 rounded-3xl bg-white p-7 text-[16px] leading-relaxed text-slate-800 ring-1 ring-slate-200 sm:p-10" data-testid="croa-statement">
              {doc.blocks.map((block, i) =>
                block.kind === "heading" ? (
                  <h3 key={i} className="pt-2 text-[18px] font-semibold text-blue-900" lang={block.origin === "federal_statute" ? "en" : undefined}>
                    {block.text}
                  </h3>
                ) : block.kind === "blank" ? (
                  <p key={i} className="leading-snug" lang={block.origin === "federal_statute" ? "en" : undefined}>
                    {block.text}
                  </p>
                ) : (
                  <p key={i} className={block.bold ? "font-semibold" : ""} lang={block.origin === "federal_statute" ? "en" : undefined}>
                    {block.text}
                  </p>
                ),
              )}
            </article>
          </Container>
        </section>

        <section aria-labelledby="gov" className="pb-16 sm:pb-24">
          <Container narrow>
            <h2 id="gov" className="font-display text-[22px] font-bold text-blue-900">{r.moreTitle}</h2>
            <ul className="mt-4 space-y-3">
              {r.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} rel="noopener" target="_blank" className="text-[16px] font-semibold text-blue-700 underline underline-offset-4">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      </main>
    </SiteShell>
  );
}
