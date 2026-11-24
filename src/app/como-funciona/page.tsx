import { CharacterFigure } from "@/components/Character";
import SiteShell from "@/components/site/SiteShell";
import { CheckList, Container, CtaGroup, Lead, PageHero, SectionTitle } from "@/components/site/ui";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { siteMetadata } from "@/lib/site/seo";

// /como-funciona: the whole journey, with screens of the real app (its demo
// mode, sample data, retaken at 390 px and 2x in each language:
// public/screens/site/). No score is on any of them.

export async function generateMetadata() {
  return siteMetadata("how", (await requestLocale()).locale);
}

const SCREENS = ["welcome", "case", "review", "letters"] as const;
/** The app's screenshots are 390 × 844 at 1x. */
const SHOT = { width: 390, height: 844 };

function Screen({ name, locale, alt }: { name: (typeof SCREENS)[number]; locale: "en" | "es"; alt: string }) {
  const base = `/screens/site/${name}-${locale}`;
  return (
    <div className="mx-auto w-[260px] rounded-[40px] bg-blue-900 p-2 shadow-[0_30px_60px_-30px_rgba(18,33,58,0.6)] sm:w-[290px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- sized WebP pair, no re-encoding needed */}
      <img
        src={`${base}@1x.webp`}
        srcSet={`${base}@1x.webp 1x, ${base}@2x.webp 2x`}
        width={SHOT.width}
        height={SHOT.height}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full rounded-[32px]"
      />
    </div>
  );
}

export default async function HowItWorks() {
  const { locale } = await requestLocale();
  const c = SITE_COPY[locale];
  const h = c.how;

  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={h.eyebrow} title={h.title} lead={h.lead} />

        <section aria-label={h.eyebrow} className="py-14 sm:py-20">
          <Container>
            <ol className="space-y-16 sm:space-y-24">
              {h.stages.map((stage, i) => (
                <li key={stage.title} className="grid items-center gap-8 md:grid-cols-2 md:gap-16">
                  <div className={i % 2 === 1 ? "md:order-2" : ""}>
                    <h2 className="font-display text-[26px] font-bold leading-tight text-blue-900 sm:text-[34px]">{stage.title}</h2>
                    <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-slate-700">{stage.body}</p>
                    <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3.5 py-1.5 text-[14px] font-semibold text-blue-700">{stage.caption}</p>
                  </div>
                  <figure className="relative rounded-[40px] bg-gradient-to-b from-blue-100/70 to-blue-50/0 px-4 pt-8 sm:pt-10">
                    <Screen name={SCREENS[i]!} locale={locale} alt={stage.alt} />
                    {i === 2 && (
                      <div aria-hidden className="absolute -bottom-4 left-[calc(50%-210px)] hidden lg:block">
                        <CharacterFigure character="assistant" view="threeQuarter" height={130} decorative />
                      </div>
                    )}
                    {i === 3 && (
                      <div aria-hidden className="absolute bottom-0 right-[calc(50%-250px)] hidden lg:block">
                        <CharacterFigure character="team" view="threeQuarter" height={300} decorative />
                      </div>
                    )}
                  </figure>
                </li>
              ))}
            </ol>
            <p className="mt-12 text-center text-[13px] text-slate-500">{h.screensNote}</p>
          </Container>
        </section>

        <section aria-labelledby="rounds" className="border-y border-slate-200 bg-white py-14 sm:py-20">
          <Container className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <SectionTitle id="rounds">{h.roundsTitle}</SectionTitle>
              <ol className="mt-8 space-y-5">
                {h.rounds.map((line, i) => (
                  <li key={line} className="flex gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-900 text-[15px] font-semibold text-white">{i + 1}</span>
                    <p className="pt-1 text-[17px] leading-relaxed text-slate-700">{line}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
                <h3 className="text-[18px] font-semibold text-blue-900">{h.youTitle}</h3>
                <CheckList items={h.you} className="mt-4" />
              </div>
              <div className="rounded-3xl bg-blue-900 p-6 text-white">
                <h3 className="text-[18px] font-semibold">{h.weTitle}</h3>
                <CheckList items={h.we} onNavy className="mt-4" />
              </div>
            </div>
          </Container>
        </section>

        <section aria-labelledby="start" className="py-16 sm:py-24">
          <Container className="text-center">
            <SectionTitle id="start">{c.home.final.title}</SectionTitle>
            <Lead className="mx-auto mt-4 max-w-xl">{c.home.final.lead}</Lead>
            <div className="mx-auto mt-8 max-w-2xl">
              <CtaGroup locale={locale} onNavy={false} secondary={false} align="center" />
            </div>
          </Container>
        </section>
      </main>
    </SiteShell>
  );
}
