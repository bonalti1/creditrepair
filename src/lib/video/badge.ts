"use client";

import { useEffect } from "react";
import { publishBadges } from "../staff/navBadges";
import type { Capability } from "../staff/permissions";
import { isSupabaseConfigured } from "../supabase/config";
import { videoNeeds } from "./rules";
import { readDemoVideoBoard, VIDEO_CHANGED_EVENT } from "./store";
import type { VideoProject } from "./types";

// The Video Studio's part of the Content group's red circle (navBadges.ts):
// for an approver, the videos waiting for approval; for an editor, the
// changes asked of them and the approved videos not yet handed to Content.
// Read on every page change, after every change to a video and every minute
// (GET /api/staff/video?needs=1, content.view: statuses only). Unknown: no number.

const REFRESH_MS = 60_000;

export function useVideoBadge(viewer: { handle: string } | null, can: (c: Capability) => boolean, pathname: string): void {
  const view = Boolean(viewer) && can("content.view");
  const approve = can("content.approve");
  const edit = can("content.edit");
  const handle = viewer?.handle ?? null;
  useEffect(() => {
    if (!view) {
      publishBadges("video", {});
      return;
    }
    let live = true;
    const run = async () => {
      if (document.hidden) return;
      let projects: Array<Pick<VideoProject, "status" | "owner" | "changesNote">> | null = null;
      if (!isSupabaseConfigured()) projects = readDemoVideoBoard();
      else {
        try {
          const res = await fetch("/api/staff/video?needs=1", { cache: "no-store" });
          projects = res.ok ? (((await res.json()) as { projects?: typeof projects }).projects ?? null) : null;
        } catch {
          projects = null;
        }
      }
      if (!live) return;
      publishBadges("video", projects ? { content: videoNeeds(projects as VideoProject[], { approve, edit, handle }).count } : {});
    };
    void run();
    const timer = window.setInterval(run, REFRESH_MS);
    document.addEventListener("visibilitychange", run);
    window.addEventListener(VIDEO_CHANGED_EVENT, run);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener(VIDEO_CHANGED_EVENT, run);
    };
  }, [view, approve, edit, handle, pathname]);
}
