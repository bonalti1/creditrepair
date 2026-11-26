import type { LeadFunnel } from "./stages";

// DEMO DATA: the funnel line on three of the Lead Manager's invented leads
// (leads/demo.ts), by their ids. Kept apart from live/demo.ts so the lead
// inbox loads nothing else. Nobody here exists.

const MIN = 60_000;

export function demoLeadFunnels(now: Date): Record<string, LeadFunnel> {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  return {
    "lead-rosa": { tag: "webinar", platform: "whatsapp", keyword: "CREDITO", campaign: "webinar-nov", stage: "reviewing", stageAt: at(30 * MIN) },
    "lead-angela": { tag: "comment", platform: "instagram", keyword: "INFO", campaign: "credit-builder-nov", stage: "watched", stageAt: at(20 * MIN) },
    "lead-210": { tag: "webinar", platform: "whatsapp", keyword: "CREDIT", campaign: "webinar-nov", stage: "reviewing", stageAt: at(3 * MIN) },
  };
}
