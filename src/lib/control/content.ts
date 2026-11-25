import { dayIn, weekDays } from "../content/calendar";
import type { PublishSettings } from "../content/publish/gates";
import { PUBLISH_CHANNELS, type ContentPiece, type ContentStatus } from "../content/types";

// The Content card of the Overview and the Content items of the Today list
// (docs/CONTROL.md «Content»). Pure, from what the content hub itself reads:
// the pieces, the schedules and the publishing switches (src/lib/content,
// docs/CONTENT.md). With a database the server builds it through the member's
// OWN connection (control/server.ts), so the content tables' read policies
// decide (administrators and specialists; sales reads none of it); the demo
// builds it from the board this browser keeps. Only titles, statuses, dates
// and the failure reason leave the content hub: never the words of a piece.
//
// "This week" is the content calendar's week: Sunday to Saturday, Central
// time (content/calendar.ts), so the numbers match the calendar's week view.

/** One piece, as the Overview and the Today list need it. */
export interface ContentRef {
  id: string;
  title: string;
  /** When it got where it is (the piece's last change). */
  since: string;
  owner: string | null;
  /** «Changes requested»: the note; «Failed»: the reason, in plain words. */
  note: string | null;
  /** «Failed»: the channel the post was for, when the schedule says. */
  channel: string | null;
}

export interface ContentSummary {
  /** Pieces on the board (archived left out). Zero: nothing to count yet. */
  pieces: number;
  review: ContentRef[];
  changes: ContentRef[];
  failed: ContentRef[];
  /** Posts the app will make this week (live schedules: scheduled, retrying, being sent). */
  scheduledThisWeek: number;
  /** Approved pieces with nothing scheduled yet. */
  approvedNotScheduled: number;
  /** Posts made this week, by a person (recorded) or by the app. */
  postedThisWeek: number;
  publishing: { enabled: boolean; channelsOn: number };
  /** The calendar week counted, Sunday to Saturday (YYYY-MM-DD). */
  week: { from: string; to: string };
}

/** What a schedule carries that the summary reads (content/server.ts ScheduleView, content/demo.ts DemoSchedule). */
export interface ScheduleLike {
  pieceId: string;
  channel: string;
  scheduledAt: string;
  status: string;
  lastError: string | null;
}

const LIVE = ["scheduled", "retry", "publishing"];

function ref(piece: ContentPiece, note: string | null, channel: string | null = null): ContentRef {
  return { id: piece.id, title: piece.title, since: piece.updatedAt || piece.createdAt, owner: piece.owner, note, channel };
}

export function contentSummary(pieces: readonly ContentPiece[], schedules: readonly ScheduleLike[], settings: PublishSettings, now: Date): ContentSummary {
  const days = weekDays(dayIn(now.toISOString()));
  const week = new Set(days);
  const board = pieces.filter((p) => p.status !== "archived");
  const of = (status: ContentStatus) => board.filter((p) => p.status === status);
  const live = schedules.filter((s) => LIVE.includes(s.status));
  const scheduledIds = new Set(live.map((s) => s.pieceId));
  const failed = of("failed").map((p) => {
    // The newest failed schedule of the piece names the channel; its reason backs up the piece's.
    const last = schedules.filter((s) => s.pieceId === p.id && s.status === "failed").sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
    return ref(p, p.failure ?? last?.lastError ?? null, last?.channel ?? null);
  });
  return {
    pieces: board.length,
    review: of("review").map((p) => ref(p, null)),
    changes: of("changes").map((p) => ref(p, p.changesNote)),
    failed,
    scheduledThisWeek: live.filter((s) => week.has(dayIn(s.scheduledAt))).length,
    approvedNotScheduled: of("approved").filter((p) => !scheduledIds.has(p.id)).length,
    postedThisWeek: board.reduce((n, p) => n + p.posts.filter((post) => week.has(dayIn(post.postedAt))).length, 0),
    publishing: { enabled: settings.enabled, channelsOn: PUBLISH_CHANNELS.filter((c) => settings.channels[c]).length },
    week: { from: days[0]!, to: days[6]! },
  };
}

/** The changes requested that are this editor's: the pieces they own, and the ones nobody owns. */
export function myChanges(summary: ContentSummary, handle: string | null): ContentRef[] {
  return summary.changes.filter((c) => c.owner === null || (handle !== null && c.owner === handle));
}

/** Who is looking, for the Content card and the Today list: approvers see what waits for approval, editors what was sent back. */
export interface ContentViewer {
  approve: boolean;
  edit: boolean;
  handle: string | null;
}

/**
 * The card's «Needs you»: for an approver, the pieces waiting for review and
 * the failed posts; for an editor, the changes requested of them and the
 * failed posts. The link opens the board on the column where most of it is.
 */
export function contentNeeds(summary: ContentSummary, viewer: ContentViewer): { count: number; href: string } {
  const failed = viewer.edit || viewer.approve ? summary.failed.length : 0;
  const first = viewer.approve ? summary.review.length : viewer.edit ? myChanges(summary, viewer.handle).length : 0;
  const column = viewer.approve ? "review" : "changes";
  const href = first === 0 && failed > 0 ? "/equipo/contenido?columna=failed" : viewer.approve || viewer.edit ? `/equipo/contenido?columna=${column}` : "/equipo/contenido";
  return { count: first + failed, href };
}
