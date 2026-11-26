import { healthToFix } from "./health";
import type { Guide, HealthReport } from "./types";

// What in SEO needs a person (the red count on the menu's Content group,
// src/lib/staff/navBadges.ts): guides waiting for an administrator's approval
// (for those who publish), guides an administrator sent back (for those who
// write), and the site-health checks with something to fix (for everyone who
// sees SEO). A count, never a score.

export interface SeoNeeds {
  review: number;
  changes: number;
  health: number;
  total: number;
}

export function seoNeeds(input: { guides: readonly Guide[]; health: HealthReport | null; canPublish: boolean; canEdit: boolean }): SeoNeeds {
  const review = input.canPublish ? input.guides.filter((g) => g.status === "review").length : 0;
  const changes = input.canEdit ? input.guides.filter((g) => g.status === "changes").length : 0;
  const health = healthToFix(input.health);
  return { review, changes, health, total: review + changes + health };
}
