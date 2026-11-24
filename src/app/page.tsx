import Icon from "@/components/Icon";
import { CharacterAvatar, CharacterFigure } from "@/components/Character";
import AltiBotDemo from "@/components/site/AltiBotDemo";
import SiteShell from "@/components/site/SiteShell";
import { Comparison, IncludedGrid, RightsCard, TrustSection } from "@/components/site/sections";
import { ArrowLink, CheckList, Container, CtaGroup, Eyebrow, FaqList, Lead, SectionTitle } from "@/components/site/ui";
import { BRAND } from "@/lib/brand";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { demoCases } from "@/lib/site/demo";
import { siteMetadata } from "@/lib/site/seo";

// Home (/). The public website's front page, server-rendered in the
// request's language; the AltiBot example is the only part that runs in the
// browser. The words are in src/lib/site/copy.ts; the rules they follow are
// at the top of that file and in docs/WEBSITE.md.

export async function generateMetadata() {
  return siteMetadata("home", (await requestLocale()).locale);
}

/** The FAQ answers the home page previews, by position in the full list. */
const FAQ_PREVIEW = [1, 2, 5, 9, 12];

export default async function Home() {
  const { locale } = await requestLocale();
  const c = SITE_COPY[locale];
  const h = c.home;
  const cases = demoCases(locale);

  return (
    <SiteShell>
      <main>
        {/* ── Hero: the promise on the left, the product itself on the right ── */}
        <section className="relative overflow-hidden bg-gradient-to-b from-blue-800 to-blue-900 text-white">
          <div aria-hidden className="pointer-events-none absolute -left-32 top-24 h-[380px] w-[380px] rounded-full bg-blue-700/40 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-blue-800/70 blur-3xl" />
          <Container className="relative grid gap-12 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center lg:gap-16 lg:pb-24 lg:pt-16 xl:grid-cols-[minmax(0,1fr)_380px_170px] xl:gap-x-16">
            <div>
              <p className="inline-flex items-center gap-2.5 rounded-full bg-white/10 py-1.5 pl-1.5 pr-4 text-[14px] font-medium text-blue-100 ring-1 ring-inset ring-white/10">
                <CharacterAvatar character="assistant" size={30} tone="ivory" decorative />
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

            {/* The example, with the two characters: Alti (the team) behind, AltiBot (the AI) in front. */}
            <div aria-labelledby="demo" className="relative">
              {/* Phones and tablets: the characters introduce the example. */}
              <div className="mb-8 flex items-end justify-center gap-4 lg:hidden">
                <figure className="flex flex-col items-center">
                  <CharacterFigure character="team" view="threeQuarter" height={200} priority />
                  <figcaption className="mt-2 whitespace-nowrap rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold text-white">{c.common.team}</figcaption>
                </figure>
                <figure className="flex flex-col items-center">
                  <CharacterFigure character="assistant" view="threeQuarter" height={112} priority />
                  <figcaption className="mt-2 whitespace-nowrap rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold text-white">
                    {BRAND.assistant} · {c.common.ai}
                  </figcaption>
                </figure>
              </div>
              <div className="mx-auto max-w-[360px] text-center">
                <h2 id="demo" className="font-display text-[22px] font-semibold leading-snug text-white">
                  {h.demo.title}
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed text-blue-100">{h.demo.lead}</p>
              </div>
              <div className="relative mt-6">
                <AltiBotDemo copy={h.demo} cases={cases} ai={c.common.aiAssistant} />
                <div aria-hidden className="pointer-events-none absolute -bottom-6 -left-16 z-10 hidden lg:block">
                  <CharacterFigure character="assistant" view="threeQuarter" height={150} decorative />
                </div>
              </div>
              <p className="mx-auto mt-5 max-w-[360px] text-center text-[13px] leading-relaxed text-blue-200">{h.demo.note}</p>
            </div>

            {/* Wide screens: Alti stands beside the phone, the team next to the product. */}
            <figure className="hidden self-end xl:flex xl:flex-col xl:items-center">
              <CharacterFigure character="team" view="threeQuarter" height={420} priority />
              <figcaption className="mt-3 whitespace-nowrap rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold text-white">{c.common.team}</figcaption>
            </figure>
          </Container>
          <div aria-hidden className="h-1.5 bg-amber-400" />
        </section>

        {/* ── Why it matters ───────────────────────────────────────────── */}
        <section aria-labelledby="why" className="border-y border-slate-200 bg-white py-16 sm:py-24">
          <Container>
            <div className="max-w-2xl">
              <SectionTitle id="why">{h.why.title}</SectionTitle>
              <Lead className="mt-4">{h.why.lead}</Lead>
            </div>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {h.why.stats.map((s) => (
                <li key={s.figure} className="flex flex-col rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
                  <p className="font-display text-[34px] font-bold leading-none text-blue-900">{s.figure}</p>
                  <p className="mt-3 flex-1 text-[15px] leading-relaxed text-slate-700">{s.text}</p>
                  <a href={s.source.url} rel="noopener" target="_blank" className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-blue-700 underline underline-offset-2">
                    {c.common.sourcesTitle}: {s.source.label}
                  </a>
                </li>
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

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section aria-labelledby="how" className="py-16 sm:py-24">
          <Container>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <SectionTitle id="how">{h.how.title}</SectionTitle>
                <Lead className="mt-4">{h.how.lead}</Lead>
              </div>
              <ArrowLink href="/como-funciona">{h.how.cta}</ArrowLink>
            </div>
            <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {h.how.steps.map((step, i) => (
                <li key={step.title} className="card relative flex gap-4 p-5 md:block md:p-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 font-display text-[18px] font-bold text-blue-900">{i + 1}</span>
                  <div>
                    <h3 className="pt-2 text-[18px] font-semibold text-blue-900 md:mt-4 md:pt-0">{step.title}</h3>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600 md:mt-2">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Container>
        </section>

        {/* ── What you get ─────────────────────────────────────────────── */}
        <section aria-labelledby="included" className="bg-blue-50/70 py-16 sm:py-24">
          <Container>
            <div className="max-w-2xl">
              <SectionTitle id="included">{h.included.title}</SectionTitle>
              <Lead className="mt-4">{h.included.lead}</Lead>
            </div>
            <div className="mt-10">
              <IncludedGrid locale={locale} />
            </div>
          </Container>
        </section>

        {/* ── Comparison ───────────────────────────────────────────────── */}
        <section aria-labelledby="compare" className="py-16 sm:py-24">
          <Container>
            <div className="max-w-2xl">
              <SectionTitle id="compare">{h.compare.title}</SectionTitle>
              <Lead className="mt-4">{h.compare.lead}</Lead>
            </div>
            <div className="mt-10">
              <Comparison locale={locale} />
            </div>
          </Container>
        </section>

        {/* ── Pricing teaser and rights ────────────────────────────────── */}
        <section aria-labelledby="pricing" className="pb-16 sm:pb-24">
          <Container className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <div className="relative overflow-hidden rounded-3xl bg-blue-900 p-7 text-white sm:p-10">
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
            </div>
            <RightsCard locale={locale} />
          </Container>
        </section>

        {/* ── Trust: real reviews only, else how we earn it ───────────── */}
        <div className="border-t border-slate-200 bg-white">
          <TrustSection locale={locale} />
        </div>

        {/* ── Partners ─────────────────────────────────────────────────── */}
        <section aria-labelledby="partners" className="py-16 sm:py-20">
          <Container>
            <div className="card flex flex-col gap-6 p-7 sm:p-10 md:flex-row md:items-center md:justify-between">
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
            </div>
          </Container>
        </section>

        {/* ── FAQ preview ──────────────────────────────────────────────── */}
        <section aria-labelledby="faq" className="pb-16 sm:pb-24">
          <Container className="grid gap-8 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <SectionTitle id="faq">{h.faq.title}</SectionTitle>
              <div className="mt-6">
                <ArrowLink href="/preguntas">{h.faq.cta}</ArrowLink>
              </div>
            </div>
            <FaqList items={FAQ_PREVIEW.map((i) => c.faq.items[i]!)} />
          </Container>
        </section>

        {/* ── Final call ───────────────────────────────────────────────── */}
        <section aria-labelledby="final" className="relative overflow-hidden bg-blue-900 py-16 text-white sm:py-24">
          <Container className="relative text-center">
            <div className="flex justify-center -space-x-3">
              <CharacterAvatar character="team" size={72} className="ring-4 ring-blue-900" />
              <CharacterAvatar character="assistant" size={72} tone="ivory" className="ring-4 ring-blue-900" />
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
