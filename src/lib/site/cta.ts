import type { Locale } from "../i18n/dictionaries";
import { SITE_COPY } from "./copy";

// The website's calls to action. Sales comes first and happens in writing:
// with a WhatsApp number configured (NEXT_PUBLIC_WHATSAPP_NUMBER, the same
// mechanics as /empezar and the landing page before it) the main button opens
// a chat with the team; without one (the demo) it starts online, in
// onboarding. No phone sales: a phone number appears only in the footer, as a
// support line, and only if the owner configures one (NEXT_PUBLIC_COMPANY_PHONE).

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null;
const SUPPORT_PHONE = process.env.NEXT_PUBLIC_COMPANY_PHONE || null;

export const ONLINE_START = "/onboarding";

export interface Cta {
  href: string;
  label: string;
  /** Opens WhatsApp (another site). */
  external: boolean;
  /** When the main button is WhatsApp: the online start, as a second way in. */
  alternate: { href: string; label: string } | null;
}

export function whatsappHref(text: string, number: string | null = WHATSAPP): string | null {
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

export function primaryCta(locale: Locale, number: string | null = WHATSAPP): Cta {
  const c = SITE_COPY[locale].common;
  const wa = whatsappHref(c.whatsappText, number);
  return wa
    ? { href: wa, label: c.ctaWhatsapp, external: true, alternate: { href: ONLINE_START, label: c.ctaOnlineAlt } }
    : { href: ONLINE_START, label: c.ctaOnline, external: false, alternate: null };
}

/** The support line, only when the owner set one. */
export function supportPhone(): string | null {
  return SUPPORT_PHONE;
}
