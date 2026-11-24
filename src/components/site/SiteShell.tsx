import Link from "next/link";
import { headers } from "next/headers";
import Icon from "@/components/Icon";
import Logo from "@/components/Logo";
import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import { PATH_HEADER } from "@/lib/i18n/detect";
import { requestLocale } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/dictionaries";
import { SITE_COPY } from "@/lib/site/copy";
import { ONLINE_START, primaryCta, supportPhone, whatsappHref } from "@/lib/site/cta";
import { aiByline } from "@/lib/brand";
import AskAltiLauncher from "./AskAltiLauncher";
import type { AskCopy, AskCtas } from "./AskAlti";
import { otherLanguageHref } from "@/lib/site/routes";
import { jsonLd, organizationJsonLd } from "@/lib/site/seo";
import { Container, PrimaryCta } from "./ui";

// The frame of every public page: the header (logo, menu, language, sign in,
// the main action), the page, and the footer with the disclosures and the
// legal links. Server-rendered in the request's language
// (src/lib/i18n/server.ts). The menu on a phone is a <details>, and the
// language switch is a link to the same page with ?lang=, so neither needs any
// JavaScript; the proxy saves the choice and the next page paints in it (with
// a cross-fade where the browser supports view transitions: globals.css).
// Every page also gets "Ask Alti" (AskAltiLauncher: the floating button, and
// on a phone the sticky bar), whose chat loads only when opened.

/** The chat's two actions, in the page's language: start a review, or WhatsApp with the team. */
export function askCtas(locale: Locale): AskCtas {
  const cta = primaryCta(locale);
  return {
    start: { href: cta.external ? ONLINE_START : cta.href, external: false },
    whatsapp: whatsappHref(SITE_COPY[locale].live.ask.whatsappText),
    faq: "/preguntas",
  };
}

/** The chat's words for the browser, without the answer library (the server answers from it). */
export function askClientCopy(locale: Locale): AskCopy {
  return { ...SITE_COPY[locale].live.ask, library: [] };
}

const NAV = [
  { key: "how", href: "/como-funciona" },
  { key: "pricing", href: "/precios" },
  { key: "faq", href: "/preguntas" },
  { key: "partners", href: "/socios" },
  { key: "about", href: "/nosotros" },
] as const;

function LanguageSwitch({ locale, path, className = "" }: { locale: Locale; path: string; className?: string }) {
  const c = SITE_COPY[locale].common;
  const other = locale === "es" ? "en" : "es";
  return (
    <a
      href={otherLanguageHref(path, locale)}
      hrefLang={other}
      lang={other}
      aria-label={c.switchLabel}
      className={`pressable inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white/10 px-4 text-[14px] font-semibold text-white hover:bg-white/15 ${className}`}
    >
      <Icon name="globe" size={16} />
      {c.switchTo}
    </a>
  );
}

function SiteHeader({ locale, path }: { locale: Locale; path: string }) {
  const c = SITE_COPY[locale].common;
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-blue-900/95 text-white backdrop-blur supports-[backdrop-filter]:bg-blue-900/85">
      <Container className="flex h-16 items-center justify-between gap-3 sm:h-[72px]">
        <Link href="/" aria-label={`${"Credalti"} — ${locale === "es" ? "Inicio" : "Home"}`} className="shrink-0 rounded-md">
          <Logo size={28} tone="dark" priority />
        </Link>
        <nav aria-label={locale === "es" ? "Principal" : "Main"} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={path === item.href ? "page" : undefined}
                  className="rounded-full px-3.5 py-2 text-[15px] font-medium text-blue-100 hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/10 aria-[current=page]:text-white"
                >
                  {c.nav[item.key]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          {/* Always in sight, phones included: the one control someone who cannot read this language looks for. */}
          <LanguageSwitch locale={locale} path={path} />
          <Link href="/login" className="pressable hidden h-11 items-center rounded-full px-4 text-[15px] font-semibold text-white hover:bg-white/10 sm:inline-flex">
            {c.signIn}
          </Link>
          <div className="hidden lg:block">
            <PrimaryCta locale={locale} className="!h-11 !px-5 !text-[15px] !shadow-none" />
          </div>
          {/* Phone menu: no script. */}
          <details key={path} className="group relative lg:hidden">
            <summary
              className="pressable flex h-11 cursor-pointer list-none items-center gap-2 rounded-full bg-white/10 px-4 text-[15px] font-semibold text-white hover:bg-white/15 [&::-webkit-details-marker]:hidden"
              aria-label={c.menu}
            >
              <span className="relative block h-3 w-4" aria-hidden>
                <span className="absolute inset-x-0 top-0 h-0.5 rounded bg-current transition group-open:top-[5px] group-open:rotate-45" />
                <span className="absolute inset-x-0 top-[5px] h-0.5 rounded bg-current group-open:opacity-0" />
                <span className="absolute inset-x-0 top-2.5 h-0.5 rounded bg-current transition group-open:top-[5px] group-open:-rotate-45" />
              </span>
              {c.menu}
            </summary>
            <div className="absolute right-0 top-[calc(100%+10px)] w-[min(88vw,340px)] rounded-3xl bg-white p-3 text-slate-900 shadow-2xl ring-1 ring-black/5">
              <ul>
                {NAV.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-current={path === item.href ? "page" : undefined}
                      className="flex h-12 items-center justify-between rounded-2xl px-4 text-[17px] font-semibold text-blue-900 hover:bg-slate-50 aria-[current=page]:bg-blue-50"
                    >
                      {c.nav[item.key]}
                      <Icon name="chevron" size={18} className="text-slate-400" />
                    </Link>
                  </li>
                ))}
                <li className="sm:hidden">
                  <Link href="/login" className="flex h-12 items-center rounded-2xl px-4 text-[17px] font-semibold text-blue-900 hover:bg-slate-50">
                    {c.signIn}
                  </Link>
                </li>
              </ul>
              <div className="mt-2 grid gap-2 border-t border-slate-100 p-1 pt-3">
                <PrimaryCta locale={locale} className="w-full" />
              </div>
            </div>
          </details>
        </div>
      </Container>
    </header>
  );
}

function SiteFooter({ locale }: { locale: Locale }) {
  const c = SITE_COPY[locale];
  const f = c.footer;
  const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS || null;
  const email = process.env.NEXT_PUBLIC_COMPANY_EMAIL || null;
  const phone = supportPhone();
  const col = "text-[13px] font-semibold uppercase tracking-[0.08em] text-blue-200";
  const link = "text-[15px] text-blue-50 hover:text-white hover:underline underline-offset-4";
  return (
    <footer className="bg-blue-900 text-white">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <Logo size={30} tone="dark" />
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-blue-100">{f.tagline}</p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-semibold text-white">
              <Icon name="check" size={14} strokeWidth={2.5} />
              {f.availability}
            </p>
          </div>
          <nav aria-label={f.product}>
            <p className={col}>{f.product}</p>
            <ul className="mt-4 space-y-3">
              <li><Link className={link} href="/como-funciona">{c.common.nav.how}</Link></li>
              <li><Link className={link} href="/precios">{c.common.nav.pricing}</Link></li>
              <li><Link className={link} href="/preguntas">{c.common.nav.faq}</Link></li>
              <li><Link className={link} href={ONLINE_START}>{f.waitlist}</Link></li>
            </ul>
          </nav>
          <nav aria-label={f.company}>
            <p className={col}>{f.company}</p>
            <ul className="mt-4 space-y-3">
              <li><Link className={link} href="/nosotros">{c.common.nav.about}</Link></li>
              <li><Link className={link} href="/socios">{c.common.nav.partners}</Link></li>
              <li><Link className={link} href="/login">{c.common.signIn}</Link></li>
            </ul>
          </nav>
          <nav aria-label={f.legal}>
            <p className={col}>{f.legal}</p>
            <ul className="mt-4 space-y-3">
              <li><Link className={link} href="/derechos">{f.rights}</Link></li>
              <li><Link className={link} href="/privacidad">{f.privacy}</Link></li>
              <li><Link className={link} href="/terminos">{f.terms}</Link></li>
            </ul>
            {(address || email || phone) && (
              <div className="mt-6">
                <p className={col}>{f.contact}</p>
                <address className="mt-3 space-y-1.5 text-[15px] not-italic leading-relaxed text-blue-50">
                  {address && <p>{address}</p>}
                  {email && <p><a className="hover:underline" href={`mailto:${email}`}>{email}</a></p>}
                  {phone && <p>{f.support}: <a className="hover:underline" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></p>}
                </address>
              </div>
            )}
          </nav>
        </div>
        <div className="mt-12 space-y-3 border-t border-white/10 pt-8 text-[13px] leading-relaxed text-blue-200">
          <p>{f.disclaimer}</p>
          <p>{f.aiDisclosure}</p>
          <p>{f.monitoring}</p>
          <p className="pt-2 text-blue-100">{f.copyright(new Date().getFullYear())}</p>
        </div>
      </Container>
    </footer>
  );
}

/**
 * The whole frame. Each page renders it (not a layout), so the header knows
 * the page it is on after a client-side navigation too: the language switch
 * points at this page, and the phone menu closes. Pages render their own <main>.
 */
export default async function SiteShell({ children }: { children: React.ReactNode }) {
  const [{ locale }, h] = await Promise.all([requestLocale(), headers()]);
  const path = h.get(PATH_HEADER) || "/";
  const c = SITE_COPY[locale].common;
  return (
    <RequestLocaleProvider>
      <div className="flex min-h-dvh flex-col bg-slate-50">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-amber-400 px-5 py-3 font-semibold text-blue-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {c.skip}
        </a>
        <SiteHeader locale={locale} path={path} />
        <div id="main" className="flex-1">
          {children}
        </div>
        <SiteFooter locale={locale} />
        <AskAltiLauncher copy={askClientCopy(locale)} locale={locale} byline={aiByline(locale)} ctas={askCtas(locale)} barLabel={SITE_COPY[locale].live.mobileBar.start} />
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(organizationJsonLd(locale)) }} />
    </RequestLocaleProvider>
  );
}
