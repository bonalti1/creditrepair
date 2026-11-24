import Link from "next/link";
import Icon from "@/components/Icon";
import type { Locale } from "@/lib/i18n/dictionaries";
import { primaryCta } from "@/lib/site/cta";
import { SITE_COPY } from "@/lib/site/copy";

// Building blocks of the public website. Server components: no JavaScript
// reaches the browser for any of them. Colours are the brand tokens only
// (globals.css): navy surfaces, gold actions with navy text, gold text only on
// navy (marked data-on-navy), amber-700 for gold-toned text on light.

export function Container({ children, className = "", narrow = false }: { children: React.ReactNode; className?: string; narrow?: boolean }) {
  // Narrow: the reading width, still aligned with the page's left edge (the hero above it).
  return (
    <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}>{narrow ? <div className="max-w-4xl">{children}</div> : children}</div>
  );
}

export function Eyebrow({ children, onNavy = false }: { children: React.ReactNode; onNavy?: boolean }) {
  return onNavy ? (
    <p data-on-navy className="text-[13px] font-semibold uppercase tracking-[0.08em] text-amber-300">
      {children}
    </p>
  ) : (
    <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-amber-700">{children}</p>
  );
}

export function SectionTitle({ id, children, onNavy = false, className = "" }: { id?: string; children: React.ReactNode; onNavy?: boolean; className?: string }) {
  return (
    <h2
      id={id}
      className={`font-display text-[28px] font-bold leading-[1.15] sm:text-[38px] ${onNavy ? "text-white" : "text-blue-900"} ${className}`}
    >
      {children}
    </h2>
  );
}

export function Lead({ children, onNavy = false, className = "" }: { children: React.ReactNode; onNavy?: boolean; className?: string }) {
  return <p className={`text-[17px] leading-relaxed sm:text-[18px] ${onNavy ? "text-blue-100" : "text-slate-600"} ${className}`}>{children}</p>;
}

const primaryClass =
  "pressable inline-flex h-14 items-center justify-center gap-2 rounded-full bg-amber-400 px-8 text-[17px] font-semibold text-blue-900 shadow-[0_8px_24px_-10px_rgba(239,181,55,0.7)] hover:bg-amber-500";

/** The main action: WhatsApp with the team when configured, else the online start. */
export function PrimaryCta({ locale, className = "" }: { locale: Locale; className?: string }) {
  const cta = primaryCta(locale);
  return cta.external ? (
    <a href={cta.href} className={`${primaryClass} ${className}`} rel="noopener" target="_blank">
      <Icon name="chat" size={20} />
      {cta.label}
    </a>
  ) : (
    <Link href={cta.href} className={`${primaryClass} ${className}`}>
      {cta.label}
      <Icon name="chevron" size={18} strokeWidth={2.25} />
    </Link>
  );
}

/** The main action, the second way in, and the small print under it. */
export function CtaGroup({
  locale,
  onNavy = true,
  secondary = true,
  align = "start",
}: {
  locale: Locale;
  onNavy?: boolean;
  secondary?: boolean;
  align?: "start" | "center";
}) {
  const c = SITE_COPY[locale].common;
  const cta = primaryCta(locale);
  const ghost = onNavy
    ? "bg-white/10 text-white hover:bg-white/15 ring-1 ring-inset ring-white/15"
    : "bg-white text-blue-900 ring-1 ring-inset ring-blue-200 hover:bg-blue-50";
  return (
    <div className={align === "center" ? "text-center" : ""}>
      <div className={`flex flex-col gap-3 sm:flex-row ${align === "center" ? "sm:justify-center" : ""}`}>
        <PrimaryCta locale={locale} className="w-full sm:w-auto" />
        {secondary && (
          <Link href="/como-funciona" className={`pressable inline-flex h-14 w-full items-center justify-center rounded-full px-8 text-[17px] font-semibold sm:w-auto ${ghost}`}>
            {c.secondary}
          </Link>
        )}
      </div>
      {cta.alternate && (
        <p className="mt-3 text-[15px]">
          <Link href={cta.alternate.href} className={`font-semibold underline underline-offset-4 ${onNavy ? "text-white" : "text-blue-700"}`}>
            {cta.alternate.label}
          </Link>
        </p>
      )}
      <p className={`mt-4 text-[13px] leading-relaxed ${onNavy ? "text-blue-200" : "text-slate-500"}`}>{c.underCta}</p>
    </div>
  );
}

/** A text link with an arrow, for "learn more" at the end of a section. */
export function ArrowLink({ href, children, onNavy = false }: { href: string; children: React.ReactNode; onNavy?: boolean }) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-1.5 text-[16px] font-semibold underline-offset-4 hover:underline ${onNavy ? "text-white" : "text-blue-700"}`}
    >
      {children}
      <Icon name="chevron" size={18} strokeWidth={2.25} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** The top of every inner page: navy, with its eyebrow, title and lead. One h1 per page. */
export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden bg-blue-900 text-white">
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[420px] w-[420px] rounded-full bg-blue-800/70 blur-3xl" />
      <Container className="relative pb-14 pt-10 sm:pb-20 sm:pt-16">
        <Eyebrow onNavy>{eyebrow}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-[34px] font-bold leading-[1.1] sm:text-[52px]">{title}</h1>
        <Lead onNavy className="mt-5 max-w-2xl">
          {lead}
        </Lead>
        {children}
      </Container>
    </section>
  );
}

/** A list with gold check marks. */
export function CheckList({ items, onNavy = false, className = "" }: { items: readonly string[]; onNavy?: boolean; className?: string }) {
  return (
    <ul className={`space-y-3 ${className}`}>
      {items.map((item) => (
        <li key={item} className={`flex gap-3 text-[16px] leading-snug ${onNavy ? "text-blue-50" : "text-slate-700"}`}>
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${onNavy ? "bg-amber-400 text-blue-900" : "bg-amber-100 text-amber-700"}`}>
            <Icon name="check" size={15} strokeWidth={2.5} />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Draft · pending attorney review", for the legal placeholders. */
export function PendingBadge({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-2 text-[13px] font-semibold leading-snug text-amber-700 ring-1 ring-inset ring-amber-200">
      <Icon name="info" size={16} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Questions and answers, open and close with no script (<details>). */
export function FaqList({ items }: { items: ReadonlyArray<{ q: string; a: string }> }) {
  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-5 text-[17px] font-semibold text-blue-900 hover:bg-slate-50 sm:px-7 [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 transition-transform group-open:rotate-45">
              <Icon name="plus" size={16} strokeWidth={2.25} />
            </span>
          </summary>
          <p className="px-5 pb-6 text-[16px] leading-relaxed text-slate-600 sm:px-7">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
