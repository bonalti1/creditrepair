import { CharacterFigure } from "@/components/Character";
import { HomeReadyTeaser, HowScroll } from "@/components/site/islands";
import { Reveal } from "@/components/site/motion";
import { ONLINE_START } from "@/lib/site/cta";
import SiteShell from "@/components/site/SiteShell";
import { CheckList, Container, CtaGroup, Lead, PageHero, SectionTitle } from "@/components/site/ui";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { siteMetadata } from "@/lib/site/seo";

// /como-funciona: the whole journey as a scroll story, with screens of the
// real app (its demo mode, sample data, taken at 390 px and 2x in each
// language: public/screens/site/), then the rounds and after-care. No score is
// on any of the screens.

export async function generateMetadata() {
  return siteMetadata("how", (await requestLocale()).locale);
}

/** The real app screens of the story, one per stage (public/screens/site/<name>-<locale>@1x/@2x.webp). */
const SCREENS = ["welcome", "case", "review", "letters", "build"] as const;
/** The app's screenshots are 390 × 844 at 1x (HowScroll gives every image this size, with srcSet=). */
const SHOT = { width: 390, height: 844 };

export default async function HowItWorks() {
  const { locale } = await requestLocale();
  const c = SITE_COPY[locale];
  const h = c.how;

  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={h.eyebrow} title={h.title} lead={h.lead} figure={<CharacterFigure character="assistant" pose="phone" height={250} decorative />} />

        {/* The journey as a scroll story: the phone stays, its screen follows the step (HowScroll). */}
        <section aria-label={h.eyebrow} className="py-14 sm:py-20" data-shot-width={SHOT.width}>
          <Container>
            <HowScroll stages={h.stages} screens={SCREENS} locale={locale} />
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

        {/* After the letters: the after-care features (docs/AFTERCARE.md), truthfully: general guidance in the app. */}
        <section aria-labelledby="after" className="py-14 sm:py-20">
          <Container className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
            <Reveal>
              <SectionTitle id="after">{c.live.after.title}</SectionTitle>
              <Lead className="mt-4">{c.live.after.lead}</Lead>
              <CheckList items={c.live.after.cards.map((card) => `${card.title}: ${card.body}`)} className="mt-6" />
              <p className="mt-4 text-[13px] leading-relaxed text-slate-500">{c.live.after.note}</p>
            </Reveal>
            <HomeReadyTeaser locale={locale} startHref={ONLINE_START} />
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
