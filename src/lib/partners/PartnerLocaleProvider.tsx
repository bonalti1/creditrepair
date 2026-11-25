import { LocaleProvider } from "../i18n";
import { requestLocale } from "../i18n/server";
import { getPartnerMember } from "./server";

/**
 * The locale for a partner's own pages (the portal and a client's page): a
 * choice made on this device (or in the link) first; else, signed in, the
 * language the partner saved (partners.locale, migration 0024: their portal
 * and their notices); else the browser's; else English. The portal writes a
 * device choice back to partners.locale, so notices follow it.
 */
export default async function PartnerLocaleProvider({ children }: { children: React.ReactNode }) {
  const initial = await requestLocale();
  if (initial.source !== "link" && initial.source !== "saved") {
    const member = await getPartnerMember();
    if (member?.partner.locale) return <LocaleProvider initial={{ locale: member.partner.locale, source: "profile" }}>{children}</LocaleProvider>;
  }
  return <LocaleProvider initial={initial}>{children}</LocaleProvider>;
}
