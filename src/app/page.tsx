import Icon from "@/components/Icon";
import { CharacterAvatar, CharacterFigure } from "@/components/Character";
import SiteShell, { askClientCopy, askCtas } from "@/components/site/SiteShell";
import { CompareToggle, HeroPhone, HomeReadyTeaser, HowScroll, ReportQuiz, Tools } from "@/components/site/islands";
import { Reveal, StatPictogram } from "@/components/site/motion";
import { IncludedGrid, RightsCard, TrustSection } from "@/components/site/sections";
import { ArrowLink, CheckList, Container, CtaGroup, Eyebrow, FaqList, Lead, SectionTitle } from "@/components/site/ui";
import { BRAND, aiByline } from "@/lib/brand";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { ONLINE_START } from "@/lib/site/cta";
import { demoCases } from "@/lib/site/demo";
import { siteMetadata } from "@/lib/site/seo";

// Home (/). The public website's front page, server-rendered in the request's
// language, with small islands for what moves (docs/WEBSITE.md, "Interactive
// pieces"): the hero phone (the example, and "Ask Alti"), the stat marks,
// the report check, the scroll story, the after-care teaser, the comparison
// toggle and the two calculators. The words are in src/lib/site/copy.ts and
// live.ts; the rules they follow are at the top of those files.
//
// Alti, the AI assistant, is the one character and the only voice; he is
// labelled AI wherever he appears beside words.

export async function generateMetadata() {
  return siteMetadata("home", (await requestLocale()).locale);
}

/** The FAQ answers the home page previews, by position in the full list. */
const FAQ_PREVIEW = [0, 1, 2, 5, 9, 15];

/** The real app screens of the scroll story (public/screens/site/), one per step. */
const STORY_SCREENS = ["welcome", "case", "review", "letters", "build"] as const;

/** "1 in 5" → 5: the sourced figures are drawn as that many marks. */
const ofFigure = (figure: string) => Number(/(\d+)\s*$/.exec(figure)?.[1] ?? 0);

export default async function Home() {
  const { locale } = await requestLocale();
  const c = SITE_COPY[locale];
  const h = c.home;
  const live = c.live;
  const cases = demoCases(locale);
  const byline = aiByline(locale);

  return (
    <SiteShell>
      <main>
        {/* ── Hero: the promise on the left, the product itself on the right ── */}
        <section className="relative overflow-hidden bg-gradient-to-b from-blue-800 to-blue-900 text-white">
          <div aria-hidden className="pointer-events-none absolute -left-32 top-24 h-[380px] w-[380px] rounded-full bg-blue-700/40 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-blue-800/70 blur-3xl" />
          <Container className="relative grid gap-12 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center lg:gap-16 lg:pb-24 lg:pt-16 xl:grid-cols-[minmax(0,1fr)_380px_200px] xl:gap-x-12">
            <div>
              <p className="inline-flex items-center gap-2.5 rounded-full bg-white/10 py-1.5 pl-1.5 pr-4 text-[14px] font-medium text-blue-100 ring-1 ring-inset ring-white/10">
                <CharacterAvatar character="assistant" size={30} decorative />
                {h.eyebrow}
              </p>
              <h1 className="mt-6 font-display text-[35px] font-bold leading-[1.08] sm:text-[54px] lg:text-[56px]">
                {h.headline} <span data-on-navy className="block text-amber-400">{h.headlineAccent}</span>
              </h1>
              <Lead onNavy className="mt-5 max-w-xl sm:text-[20px]">
                {h.lead}
              </Lead>
              <CheckList items={h.heroPoints} onNavy className="mt-6" />
              <div className="mt-8">
                <CtaGroup locale={locale} />
              </div>
            </div>

            {/* The phone: the example and "Ask Alti", with Alti beside it. */}
            <div aria-labelledby="demo" className="relative">
              {/* Phones and tablets: Alti introduces the phone, labelled as AI. */}
              <div className="mb-6 flex items-end justify-center gap-4 lg:hidden">
                <CharacterFigure character="assistant" view="threeQuarter" height={170} priority motion="wave" />
                <p className="mb-6 max-w-[190px] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2.5 text-[14px] font-semibold leading-snug text-white ring-1 ring-inset ring-white/15">
                  {byline}
                  <span className="mt-0.5 block text-[12.5px] font-medium text-blue-100">{live.ask.subtitle}</span>
                </p>
              </div>
              <div className="mx-auto max-w-[360px] text-center">
                <h2 id="demo" className="font-display text-[22px] font-semibold leading-snug text-white">
                  {h.demo.title}
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed text-blue-100">{h.demo.lead}</p>
              </div>
              <div className="relative mt-6">
                <HeroPhone
                  demo={h.demo}
                  cases={cases}
                  byline={byline}
                  tabs={{ example: live.hero.tabExample, ask: live.hero.tabAsk, label: live.hero.tabsLabel }}
                  ask={askClientCopy(locale)}
                  ctas={askCtas(locale)}
                  locale={locale}
                />
              </div>
              <p className="mx-auto mt-5 max-w-[360px] text-center text-[13px] leading-relaxed text-blue-200">{h.demo.note}</p>
            </div>

            {/* Wide screens: floating product facts (facts, never reviews), and Alti with his AI label. */}
            <div className="hidden self-stretch xl:flex xl:flex-col xl:items-center xl:justify-between">
              <ul aria-hidden className="mt-24 w-full space-y-4">
                {live.hero.facts.map((fact, i) => (
                  <li
                    key={fact}
                    className={`float-y flex w-[230px] items-center gap-2.5 rounded-2xl bg-white px-3.5 py-3 text-[13.5px] font-semibold leading-snug text-blue-900 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)] ${
                      ["-ml-12", "ml-2", "-ml-8", "ml-0"][i] ?? ""
                    }`}
                    style={{ animationDelay: `${i * 1.3}s` }}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                      <Icon name={(["mail", "calc", "clock", "globe"] as const)[i] ?? "check"} size={15} />
                    </span>
                    {fact}
                  </li>
                ))}
              </ul>
              <figure className="flex flex-col items-center">
                <CharacterFigure character="assistant" view="threeQuarter" height={300} priority motion="idle" />
                <figcaption data-on-navy className="mt-3 whitespace-nowrap rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold text-amber-300">
                  {byline}
                </figcaption>
              </figure>
            </div>
          </Container>
          <div aria-hidden className="h-1.5 bg-amber-400" />
        </section>

        {/* ── Why it matters ───────────────────────────────────────────── */}
        <section aria-labelledby="why" className="border-y border-slate-200 bg-white py-16 sm:py-24">
          <Container>
            <Reveal className="max-w-2xl">
              <SectionTitle id="why">{h.why.title}</SectionTitle>
              <Lead className="mt-4">{h.why.lead}</Lead>
            </Reveal>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {h.why.stats.map((s, i) => (
                <Reveal as="li" key={s.figure} delay={i * 80} className="flex flex-col rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200 transition-transform hover:-translate-y-1">
                  <p className="font-display text-[34px] font-bold leading-none text-blue-900">{s.figure}</p>
                  {i < 2 && ofFigure(s.figure) > 1 && <StatPictogram of={ofFigure(s.figure)} label={live.stats.of(ofFigure(s.figure))} />}
                  <p className="mt-3 flex-1 text-[15px] leading-relaxed text-slate-700">{s.text}</p>
                  <a href={s.source.url} rel="noopener" target="_blank" className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-blue-700 underline underline-offset-2">
                    {c.common.sourcesTitle}: {s.source.label}
                  </a>
                </Reveal>
              ))}
            </ul>
            <p className="mt-8 flex items-start gap-2.5 text-[16px] text-slate-700">
              <Icon name="search" size={20} className="mt-0.5 shrink-0 text-blue-700" />
              <span>
                {h.why.close.replace("AnnualCreditReport.com.", "")}
                <a href="https://www.annualcreditreport.com" rel="noopener" target="_blank" className="font-semibold text-blue-700 underline underline-offset-2">
                  AnnualCreditReport.com
                </a>
                .
              </span>
            </p>
          </Container>
        </section>

        {/* ── What's on your report? (the 30-second check) ─────────────── */}
        <section aria-labelledby="quiz" className="bg-blue-50/70 py-16 sm:py-24">
          <Container>
            <Reveal className="max-w-2xl">
              <Eyebrow>{live.quiz.eyebrow}</Eyebrow>
              <SectionTitle id="quiz" className="mt-2">
                {live.quiz.title}
              </SectionTitle>
              <Lead className="mt-4">{live.quiz.lead}</Lead>
            </Reveal>
            <div className="mt-10">
              <ReportQuiz locale={locale} startHref={ONLINE_START} />
            </div>
          </Container>
        </section>

        {/* ── How it works: the scroll story ───────────────────────────── */}
        <section aria-labelledby="how" className="py-16 sm:py-24">
          <Container>
            <Reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <SectionTitle id="how">{h.how.title}</SectionTitle>
                <Lead className="mt-4">{h.how.lead}</Lead>
              </div>
              <ArrowLink href="/como-funciona">{h.how.cta}</ArrowLink>
            </Reveal>
            <div className="mt-10">
              <HowScroll stages={c.how.stages} screens={STORY_SCREENS} locale={locale} />
            </div>
            <p className="mt-6 text-center text-[13px] text-slate-500">{c.how.screensNote}</p>
          </Container>
        </section>

        {/* ── What you get ─────────────────────────────────────────────── */}
        <section aria-labelledby="included" className="bg-blue-50/70 py-16 sm:py-24">
          <Container>
            <Reveal className="max-w-2xl">
              <SectionTitle id="included">{h.included.title}</SectionTitle>
              <Lead className="mt-4">{h.included.lead}</Lead>
            </Reveal>
            <Reveal className="mt-10">
              <IncludedGrid locale={locale} />
            </Reveal>
          </Container>
        </section>

        {/* ── After the letters: building credit, the home path, ITIN ──── */}
        <section aria-labelledby="after" className="py-16 sm:py-24">
          <Container className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
            <Reveal>
              <Eyebrow>{live.after.eyebrow}</Eyebrow>
              <SectionTitle id="after" className="mt-2">
                {live.after.title}
              </SectionTitle>
              <Lead className="mt-4">{live.after.lead}</Lead>
              <ul className="mt-8 space-y-3">
                {live.after.cards.map((card, i) => (
                  <li key={card.title} className="card flex gap-4 p-5 transition-transform hover:-translate-y-0.5">
                    <span data-on-navy className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-900 text-amber-400">
                      <Icon name={(["chart", "home", "doc"] as const)[i] ?? "check"} size={22} />
                    </span>
                    <span>
                      <span className="block text-[17px] font-semibold text-blue-900">{card.title}</span>
                      <span className="mt-1 block text-[15px] leading-relaxed text-slate-600">{card.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[13px] leading-relaxed text-slate-500">{live.after.note}</p>
            </Reveal>
            <Reveal delay={120}>
              <HomeReadyTeaser locale={locale} startHref={ONLINE_START} />
            </Reveal>
          </Container>
        </section>

        {/* ── Comparison ───────────────────────────────────────────────── */}
        <section aria-labelledby="compare" className="border-y border-slate-200 bg-white py-16 sm:py-24">
          <Container>
            <Reveal className="max-w-2xl">
              <SectionTitle id="compare">{h.compare.title}</SectionTitle>
              <Lead className="mt-4">{h.compare.lead}</Lead>
            </Reveal>
            <div className="mt-10">
              <CompareToggle locale={locale} rows={h.compare.rows} note={h.compare.note} />
            </div>
          </Container>
        </section>

        {/* ── Tools ────────────────────────────────────────────────────── */}
        <section aria-labelledby="tools" className="py-16 sm:py-24">
          <Container className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <Reveal>
              <Eyebrow>{live.tools.eyebrow}</Eyebrow>
              <SectionTitle id="tools" className="mt-2">
                {live.tools.title}
              </SectionTitle>
              <Lead className="mt-4">{live.tools.lead}</Lead>
            </Reveal>
            <Tools locale={locale} />
          </Container>
        </section>

        {/* ── Pricing teaser and rights ────────────────────────────────── */}
        <section aria-labelledby="pricing" className="pb-16 sm:pb-24">
          <Container className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Reveal className="relative overflow-hidden rounded-3xl bg-blue-900 p-7 text-white sm:p-10">
              <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-800" />
              <div className="relative">
                <span data-on-navy className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-amber-400">
                  <Icon name="calc" size={22} />
                </span>
                <h2 id="pricing" className="mt-4 font-display text-[28px] font-bold leading-tight sm:text-[34px]">
                  {h.pricing.title}
                </h2>
                <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-blue-100">{h.pricing.lead}</p>
                <CheckList items={h.pricing.points} onNavy className="mt-6" />
                <div className="mt-8">
                  <ArrowLink href="/precios" onNavy>
                    {h.pricing.cta}
                  </ArrowLink>
                </div>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <RightsCard locale={locale} />
            </Reveal>
          </Container>
        </section>

        {/* ── Trust: real reviews only, else how we earn it ───────────── */}
        <div className="border-t border-slate-200 bg-white">
          <TrustSection locale={locale} />
        </div>

        {/* ── Partners ─────────────────────────────────────────────────── */}
        <section aria-labelledby="partners" className="py-16 sm:py-20">
          <Container>
            <Reveal className="card flex flex-col gap-6 p-7 sm:p-10 md:flex-row md:items-center md:justify-between">
              <div className="flex gap-5">
                <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 sm:flex">
                  <Icon name="team" size={28} />
                </span>
                <div className="max-w-2xl">
                  <h2 id="partners" className="font-display text-[24px] font-bold leading-tight text-blue-900 sm:text-[28px]">
                    {h.partners.title}
                  </h2>
                  <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{h.partners.lead}</p>
                </div>
              </div>
              <div className="shrink-0">
                <ArrowLink href="/socios">{h.partners.cta}</ArrowLink>
              </div>
            </Reveal>
          </Container>
        </section>

        {/* ── FAQ preview ──────────────────────────────────────────────── */}
        <section aria-labelledby="faq" className="pb-16 sm:pb-24">
          <Container className="grid gap-8 lg:grid-cols-[1fr_1.6fr]">
            <Reveal>
              <SectionTitle id="faq">{h.faq.title}</SectionTitle>
              <div className="mt-6">
                <ArrowLink href="/preguntas">{h.faq.cta}</ArrowLink>
              </div>
            </Reveal>
            <FaqList items={FAQ_PREVIEW.map((i) => c.faq.items[i]!)} />
          </Container>
        </section>

        {/* ── Final call ───────────────────────────────────────────────── */}
        <section aria-labelledby="final" className="relative overflow-hidden bg-blue-900 py-16 text-white sm:py-24">
          <Container className="relative text-center">
            <div className="flex flex-col items-center">
              <CharacterAvatar character="assistant" size={84} className="ring-4 ring-amber-400" />
              <p data-on-navy className="mt-3 text-[13px] font-semibold text-amber-300">
                {BRAND.assistant} · {BRAND.aiLabel[locale]}
              </p>
            </div>
            <SectionTitle id="final" onNavy className="mx-auto mt-6 max-w-2xl">
              {h.final.title}
            </SectionTitle>
            <Lead onNavy className="mx-auto mt-4 max-w-xl">
              {h.final.lead}
            </Lead>
            <div className="mx-auto mt-8 max-w-2xl">
              <CtaGroup locale={locale} secondary={false} align="center" />
            </div>
          </Container>
        </section>
      </main>
    </SiteShell>
  );
}
