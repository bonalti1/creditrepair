import type { IconName } from "@/components/Icon";
import type { Capability } from "./permissions";
import type { SHELL_TEXT } from "./i18n/ui/shell";
import { callsEnabled } from "../calls/config";

// The console's destinations: the top bar and the phone's tab bar
// (components/staff/StaffShell.tsx) and the console's search (search.ts) read
// the same list, so a page the role may not open is missing from both.

export type NavKey = keyof (typeof SHELL_TEXT)["en"]["nav"];

export interface NavItem {
  href: string;
  label: NavKey;
  icon: IconName;
  needs?: Capability;
}

/** The everyday destinations: tabs on the top bar and on the phone's bottom bar. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/equipo", label: "home", icon: "home" },
  // Credalti Control (docs/CONTROL.md): the business at a glance, and every lead conversation.
  { href: "/equipo/control", label: "overview", icon: "dashboard" },
  { href: "/equipo/leads", label: "leads", icon: "inbox", needs: "leads.work" },
  { href: "/equipo/clientes", label: "clients", icon: "person" },
  { href: "/equipo/respuestas", label: "answers", icon: "chat", needs: "clients.reply" },
];

/** Everything else, under "More". The two departments without a tab come first (docs/CONTROL.md): the top bar stays as it is. */
export const MORE_NAV: NavItem[] = [
  // Content (src/lib/content): the board for content.view; the brand kit and partner material for everyone with content.share.
  { href: "/equipo/contenido", label: "content", icon: "grid", needs: "content.share" },
  { href: "/equipo/contabilidad", label: "accounting", icon: "calc", needs: "accounting" },
  { href: "/equipo/invitar", label: "invite", icon: "mail", needs: "clients.invite" },
  { href: "/equipo/acreedores", label: "creditors", icon: "doc", needs: "rounds.send" },
  { href: "/equipo/actividad", label: "activity", icon: "clock" },
  { href: "/equipo/piloto", label: "autopilot", icon: "sparkle", needs: "rounds.send" },
  { href: "/equipo/negocio", label: "business", icon: "chart", needs: "business.view" },
  { href: "/equipo/socios", label: "partners", icon: "link", needs: "partners.view" },
  { href: "/equipo/ofertas", label: "offers", icon: "sparkle", needs: "partners.manage" },
  { href: "/equipo/equipo", label: "team", icon: "team", needs: "team.manage" },
  { href: "/equipo/cartas", label: "letters", icon: "clipboard", needs: "letters.edit" },
  { href: "/equipo/planes", label: "plans", icon: "calc", needs: "billing.plans" },
  { href: "/equipo/cobros", label: "invoices", icon: "doc", needs: "billing.plans" },
  // Fulfillment (src/lib/fulfillment, migration 0041): moving clients over from Credit Repair Cloud, and the monitoring commissions.
  { href: "/equipo/importar", label: "import", icon: "inbox", needs: "clients.import" },
  { href: "/equipo/monitoreo", label: "monitoring", icon: "calc", needs: "monitoring.commissions" },
  { href: "/equipo/resenas", label: "reviews", icon: "chat" },
  { href: "/equipo/estados", label: "states", icon: "globe" },
  // Calls with a person (src/lib/calls): only when turned on (off by default).
  ...(callsEnabled() ? [{ href: "/equipo/llamadas", label: "calls" as const, icon: "clock" as const, needs: "calls.manage" as const }] : []),
  { href: "/equipo/alertas", label: "alerts", icon: "bell" },
  { href: "/equipo/perfil", label: "profile", icon: "person" },
  { href: "/equipo/bienvenida", label: "welcome", icon: "book" },
];

// ── The grouped menu (ALTO Control's navigation model) ──────────────────
//
// The console's side menu, the phone's tab bar and its «More» sheet show the
// destinations above in ten numbered groups, in the order the business works
// (ALTO Control's GROUPS): 0 Overview → 1 My day → 2 Content → 3 Leads →
// 4 Fulfillment → 5 Money → 6 Letters & rules → 7 Partners → 8 Business
// numbers → 9 Team & settings. A group holds one or more destinations; a group
// with two or more the member may open shows them as sub-tabs under the top
// bar. A group shows only when the member may open at least one of its pages
// (the same `needs` as above), and opens on the first of them.

export type NavGroupKey = keyof (typeof SHELL_TEXT)["en"]["groups"];

export interface NavGroup {
  key: NavGroupKey;
  /** "0" to "9", shown beside the name like ALTO Control's menu. */
  number: string;
  icon: IconName;
  /** Its destinations, in sub-tab order (each one an href of PRIMARY_NAV or MORE_NAV). */
  hrefs: string[];
  /** Pages that belong to the group without a sub-tab of their own (opened from inside it). */
  also?: string[];
}

export const NAV_GROUPS: NavGroup[] = [
  { key: "overview", number: "0", icon: "dashboard", hrefs: ["/equipo/control"] },
  { key: "day", number: "1", icon: "home", hrefs: ["/equipo", "/equipo/actividad"] },
  { key: "content", number: "2", icon: "speaker", hrefs: ["/equipo/contenido", "/equipo/resenas"] },
  { key: "leads", number: "3", icon: "inbox", hrefs: ["/equipo/leads", "/equipo/invitar"] },
  { key: "clients", number: "4", icon: "person", hrefs: ["/equipo/clientes", "/equipo/respuestas", "/equipo/piloto", "/equipo/llamadas", "/equipo/importar"], also: ["/equipo/enviar", "/equipo/imprimir"] },
  { key: "money", number: "5", icon: "calc", hrefs: ["/equipo/contabilidad", "/equipo/cobros", "/equipo/planes", "/equipo/monitoreo"] },
  { key: "library", number: "6", icon: "book", hrefs: ["/equipo/cartas", "/equipo/acreedores", "/equipo/estados"] },
  { key: "partners", number: "7", icon: "link", hrefs: ["/equipo/socios", "/equipo/ofertas"] },
  { key: "business", number: "8", icon: "chart", hrefs: ["/equipo/negocio"] },
  { key: "settings", number: "9", icon: "team", hrefs: ["/equipo/equipo", "/equipo/alertas", "/equipo/perfil", "/equipo/bienvenida"] },
];

/** Every destination, by href. */
export const NAV_BY_HREF: ReadonlyMap<string, NavItem> = new Map([...PRIMARY_NAV, ...MORE_NAV].map((n) => [n.href, n]));

/** True when `pathname` is this destination or a page inside it ("/equipo" only matches itself). */
export function navMatches(href: string, pathname: string): boolean {
  return href === "/equipo" ? pathname === "/equipo" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The group a page belongs to (the longest destination that matches it); Overview when none does. */
export function groupOfPath(pathname: string): NavGroup {
  let best: { group: NavGroup; length: number } | null = null;
  for (const group of NAV_GROUPS) {
    for (const href of [...group.hrefs, ...(group.also ?? [])]) {
      if (navMatches(href, pathname) && (!best || href.length > best.length)) best = { group, length: href.length };
    }
  }
  return best?.group ?? NAV_GROUPS[0]!;
}

/** The phone's tab bar: the groups of the everyday destinations (PRIMARY_NAV) first, four at most, filled with the next groups. */
export function phoneMainGroups(groups: readonly NavGroup[], allowedHrefs: ReadonlySet<string>): NavGroup[] {
  const main: NavGroup[] = [];
  for (const item of PRIMARY_NAV) {
    if (!allowedHrefs.has(item.href)) continue;
    const group = groups.find((g) => g.hrefs.includes(item.href));
    if (group && !main.includes(group) && main.length < 4) main.push(group);
  }
  for (const group of groups) if (main.length < 4 && !main.includes(group)) main.push(group);
  return main;
}
