import { demoClientRawReport, DEMO_RAW_REPORT } from "../demo";
import { buildOverview } from "./overview";
import type { ReviewItem } from "./review";
import { demoLeadFunnels } from "./demoFunnels";

export { demoLeadFunnels };

// DEMO DATA for the live funnel. Nobody here exists: three of the Lead
// Manager's invented leads (leads/demo.ts) came through the funnel, with a
// sample report overview (the demo report, never anyone's) and a sample video
// (public/live/sample-video.webm, which says on screen that it is a sample).
// Times are relative to `now`.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const SAMPLE_VIDEO_URL = "/live/sample-video.webm";
/** The demo's video link: /v/demo shows the sample video. */
export const DEMO_VIDEO_TOKEN = "demo";

/** The review queue's sample items. */
export function demoReviews(now: Date): ReviewItem[] {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const funnels = demoLeadFunnels(now);
  const rosaRaw = demoClientRawReport();
  rosaRaw.pulledAt = at(2 * DAY);
  const angelaRaw = structuredClone(DEMO_RAW_REPORT);
  angelaRaw.pulledAt = at(3 * DAY);
  const strip = (raw: typeof rosaRaw) => {
    for (const section of Object.values(raw.bureaus)) if (section) delete section.score;
    return raw;
  };
  return [
    {
      id: "demo-review-rosa",
      leadId: "lead-rosa",
      firstName: "Rosa Elena",
      locale: "es",
      state: "TX",
      goal: "mortgage",
      status: "ready",
      simulated: true,
      createdAt: at(35 * MIN),
      readyAt: at(30 * MIN),
      deleteAfter: new Date(now.getTime() + 30 * DAY - 35 * MIN).toISOString(),
      fileCount: 3,
      problems: [],
      overview: buildOverview({ raw: strip(rosaRaw), goal: "mortgage", doubtful: 1, warnings: [], now }),
      funnel: funnels["lead-rosa"]!,
      videos: [],
      signed: false,
      clientUserId: null,
      importedAt: null,
      sample: true,
    },
    {
      id: "demo-review-angela",
      leadId: "lead-angela",
      firstName: "Angela",
      locale: "en",
      state: "TX",
      goal: "card",
      status: "ready",
      simulated: true,
      createdAt: at(DAY + 2 * HOUR),
      readyAt: at(DAY + 2 * HOUR - 4 * MIN),
      deleteAfter: new Date(now.getTime() + 29 * DAY).toISOString(),
      fileCount: 1,
      problems: [],
      overview: buildOverview({ raw: strip(angelaRaw), goal: "card", doubtful: 0, warnings: [], now }),
      funnel: funnels["lead-angela"]!,
      videos: [
        {
          id: "demo-video-angela",
          createdAt: at(3 * HOUR),
          durationSeconds: 166,
          recordedBy: "Carmen",
          sentAt: at(3 * HOUR - 5 * MIN),
          sentVia: ["whatsapp"],
          openedAt: at(40 * MIN),
          watchedAt: at(20 * MIN),
          startedAt: null,
          expiresAt: new Date(now.getTime() + 14 * DAY - 3 * HOUR).toISOString(),
          deleted: false,
          localUrl: SAMPLE_VIDEO_URL,
        },
      ],
      signed: false,
      clientUserId: null,
      importedAt: null,
      sample: true,
    },
    {
      id: "demo-review-210",
      leadId: "lead-210",
      firstName: null,
      locale: "en",
      state: "TX",
      goal: "general",
      status: "reading",
      simulated: true,
      createdAt: at(3 * MIN),
      readyAt: null,
      deleteAfter: new Date(now.getTime() + 30 * DAY).toISOString(),
      fileCount: 1,
      problems: [],
      overview: null,
      funnel: funnels["lead-210"]!,
      videos: [],
      signed: false,
      clientUserId: null,
      importedAt: null,
      sample: true,
    },
  ];
}
