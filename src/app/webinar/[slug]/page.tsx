import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/components/Icon";
import { AltiWaveLoop, CharacterAvatar } from "@/components/Character";
import SiteShell from "@/components/site/SiteShell";
import { Container, Eyebrow } from "@/components/site/ui";
import WebinarRegistration from "@/components/site/WebinarRegistration";
import { BRAND } from "@/lib/brand";
import { requestLocale } from "@/lib/i18n/server";
import { siteUrl } from "@/lib/site/routes";
import { getAdminClient } from "@/lib/supabase/admin";
import { demoWebinars } from "@/lib/webinars/demo";
import { PLATFORM_NAMES, WEBINAR_PUBLIC_COPY } from "@/lib/webinars/publicCopy";
import { loadPublicWebinar } from "@/lib/webinars/server";
import { phaseOf, webinarWhen } from "@/lib/webinars/time";
import { PLATFORMS, type Webinar } from "@/lib/webinars/types";

// A webinar's public registration page (docs/WEBINARS.md, «Before»). Phone
// first, English and Spanish (the site's language system: ?lang=), the
// website's look with Alti, labelled as the AI assistant. Never "free":
// "Live class · 45 minutes · Register". While the class is live it shows
// where to watch; afterwards, the replay. A draft is never shown. In the demo
// (no database) the sample webinars are shown, and registering stores nothing.

export const dynamic = "force-dynamic";

async function findWebinar(slug: string): Promise<{ webinar: Webinar | null; demo: boolean }> {
  const db = getAdminClient();
  if (!db) return { webinar: demoWebinars(new Date()).find((w) => w.slug === slug && w.status !== "draft") ?? null, demo: true };
  try {
    return { webinar: await loadPublicWebinar(db, slug), demo: false };
  } catch {
    return { webinar: null, demo: false };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { locale } = await requestLocale();
  const { webinar } = await findWebinar(slug);
  const c = WEBINAR_PUBLIC_COPY[locale];
  const title = webinar ? `${locale === "es" ? webinar.title.es : webinar.title.en} · ${BRAND.name}` : `${c.eyebrow} · ${BRAND.name}`;
  return {
    title: { absolute: title },
    description: c.badge(webinar?.durationMinutes ?? 45),
    alternates: { canonical: `${siteUrl()}/webinar/${slug}?lang=${locale}`, languages: { en: `${siteUrl()}/webinar/${slug}?lang=en`, es: `${siteUrl()}/webinar/${slug}?lang=es`, "x-default": `${siteUrl()}/webinar/${slug}` } },
  };
}

export default async function WebinarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { locale } = await requestLocale();
  const c = WEBINAR_PUBLIC_COPY[locale];
  const { webinar, demo } = await findWebinar(slug);

  if (!webinar) {
    return (
      <SiteShell>
        <main>
          <Container narrow className="py-20">
            <p className="text-[18px] text-slate-700" data-testid="webinar-not-found">{c.notFound}</p>
            <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-blue-700 hover:underline">
              {BRAND.name}
            </Link>
          </Container>
        </main>
      </SiteShell>
    );
  }

  const phase = phaseOf(webinar, new Date());
  const title = (locale === "es" ? webinar.title.es : webinar.title.en) || webinar.title.en;
  const platforms = PLATFORMS.filter((p) => webinar.links[p]);
  const signup = `/registro?utm_source=webinar&utm_medium=page&utm_campaign=${encodeURIComponent(webinar.campaignTag ?? webinar.slug)}`;

  return (
    <SiteShell>
      <main data-testid="webinar-public">
        <section className="relative overflow-hidden bg-blue-900 text-white">
          <Container className="grid grid-cols-[minmax(0,1fr)] items-end gap-6 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="pb-10 sm:pb-14">
              <Eyebrow onNavy>{c.eyebrow}</Eyebrow>
              <h1 className="mt-2 font-display text-[32px] font-bold leading-[1.1] sm:text-[46px]">{title}</h1>
              <p className="mt-3 inline-flex rounded-full bg-amber-400 px-4 py-1.5 text-[15px] font-semibold text-blue-900" data-testid="webinar-badge">
                {c.badge(webinar.durationMinutes)}
              </p>
              <dl className="mt-5 space-y-2 text-[16px] text-blue-100">
                <div className="flex gap-2">
                  <dt className="sr-only">{c.when}</dt>
                  <span data-on-navy className="mt-0.5 shrink-0 text-amber-300"><Icon name="clock" size={20} /></span>
                  <dd>{webinarWhen(webinar.startsAt, locale)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="sr-only">{c.languagePick}</dt>
                  <span data-on-navy className="mt-0.5 shrink-0 text-amber-300"><Icon name="globe" size={20} /></span>
                  <dd>
                    {c.language[webinar.language]} · {c.hostedBy(webinar.host)}
                  </dd>
                </div>
                {platforms.length > 0 && (
                  <div className="flex gap-2">
                    <dt className="sr-only">{c.where}</dt>
                    <span data-on-navy className="mt-0.5 shrink-0 text-amber-300"><Icon name="video" size={20} /></span>
                    <dd>{platforms.map((p) => PLATFORM_NAMES[p]).join(" · ")}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-6 flex max-w-lg items-start gap-3" data-testid="webinar-alti">
                <CharacterAvatar character="assistant" size={40} tone="ivory" decorative className="sm:hidden" />
                <div className="rounded-[18px] rounded-tl-[6px] bg-white/10 px-4 py-3">
                  <p data-on-navy className="text-[12px] font-semibold uppercase tracking-[0.06em] text-amber-300">
                    {c.alti}
                  </p>
                  <p className="mt-0.5 text-[15.5px] leading-snug text-white">{c.altiHello}</p>
                </div>
              </div>
            </div>
            <AltiWaveLoop height={300} heightClassName="h-56 lg:h-80" decorative priority className="mx-auto hidden self-end sm:block" />
          </Container>
        </section>

        {(phase === "live" || phase === "ended" || phase === "cancelled") && (
          <section className="border-b border-slate-200 bg-white py-8" aria-live="polite">
            <Container narrow>
              {phase === "live" && (
                <div data-testid="webinar-live">
                  <p className="flex items-center gap-2 font-display text-[22px] font-bold text-red-700">
                    <span className="h-3 w-3 animate-pulse rounded-full bg-red-600 motion-reduce:animate-none" aria-hidden="true" />
                    {c.liveNow}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {platforms.map((p) => (
                      <a key={p} href={webinar.links[p]} target="_blank" rel="noopener noreferrer" className="pressable inline-flex h-12 items-center rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
                        {c.join(PLATFORM_NAMES[p])}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {phase === "ended" &&
                (webinar.replayUrl ? (
                  <a href={webinar.replayUrl} target="_blank" rel="noopener noreferrer" className="pressable inline-flex h-12 items-center rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500" data-testid="webinar-replay">
                    {c.replay}
                  </a>
                ) : (
                  <p className="text-[16px] text-slate-700">{c.replaySoon}</p>
                ))}
              {phase === "cancelled" && <p className="text-[16px] text-slate-700">{c.cancelled}</p>}
            </Container>
          </section>
        )}

        <section className="py-10 sm:py-14">
          <Container className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div>
              <h2 className="font-display text-[24px] font-bold text-blue-900">{c.whatYouLearn}</h2>
              <ul className="mt-4 space-y-3">
                {c.learn.map((line) => (
                  <li key={line} className="flex gap-3 text-[16.5px] leading-snug text-slate-700">
                    <Icon name="check" size={20} className="mt-0.5 shrink-0 text-blue-700" strokeWidth={2.25} />
                    {line}
                  </li>
                ))}
              </ul>
              {webinar.topic && <p className="mt-4 text-[15px] text-slate-600">{webinar.topic}</p>}
              <p className="mt-5 rounded-2xl bg-slate-100 px-4 py-3 text-[14.5px] leading-snug text-slate-700">{c.noPromise}</p>
              <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
                <p className="text-[15.5px] text-slate-700">{c.startReview}</p>
                <Link href={signup} className="pressable mt-3 inline-flex h-12 items-center gap-1.5 rounded-full bg-blue-50 px-5 text-[16px] font-semibold text-blue-700">
                  {c.startReviewCta}
                  <Icon name="chevron" size={16} />
                </Link>
              </div>
            </div>
            {/* Phone first: the form comes right under the hero on a phone, beside what we cover on a laptop. */}
            <div className="order-first lg:order-none">
              {phase === "upcoming" || phase === "live" ? (
                <WebinarRegistration slug={webinar.slug} locale={locale} when={webinarWhen(webinar.startsAt, locale)} durationMinutes={webinar.durationMinutes} demo={demo} />
              ) : (
                <p className="rounded-3xl border border-slate-200 bg-white p-6 text-[16px] text-slate-700">{phase === "cancelled" ? c.cancelled : c.ended}</p>
              )}
            </div>
          </Container>
        </section>
      </main>
    </SiteShell>
  );
}
