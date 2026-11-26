import type { Ad, AdCampaign, AdDay, AdLead, AdSet, AdsSnapshot, ResultKind } from "./types";
import { addDays, dayInZone } from "./window";

// The demo's ad account: SAMPLE numbers, labelled as sample everywhere they
// show (no database, no Meta). Four campaigns, five ad sets, twelve ads over
// the last 100 days, with Meta-style daily spend, impressions, link clicks
// and results, and sample leads credited the three ways real ones are (a
// click-to-WhatsApp referral, a tagged website link, a lead form), a few
// that only say "from Meta" and some that signed. Deterministic: the same
// numbers for the same day, so the screens and the tests agree.
//
// The sample ads' words follow the same rules as real ones: no promise, no
// price, nothing "free", results vary.

const TZ = "America/Chicago";

interface AdPlan {
  id: string;
  adsetId: string;
  name: string;
  title: string;
  body: string;
  cta: string;
  video: boolean;
  thumb: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  /** Days ago it started and (when it stopped) ended spending. */
  from: number;
  to?: number;
  dailyCents: number;
  /** Meta's cost per result, in cents. */
  cprCents: number;
  /** Credalti leads per Meta result (lead-type goals), or leads per day for click goals. */
  leadRate: number;
  signRate: number;
  via: "ctwa" | "link" | "form";
}

const CAMPAIGNS: AdCampaign[] = [
  { id: "120210000000000101", name: "WhatsApp · Know your rights (TX)", status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", specialAdCategories: ["FINANCIAL_PRODUCTS_SERVICES"], dailyBudgetCents: 15_000, lifetimeBudgetCents: null, createdAt: null },
  { id: "120210000000000102", name: "Website · Start my review", status: "ACTIVE", objective: "OUTCOME_LEADS", specialAdCategories: ["FINANCIAL_PRODUCTS_SERVICES"], dailyBudgetCents: 8_000, lifetimeBudgetCents: null, createdAt: null },
  { id: "120210000000000103", name: "Lead form · Credit report questions", status: "ACTIVE", objective: "OUTCOME_LEADS", specialAdCategories: ["CREDIT"], dailyBudgetCents: 4_000, lifetimeBudgetCents: null, createdAt: null },
  { id: "120210000000000104", name: "Retargeting · Site visitors", status: "ACTIVE", objective: "OUTCOME_TRAFFIC", specialAdCategories: [], dailyBudgetCents: 1_000, lifetimeBudgetCents: null, createdAt: null },
];

const ADSETS: Array<AdSet> = [
  { id: "120210000000000201", campaignId: "120210000000000101", name: "Texas · Spanish · WhatsApp", status: "ACTIVE", optimizationGoal: "CONVERSATIONS", resultAction: "onsite_conversion.messaging_conversation_started_7d", resultKind: "conversations", createdAt: null },
  { id: "120210000000000202", campaignId: "120210000000000101", name: "Texas · English · WhatsApp", status: "ACTIVE", optimizationGoal: "CONVERSATIONS", resultAction: "onsite_conversion.messaging_conversation_started_7d", resultKind: "conversations", createdAt: null },
  { id: "120210000000000203", campaignId: "120210000000000102", name: "Texas · Website leads", status: "ACTIVE", optimizationGoal: "OFFSITE_CONVERSIONS", resultAction: "offsite_conversion.fb_pixel_lead", resultKind: "website_leads", createdAt: null },
  { id: "120210000000000204", campaignId: "120210000000000103", name: "Texas · Instant form", status: "ACTIVE", optimizationGoal: "LEAD_GENERATION", resultAction: "lead", resultKind: "leads_form", createdAt: null },
  { id: "120210000000000205", campaignId: "120210000000000104", name: "Visited the site · 30 days", status: "ACTIVE", optimizationGoal: "LINK_CLICKS", resultAction: "link_click", resultKind: "link_clicks", createdAt: null },
];

const SHOT = (name: string) => `/screens/site/${name}@1x.webp`;

const PLANS: AdPlan[] = [
  { id: "120210000000000301", adsetId: "120210000000000201", name: "Tus derechos (FCRA) · video 15s", title: "Tus derechos, en tu idioma", body: "Tienes derecho a disputar lo que está mal en tu reporte. Tú nos dices qué está mal; preparamos y enviamos las cartas por ti. Los resultados varían.", cta: "WHATSAPP_MESSAGE", video: true, thumb: SHOT("letters-es"), status: "ACTIVE", from: 60, dailyCents: 4_000, cprCents: 900, leadRate: 0.7, signRate: 0.09, via: "ctwa" },
  { id: "120210000000000302", adsetId: "120210000000000201", name: "¿Qué es un buró? · video 20s", title: "¿Qué es un buró de crédito?", body: "Tres burós, tres reportes. Te explicamos cómo leer el tuyo y qué hacer si algo está mal. Los resultados varían.", cta: "WHATSAPP_MESSAGE", video: true, thumb: SHOT("review-es"), status: "ACTIVE", from: 45, dailyCents: 2_500, cprCents: 1_400, leadRate: 0.65, signRate: 0.06, via: "ctwa" },
  { id: "120210000000000303", adsetId: "120210000000000201", name: "Carta paso a paso · imagen", title: "Así se ve una carta de disputa", body: "Cada carta lleva tus datos y lo que tú marcaste. Ves cada paso en la app. Los resultados varían.", cta: "WHATSAPP_MESSAGE", video: false, thumb: SHOT("case-es"), status: "ACTIVE", from: 30, dailyCents: 1_500, cprCents: 3_300, leadRate: 0.6, signRate: 0.04, via: "ctwa" },
  { id: "120210000000000304", adsetId: "120210000000000202", name: "Know your rights · video 15s", title: "Your credit report rights", body: "You can dispute what is wrong on your report. You tell us what is wrong; we prepare and mail the letters. Results vary.", cta: "WHATSAPP_MESSAGE", video: true, thumb: SHOT("letters-en"), status: "ACTIVE", from: 50, dailyCents: 3_000, cprCents: 2_100, leadRate: 0.7, signRate: 0.08, via: "ctwa" },
  { id: "120210000000000305", adsetId: "120210000000000202", name: "Myth: checking hurts · carousel", title: "Myth or fact?", body: "Five things people believe about credit reports, and what the law actually says. Swipe through, then ask us anything. Results vary.", cta: "WHATSAPP_MESSAGE", video: false, thumb: SHOT("build-en"), status: "ACTIVE", from: 28, dailyCents: 2_000, cprCents: 6_200, leadRate: 0.5, signRate: 0.02, via: "ctwa" },
  { id: "120210000000000306", adsetId: "120210000000000203", name: "How it works · video 30s", title: "How Credalti works", body: "Start your review in a short chat. You tell us what is wrong on your report, and our team prepares and mails the letters. Results vary.", cta: "LEARN_MORE", video: true, thumb: SHOT("welcome-en"), status: "ACTIVE", from: 40, dailyCents: 3_500, cprCents: 2_800, leadRate: 0.85, signRate: 0.07, via: "link" },
  { id: "120210000000000307", adsetId: "120210000000000203", name: "Cómo funciona · video 30s", title: "Cómo funciona Credalti", body: "Empieza tu revisión en un chat corto. Tú nos dices qué está mal y nuestro equipo prepara y envía las cartas. Los resultados varían.", cta: "LEARN_MORE", video: true, thumb: SHOT("welcome-es"), status: "ACTIVE", from: 40, dailyCents: 3_000, cprCents: 1_900, leadRate: 0.85, signRate: 0.1, via: "link" },
  { id: "120210000000000308", adsetId: "120210000000000203", name: "In English or Spanish · image", title: "In English or Spanish", body: "One team, your language, every step in the app. Start my review. Results vary.", cta: "SIGN_UP", video: false, thumb: SHOT("review-en"), status: "ACTIVE", from: 4, dailyCents: 1_500, cprCents: 2_400, leadRate: 0.8, signRate: 0.06, via: "link" },
  { id: "120210000000000309", adsetId: "120210000000000204", name: "Questions about your report? · image", title: "Questions about your credit report?", body: "Ask us in a two-minute form and a person from our team writes back. Results vary.", cta: "SIGN_UP", video: false, thumb: SHOT("case-en"), status: "ACTIVE", from: 0, dailyCents: 0, cprCents: 3_000, leadRate: 0.8, signRate: 0.1, via: "form" },
  { id: "120210000000000310", adsetId: "120210000000000204", name: "Preguntas sobre tu reporte · imagen", title: "¿Preguntas sobre tu reporte?", body: "Pregúntanos en un formulario corto y alguien del equipo te contesta. Los resultados varían.", cta: "SIGN_UP", video: false, thumb: SHOT("letters-es"), status: "PAUSED", from: 14, to: 11, dailyCents: 5_500, cprCents: 0, leadRate: 0, signRate: 0, via: "form" },
  { id: "120210000000000311", adsetId: "120210000000000205", name: "Still have questions? · image", title: "Still have questions?", body: "Read how disputes work, in plain words, then ask us anything on WhatsApp. Results vary.", cta: "LEARN_MORE", video: false, thumb: SHOT("build-es"), status: "ACTIVE", from: 30, dailyCents: 800, cprCents: 90, leadRate: 0.45, signRate: 0.04, via: "link" },
  { id: "120210000000000312", adsetId: "120210000000000201", name: "Tu reporte, explicado · video (old)", title: "Tu reporte, explicado", body: "Te explicamos cada parte de tu reporte, en español. Los resultados varían.", cta: "WHATSAPP_MESSAGE", video: true, thumb: SHOT("review-es"), status: "ARCHIVED", from: 95, to: 62, dailyCents: 2_000, cprCents: 1_600, leadRate: 0.65, signRate: 0.07, via: "ctwa" },
];

/** A number in [0, 1) from a string: the same every time. */
function noise(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

const FIRST = ["Rosa", "Miguel", "Ana", "Jorge", "Lucía", "Kevin", "Angela", "David", "María", "Luis", "Sofía", "Carlos", "Brenda", "José", "Tanya", "Marcos", "Elena", "Andre", "Paola", "Victor"];
const INITIAL = "GMRLSTPHCBDNVA";

/** The sample account, its ads and their numbers up to `now` (the account's today). */
export function buildDemoAds(now: Date): { snapshot: AdsSnapshot; leads: AdLead[] } {
  const today = dayInZone(now, TZ);
  const adsetById = new Map(ADSETS.map((s) => [s.id, s]));
  const ads: Ad[] = PLANS.map((p) => ({
    id: p.id,
    adsetId: p.adsetId,
    campaignId: adsetById.get(p.adsetId)!.campaignId,
    name: p.name,
    status: p.status,
    createdAt: new Date(Date.parse(`${addDays(today, -p.from)}T15:00:00Z`)).toISOString(),
    creative: { title: p.title, body: p.body, thumbnailUrl: p.thumb, imageUrl: p.video ? null : p.thumb, videoId: p.video ? `9${p.id.slice(-8)}` : null, callToAction: p.cta, link: p.via === "link" ? "https://credalti.com/registro" : null },
    previewUrl: null,
  }));

  const days: AdDay[] = [];
  const leads: AdLead[] = [];
  let leadNo = 0;
  for (const p of PLANS) {
    const adset = adsetById.get(p.adsetId)!;
    const clicksGoal: ResultKind[] = ["link_clicks", "landing_page_views"];
    let resultCarry = 0;
    let leadCarry = 0;
    for (let ago = p.from; ago >= (p.to ?? 0); ago--) {
      const day = addDays(today, -ago);
      if (p.dailyCents <= 0) continue;
      const k = `${p.id}:${day}`;
      // Today is only partly spent.
      const share = ago === 0 ? 0.45 : 1;
      const spendCents = Math.round(p.dailyCents * (0.72 + 0.56 * noise(`${k}:s`)) * share);
      const impressions = Math.round((spendCents / 100) * (55 + 30 * noise(`${k}:i`)));
      const clicks = Math.round(impressions * (0.009 + 0.016 * noise(`${k}:c`)));
      let results = 0;
      if (p.cprCents > 0) {
        resultCarry += (spendCents / p.cprCents) * (0.7 + 0.6 * noise(`${k}:r`));
        results = Math.floor(resultCarry);
        resultCarry -= results;
      }
      days.push({ adId: p.id, adsetId: p.adsetId, campaignId: adset.campaignId, day, spendCents, impressions, clicks, results });
      // Credalti's own leads from this ad that day: a share of Meta's lead-type results, or a few per day for a clicks goal.
      leadCarry += clicksGoal.includes(adset.resultKind) ? p.leadRate * (0.6 + 0.8 * noise(`${k}:l`)) : results * p.leadRate;
      const n = Math.floor(leadCarry);
      leadCarry -= n;
      for (let i = 0; i < n; i++) {
        leadNo += 1;
        const at = new Date(Date.parse(`${day}T14:00:00Z`) + Math.floor(noise(`${k}:t${i}`) * 9) * 3_600_000);
        if (at > now) continue;
        const signed = ago >= 3 && noise(`${k}:g${i}`) < p.signRate;
        leads.push({
          id: `demo-ad-lead-${leadNo}`,
          name: `${FIRST[leadNo % FIRST.length]} ${INITIAL[leadNo % INITIAL.length]}.`,
          createdAt: at.toISOString(),
          signedAt: signed ? new Date(at.getTime() + (1 + Math.floor(noise(`${k}:d${i}`) * 3)) * 86_400_000).toISOString() : null,
          source: p.via === "ctwa" ? "whatsapp" : p.via === "form" ? "highlevel" : "signup_chat",
          utm: p.via === "link" ? { source: "facebook", medium: "paid", campaign: adset.campaignId, content: p.id } : p.via === "form" ? { source: "facebook", content: p.name } : null,
          ad: p.via === "ctwa" ? { adId: p.id, via: "ctwa" } : p.via === "link" ? { adId: p.id, fbclid: true, via: "link" } : { via: "form" },
        });
      }
    }
  }
  // A few leads that only say they came from Meta, and a few credited to a campaign by its name.
  for (let i = 0; i < 9; i++) {
    const at = new Date(now.getTime() - (2 + i * 3.3) * 86_400_000);
    leads.push({ id: `demo-ad-lead-meta-${i}`, name: `${FIRST[(i * 7) % FIRST.length]} ${INITIAL[(i * 3) % INITIAL.length]}.`, createdAt: at.toISOString(), signedAt: i % 4 === 0 ? new Date(at.getTime() + 2 * 86_400_000).toISOString() : null, source: "signup_chat", utm: { source: "instagram" }, ad: { fbclid: true, via: "link" } });
  }
  for (let i = 0; i < 5; i++) {
    const at = new Date(now.getTime() - (1 + i * 4.1) * 86_400_000);
    leads.push({ id: `demo-ad-lead-campaign-${i}`, name: `${FIRST[(i * 5 + 3) % FIRST.length]} ${INITIAL[(i * 5) % INITIAL.length]}.`, createdAt: at.toISOString(), signedAt: null, source: "highlevel", utm: { source: "facebook", campaign: CAMPAIGNS[1]!.name }, ad: null });
  }

  return {
    snapshot: {
      platform: "meta",
      account: { id: "act_1000000000001", name: "Credalti · sample ad account", currency: "USD", timeZone: TZ, status: "active", statusCode: 1 },
      campaigns: CAMPAIGNS,
      adsets: ADSETS,
      ads,
      days,
      syncedAt: new Date(now.getTime() - 95 * 60_000).toISOString(),
      lastRun: { at: new Date(now.getTime() - 95 * 60_000).toISOString(), ok: true, since: addDays(today, -2), until: today, rows: days.length, error: null },
    },
    leads: leads.filter((l) => Date.parse(l.createdAt) <= now.getTime()),
  };
}
