import type { Capability } from "../staff/permissions";
import type { StaffLocale } from "../staff/i18n/locale";
import type { IconName } from "@/components/Icon";
import type { CardKey, DeptCard } from "./overview";
import type { TodayItem } from "./today";

// The departments strip at the top of the Overview (docs/CONTROL.md): every
// department one tap from the home of the business, on a desk and on a
// phone. A tile shows only to a member who may open that screen (the same
// capability the console's navigation asks, staff/nav.ts), with what needs
// them there when the Overview knows it.

export type DepartmentKey = "leads" | "clients" | "content" | "accounting" | "partners" | "reviews";

export interface DepartmentTile {
  key: DepartmentKey;
  label: string;
  href: string;
  icon: IconName;
  /** What needs the member there (the card's «Needs you», or the Today items); null: nothing to say. */
  count: number | null;
}

const LABEL: Record<StaffLocale, Record<DepartmentKey, string>> = {
  en: { leads: "Leads", clients: "Clients", content: "Content", accounting: "Accounting", partners: "Partners", reviews: "Reviews" },
  es: { leads: "Prospectos", clients: "Clientes", content: "Contenido", accounting: "Contabilidad", partners: "Socios", reviews: "Reseñas" },
};

export const DEPARTMENT_LABELS = LABEL;

interface Department {
  key: DepartmentKey;
  href: string;
  icon: IconName;
  /** Null: every member of the team may open it. */
  needs: Capability | null;
  /** The Overview card whose «Needs you» it shows. */
  card?: CardKey;
}

const DEPARTMENTS: readonly Department[] = [
  { key: "leads", href: "/equipo/leads", icon: "inbox", needs: "leads.work", card: "leads" },
  { key: "clients", href: "/equipo/clientes", icon: "person", needs: null, card: "clients" },
  // Sales may open Content for the brand kit and the partner material (content.share); the board sends them there.
  { key: "content", href: "/equipo/contenido", icon: "grid", needs: "content.share", card: "content" },
  { key: "accounting", href: "/equipo/contabilidad", icon: "calc", needs: "accounting" },
  { key: "partners", href: "/equipo/socios", icon: "link", needs: "partners.view", card: "partners" },
  { key: "reviews", href: "/equipo/resenas", icon: "chat", needs: null },
];

export function departmentTiles(input: { can: (c: Capability) => boolean; cards: readonly DeptCard[]; today: readonly TodayItem[]; locale: StaffLocale }): DepartmentTile[] {
  return DEPARTMENTS.filter((d) => d.needs === null || input.can(d.needs)).map((d) => {
    const card = d.card ? input.cards.find((c) => c.key === d.card) : undefined;
    const count = d.key === "accounting" ? input.today.filter((i) => i.kind === "books_close" || i.kind === "books_receipts").length : (card?.needsYou.count ?? null);
    // Sales has no board: the tile opens the partner kit straight away.
    const href = d.key === "content" && !input.can("content.view") ? "/equipo/contenido/socios" : d.href;
    return { key: d.key, label: LABEL[input.locale][d.key], href, icon: d.icon, count };
  });
}
