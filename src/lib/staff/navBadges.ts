"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { NavGroupKey } from "./nav";

// The red circles on the console's menu (ALTO Control's badges): how many
// things need the member in each group of the menu. The numbers are the
// Overview's own «Needs you» counts (src/lib/control/overview.ts), never a
// count of their own:
//
//   - the shell works out My day, Leads, Fulfillment and Money from the same
//     clients, work queue and lead list the Overview reads (StaffShell's
//     BadgeProbe, through the member's own connection);
//   - the Overview page reports the ones only it reads (Content, the books on
//     Money, Partners) when it opens;
//   - the Ads Manager's count (ads marked "Turn off" that are still spending,
//     src/lib/ads/report.ts) is ADDED to Marketing's circle, on any page, for a
//     member who may see the ads (BadgeProbe). It is its own source, so the
//     Overview's Content number never counts it twice.
//   - the Video Studio's own «Needs you» (videos waiting for approval, changes
//     asked of an editor, approved videos not yet handed to Content:
//     video/rules.ts videoNeeds) is ADDED to the Content group's number, from
//     the shell's probe on any page.
//
// A group with no number known shows no circle: "no data" is never a 0 or a
// guess. «✓ Clear» hides a group's circle for this member in this browser
// until its number goes up (something new came in), like ALTO's. Nothing
// here changes a record; it is a view.

export type BadgeCounts = Partial<Record<NavGroupKey, number>>;

/**
 * Who reported a number: the shell's own probe, the Overview, or a department
 * that counts its own work (SEO: src/lib/seo/needs.ts; the Ads Manager: ads to turn off; the Video Studio: lib/video/badge.ts). The probe and the
 * Overview replace each other's number for a group; a department's number is
 * ADDED to its group (the Overview does not count it), so the circle covers it.
 */
type Source = "probe" | "overview" | "seo" | "ads" | "video";
const ADDITIVE: readonly Source[] = ["seo", "ads", "video"];

const sources: Record<Source, BadgeCounts> = { probe: {}, overview: {}, seo: {}, ads: {}, video: {} };
let merged: BadgeCounts = {};
const listeners = new Set<() => void>();

function recompute() {
  const next: BadgeCounts = {};
  // The Overview's numbers are the complete ones (it reads the books and the server's extras too); the probe fills the rest.
  for (const [key, value] of Object.entries(sources.probe) as Array<[NavGroupKey, number]>) next[key] = value;
  for (const [key, value] of Object.entries(sources.overview) as Array<[NavGroupKey, number]>) next[key] = value;
  for (const source of ADDITIVE) for (const [key, value] of Object.entries(sources[source]) as Array<[NavGroupKey, number]>) next[key] = (next[key] ?? 0) + value;
  merged = next;
  for (const listener of listeners) listener();
}

/** Report the counts a source knows (a null or missing group: not known, no circle from this source). */
export function publishBadges(source: Source, counts: Partial<Record<NavGroupKey, number | null>>): void {
  const clean: BadgeCounts = {};
  for (const [key, value] of Object.entries(counts) as Array<[NavGroupKey, number | null]>) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) clean[key] = value;
  }
  const before = sources[source];
  const same = Object.keys(clean).length === Object.keys(before).length && (Object.keys(clean) as NavGroupKey[]).every((k) => before[k] === clean[k]);
  if (same) return;
  sources[source] = clean;
  recompute();
}

/** The merged counts now (for tests and the probe). */
export function badgeSnapshot(): BadgeCounts {
  return merged;
}

/** The same numbers (the Video Studio's tests use this name). */
export const currentBadges = badgeSnapshot;

/** Forget every number (the demo's "view as" switched, so the counts were someone else's). */
export function resetBadges(): void {
  sources.probe = {};
  sources.overview = {};
  for (const s of ADDITIVE) sources[s] = {};
  recompute();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: BadgeCounts = {};

/** What «✓ Clear» hid: the count of each group when it was cleared, per member, in this browser. */
const CLEARED_KEY = (handle: string) => `credalti.console.cleared.${handle}`;

function readCleared(handle: string): BadgeCounts {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CLEARED_KEY(handle)) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as BadgeCounts) : {};
  } catch {
    return {};
  }
}

function writeCleared(handle: string, cleared: BadgeCounts) {
  try {
    window.localStorage.setItem(CLEARED_KEY(handle), JSON.stringify(cleared));
  } catch {
    // Storage unavailable: cleared for this visit only.
  }
}

/**
 * The circles to show: each group's count, unless the member cleared it and
 * nothing new came in since. `clear(key)` hides one group, `clear("all")` all.
 */
export function useNavBadges(handle: string | null) {
  const counts = useSyncExternalStore(subscribe, () => merged, () => EMPTY);
  const [cleared, setCleared] = useState<BadgeCounts>({});
  const who = handle ?? "demo";

  useEffect(() => setCleared(readCleared(who)), [who]);

  // A number that went down lowers the mark, so the next new thing shows again.
  useEffect(() => {
    let changed = false;
    const next = { ...cleared };
    for (const [key, mark] of Object.entries(cleared) as Array<[NavGroupKey, number]>) {
      const now = counts[key];
      if (now !== undefined && now < mark) {
        next[key] = now;
        changed = true;
      }
    }
    if (changed) {
      setCleared(next);
      writeCleared(who, next);
    }
  }, [counts, cleared, who]);

  const shown = (key: NavGroupKey): number => {
    const n = counts[key];
    if (n === undefined || n <= 0) return 0;
    const mark = cleared[key];
    return mark !== undefined && n <= mark ? 0 : n;
  };

  const clear = (key: NavGroupKey | "all") => {
    const next = { ...cleared };
    for (const [k, n] of Object.entries(counts) as Array<[NavGroupKey, number]>) if (key === "all" || k === key) next[k] = n;
    setCleared(next);
    writeCleared(who, next);
  };

  return { shown, clear };
}
