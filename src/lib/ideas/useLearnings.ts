"use client";

import { useEffect, useState } from "react";
import type { LearningEntry } from "../staff/altiHelp";
import { can } from "../staff/permissions";
import { useStaffLocale } from "../staff/i18n/StaffLocale";
import { useViewer } from "../staff/useStaff";
import { getIdeasData } from "./data";
import { searchLearnings } from "./rules";
import { metricLabel } from "./signals";

// The learnings library (finished tests, src/lib/ideas) for «Ask Alti»'s
// playbook search: what the team wrote when it kept or dropped a test, so a
// search for "payment reminder" finds what was already tried. Read once, only
// when the member searches, through the same data layer as the Ideas screen
// (the database's read policy, or the demo's sample board). Read only.

export function useLearningEntries(enabled: boolean): readonly LearningEntry[] {
  const { viewer } = useViewer();
  const { locale } = useStaffLocale();
  const [entries, setEntries] = useState<readonly LearningEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const allowed = can(viewer?.role, "ideas.add");

  useEffect(() => {
    if (!enabled || loaded || !allowed) return;
    let alive = true;
    setLoaded(true);
    getIdeasData(viewer)
      .load()
      .then((board) => {
        if (!alive) return;
        setEntries(
          searchLearnings(board.ideas, "").map((idea) => ({
            id: idea.id,
            title: idea.title,
            lines: [idea.resultNote ?? "", metricLabel(idea.metric, locale)].filter(Boolean),
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, loaded, allowed, viewer, locale]);

  return entries;
}
