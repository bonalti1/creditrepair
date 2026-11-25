import { BRAND } from "../brand";
import { siteUrl } from "../site/routes";
import type { LocalItemKey } from "./text";

// Local SEO (docs/SEO.md, "Local"): the owner's to-dos for Google Business
// Profile, the business's name, address and phone exactly as the agreement
// prints them (the same NEXT_PUBLIC_COMPANY_* variables, src/lib/agreement/terms.ts),
// and the review links (the Reviews tab). Most of it happens outside the app,
// so each item is a tick a person makes (who and when is kept).

export interface LocalItem {
  key: LocalItemKey;
  /** Who does it: the owner (an account only they can open) or the team. */
  who: "owner" | "team";
  /** Where it is done. */
  href: string | null;
}

export const LOCAL_ITEMS: readonly LocalItem[] = [
  { key: "gbpCreate", who: "owner", href: "https://business.google.com/" },
  { key: "gbpVerify", who: "owner", href: "https://business.google.com/" },
  { key: "gbpServiceArea", who: "owner", href: null },
  { key: "gbpCategory", who: "owner", href: null },
  { key: "gbpDescription", who: "team", href: null },
  { key: "gbpHours", who: "owner", href: null },
  { key: "gbpPhotos", who: "team", href: "/equipo/contenido/marca" },
  { key: "napConsistent", who: "team", href: null },
  { key: "reviewLink", who: "owner", href: "/equipo/resenas" },
  { key: "reviewReplies", who: "team", href: "/equipo/resenas" },
  { key: "searchConsole", who: "owner", href: "https://search.google.com/search-console" },
  { key: "noOtherStates", who: "team", href: null },
];

export interface CompanyDetail {
  key: "name" | "legalName" | "address" | "phone" | "email" | "website";
  value: string | null;
  /** The variable that sets it (shown when it is missing). */
  variable: string | null;
  /** Something about the value is wrong (the address is not in Texas). */
  problem: "notTexas" | null;
}

// Static reads: Next replaces each with its value at build time, so the browser has them too.
const ENV = {
  legalName: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME,
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS,
  phone: process.env.NEXT_PUBLIC_COMPANY_PHONE,
  email: process.env.NEXT_PUBLIC_COMPANY_EMAIL,
  site: process.env.NEXT_PUBLIC_SITE_URL,
  app: process.env.NEXT_PUBLIC_APP_URL,
};

const clean = (v: string | undefined) => v?.replace(/\s+/g, " ").trim() || null;

/** The name, address and phone to use everywhere, from the same settings the agreement prints. */
export function companyDetails(env: typeof ENV = ENV): CompanyDetail[] {
  const address = clean(env.address);
  const site = env.site || env.app ? siteUrl({ NEXT_PUBLIC_SITE_URL: env.site, NEXT_PUBLIC_APP_URL: env.app }) : null;
  return [
    { key: "name", value: BRAND.name, variable: null, problem: null },
    { key: "legalName", value: clean(env.legalName), variable: "NEXT_PUBLIC_COMPANY_LEGAL_NAME", problem: null },
    { key: "address", value: address, variable: "NEXT_PUBLIC_COMPANY_ADDRESS", problem: address && !/\b(TX|Texas)\b\s*,?\s*\d{5}(-\d{4})?\s*$|\b(TX|Texas)\s*$/i.test(address) ? "notTexas" : null },
    { key: "phone", value: clean(env.phone), variable: "NEXT_PUBLIC_COMPANY_PHONE", problem: null },
    { key: "email", value: clean(env.email), variable: "NEXT_PUBLIC_COMPANY_EMAIL", problem: null },
    { key: "website", value: site, variable: "NEXT_PUBLIC_SITE_URL", problem: null },
  ];
}

/** Local to-dos not ticked yet. */
export function localOpen(ticks: Partial<Record<string, { done: boolean }>>): number {
  return LOCAL_ITEMS.filter((i) => !ticks[i.key]?.done).length;
}
