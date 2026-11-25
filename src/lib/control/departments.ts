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

export type DepartmentKey = "leads" | "clients" | "content" | "video" | "ads" | "seo" | "reviews" | "accounting" | "partners" | "ideas";

export interface DepartmentTile {
  key: DepartmentKey;
  label: string;
  href: string;
  icon: IconName;
  /** What needs the member there (the card's «Needs you», or the Today items); null: nothing to say. */
  count: number | null;
}

const LABEL: Record<StaffLocale, Record<DepartmentKey, string>> = {
  en: { leads: "Leads", clients: "Clients", content: "Content", video: "Video Studio", ads: "Ads", seo: "SEO", reviews: "Reviews", accounting: "Accounting", partners: "Partners", ideas: "Ideas" },
  es: { leads: "Prospectos", clients: "Clientes", content: "Contenido", video: "Estudio de video", ads: "Anuncios", seo: "SEO", reviews: "Reseñas", accounting: "Contabilidad", partners: "Socios", ideas: "Ideas" },
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
  // Marketing, in the menu's order. Sales may open Content for the brand kit and the partner material (content.share); the board sends them there.
  { key: "content", href: "/equipo/contenido", icon: "grid", needs: "content.share" },
  { key: "video", href: "/equipo/video", icon: "video", needs: "content.view" },
  // The Ads Manager: the tile for whoever sees the numbers (ads.view), with the ads to turn off; its spend is on the Ads card.
  { key: "ads", href: "/equipo/anuncios", icon: "megaphone", needs: "ads.view", card: "ads" },
  { key: "seo", href: "/equipo/seo", icon: "search", needs: "seo.view", card: "seo" },
  { key: "reviews", href: "/equipo/resenas", icon: "chat", needs: null },
  { key: "accounting", href: "/equipo/contabilidad", icon: "calc", needs: "accounting" },
  { key: "partners", href: "/equipo/socios", icon: "link", needs: "partners.view", card: "partners" },
  { key: "ideas", href: "/equipo/ideas", icon: "bulb", needs: "ideas.add", card: "ideas" },
];

export function departmentTiles(input: { can: (c: Capability) => boolean; cards: readonly DeptCard[]; today: readonly TodayItem[]; locale: StaffLocale }): DepartmentTile[] {
  return DEPARTMENTS.filter((d) => d.needs === null || input.can(d.needs)).map((d) => {
    const card = d.card ? input.cards.find((c) => c.key === d.card) : undefined;
    // Content and the Video Studio share a card: each tile counts its own Today items, so the two numbers add up to the card's.
    const count =
      d.key === "accounting"
        ? input.today.filter((i) => i.kind === "books_close" || i.kind === "books_receipts").length
        : d.key === "content"
          ? countKinds(input, ["content_review", "content_changes", "content_failed"], "content.view")
          : d.key === "video"
            ? countKinds(input, ["video_review", "video_changes", "video_handoff"], "content.view")
            : (card?.needsYou.count ?? null);
    // Sales has no board: the tile opens the partner kit straight away.
    const href = d.key === "content" && !input.can("content.view") ? "/equipo/contenido/socios" : d.href;
    return { key: d.key, label: LABEL[input.locale][d.key], href, icon: d.icon, count };
  });
}

/** A tile's number from the Today list's items of these kinds; null when the member has no such board or the card could not read it. */
function countKinds(input: { can: (c: Capability) => boolean; cards: readonly DeptCard[]; today: readonly TodayItem[] }, kinds: readonly TodayItem["kind"][], needs: Capability): number | null {
  if (!input.can(needs)) return null;
  const card = input.cards.find((c) => c.key === "content");
  if (!card || card.needsYou.count === null) return null;
  return input.today.filter((i) => kinds.includes(i.kind)).length;
}
