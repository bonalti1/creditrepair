import Icon, { type IconName } from "@/components/Icon";
import type { Locale } from "@/lib/i18n/dictionaries";
import { SITE_COPY } from "@/lib/site/copy";
import { publishedPress, publishedReviews, type PressMention, type Review } from "@/lib/site/socialProof";
import { ArrowLink, Container, Lead, SectionTitle } from "./ui";

// Sections that more than one page shows. Server components.

const INCLUDED_ICONS: IconName[] = ["grid", "search", "mail", "clipboard", "doc", "chat", "team", "clock"];

/** "What you get": everything, for everyone. */
export function IncludedGrid({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const c = SITE_COPY[locale].home.included;
  return (
    <ul className={`grid gap-4 sm:grid-cols-2 ${compact ? "" : "lg:grid-cols-4"}`}>
      {c.items.map((item, i) => (
        <li key={item.title} className="card p-6">
          <span data-on-navy className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-900 text-amber-400">
            <Icon name={INCLUDED_ICONS[i] ?? "check"} size={22} />
          </span>
          <h3 className="mt-4 text-[17px] font-semibold text-blue-900">{item.title}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** The honest comparison: a table on a wide screen, one card per question on a phone. */
export function Comparison({ locale }: { locale: Locale }) {
  const c = SITE_COPY[locale].home.compare;
  return (
    <div>
      {/* Wide screens: a real table. */}
      <div className="hidden overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200 md:block">
        <table className="w-full table-fixed text-left">
          <caption className="sr-only">{c.title}</caption>
          <thead>
            <tr className="border-b border-slate-200">
              <th scope="col" className="w-[22%] px-6 py-5 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{c.topic}</th>
              <th scope="col" className="w-[42%] bg-blue-900 px-6 py-5 font-display text-[18px] font-semibold text-white">{c.us}</th>
              <th scope="col" className="px-6 py-5 text-[16px] font-semibold text-slate-600">{c.them}</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row, i) => (
              <tr key={row.topic} className={i < c.rows.length - 1 ? "border-b border-slate-100" : ""}>
                <th scope="row" className="px-6 py-5 align-top text-[15px] font-semibold text-blue-900">{row.topic}</th>
                <td className="bg-blue-50/60 px-6 py-5 align-top">
                  <span className="flex gap-3 text-[15px] leading-relaxed text-slate-800">
                    <Icon name="check" size={20} strokeWidth={2.5} className="mt-0.5 shrink-0 text-amber-600" />
                    {row.us}
                  </span>
                </td>
                <td className="px-6 py-5 align-top text-[15px] leading-relaxed text-slate-600">{row.them}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones: one card per question. */}
      <ul className="space-y-3 md:hidden">
        {c.rows.map((row) => (
          <li key={row.topic} className="card overflow-hidden">
            <p className="px-5 pt-5 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{row.topic}</p>
            <div className="mx-3 mt-3 rounded-2xl bg-blue-900 px-4 py-3.5 text-white">
              <p data-on-navy className="text-[12px] font-semibold uppercase tracking-wide text-amber-300">{c.us}</p>
              <p className="mt-1 text-[15px] leading-relaxed">{row.us}</p>
            </div>
            <div className="px-5 pb-5 pt-3.5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{c.them}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{row.them}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] leading-relaxed text-slate-500">{c.note}</p>
    </div>
  );
}

function ReviewCard({ review, locale }: { review: Review; locale: Locale }) {
  const c = SITE_COPY[locale].home.reviews;
  return (
    <figure className="card flex h-full flex-col p-6" lang={review.language}>
      <blockquote className="flex-1 text-[16px] leading-relaxed text-slate-800">“{review.quote}”</blockquote>
      <figcaption className="mt-4 text-[14px] text-slate-600">
        <span className="font-semibold text-blue-900">{review.author}</span>{" "}
        <a href={review.url} className="underline underline-offset-2" rel="nofollow noopener" target="_blank">
          {c.via(review.source)}
        </a>
        , <time dateTime={review.postedOn}>{review.postedOn}</time>
      </figcaption>
    </figure>
  );
}

/**
 * Social proof, only what is real (socialProof.ts). With reviews on file:
 * the reviews, each linked to where it was posted, no stars drawn by us. With
 * none: "We're new: here is how we earn your trust". Press shows only when
 * there is any, as plain linked headlines, never logos.
 */
export function TrustSection({
  locale,
  reviews = publishedReviews(),
  press = publishedPress(),
}: {
  locale: Locale;
  reviews?: Review[];
  press?: PressMention[];
}) {
  const c = SITE_COPY[locale].home;
  const icons: IconName[] = ["mail", "calc", "clock", "info"];
  return (
    <section aria-labelledby="trust" className="py-16 sm:py-24" data-testid={reviews.length ? "reviews" : "trust-new"}>
      <Container>
        {reviews.length > 0 ? (
          <>
            <SectionTitle id="trust">{c.reviews.title}</SectionTitle>
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {reviews.map((r) => (
                <li key={r.url}>
                  <ReviewCard review={r} locale={locale} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
            <div>
              <SectionTitle id="trust">{c.trust.title}</SectionTitle>
              <Lead className="mt-4">{c.trust.lead}</Lead>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {c.trust.points.map((p, i) => (
                <li key={p.title} className="card p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <Icon name={icons[i] ?? "check"} size={20} />
                  </span>
                  <h3 className="mt-3 text-[17px] font-semibold text-blue-900">{p.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{p.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {press.length > 0 && (
          <div className="mt-12" data-testid="press">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{c.press.title}</h3>
            <ul className="mt-3 space-y-2">
              {press.map((p) => (
                <li key={p.url} className="text-[16px]">
                  <a href={p.url} className="font-semibold text-blue-700 underline underline-offset-4" rel="noopener" target="_blank">
                    {p.title}
                  </a>{" "}
                  <span className="text-slate-500">
                    · {p.outlet}, <time dateTime={p.publishedOn}>{p.publishedOn}</time>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Container>
    </section>
  );
}

/** "Your rights, up front": three lines and a link to /derechos. */
export function RightsCard({ locale }: { locale: Locale }) {
  const c = SITE_COPY[locale].home.rights;
  return (
    <div className="card flex h-full flex-col p-7 sm:p-9">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
        <Icon name="book" size={22} />
      </span>
      <h3 className="mt-4 font-display text-[24px] font-bold leading-tight text-blue-900">{c.title}</h3>
      <ul className="mt-4 flex-1 space-y-3">
        {c.points.map((p) => (
          <li key={p} className="flex gap-3 text-[16px] leading-snug text-slate-700">
            <Icon name="check" size={20} strokeWidth={2.5} className="mt-0.5 shrink-0 text-amber-600" />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <ArrowLink href="/derechos">{c.cta}</ArrowLink>
      </div>
    </div>
  );
}

