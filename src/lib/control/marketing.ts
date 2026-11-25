import type { Guide, HealthReport } from "../seo/types";
import { seoNeeds } from "../seo/needs";
import type { Idea } from "../ideas/types";
import type { VideoProject } from "../video/types";

// The Video Studio, SEO and Ideas on the Overview and in the Today list
// (docs/CONTROL.md). Pure, from what each department itself reads: the video
// projects (src/lib/video), the guides and the last site check (src/lib/seo),
// the ideas board (src/lib/ideas). Only titles, statuses, dates and counts
// leave each department; never the words of a video, a guide or an idea.
//
// "Needs you" follows each department's own rule, so the Overview, the menu's
// red circle and the department's screen always agree: the Video Studio's
// videoNeeds (video/rules.ts), SEO's seoNeeds (seo/needs.ts). Ideas: what an
// administrator decides (new ideas to approve, tests whose days are over).

/** One video, as the Content card and the Today list need it. */
export interface VideoRef {
  id: string;
  title: string;
  /** When it got where it is (the project's last change). */
  since: string;
  owner: string | null;
  /** «Changes asked»: the note. */
  note: string | null;
}

export interface VideoSummary {
  /** Videos on the board (archived left out). */
  videos: number;
  /** Waiting for an approver (status ready). */
  ready: VideoRef[];
  /** Sent back with a note (editing, with the approver's note). */
  changes: VideoRef[];
  /** Approved, not yet handed to Content to publish. */
  approved: VideoRef[];
}

type VideoLike = Pick<VideoProject, "id" | "title" | "status" | "owner" | "changesNote" | "updatedAt" | "createdAt">;

const videoRef = (p: VideoLike): VideoRef => ({ id: p.id, title: p.title, since: p.updatedAt || p.createdAt, owner: p.owner, note: p.changesNote });

export function videoSummary(projects: readonly VideoLike[]): VideoSummary {
  const live = projects.filter((p) => p.status !== "archived");
  return {
    videos: live.length,
    ready: live.filter((p) => p.status === "ready").map(videoRef),
    changes: live.filter((p) => p.status === "editing" && Boolean(p.changesNote)).map(videoRef),
    approved: live.filter((p) => p.status === "approved").map(videoRef),
  };
}

/** The Video Studio's «Needs you», the same rule as video/rules.ts videoNeeds: approvers the videos waiting; editors the changes asked of them and the approved videos to hand over. */
export function videoNeedsOf(summary: VideoSummary, viewer: { approve: boolean; edit: boolean; handle: string | null }) {
  const ready = viewer.approve ? summary.ready : [];
  const changes = viewer.edit ? summary.changes.filter((c) => c.owner === null || c.owner === viewer.handle) : [];
  const approved = viewer.edit ? summary.approved : [];
  return { ready, changes, approved, count: ready.length + changes.length + approved.length };
}

export interface SeoSummary {
  /** A site check has been run at least once (null report: never). */
  checked: boolean;
  /** Site-health checks with something to fix (seo/health.ts healthToFix). */
  toFix: number;
  /** Guides waiting for an administrator's approval. */
  review: number;
  /** Guides an administrator sent back. */
  changes: number;
  /** Guides live on the website. */
  published: number;
}

export function seoSummary(guides: readonly Pick<Guide, "status">[], health: HealthReport | null): SeoSummary {
  const all = seoNeeds({ guides: guides as Guide[], health, canPublish: true, canEdit: true });
  return { checked: health !== null, toFix: all.health, review: all.review, changes: all.changes, published: guides.filter((g) => g.status === "published").length };
}

/** SEO's «Needs you», the same rule as seo/needs.ts: approvals for whoever publishes, sent-back guides for whoever writes, checks to fix for everyone. */
export function seoNeedsOf(summary: SeoSummary, viewer: { publish: boolean; edit: boolean }): number {
  return (viewer.publish ? summary.review : 0) + (viewer.edit ? summary.changes : 0) + summary.toFix;
}

export interface IdeasSummary {
  /** New ideas waiting for an administrator's yes or no. */
  waitingApproval: number;
  /** Approved, the test not started yet. */
  approved: number;
  /** Tests running, their days not over. */
  testing: number;
  /** Tests whose days are over: keep it or drop it. */
  decide: number;
  /** Kept or dropped in the last 30 days. */
  decided30d: number;
}

type IdeaLike = Pick<Idea, "status" | "testEndsAt" | "decidedAt">;

export function ideasSummary(ideas: readonly IdeaLike[], now: Date): IdeasSummary {
  const testing = ideas.filter((i) => i.status === "testing");
  const over = (i: IdeaLike) => i.testEndsAt !== null && Date.parse(i.testEndsAt) <= now.getTime();
  const monthAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return {
    waitingApproval: ideas.filter((i) => i.status === "new").length,
    approved: ideas.filter((i) => i.status === "approved").length,
    testing: testing.filter((i) => !over(i)).length,
    decide: testing.filter(over).length,
    decided30d: ideas.filter((i) => (i.status === "kept" || i.status === "dropped") && i.decidedAt !== null && Date.parse(i.decidedAt) >= monthAgo).length,
  };
}

/** Ideas' «Needs you»: an administrator approves new ideas and decides finished tests; nobody else is waited on. */
export function ideasNeedsOf(summary: IdeasSummary, viewer: { approve: boolean }): number {
  return viewer.approve ? summary.waitingApproval + summary.decide : 0;
}
