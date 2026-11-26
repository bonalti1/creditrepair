"use client";

import { useEffect } from "react";
import { publishBadges } from "../staff/navBadges";
import type { Capability } from "../staff/permissions";
import { fetchNeeds, LIVE_CHANGED_EVENT } from "./data";

// The live funnel's part of the Leads group's red circle (navBadges.ts): the
// report reviews waiting for a person (ready with no video yet, or signed and
// not imported). Read on every page change, after every change on the review
// screen and every minute, for a member with reviews.video. Unknown: no number.

const REFRESH_MS = 60_000;

export function useLiveBadge(viewer: { handle: string } | null, can: (c: Capability) => boolean, pathname: string): void {
  const view = Boolean(viewer) && can("reviews.video");
  useEffect(() => {
    if (!view) {
      publishBadges("live", {});
      return;
    }
    let live = true;
    const run = async () => {
      if (document.hidden) return;
      const count = await fetchNeeds();
      if (live) publishBadges("live", count === null ? {} : { leads: count });
    };
    void run();
    const timer = window.setInterval(run, REFRESH_MS);
    document.addEventListener("visibilitychange", run);
    window.addEventListener(LIVE_CHANGED_EVENT, run);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener(LIVE_CHANGED_EVENT, run);
    };
  }, [view, pathname]);
}
