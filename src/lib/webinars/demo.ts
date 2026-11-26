import { demoChargeMeta } from "../accounting/demo";
import { attributionIndex, attributeLead } from "../ads/attribution";
import { buildDemoAds } from "../ads/demo";
import { addDays, dayInZone } from "../ads/window";
import { demoCommissionLines } from "../fulfillment/commissionData";
import { buildDemoClients } from "../staff/demoClients";
import type { StaffClient } from "../staff/types";
import type { FunnelLead } from "./live";
import type { ClientValueFacts } from "./scorecard";
import { TEXAS_TZ, texasToIso } from "./time";
import { GOALS, TIMELINES, type Campaign, type CampaignCost, type ClientPurchase, type Registration, type Webinar } from "./types";
import { clientValueFacts } from "./value";

// The demo's webinars: SAMPLE data, labelled as sample on every screen (no
// database, nothing sent). Three webinars (one ended with its replay and a
// Zoom attendance import, one live right now so the live console has
// something to show, one next week), their registrants, the campaign
// "Webinar test #1" ($1,000) that groups them with the sample Meta campaign
// and the keyword, its non-Meta costs, the leads they brought (some signed,
// matched to the demo's sample clients so the value comes from the demo's
// own books), and two later purchases. (The sample signup chats are in
// src/lib/signup/liveChatDemo.ts.)
// Deterministic: the same `now` gives the same numbers.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const FIRST = ["Rosa", "Miguel", "Ana", "Jorge", "Lucía", "Kevin", "Angela", "David", "María", "Luis", "Sofía", "Carlos", "Brenda", "José", "Tanya", "Marcos", "Elena", "Andre", "Paola", "Victor", "Gabriela", "Raúl", "Diana", "Hugo"];
const LAST = ["García", "Martínez", "Hernández", "López", "González", "Pérez", "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez"];
const OUT_OF_STATE = ["CA", "FL", "IL", "NM", "AZ"];

function noise(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** A day on Texas's calendar, `n` days from now's. */
const texasDay = (now: Date, n: number) => addDays(dayInZone(now, TEXAS_TZ), n);

export function demoWebinars(now: Date): Webinar[] {
  // The live one is always 10 to 40 minutes in, and its start holds still for half an hour, so the console's timer runs.
  const CYCLE = 30 * 60_000;
  const liveStart = new Date(Math.floor((now.getTime() - 10 * 60_000) / CYCLE) * CYCLE).toISOString();
  const base = { durationMinutes: 45, keyword: "CREDIT", status: "published" as const, campaignId: "demo-campaign-1", createdBy: "Carmen Ruiz" };
  return [
    {
      ...base,
      id: "demo-webinar-ended",
      slug: "reporte-explicado",
      title: { en: "Your credit report, explained", es: "Tu reporte de crédito, explicado" },
      host: "Daniela Ruiz",
      startsAt: texasToIso(texasDay(now, -5), "19:00")!,
      language: "es",
      topic: "Reading the three reports; your rights under the FCRA; how a dispute works.",
      campaignTag: "webinar-test-1",
      links: { zoom: "https://zoom.us/j/0000000000", facebook: "https://www.facebook.com/credalti/live", youtube: "https://www.youtube.com/@credalti/live" },
      replayUrl: "https://www.youtube.com/watch?v=sample-replay",
      createdAt: new Date(now.getTime() - 24 * DAY).toISOString(),
    },
    {
      ...base,
      id: "demo-webinar-live",
      slug: "credito-en-vivo",
      title: { en: "Credit questions, live", es: "Preguntas de crédito, en vivo" },
      host: "Daniela Ruiz",
      startsAt: liveStart,
      language: "both",
      topic: "Open questions about credit reports, disputes and buying a home in Texas.",
      campaignTag: "webinar-test-1",
      links: { zoom: "https://zoom.us/j/0000000001", facebook: "https://www.facebook.com/credalti/live", instagram: "https://www.instagram.com/credalti/live", tiktok: "https://www.tiktok.com/@credalti/live" },
      replayUrl: null,
      createdAt: new Date(now.getTime() - 12 * DAY).toISOString(),
    },
    {
      ...base,
      id: "demo-webinar-next",
      slug: "primera-casa-texas",
      title: { en: "Your first home in Texas: what lenders look at", es: "Tu primera casa en Texas: lo que miran los prestamistas" },
      host: "Daniela Ruiz",
      startsAt: texasToIso(texasDay(now, 6), "19:00")!,
      language: "en",
      topic: "What a lender reads on a report, questions to ask a loan officer.",
      campaignTag: "webinar-test-1",
      links: { zoom: "https://zoom.us/j/0000000002", youtube: "https://www.youtube.com/@credalti/live" },
      replayUrl: null,
      createdAt: new Date(now.getTime() - 3 * DAY).toISOString(),
    },
  ];
}

const COUNTS: Record<string, number> = { "demo-webinar-ended": 46, "demo-webinar-live": 31, "demo-webinar-next": 14 };

export function demoRegistrations(now: Date): Registration[] {
  const out: Registration[] = [];
  let phone = 100;
  for (const w of demoWebinars(now)) {
    const start = Date.parse(w.startsAt);
    for (let i = 0; i < COUNTS[w.id]!; i++) {
      const key = `${w.id}:${i}`;
      const r = noise(key);
      const outOfState = r < 0.12;
      const state = outOfState ? OUT_OF_STATE[i % OUT_OF_STATE.length]! : "TX";
      const ended = w.id === "demo-webinar-ended";
      const attended = ended ? noise(`${key}:a`) < 0.48 : w.id === "demo-webinar-live" ? noise(`${key}:a`) < 0.55 : false;
      out.push({
        id: `demo-reg-${w.id.replace("demo-webinar-", "")}-${i}`,
        webinarId: w.id,
        firstName: FIRST[(i * 7 + w.id.length) % FIRST.length]!,
        lastName: LAST[(i * 5 + 3) % LAST.length]!,
        phone: `+1713555${String(phone++).padStart(4, "0")}`,
        email: noise(`${key}:e`) < 0.6 ? `sample${phone}@example.com` : null,
        state,
        served: outOfState ? "out_of_state" : "texas",
        locale: w.language === "en" ? "en" : w.language === "es" ? "es" : noise(`${key}:l`) < 0.6 ? "es" : "en",
        goal: GOALS[Math.floor(noise(`${key}:g`) * GOALS.length)]!,
        timeline: TIMELINES[Math.floor(noise(`${key}:t`) * TIMELINES.length)]!,
        question: noise(`${key}:q`) < 0.35 ? (i % 2 ? "How long does a bureau have to answer a dispute?" : "¿Una cobranza vieja se puede disputar?") : null,
        remindersConsent: noise(`${key}:c`) < 0.86,
        optedOutAt: noise(`${key}:o`) < 0.04 ? new Date(start - 2 * DAY).toISOString() : null,
        attended,
        attendedMinutes: attended ? (ended ? 12 + Math.round(noise(`${key}:m`) * 33) : Math.min(12, 3 + Math.round(noise(`${key}:m`) * 9))) : null,
        attendanceSource: attended ? (ended ? "zoom_csv" : "manual") : null,
        createdAt: new Date(start - (1 + noise(`${key}:d`) * 9) * DAY).toISOString(),
        attribution: noise(`${key}:ad`) < 0.55 ? { ad: { campaignId: "120210000000000101", via: "link" }, utm: { source: "facebook", campaign: "120210000000000101" } } : noise(`${key}:ig`) < 0.5 ? { utm: { source: "instagram" } } : null,
      });
    }
  }
  return out;
}

export function demoCampaigns(now: Date): Campaign[] {
  return [
    {
      id: "demo-campaign-1",
      name: "Webinar test #1",
      startDay: texasDay(now, -6),
      endDay: texasDay(now, 7),
      budgetCents: 120_000,
      metaCampaignIds: ["120210000000000101"],
      webinarIds: ["demo-webinar-ended", "demo-webinar-live", "demo-webinar-next"],
      keywords: ["CREDIT"],
      organicSources: ["instagram", "tiktok", "youtube"],
      note: "About $1,000 of Meta ads inviting people to the live classes, plus organic posts and about $200 of other costs.",
      createdAt: new Date(now.getTime() - 22 * DAY).toISOString(),
    },
  ];
}

export function demoCosts(now: Date): CampaignCost[] {
  return [
    { id: "demo-cost-1", campaignId: "demo-campaign-1", label: "Zoom Webinars (1 month)", kind: "tools", amountCents: 7_900, day: texasDay(now, -6), by: "Carmen Ruiz", voidedAt: null },
    { id: "demo-cost-2", campaignId: "demo-campaign-1", label: "Canva Pro", kind: "tools", amountCents: 1_500, day: texasDay(now, -6), by: "Carmen Ruiz", voidedAt: null },
    { id: "demo-cost-3", campaignId: "demo-campaign-1", label: "Editing the class clips", kind: "content", amountCents: 4_000, day: texasDay(now, -4), by: "Carmen Ruiz", voidedAt: null },
  ];
}

export function demoPurchases(now: Date): ClientPurchase[] {
  return [
    { id: "demo-purchase-1", clientId: "c24", kind: "loan_officer", amountCents: null, day: texasDay(now, -4), note: "Introduced to a loan officer (no fee).", by: "Carmen Ruiz", voidedAt: null },
    { id: "demo-purchase-2", clientId: "c25", kind: "household_addon", amountCents: 4_900, day: texasDay(now, -2), note: "Added a spouse.", by: "Carmen Ruiz", voidedAt: null },
  ];
}

/** The signed sample clients the campaign's leads are matched to (they have charges in the demo's books). */
const SIGNED_CLIENTS = ["c24", "c25", "c26", "c27", "c13", "c19", "c29", "c20", "c28", "c30", "c12", "c14"];
/** Sample packages: DIY clients, and one who moved from DIY to Complete. */
const DIY_CLIENTS = new Set(["c13", "c19", "c29"]);

export function demoClientsWithPackages(now: Date): StaffClient[] {
  return buildDemoClients(now).map((c) => {
    if (DIY_CLIENTS.has(c.id)) return { ...c, option: "diy" } as StaffClient;
    if (c.id === "c20") return { ...c, option: "complete", packageEvents: [{ at: new Date(now.getTime() - 40 * DAY).toISOString(), from: "diy", to: "complete" }] } as StaffClient;
    return c;
  });
}

export function demoValues(now: Date): Map<string, ClientValueFacts> {
  const clients = demoClientsWithPackages(now);
  return clientValueFacts({ clients, chargeMeta: demoChargeMeta(clients), commissions: demoCommissionLines(now), purchases: demoPurchases(now), loanOfficer: new Map([["c24", 1]]), households: new Map([["c25", 1]]) });
}

const EXCERPTS = ["CREDIT", "credit", "CREDIT 🙌", "Hola, CREDIT", "CREDIT please", "¿Cómo me registro?", "CREDIT, gracias"];

/** The leads the campaign brought: ad leads from the sample ad account, keyword leads from the classes, organic. */
export function demoFunnelLeads(now: Date): FunnelLead[] {
  const { snapshot, leads } = buildDemoAds(now);
  const index = attributionIndex(snapshot);
  const campaign = demoCampaigns(now)[0]!;
  const out: FunnelLead[] = [];
  let signedIdx = 0;
  const nextClient = () => SIGNED_CLIENTS[signedIdx++ % SIGNED_CLIENTS.length]!;
  for (const l of leads) {
    const day = dayInZone(l.createdAt, TEXAS_TZ);
    if (day < campaign.startDay || day > campaign.endDay) continue;
    const a = attributeLead(l, index);
    if (a.campaignId !== "120210000000000101") continue;
    out.push({
      id: l.id,
      name: l.name,
      phone: null,
      createdAt: l.createdAt,
      source: l.source,
      keyword: null,
      campaign: null,
      webinarId: null,
      utmSource: l.utm?.source ?? null,
      utmCampaign: l.utm?.campaign ?? null,
      adCampaignId: a.campaignId,
      fromMeta: true,
      clientUserId: l.signedAt ? nextClient() : null,
      signupStarted: Boolean(l.signedAt) || noise(`${l.id}:s`) < 0.25,
      signedAt: l.signedAt,
      lastMessage: null,
    });
  }
  const regs = demoRegistrations(now);
  for (const w of demoWebinars(now).filter((x) => x.id !== "demo-webinar-next")) {
    const live = w.id === "demo-webinar-live";
    const start = Date.parse(w.startsAt);
    const n = live ? 17 : 22;
    const mine = regs.filter((r) => r.webinarId === w.id);
    for (let i = 0; i < n; i++) {
      const key = `${w.id}:kw:${i}`;
      // In the live class they keep arriving over its first 35 minutes (the console shows those already in).
      const at = live ? start + Math.round((i / n) * 35 * 60_000) : start + Math.round(noise(key) * 50) * 60_000;
      const reg = mine[i % mine.length]!;
      const signed = !live && noise(`${key}:sig`) < 0.24;
      out.push({
        id: `demo-kw-${w.id}-${i}`,
        name: `${reg.firstName} ${reg.lastName?.charAt(0) ?? ""}.`,
        phone: reg.phone,
        createdAt: new Date(at).toISOString(),
        source: "webinar",
        keyword: "CREDIT",
        campaign: w.campaignTag,
        webinarId: w.id,
        utmSource: null,
        utmCampaign: null,
        adCampaignId: null,
        fromMeta: false,
        clientUserId: signed ? nextClient() : null,
        signupStarted: signed || noise(`${key}:st`) < (live ? 0.2 : 0.4),
        signedAt: signed ? new Date(at + (1 + noise(`${key}:when`) * 5) * DAY).toISOString() : null,
        lastMessage: { at: new Date(at).toISOString(), excerpt: EXCERPTS[i % EXCERPTS.length]!, fromLead: true },
      });
    }
  }
  // The keyword typed under an organic post ("type CREDIT"), not tied to a class.
  for (let i = 0; i < 4; i++) {
    const at = now.getTime() - (3.2 + i * 0.4) * DAY;
    const signed = i === 1;
    out.push({
      id: `demo-keyword-${i}`,
      name: `${FIRST[(i * 5 + 2) % FIRST.length]} ${LAST[(i + 4) % LAST.length]!.charAt(0)}.`,
      phone: null,
      createdAt: new Date(at).toISOString(),
      source: "webinar",
      keyword: "CREDIT",
      campaign: null,
      webinarId: null,
      utmSource: "tiktok",
      utmCampaign: null,
      adCampaignId: null,
      fromMeta: false,
      clientUserId: signed ? nextClient() : null,
      signupStarted: signed || i === 3,
      signedAt: signed ? new Date(at + DAY).toISOString() : null,
      lastMessage: { at: new Date(at).toISOString(), excerpt: "CREDIT", fromLead: true },
    });
  }
  for (let i = 0; i < 7; i++) {
    const at = now.getTime() - (1 + i) * DAY;
    const signed = i === 2;
    out.push({
      id: `demo-organic-${i}`,
      name: `${FIRST[(i * 3 + 5) % FIRST.length]} ${LAST[i % LAST.length]!.charAt(0)}.`,
      phone: null,
      createdAt: new Date(at).toISOString(),
      source: "whatsapp",
      keyword: null,
      campaign: null,
      webinarId: null,
      utmSource: ["instagram", "tiktok", "youtube"][i % 3]!,
      utmCampaign: null,
      adCampaignId: null,
      fromMeta: false,
      clientUserId: signed ? nextClient() : null,
      signupStarted: signed || i % 3 === 0,
      signedAt: signed ? new Date(at + DAY).toISOString() : null,
      lastMessage: null,
    });
  }
  return out;
}

/** Sample clients with a report on file (a share of the campaign's leads who signed up). */
export function demoReportClients(now: Date): Set<string> {
  return new Set(demoFunnelLeads(now).filter((l) => l.clientUserId && noise(`${l.id}:r`) < 0.8).map((l) => l.clientUserId!));
}

/** The demo's Meta spend per campaign per day (the Ads Manager's sample account). */
export function demoAdDays(now: Date): Array<{ campaignId: string; day: string; spendCents: number }> {
  return buildDemoAds(now).snapshot.days.map((d) => ({ campaignId: d.campaignId, day: d.day, spendCents: d.spendCents }));
}

