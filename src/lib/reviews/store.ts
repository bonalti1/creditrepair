"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "../supabase/config";
import {
  DEFAULT_REVIEW_SETTINGS,
  EMPTY_PLATFORMS,
  livePlatforms,
  platformUrlProblem,
  type ReviewPlatform,
  type ReviewPlatformKey,
  type ReviewRequestRecord,
  type ReviewSettings,
} from "./reviews";

// The review settings for the screens. With a database: /api/reviews (the
// public links) and /api/staff/reviews (the team's page). In the demo: this
// browser keeps them, starting from example links on reserved / made-up
// addresses, so nothing points at a real business.

export const REVIEWS_KEY = "bonalti.reviews.v1";

export const DEMO_PLATFORMS: ReviewPlatform[] = [
  { key: "google", url: "https://g.page/r/credalti-demo/review", enabled: true, rating: 4.8, reviewCount: 212, ratingUpdatedAt: "2026-11-20T15:00:00.000Z", ratingUpdatedBy: "carmen", },
  { key: "trustpilot", url: "https://www.trustpilot.com/evaluate/credalti.example", enabled: true, rating: 4.6, reviewCount: 87, ratingUpdatedAt: "2026-11-20T15:00:00.000Z", ratingUpdatedBy: "carmen" },
  { key: "bbb", url: "https://www.bbb.org/us/tx/houston/profile/credit-services/credalti-demo", enabled: true, rating: null, reviewCount: null, ratingUpdatedAt: null, ratingUpdatedBy: null },
];

export const DEMO_REQUESTS: ReviewRequestRecord[] = [
  { userId: "c13", milestone: "first_results", channel: "whatsapp_or_email", at: "2026-11-21T17:00:00.000Z" },
  { userId: "c14", milestone: "first_results", channel: "whatsapp_or_email", at: "2026-11-12T17:00:00.000Z" },
  { userId: "c10", milestone: "pulse_answered", channel: "in_app", at: "2026-11-18T17:00:00.000Z" },
  { userId: "c15", milestone: "pulse_answered", channel: "in_app", at: "2026-11-19T17:00:00.000Z" },
  { userId: "c16", milestone: "referral_signed", channel: "whatsapp_or_email", at: "2026-11-15T17:00:00.000Z" },
  { userId: "c04", milestone: "program_finished", channel: "whatsapp_or_email", at: "2026-10-30T17:00:00.000Z" },
];

interface Local {
  settings: ReviewSettings;
  platforms: ReviewPlatform[];
}

function readLocal(): Local {
  try {
    const raw = window.localStorage.getItem(REVIEWS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Local>) : null;
    return { settings: { ...DEFAULT_REVIEW_SETTINGS, requestsEnabled: true, ...(parsed?.settings ?? {}) }, platforms: parsed?.platforms ?? DEMO_PLATFORMS };
  } catch {
    return { settings: { ...DEFAULT_REVIEW_SETTINGS, requestsEnabled: true }, platforms: DEMO_PLATFORMS };
  }
}

function writeLocal(next: Local): void {
  try {
    window.localStorage.setItem(REVIEWS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the demo forgets the change.
  }
}

/** The public links, the same for everyone. */
export function useReviewLinks(): { ready: boolean; platforms: ReviewPlatform[] } {
  const live = isSupabaseConfigured();
  const [platforms, setPlatforms] = useState<ReviewPlatform[] | null>(null);
  useEffect(() => {
    if (!live) {
      setPlatforms(livePlatforms(readLocal().platforms));
      return;
    }
    let cancelled = false;
    fetch("/api/reviews", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ platforms?: ReviewPlatform[] }>) : null))
      .then((body) => !cancelled && setPlatforms(livePlatforms(body?.platforms ?? [])))
      .catch(() => !cancelled && setPlatforms([]));
    return () => {
      cancelled = true;
    };
  }, [live]);
  return { ready: platforms !== null, platforms: platforms ?? [] };
}

export interface ReviewsAdminView {
  settings: ReviewSettings;
  platforms: ReviewPlatform[];
  requests: ReviewRequestRecord[];
}

export type SaveResult = { ok: true } | { ok: false; code: string };

/** The team's page: settings, links, ratings and the asks on record. */
export function useReviewsAdmin() {
  const live = isSupabaseConfigured();
  const [view, setView] = useState<ReviewsAdminView | null>(null);

  const reload = useCallback(async () => {
    if (!live) {
      const local = readLocal();
      setView({ settings: local.settings, platforms: local.platforms, requests: DEMO_REQUESTS });
      return;
    }
    try {
      const res = await fetch("/api/staff/reviews", { cache: "no-store" });
      setView(res.ok ? ((await res.json()) as ReviewsAdminView) : { settings: DEFAULT_REVIEW_SETTINGS, platforms: EMPTY_PLATFORMS, requests: [] });
    } catch {
      setView({ settings: DEFAULT_REVIEW_SETTINGS, platforms: EMPTY_PLATFORMS, requests: [] });
    }
  }, [live]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<SaveResult> => {
      if (!live) {
        const local = readLocal();
        if (body.action === "settings") {
          const patch = body as { requestsEnabled?: boolean; milestones?: Record<string, boolean> };
          local.settings = {
            ...local.settings,
            ...(patch.requestsEnabled === undefined ? {} : { requestsEnabled: patch.requestsEnabled }),
            milestones: { ...local.settings.milestones, ...(patch.milestones ?? {}) },
            updatedAt: new Date().toISOString(),
            updatedBy: "demo",
          };
        } else if (body.action === "platform") {
          const p = body as { key: ReviewPlatformKey; url?: string | null; enabled?: boolean; rating?: number | null; reviewCount?: number | null };
          if (p.url && platformUrlProblem(p.key, p.url)) return { ok: false, code: platformUrlProblem(p.key, p.url)! };
          local.platforms = local.platforms.map((x) =>
            x.key !== p.key
              ? x
              : {
                  ...x,
                  ...(p.url !== undefined ? { url: p.url || null, enabled: p.url ? x.enabled : false } : {}),
                  ...(p.enabled !== undefined ? { enabled: p.enabled && Boolean(x.url || p.url) } : {}),
                  ...(p.rating !== undefined || p.reviewCount !== undefined
                    ? { rating: p.rating ?? x.rating, reviewCount: p.reviewCount ?? x.reviewCount, ratingUpdatedAt: new Date().toISOString(), ratingUpdatedBy: "demo" }
                    : {}),
                },
          );
        }
        writeLocal(local);
        await reload();
        return { ok: true };
      }
      try {
        const res = await fetch("/api/staff/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const out = (await res.json().catch(() => ({}))) as { code?: string };
        await reload();
        return res.ok ? { ok: true } : { ok: false, code: out.code ?? "error" };
      } catch {
        return { ok: false, code: "network" };
      }
    },
    [live, reload],
  );

  return { live, ready: view !== null, view: view ?? { settings: DEFAULT_REVIEW_SETTINGS, platforms: EMPTY_PLATFORMS, requests: [] }, post, reload };
}
