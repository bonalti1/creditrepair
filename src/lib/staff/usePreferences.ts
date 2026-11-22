"use client";

import { useCallback, useEffect, useState } from "react";
import { isDemoMode } from "../supabase/config";
import type { Viewer } from "./permissions";
import { applyPreferencesUpdate, DEFAULT_PREFERENCES, normalizePreferences, type PreferencesUpdate, type StaffPreferences } from "./preferences";

// The signed-in member's own preferences. With a database: /api/staff/preferences
// (their row only). In the demo: this browser, per member of the demo team.

const KEY = "bonalti.staffDemo.preferences.v1";

function readDemo(): Record<string, StaffPreferences> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, StaffPreferences>;
  } catch {
    return {};
  }
}

/** One demo member's preferences, as stored in this browser. */
export function readDemoPreferences(handle: string): StaffPreferences {
  return normalizePreferences(readDemo()[handle]);
}

/** Change one demo member's preferences in this browser; returns them as saved. */
export function writeDemoPreferences(handle: string, change: PreferencesUpdate): StaffPreferences {
  const all = readDemo();
  const next = applyPreferencesUpdate(normalizePreferences(all[handle]), change, new Date());
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...all, [handle]: next }));
  } catch {
    // This visit only.
  }
  return next;
}

export function resetDemoPreferences(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function usePreferences(viewer: Viewer | null) {
  const demo = isDemoMode();
  const [prefs, setPrefs] = useState<StaffPreferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const handle = viewer?.handle ?? null;

  useEffect(() => {
    if (!handle) return;
    if (demo) {
      setPrefs(normalizePreferences(readDemo()[handle]));
      setReady(true);
      return;
    }
    let cancelled = false;
    fetch("/api/staff/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ preferences?: StaffPreferences }>) : null))
      .then((data) => {
        if (!cancelled && data?.preferences) setPrefs(normalizePreferences(data.preferences));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [demo, handle]);

  const update = useCallback(
    async (change: PreferencesUpdate): Promise<boolean> => {
      if (!handle) return false;
      if (demo) {
        setPrefs(writeDemoPreferences(handle, change));
        return true;
      }
      try {
        const res = await fetch("/api/staff/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
        const data = (await res.json().catch(() => ({}))) as { preferences?: StaffPreferences };
        if (res.ok && data.preferences) setPrefs(normalizePreferences(data.preferences));
        return res.ok;
      } catch {
        return false;
      }
    },
    [demo, handle],
  );

  return { prefs, ready, update, demo };
}
