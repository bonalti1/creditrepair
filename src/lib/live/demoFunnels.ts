import type { LeadFunnel } from "./stages";

// DEMO DATA: the funnel line on three of the Lead Manager's invented leads
// (leads/demo.ts), by their ids. Kept apart from live/demo.ts so the lead
// inbox loads nothing else. Nobody here exists.
//
// Rosa and the 210 number typed the keyword during the demo's live class
// ("Credit questions, live", campaign tag webinar-test-1: webinars/demo.ts),
// so the Webinars live console and the campaign scorecard count them too.

const MIN = 60_000;

/** The demo's webinar campaign tag (webinars/demo.ts demoWebinars). */
export const DEMO_FUNNEL_CAMPAIGN = "webinar-test-1";

export function demoLeadFunnels(now: Date): Record<string, LeadFunnel> {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  return {
    "lead-rosa": { tag: "webinar", platform: "whatsapp", keyword: "CREDITO", campaign: DEMO_FUNNEL_CAMPAIGN, stage: "reviewing", stageAt: at(30 * MIN) },
    "lead-angela": { tag: "comment", platform: "instagram", keyword: "INFO", campaign: "credit-builder-nov", stage: "watched", stageAt: at(20 * MIN) },
    "lead-210": { tag: "webinar", platform: "whatsapp", keyword: "CREDIT", campaign: DEMO_FUNNEL_CAMPAIGN, stage: "reviewing", stageAt: at(3 * MIN) },
  };
}

/**
 * The demo's private video links, by lead: /v/demo is Angela's sample video;
 * a video a member records and sends in the demo gets its own lead's link
 * (/v/demo-rosa, /v/demo-210), so the page greets the right person.
 */
export const DEMO_VIDEO_TOKENS: Readonly<Record<string, string>> = { demo: "lead-angela", "demo-rosa": "lead-rosa", "demo-210": "lead-210" };

export function demoTokenForLead(leadId: string): string {
  return Object.entries(DEMO_VIDEO_TOKENS).find(([, lead]) => lead === leadId)?.[0] ?? "demo";
}

export function demoLeadForToken(token: string): string | null {
  return DEMO_VIDEO_TOKENS[token] ?? null;
}
