import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { looksLikeCardNumber } from "../billing/api";
import {
  acceptedCardsLine,
  acceptedCardsProblem,
  brandFromIin,
  brandRefused,
  cardBrandMessage,
  DEFAULT_ACCEPTED_CARDS,
  normalizeBrand,
  readAcceptedCards,
} from "../billing/cardBrands";
import { createDemoGateway, isDemoToken } from "../billing/gateway";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { HOUSEHOLD_COPY } from "../household/copy";
import { checkHouseholdMember, householdInviteMessage, householdInvitePath } from "../household/household";
import { parseInvite } from "../sales/invite";
import { householdsFromRows } from "../staff/fromRows";
import { buildDemoClients } from "../staff/demoClients";
import { applyTeamActions, EMPTY_TEAM_ACTIONS } from "../staff/teamStore";
import { matchScore, normalize, searchIndex, searchStaff } from "../staff/search";
import type { Viewer } from "../staff/permissions";
import { TEST_CARDS, testCardBrand } from "../ux/testCards";

// Accepted card brands (CRC, Nov 13), household signup (CRC, Nov 12) and the
// console's search (CRC, Sep 11).

describe("accepted card brands", () => {
  it("tells the brand from a card's first digits, as the networks publish them", () => {
    expect(brandFromIin("4")).toBe("visa");
    expect(brandFromIin("424242")).toBe("visa");
    for (const iin of ["51", "55", "555555", "2221", "2720", "222100"]) expect(brandFromIin(iin), iin).toBe("mastercard");
    expect(brandFromIin("2220")).toBeNull();
    expect(brandFromIin("2721")).toBeNull();
    for (const iin of ["34", "37", "378282"]) expect(brandFromIin(iin), iin).toBe("amex");
    for (const iin of ["6011", "601111", "65", "644", "649"]) expect(brandFromIin(iin), iin).toBe("discover");
    expect(brandFromIin("643")).toBeNull();
    expect(brandFromIin("")).toBeNull();
    expect(brandFromIin("3")).toBeNull();
  });

  it("reads the brand names processors send", () => {
    expect(normalizeBrand("Visa")).toBe("visa");
    expect(normalizeBrand("MasterCard")).toBe("mastercard");
    expect(normalizeBrand("mc")).toBe("mastercard");
    expect(normalizeBrand("American Express")).toBe("amex");
    expect(normalizeBrand("AMEX")).toBe("amex");
    expect(normalizeBrand("discover")).toBe("discover");
    expect(normalizeBrand("card")).toBeNull();
    expect(normalizeBrand(null)).toBeNull();
  });

  it("takes Visa and Mastercard by default, not American Express or Discover", () => {
    expect(DEFAULT_ACCEPTED_CARDS).toEqual({ visa: true, mastercard: true, amex: false, discover: false });
    expect(brandRefused("visa", DEFAULT_ACCEPTED_CARDS)).toBe(false);
    expect(brandRefused("MasterCard", DEFAULT_ACCEPTED_CARDS)).toBe(false);
    expect(brandRefused("amex", DEFAULT_ACCEPTED_CARDS)).toBe(true);
    expect(brandRefused("Discover", DEFAULT_ACCEPTED_CARDS)).toBe(true);
    // Brands that are never on the list, and an unknown brand (the processor decides).
    expect(brandRefused("jcb", { ...DEFAULT_ACCEPTED_CARDS, amex: true })).toBe(true);
    expect(brandRefused("card", DEFAULT_ACCEPTED_CARDS)).toBe(false);
    expect(brandRefused(null, DEFAULT_ACCEPTED_CARDS)).toBe(false);
    // Turned on, it is taken.
    expect(brandRefused("amex", { ...DEFAULT_ACCEPTED_CARDS, amex: true })).toBe(false);
  });

  it("says it kindly before the card is sent, in English and Spanish", () => {
    expect(cardBrandMessage("amex", DEFAULT_ACCEPTED_CARDS, "en")).toBe("We can't take American Express. Please use a Visa or Mastercard.");
    expect(cardBrandMessage("amex", DEFAULT_ACCEPTED_CARDS, "es")).toBe("No podemos aceptar American Express. Por favor usa una Visa o Mastercard.");
    expect(cardBrandMessage("discover", { ...DEFAULT_ACCEPTED_CARDS, amex: true }, "en")).toBe("We can't take Discover. Please use a Visa, Mastercard or American Express.");
    expect(cardBrandMessage("visa", DEFAULT_ACCEPTED_CARDS, "en")).toBeNull();
    expect(acceptedCardsLine({ visa: true, mastercard: false, amex: false, discover: false }, "es")).toBe("una Visa");
    for (const text of [cardBrandMessage("amex", DEFAULT_ACCEPTED_CARDS, "en")!, cardBrandMessage("amex", DEFAULT_ACCEPTED_CARDS, "es")!]) {
      expect(checkClaimGuardrails(text)).toEqual([]);
    }
  });

  it("keeps at least one brand on, and reads a stored setting safely", () => {
    expect(acceptedCardsProblem({ visa: false, mastercard: false, amex: false, discover: false })).not.toBeNull();
    expect(acceptedCardsProblem({ visa: false, mastercard: false, amex: true, discover: false })).toBeNull();
    expect(readAcceptedCards(null)).toEqual(DEFAULT_ACCEPTED_CARDS);
    expect(readAcceptedCards({ amex: true })).toEqual({ ...DEFAULT_ACCEPTED_CARDS, amex: true });
    expect(readAcceptedCards({ visa: false, mastercard: false, amex: false, discover: false })).toEqual(DEFAULT_ACCEPTED_CARDS);
  });

  it("the demo's test cards carry an IIN and a token, never a card number, and the brand comes from the IIN", () => {
    expect(TEST_CARDS.map((c) => testCardBrand(c))).toEqual(["visa", "visa", "mastercard", "amex", "discover"]);
    for (const card of TEST_CARDS) {
      expect(isDemoToken(card.token), card.token).toBe(true);
      expect(looksLikeCardNumber(card.token)).toBe(false);
      expect(looksLikeCardNumber(card.iin)).toBe(false);
      expect(card.iin).toMatch(/^\d{6}$/);
    }
  });

  it("the demo processor reports the brand it attached, which the server checks", async () => {
    const gateway = createDemoGateway();
    const amex = await gateway.attachPaymentMethod({ customerRef: "c", token: "demo_tok_amex_0005" });
    expect(amex).toMatchObject({ ok: true, brand: "amex" });
    expect(brandRefused(amex.ok ? amex.brand : null, DEFAULT_ACCEPTED_CARDS)).toBe(true);
  });

  it("the server refuses a brand that is off after attaching, and forgets it at the processor", () => {
    const route = readFileSync("src/app/api/billing/payment-method/route.ts", "utf8");
    expect(route).toMatch(/brandRefused\(attached\.brand, accepted\)/);
    expect(route).toMatch(/card_brand_not_accepted/);
    expect(route).toMatch(/detachPaymentMethod\(\{ customerRef, paymentMethodRef: attached\.paymentMethodRef \}\)/);
    // Only a new card is checked: the charge run never looks at the brand.
    expect(readFileSync("src/lib/billing/collect.ts", "utf8")).not.toMatch(/brandRefused|acceptedCards/);
    for (const page of ["src/app/(app)/pagos/page.tsx", "src/app/(app)/pagos/tarjeta/page.tsx"]) {
      const source = readFileSync(page, "utf8");
      expect(source, page).toMatch(/data-testid="card-brand-warning"/);
      expect(source, page).toMatch(/disabled=\{[^}]*brandWarning/);
    }
  });
});

describe("household signup", () => {
  it("checks the member: their own phone, a relationship and a language", () => {
    const ok = checkHouseholdMember({ firstName: "Luis", lastName: "Delgado", phone: "(713) 555-0199", email: "", relationship: "spouse", locale: "es" }, "+17135550124");
    expect(ok).toEqual({ ok: true, value: { firstName: "Luis", lastName: "Delgado", phone: "+17135550199", email: null, relationship: "spouse", locale: "es" } });
    const same = checkHouseholdMember({ firstName: "Luis", lastName: "Delgado", phone: "713-555-0124", relationship: "spouse", locale: "en" }, "+17135550124");
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.problems.phone?.en).toMatch(/their own phone/);
    const taken = checkHouseholdMember({ firstName: "Luis", lastName: "Delgado", phone: "7135550111", relationship: "family", locale: "en" }, null, ["+17135550111"]);
    expect(taken.ok).toBe(false);
    const bad = checkHouseholdMember({ firstName: "", lastName: "D", phone: "12", email: "x@", relationship: "boss", locale: "fr" }, null);
    expect(bad.ok ? [] : Object.keys(bad.problems).sort()).toEqual(["email", "firstName", "lastName", "locale", "phone", "relationship"]);
  });

  it("gives the member their own invitation, in their language, with the same salesperson", () => {
    const path = householdInvitePath({ firstName: "Luis", locale: "es" }, { state: "TX", goal: "mortgage", ref: "ana", refName: "Ana" });
    const invite = parseInvite(new URLSearchParams(path.split("?")[1]));
    expect(invite).toMatchObject({ name: "Luis", state: "TX", goal: "mortgage", ref: "ana", lang: "es" });
    for (const locale of ["en", "es"] as const) {
      const message = householdInviteMessage("Luis", "Rosa", "https://credalti.test/onboarding", locale);
      expect(message).toMatch(locale === "en" ? /your own agreement, your own report/ : /tu propio acuerdo, tu propio reporte/);
      expect(checkClaimGuardrails(message)).toEqual([]);
      for (const text of Object.values(HOUSEHOLD_COPY[locale])) {
        if (typeof text === "string") expect(checkClaimGuardrails(text), text).toEqual([]);
      }
    }
  });

  it("shows each person the other's name only, by the console's id, from the rows", () => {
    const map = householdsFromRows({
      profiles: [{ id: "u1", full_name: "Rosa Delgado" }, { id: "u3", full_name: "Ana Paz" }, { id: "u4", full_name: "Leo Paz" }],
      prospects: [{ id: "p2", converted_user_id: null }],
      households: [{ id: "h1", primary_user_id: "u1", primary_prospect_id: null, member_prospect_id: "p2", primary_name: "Rosa", member_name: "Luis Delgado", relationship: "spouse", link_id: null, ended_at: null }],
      householdLinks: [{ id: "l1", user_a: "u3", user_b: "u4", ended_at: null }],
    });
    expect(map.get("u1")).toEqual({ partnerId: "p2", partnerName: "Luis Delgado", relationship: "spouse", status: "invited" });
    expect(map.get("p2")).toEqual({ partnerId: "u1", partnerName: "Rosa", relationship: "spouse", status: "invited" });
    expect(map.get("u3")).toMatchObject({ partnerId: "u4", status: "linked", relationship: "household" });
    // Once the member has an account, the console's id is the account.
    const converted = householdsFromRows({
      profiles: [],
      prospects: [{ id: "p2", converted_user_id: "u2" }],
      households: [{ id: "h1", primary_user_id: "u1", member_prospect_id: "p2", primary_name: "Rosa", member_name: "Luis Delgado", relationship: "spouse", link_id: "l9", ended_at: null }],
    });
    expect(converted.get("u2")).toMatchObject({ partnerId: "u1", status: "linked" });
    expect(converted.has("p2")).toBe(false);
  });

  it("the demo links both people, and nothing else of either record changes", () => {
    const all = buildDemoClients(new Date("2026-11-23T18:00:00Z"));
    const rosa = all.find((c) => c.id === "c24");
    const other = all.find((c) => c.id === "c01");
    const member = { ...other!, id: "nluis", firstName: "Luis", lastName: "Delgado" };
    const actions = { ...EMPTY_TEAM_ACTIONS, households: { c24: { memberId: "nluis", memberName: "Luis Delgado", primaryName: "Rosa", relationship: "spouse" as const } } };
    const [a, b] = applyTeamActions([rosa!, member], actions);
    expect(a!.household).toEqual({ partnerId: "nluis", partnerName: "Luis Delgado", relationship: "spouse", status: "invited" });
    expect(b!.household).toMatchObject({ partnerId: "c24", partnerName: "Rosa" });
    expect(a!.report).toBe(rosa!.report);
    expect(b!.report).toBe(member.report);
  });
});

describe("the console's search", () => {
  const clients = buildDemoClients(new Date("2026-11-23T18:00:00Z"));
  const admin: Viewer = { handle: "carmen", name: "Carmen Ruiz", role: "admin" };
  const sales: Viewer = { handle: "ana", name: "Ana Prieto", role: "sales" };
  const marta: Viewer = { handle: "marta", name: "Marta Leal", role: "specialist" };
  const partners = [{ id: "pt1", name: "María López", company: "ABC Realty", phone: "+17135550900" }];
  const src = (viewer: Viewer, locale: "en" | "es" = "en") => ({ viewer, locale, clients, partners });

  it("ignores case and accents", () => {
    expect(normalize("  Héctor  VALDEZ ")).toBe("hector valdez");
  });

  it("finds a page, in either language", () => {
    expect(searchStaff("plans", src(admin))[0]).toMatchObject({ kind: "page", href: "/equipo/planes" });
    expect(searchStaff("planes", src(admin))[0]).toMatchObject({ kind: "page", href: "/equipo/planes" });
    expect(searchStaff("inicio", src(admin, "es"))[0]).toMatchObject({ kind: "page", href: "/equipo", label: "Inicio" });
  });

  it("finds an action by what it does", () => {
    expect(searchStaff("send rounds", src(admin))[0]).toMatchObject({ kind: "action", href: "/equipo/enviar" });
    expect(searchStaff("enviar rondas", src(admin, "es"))[0]).toMatchObject({ kind: "action", label: "Enviar rondas" });
    expect(searchStaff("import report", src(admin))[0]).toMatchObject({ kind: "action", label: "Import report" });
    // "import <name>": that client's importer.
    expect(searchStaff("import rosa", src(admin))[0]).toMatchObject({ kind: "action", label: "Import report · Rosa Delgado", href: "/equipo/clientes/c24?importar=1" });
  });

  it("finds a client by name or phone, with or without punctuation", () => {
    expect(searchStaff("hector", src(admin))[0]).toMatchObject({ kind: "client", href: "/equipo/clientes/c27" });
    expect(searchStaff("Valdez", src(admin)).some((r) => r.id === "client:c27")).toBe(true);
    expect(searchStaff("(512) 555-0127", src(admin))[0]).toMatchObject({ kind: "client", href: "/equipo/clientes/c27" });
    expect(searchStaff("5125550127", src(admin))[0]).toMatchObject({ id: "client:c27" });
    expect(searchStaff("0127", src(admin)).some((r) => r.id === "client:c27")).toBe(true);
  });

  it("finds only the clients the member's role may see", () => {
    const ids = (viewer: Viewer) => new Set(searchIndex(src(viewer)).filter((e) => e.kind === "client").map((e) => e.id.slice("client:".length)));
    expect(ids(admin).size).toBe(clients.length);
    const forSales = ids(sales);
    expect(forSales.size).toBeGreaterThan(0);
    expect([...forSales].every((id) => clients.find((c) => c.id === id)!.salesperson === "ana")).toBe(true);
    const forMarta = ids(marta);
    expect([...forMarta].every((id) => clients.find((c) => c.id === id)!.assignedTo === "marta")).toBe(true);
    // Someone the specialist does not work is not found, by name or by phone.
    const hidden = clients.find((c) => c.assignedTo !== "marta")!;
    expect(searchStaff(hidden.phone, src(marta)).some((r) => r.id === `client:${hidden.id}`)).toBe(false);
    expect(searchStaff(`${hidden.firstName} ${hidden.lastName}`, src(marta)).some((r) => r.id === `client:${hidden.id}`)).toBe(false);
  });

  it("finds partners and letter templates only for the roles that may open them", () => {
    expect(searchStaff("abc realty", src(admin))[0]).toMatchObject({ kind: "partner", href: "/equipo/socios#socio-pt1" });
    expect(searchStaff("abc realty", src(marta))).toEqual([]);
    expect(searchStaff("abc realty", src(sales))[0]).toMatchObject({ kind: "partner" });
    expect(searchStaff("debt validation", src(admin)).some((r) => r.kind === "letter" && r.href.startsWith("/equipo/cartas?carta="))).toBe(true);
    expect(searchStaff("debt validation", src(sales)).some((r) => r.kind === "letter")).toBe(false);
    // Pages and actions the role may not open are not found.
    expect(searchStaff("plans", src(sales)).some((r) => r.href.startsWith("/equipo/planes"))).toBe(false);
    expect(searchStaff("send rounds", src(sales)).some((r) => r.href === "/equipo/enviar")).toBe(false);
    expect(searchStaff("import", src(sales)).some((r) => r.kind === "action" && r.label.startsWith("Import"))).toBe(false);
  });

  it("starts with the actions and the everyday pages, and scores a full match above a part", () => {
    const start = searchStaff("", src(admin));
    expect(start.length).toBeGreaterThan(0);
    expect(start.every((r) => r.kind === "action" || r.kind === "page")).toBe(true);
    const entry = searchIndex(src(admin)).find((e) => e.id === "page:/equipo/clientes")!;
    expect(matchScore(entry, "clients")).toBeGreaterThan(matchScore(entry, "cli"));
    expect(matchScore(entry, "zzz")).toBe(0);
    // A few letters inside a keyword find nothing: "ros" is a client's name, not "cobros" or "prospectos".
    expect(searchStaff("ros", src(admin)).every((r) => r.kind === "client" || r.kind === "partner" || r.kind === "letter" || /ros/i.test(r.label))).toBe(true);
  });
});
