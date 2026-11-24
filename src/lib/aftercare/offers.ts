import { z } from "zod";
import { BRAND } from "../brand";

// Partner offers (optional, OFF by default): credit-building products the
// owner adds in /equipo/ofertas and clients see in /construir.
//
// Rules, here and in the database (migration 0030):
//  - Off until an administrator turns the marketplace on.
//  - Never required, never part of the service, and never a guarantee.
//  - Ranked by what the offer costs the client in the first year, then by
//    name. There is no commission field anywhere, so nothing can rank by it.
//  - An offer where Credalti may be paid carries a disclosure, shown next to
//    it before the link: "Credalti may be paid if you sign up."
//  - Attorney questions (docs/AFTERCARE.md): CROA and Texas CSO rules on
//    selling other products to credit repair clients, UDAAP, the FTC's
//    endorsement and affiliate disclosure rules.

export type L = "es" | "en";

export const OFFER_KINDS = ["secured_card", "credit_builder_loan", "rent_reporting", "utility_reporting", "other"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

export const OFFER_KIND_LABEL: Record<L, Record<OfferKind, string>> = {
  en: { secured_card: "Secured card", credit_builder_loan: "Credit-builder loan", rent_reporting: "Rent reporting", utility_reporting: "Utility reporting", other: "Other" },
  es: { secured_card: "Tarjeta asegurada", credit_builder_loan: "Préstamo para construir crédito", rent_reporting: "Reporte de renta", utility_reporting: "Reporte de servicios", other: "Otro" },
};

export interface Offer {
  id: string;
  name: string;
  kind: OfferKind;
  provider: string;
  /** What the client pays in the first year, in cents. A refundable deposit is not a cost. */
  yearlyCostCents: number;
  /** Plain words about the cost: "Refundable $200 deposit; no annual fee." */
  costNote: string;
  url: string;
  itinFriendly: boolean;
  /** Credalti may be paid if the client signs up. */
  affiliate: boolean;
  /** The owner's disclosure text; shown with the standard sentence. */
  affiliateDisclosure: string | null;
  active: boolean;
}

/** The sentence shown next to every affiliate offer, before its link. */
export const AFFILIATE_LINE: Record<L, string> = {
  en: `${BRAND.name} may be paid if you sign up.`,
  es: `${BRAND.name} puede recibir un pago si te inscribes.`,
};

/** The block above the offers, always. */
export const OFFERS_INTRO: Record<L, { title: string; lead: string; never: string[] }> = {
  en: {
    title: "Partner offers",
    lead: "Products some clients use to add positive accounts. They are optional and not part of your service.",
    never: [
      "You never need any of them, and your service does not change if you skip them.",
      "They are listed from lowest to highest cost to you, then by name. Never by what we may be paid.",
      "Read the provider's terms before you sign up. The provider decides who it accepts.",
    ],
  },
  es: {
    title: "Ofertas de socios",
    lead: "Productos que algunos clientes usan para sumar cuentas positivas. Son opcionales y no son parte de tu servicio.",
    never: [
      "Nunca necesitas ninguno, y tu servicio no cambia si no los usas.",
      "Van del menor al mayor costo para ti, y luego por nombre. Nunca por lo que nos puedan pagar.",
      "Lee los términos del proveedor antes de inscribirte. El proveedor decide a quién acepta.",
    ],
  },
};

export const OFFER_LABELS: Record<L, { itin: string; cost: string; perYear: (amount: string) => string; free: string; visit: string; noOffers: string }> = {
  en: { itin: "Accepts ITIN", cost: "Cost to you", perYear: (a) => `About ${a} in the first year`, free: "No cost in the first year", visit: "See the offer", noOffers: "No offers right now." },
  es: { itin: "Acepta ITIN", cost: "Costo para ti", perYear: (a) => `Cerca de ${a} el primer año`, free: "Sin costo el primer año", visit: "Ver la oferta", noOffers: "No hay ofertas por ahora." },
};

/** Cheapest first, then by name, then id. The only order offers are ever shown in. */
export function rankOffers<T extends Pick<Offer, "yearlyCostCents" | "name" | "id" | "active">>(offers: readonly T[]): T[] {
  return offers
    .filter((o) => o.active)
    .slice()
    .sort((a, b) => a.yearlyCostCents - b.yearlyCostCents || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id));
}

export function yearlyCostLabel(cents: number, locale: L): string {
  if (cents <= 0) return OFFER_LABELS[locale].free;
  const amount = `$${(cents / 100).toLocaleString(locale === "es" ? "es-MX" : "en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return OFFER_LABELS[locale].perYear(amount);
}

/** The owner's form, checked here and again by the database's constraints. */
export const offerInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(OFFER_KINDS),
    provider: z.string().trim().min(2).max(80),
    yearlyCostCents: z.number().int().min(0).max(1_000_000),
    costNote: z.string().trim().min(2).max(200),
    url: z
      .string()
      .trim()
      .max(500)
      .regex(/^https:\/\/[^\s<>"]{4,500}$/, "The link must start with https://"),
    itinFriendly: z.boolean(),
    affiliate: z.boolean(),
    affiliateDisclosure: z.string().trim().max(400).nullable(),
    active: z.boolean(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.affiliate && (!o.affiliateDisclosure || o.affiliateDisclosure.length < 20)) {
      ctx.addIssue({ code: "custom", path: ["affiliateDisclosure"], message: "An affiliate offer needs its disclosure text (at least 20 characters)." });
    }
  });

export type OfferInput = z.infer<typeof offerInputSchema>;

export function offerFromRow(row: Record<string, unknown>): Offer {
  const kind = String(row.kind);
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    kind: (OFFER_KINDS as readonly string[]).includes(kind) ? (kind as OfferKind) : "other",
    provider: String(row.provider ?? ""),
    yearlyCostCents: Math.max(0, Math.trunc(Number(row.yearly_cost_cents ?? 0))),
    costNote: String(row.cost_note ?? ""),
    url: String(row.url ?? ""),
    itinFriendly: row.itin_friendly === true,
    affiliate: row.affiliate === true,
    affiliateDisclosure: typeof row.affiliate_disclosure === "string" && row.affiliate_disclosure ? row.affiliate_disclosure : null,
    active: row.active !== false,
  };
}

export function offerToRow(o: OfferInput): Record<string, unknown> {
  return {
    name: o.name,
    kind: o.kind,
    provider: o.provider,
    yearly_cost_cents: o.yearlyCostCents,
    cost_note: o.costNote,
    url: o.url,
    itin_friendly: o.itinFriendly,
    affiliate: o.affiliate,
    affiliate_disclosure: o.affiliate ? o.affiliateDisclosure : null,
    active: o.active,
  };
}

/** The default disclosure an owner starts from when an offer is an affiliate one. */
export const DEFAULT_AFFILIATE_DISCLOSURE = `${BRAND.name} has an agreement with this provider and may be paid if you sign up. It does not change the price you pay.`;

// ── The demo: invented offers, kept in this browser ─────────────────────

const DEMO_KEY = "credalti.demoOffers.v1";

export interface DemoOffersState {
  enabled: boolean;
  offers: Offer[];
}

/** Invented examples. No real company. */
export const DEMO_OFFERS: Offer[] = [
  {
    id: "00000000-0000-4000-b000-000000000001",
    name: "Starter Secured Card (example)",
    kind: "secured_card",
    provider: "Example Community Credit Union",
    yearlyCostCents: 0,
    costNote: "Refundable $200 deposit. No annual fee. Interest only if you carry a balance.",
    url: "https://example.com/secured-card",
    itinFriendly: true,
    affiliate: true,
    affiliateDisclosure: DEFAULT_AFFILIATE_DISCLOSURE,
    active: true,
  },
  {
    id: "00000000-0000-4000-b000-000000000002",
    name: "Builder Loan $500 (example)",
    kind: "credit_builder_loan",
    provider: "Example Neighborhood Bank",
    yearlyCostCents: 3600,
    costNote: "About $36 in interest over 12 months of $44.67. You get the $500 at the end.",
    url: "https://example.com/builder-loan",
    itinFriendly: true,
    affiliate: false,
    affiliateDisclosure: null,
    active: true,
  },
  {
    id: "00000000-0000-4000-b000-000000000003",
    name: "Rent Reporter (example)",
    kind: "rent_reporting",
    provider: "Example Rent Reporting Co.",
    yearlyCostCents: 8340,
    costNote: "$25 to start, then $4.95 a month. Reports to one bureau.",
    url: "https://example.com/rent-reporting",
    itinFriendly: false,
    affiliate: true,
    affiliateDisclosure: DEFAULT_AFFILIATE_DISCLOSURE,
    active: true,
  },
];

export function readDemoOffers(): DemoOffersState {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoOffersState>;
      return { enabled: parsed.enabled === true, offers: Array.isArray(parsed.offers) ? parsed.offers : DEMO_OFFERS };
    }
  } catch {
    // Storage unavailable.
  }
  return { enabled: false, offers: DEMO_OFFERS };
}

export function writeDemoOffers(state: DemoOffersState): void {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  } catch {
    // Kept for this visit only.
  }
}

/** Every sentence a client reads around offers, for the claim tests. */
export function offersCopy(locale: L): string[] {
  const i = OFFERS_INTRO[locale];
  return [i.title, i.lead, ...i.never, AFFILIATE_LINE[locale], ...Object.values(OFFER_LABELS[locale]).filter((v): v is string => typeof v === "string" && v.length > 0)];
}
