import Icon, { type IconName } from "@/components/Icon";
import SociosContent from "@/components/partners/SociosContent";
import SiteShell from "@/components/site/SiteShell";
import { CheckList, Container, PageHero } from "@/components/site/ui";
import { requestLocale } from "@/lib/i18n/server";
import { commissionsEnabled } from "@/lib/partners/sharingServer";
import { SITE_COPY } from "@/lib/site/copy";
import { siteMetadata } from "@/lib/site/seo";
import { getAdminClient } from "@/lib/supabase/admin";

// /socios: the website's page for realtors, loan officers and tax
// preparers, above the existing application (SociosContent). It describes the
// consent-based progress sharing (src/lib/partners/sharing.ts) and reads the
// "Comisiones a socios" switch (src/lib/partners/program.ts) on the server:
// while it is off, or without a database (the demo), the page says the
// program pays no referral fees.

export async function generateMetadata() {
  return siteMetadata("partners", (await requestLocale()).locale);
}

async function feesOn(): Promise<boolean> {
  const db = getAdminClient();
  if (!db) return false;
  try {
    return await commissionsEnabled(db);
  } catch {
    return false;
  }
}

const WHO_ICONS: IconName[] = ["home", "calc", "doc"];

export default async function Socios() {
  const { locale } = await requestLocale();
  const p = SITE_COPY[locale].partners;
  const fees = await feesOn();

  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={p.eyebrow} title={p.title} lead={p.lead}>
          <a
            href="#solicitud"
            className="pressable mt-8 inline-flex h-14 items-center justify-center rounded-full bg-amber-400 px-8 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
          >
            {p.cta}
          </a>
        </PageHero>

        <section aria-label={p.eyebrow} className="py-12 sm:py-16">
          <Container className="grid gap-4 md:grid-cols-3">
            {p.who.map((w, i) => (
              <div key={w.title} className="card p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                  <Icon name={WHO_ICONS[i] ?? "team"} size={22} />
                </span>
                <h2 className="mt-4 text-[18px] font-semibold text-blue-900">{w.title}</h2>
                <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{w.body}</p>
              </div>
            ))}
          </Container>
        </section>

        <section aria-labelledby="sharing" className="pb-4">
          <Container>
            <div className="grid gap-6 rounded-3xl bg-blue-900 p-7 text-white sm:p-10 lg:grid-cols-[1fr_1.3fr] lg:gap-12">
              <div>
                <h2 id="sharing" className="font-display text-[26px] font-bold leading-tight sm:text-[30px]">{p.sharingTitle}</h2>
                <p className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-[15px] leading-relaxed text-blue-50" data-testid="partner-fees">
                  {fees ? p.feesOn : p.feesOff}
                </p>
              </div>
              <CheckList items={p.sharing} onNavy />
            </div>
          </Container>
        </section>

        <SociosContent />
      </main>
    </SiteShell>
  );
}
