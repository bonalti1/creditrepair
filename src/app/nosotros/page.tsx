import Icon, { type IconName } from "@/components/Icon";
import { CharacterFigure } from "@/components/Character";
import SiteShell from "@/components/site/SiteShell";
import { Container, CtaGroup, PageHero, SectionTitle } from "@/components/site/ui";
import { BRAND } from "@/lib/brand";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { OWNER_STORY } from "@/lib/site/owner";
import { siteMetadata } from "@/lib/site/seo";

// /nosotros: who we are, Alti and AltiBot, and the rules we work by. The
// founder's story is the owner's to write (src/lib/site/owner.ts); until then
// the page says it is coming and invents nothing.

export async function generateMetadata() {
  return siteMetadata("about", (await requestLocale()).locale);
}

const RULE_ICONS: IconName[] = ["info", "check", "calc", "mail", "globe"];

export default async function About() {
  const { locale } = await requestLocale();
  const c = SITE_COPY[locale];
  const a = c.about;
  const story = OWNER_STORY;

  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={a.eyebrow} title={a.title} lead={a.lead} />

        <section aria-labelledby="story" className="py-14 sm:py-20">
          <Container narrow>
            <SectionTitle id="story">{a.storyTitle}</SectionTitle>
            {story ? (
              <div className="mt-6 flex flex-col gap-6 sm:flex-row">
                {story.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={story.photo} alt={story.byline[locale]} width={160} height={160} loading="lazy" className="h-40 w-40 shrink-0 rounded-3xl object-cover" />
                )}
                <div className="space-y-4 text-[17px] leading-relaxed text-slate-700">
                  {story.paragraphs[locale].map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                  <p className="font-semibold text-blue-900">{story.byline[locale]}</p>
                </div>
              </div>
            ) : (
              <p className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center text-[16px] text-slate-500" data-testid="story-pending">
                {a.storyPending}
              </p>
            )}
          </Container>
        </section>

        <section aria-labelledby="characters" className="border-y border-slate-200 bg-white py-14 sm:py-20">
          <Container>
            <SectionTitle id="characters">{a.charactersTitle}</SectionTitle>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="flex items-end gap-6 overflow-hidden rounded-3xl bg-blue-900 px-6 pt-6 text-white sm:px-8 sm:pt-8">
                <div className="flex-1 pb-8">
                  <h3 className="font-display text-[26px] font-bold">{BRAND.teamMascot}</h3>
                  <p className="mt-1 text-[14px] font-semibold text-blue-200">{c.common.team}</p>
                  <p className="mt-4 text-[16px] leading-relaxed text-blue-50">{a.alti}</p>
                </div>
                <CharacterFigure character="team" view="front" height={260} heightClassName="h-[220px] sm:h-[260px]" />
              </div>
              <div className="flex items-end gap-6 overflow-hidden rounded-3xl bg-amber-50 px-6 pt-6 ring-1 ring-amber-200 sm:px-8 sm:pt-8">
                <div className="flex-1 pb-8">
                  <h3 className="font-display text-[26px] font-bold text-blue-900">{BRAND.assistant}</h3>
                  <p className="mt-1 text-[14px] font-semibold text-amber-700">{c.common.aiAssistant}</p>
                  <p className="mt-4 text-[16px] leading-relaxed text-slate-700">{a.altibot}</p>
                </div>
                <CharacterFigure character="assistant" view="front" height={150} heightClassName="mb-8 h-[120px] sm:h-[150px]" />
              </div>
            </div>
          </Container>
        </section>

        <section aria-labelledby="rules" className="py-14 sm:py-20">
          <Container>
            <SectionTitle id="rules">{a.rulesTitle}</SectionTitle>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {a.rules.map((rule, i) => (
                <li key={rule.title} className="card flex gap-4 p-5 sm:block sm:p-6">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <Icon name={RULE_ICONS[i] ?? "check"} size={20} />
                  </span>
                  <div>
                    <h3 className="pt-1.5 text-[17px] font-semibold text-blue-900 sm:mt-3 sm:pt-0">{rule.title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{rule.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Container>
        </section>

        <section aria-labelledby="where" className="pb-16 sm:pb-24">
          <Container>
            <div className="rounded-3xl bg-blue-900 p-7 text-white sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
              <div className="max-w-2xl">
                <h2 id="where" className="font-display text-[26px] font-bold">{a.whereTitle}</h2>
                <p className="mt-3 text-[17px] leading-relaxed text-blue-100">{a.where}</p>
              </div>
              <div className="mt-6 shrink-0 lg:mt-0">
                <CtaGroup locale={locale} secondary={false} />
              </div>
            </div>
          </Container>
        </section>
      </main>
    </SiteShell>
  );
}
