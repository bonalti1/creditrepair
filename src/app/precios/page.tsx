import { CharacterFigure } from "@/components/Character";
import Icon, { type IconName } from "@/components/Icon";
import SiteShell from "@/components/site/SiteShell";
import { IncludedGrid } from "@/components/site/sections";
import { CheckList, Container, CtaGroup, Lead, PageHero, SectionTitle } from "@/components/site/ui";
import { requestLocale } from "@/lib/i18n/server";
import { SITE_COPY } from "@/lib/site/copy";
import { publicPlans } from "@/lib/site/plans";
import { payEvents } from "@/lib/site/payTimeline";
import { PayTimeline } from "@/components/site/islands";
import { Reveal } from "@/components/site/motion";
import { siteMetadata } from "@/lib/site/seo";
import OptionsSection from "@/components/site/OptionsSection";

// /precios: how charging works, for everyone, and the offered plans when the
// catalogue has attorney-approved ones (src/lib/site/plans.ts). Until then,
// "plans and prices are explained before you sign". No amount is written in
// the copy; any amount on this page comes from an approved plan.

export async function generateMetadata() {
  return siteMetadata("pricing", (await requestLocale()).locale);
}

const RULE_ICONS: IconName[] = ["mail", "close", "calc", "clock", "team"];

export default async function Pricing() {
  const { locale } = await requestLocale();
  const c = SITE_COPY[locale];
  const p = c.pricing;
  const plans = await publicPlans(locale);
  // "When would I pay?": the rule for every plan, and each offered plan's own amounts (payTimeline.ts).
  const timelines = [
    ...plans.map((plan) => ({ id: plan.id, name: plan.name, events: payEvents(plan.timeline) })),
    { id: "rule", name: c.live.timeline.ruleOnly, events: payEvents(null) },
  ];

  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={p.eyebrow} title={p.title} lead={p.lead} figure={<CharacterFigure character="assistant" pose="thumbsUp" height={250} decorative />} />

        {/* The two options side by side: Credalti Complete and Credalti DIY (docs/SERVICE-OPTIONS.md). */}
        <OptionsSection locale={locale} />

        {/* Plans, or how they are explained */}
        <section aria-labelledby="plans" className="py-14 sm:py-20">
          <Container>
            <SectionTitle id="plans">{p.plansTitle}</SectionTitle>
            {plans.length > 0 ? (
              <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="plans">
                {plans.map((plan) => (
                  <li key={plan.id} className="card flex flex-col p-7">
                    <h3 className="font-display text-[22px] font-bold text-blue-900">{plan.name}</h3>
                    <ul className="mt-4 flex-1 space-y-2.5 text-[15px] leading-relaxed text-slate-700">
                      {plan.terms.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="mt-6 rounded-2xl bg-blue-900 px-4 py-3 text-[16px] font-semibold tabular-nums text-white">{plan.most}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-8 flex flex-col gap-6 rounded-3xl bg-blue-900 p-7 text-white sm:p-10 md:flex-row md:items-center md:justify-between" data-testid="no-plans">
                <div className="max-w-2xl">
                  <p className="font-display text-[24px] font-bold leading-tight sm:text-[28px]">{p.noPlans}</p>
                  <p className="mt-3 text-[17px] leading-relaxed text-blue-100">{p.noPlansSub}</p>
                </div>
                <div className="shrink-0">
                  <CtaGroup locale={locale} secondary={false} />
                </div>
              </div>
            )}
          </Container>
        </section>

        {/* When would I pay? Drag through months 1 to 6. */}
        <section aria-labelledby="when-pay" className="pb-14 sm:pb-20">
          <Container>
            <Reveal>
              <PayTimeline locale={locale} sets={timelines} />
            </Reveal>
          </Container>
        </section>

        {/* The rules every charge follows */}
        <section aria-labelledby="rules" className="border-y border-slate-200 bg-white py-14 sm:py-20">
          <Container>
            <SectionTitle id="rules">{p.rulesTitle}</SectionTitle>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {p.rules.slice(0, 4).map((rule, i) => (
                <li key={rule.title} className="rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                    <Icon name={RULE_ICONS[i] ?? "check"} size={22} />
                  </span>
                  <h3 className="mt-4 text-[18px] font-semibold text-blue-900">{rule.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{rule.body}</p>
                </li>
              ))}
            </ol>
            {p.rules.slice(4).map((rule, i) => (
              <p key={rule.title} className="mt-4 flex items-start gap-3 rounded-3xl bg-slate-50 px-6 py-4 text-[15px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
                <Icon name={RULE_ICONS[4 + i] ?? "check"} size={20} className="mt-0.5 shrink-0 text-amber-700" />
                <span>
                  <strong className="text-blue-900">{rule.title}.</strong> {rule.body}
                </span>
              </p>
            ))}
          </Container>
        </section>

        {/* Included for everyone */}
        <section aria-labelledby="included" className="py-14 sm:py-20">
          <Container>
            <SectionTitle id="included">{p.includedTitle}</SectionTitle>
            <Lead className="mt-3">{p.includedLead}</Lead>
            <div className="mt-8">
              <IncludedGrid locale={locale} />
            </div>
          </Container>
        </section>

        {/* Monitoring, and changing your mind */}
        <section aria-label={`${p.monitoringTitle} · ${p.cancelTitle}`} className="pb-16 sm:pb-24">
          <Container className="grid gap-4 lg:grid-cols-2">
            <div className="card p-7 sm:p-9">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                <Icon name="search" size={22} />
              </span>
              <h2 className="mt-4 font-display text-[24px] font-bold text-blue-900">{p.monitoringTitle}</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-slate-700">{p.monitoring}</p>
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-relaxed text-blue-900">{p.disclosure}</p>
            </div>
            <div className="card p-7 sm:p-9">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                <Icon name="clock" size={22} />
              </span>
              <h2 className="mt-4 font-display text-[24px] font-bold text-blue-900">{p.cancelTitle}</h2>
              <CheckList items={p.cancel} className="mt-4" />
            </div>
          </Container>
        </section>
      </main>
    </SiteShell>
  );
}
