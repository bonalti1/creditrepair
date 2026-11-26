"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bilingual } from "../content/types";
import { isSupabaseConfigured } from "../supabase/config";
import { can, deniedReason, type Viewer } from "../staff/permissions";
import { checkAdDraft, draftAdCopy, type AdCopyOutput, type AdCopyRequest, type AdCopyResult, type AdFormat, type AdGoal, type AdLanguage } from "./copy";
import { buildDemoAds } from "./demo";
import { adsSummary, buildReport, spendByMonth, type AdsSummary } from "./report";
import { META_ADS_ENV, type AdBrief, type AdsPayload } from "./types";
import { adWindow } from "./window";

// The Ads Manager's data for the screens. With a database: /api/staff/ads
// (read through the member's own connection). In the demo: the SAMPLE ad
// account (demo.ts), built in this browser, with the same rules and the same
// capability checks as the route; the briefs the demo makes stay in this
// browser. Nothing is ever sent to Meta, in either.

export interface AdsSelection {
  preset: 7 | 14 | 30 | 90 | "custom";
  since?: string;
  until?: string;
}

const BRIEFS_KEY = "credalti.demo.ads.briefs.v1";
const msg = (en: string, es: string): Bilingual => ({ en, es });

function readDemoBriefs(): AdBrief[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(BRIEFS_KEY) ?? "[]") as AdBrief[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function resetDemoAds(): void {
  try {
    window.localStorage.removeItem(BRIEFS_KEY);
  } catch {
    // Nothing kept.
  }
}

/** The demo's payload for a window: the sample account, labelled as sample. */
export function demoAdsPayload(selection: AdsSelection, now: Date = new Date()): AdsPayload {
  const { snapshot, leads } = buildDemoAds(now);
  const window = adWindow(selection, now, snapshot.account!.timeZone);
  const monthly = [...spendByMonth(snapshot.days).entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, spendCents]) => ({ month, spendCents }));
  return { window, snapshot, leads, monthly, meta: { configured: false, missing: [...META_ADS_ENV] }, briefs: typeof globalThis.localStorage !== "undefined" ? readDemoBriefs() : [], sample: true };
}

/** The last 7 days in short, in the demo (the Overview, the strip and the red circle read it). */
export function demoAdsSummary(now: Date = new Date()): AdsSummary {
  const payload = demoAdsPayload({ preset: 7 }, now);
  return adsSummary(buildReport(payload.snapshot, payload.leads, payload.window), { connected: false, sample: true, syncedAt: payload.snapshot.syncedAt });
}

/** The 7-day summary for the member: the demo's, or the server's (null when their role may not see it or it could not be read). */
export async function fetchAdsSummary(viewer: Viewer | null): Promise<AdsSummary | null> {
  if (!can(viewer?.role, "ads.view")) return null;
  if (!isSupabaseConfigured()) return demoAdsSummary();
  try {
    const res = await fetch("/api/staff/ads?summary=1", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { summary: AdsSummary }).summary;
  } catch {
    return null;
  }
}

/** Meta's spend per month (the books' reconciliation), for a member who may see the ads; null otherwise or when it could not be read. */
export async function fetchAdsMonthly(viewer: Viewer | null): Promise<{ monthly: AdsPayload["monthly"]; sample: boolean } | null> {
  if (!can(viewer?.role, "ads.view")) return null;
  if (!isSupabaseConfigured()) return { monthly: demoAdsPayload({ preset: 7 }).monthly, sample: true };
  try {
    const res = await fetch("/api/staff/ads?monthly=1", { cache: "no-store" });
    if (!res.ok) return null;
    return { monthly: ((await res.json()) as { monthly: AdsPayload["monthly"] }).monthly, sample: false };
  } catch {
    return null;
  }
}

/** The video briefs, for the content team (ads.draft) who may not see the numbers. */
export async function fetchAdBriefs(viewer: Viewer | null): Promise<AdBrief[]> {
  if (!can(viewer?.role, "ads.draft")) return [];
  if (!isSupabaseConfigured()) return readDemoBriefs();
  try {
    const res = await fetch("/api/staff/ads?briefs=1", { cache: "no-store" });
    return res.ok ? ((await res.json()) as { briefs: AdBrief[] }).briefs : [];
  } catch {
    return [];
  }
}

export type AdsResult<T> = { ok: true; value: T } | { ok: false; message: Bilingual };

export function useAds(viewer: Viewer | null, selection: AdsSelection) {
  const live = isSupabaseConfigured();
  const role = viewer?.role ?? null;
  const seesNumbers = can(role, "ads.view");
  const [payload, setPayload] = useState<AdsPayload | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);
  const [loading, setLoading] = useState(true);
  const key = `${selection.preset}:${selection.since ?? ""}:${selection.until ?? ""}`;

  const reload = useCallback(async () => {
    if (!seesNumbers) {
      setPayload(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (!live) {
      setPayload(demoAdsPayload(selection));
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const q = new URLSearchParams({ preset: String(selection.preset) });
      if (selection.preset === "custom" && selection.since && selection.until) {
        q.set("since", selection.since);
        q.set("until", selection.until);
      }
      const res = await fetch(`/api/staff/ads?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setPayload((await res.json()) as AdsPayload);
      setError(null);
    } catch {
      setError(msg("The ads could not be read right now. Try again in a minute.", "No se pudieron leer los anuncios ahora. Inténtalo en un minuto."));
    } finally {
      setLoading(false);
    }
    // The selection is read through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, seesNumbers, key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refuse = useCallback(
    (capability: "ads.view" | "ads.draft"): AdsResult<never> | null => (can(role, capability) ? null : { ok: false, message: { en: deniedReason(capability, "en"), es: deniedReason(capability, "es") } }),
    [role],
  );

  const post = useCallback(async (body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> => {
    try {
      const res = await fetch("/api/staff/ads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  }, []);

  /** Alti's ad copy: the server's (Claude with a key, else templates) or, in the demo, the templates here. */
  const draft = useCallback(
    async (request: AdCopyRequest): Promise<AdsResult<AdCopyResult>> => {
      const denied = refuse("ads.draft");
      if (denied) return denied;
      if (!live) return { ok: true, value: await draftAdCopy(request, null) };
      const res = await post({ action: "draft", ...request });
      return res.ok ? { ok: true, value: res.body as unknown as AdCopyResult } : { ok: false, message: msg("Alti could not write right now. Try again in a minute.", "Alti no pudo escribir ahora. Inténtalo en un minuto.") };
    },
    [live, post, refuse],
  );

  /** A video brief for Video Studio, from a draft that passes every check. */
  const brief = useCallback(
    async (input: { title: string; copy: AdCopyOutput; format: AdFormat; goal: AdGoal; language: AdLanguage; sourceAdId?: string | null }): Promise<AdsResult<{ id: string }>> => {
      const denied = refuse("ads.draft");
      if (denied) return denied;
      if (checkAdDraft(input.copy, input.language).some((i) => i.severity === "block")) {
        return { ok: false, message: msg("Fix what the check marks before sending it to Video Studio.", "Corrige lo que marca la revisión antes de mandarlo a Video Studio.") };
      }
      if (!live) {
        const made: AdBrief = { id: `demo-brief-${Date.now().toString(36)}`, createdAt: new Date().toISOString(), by: viewer?.handle ?? "demo", title: input.title.slice(0, 120), sourceAdId: input.sourceAdId ?? null, format: input.format, goal: input.goal, language: input.language, status: "new" };
        try {
          window.localStorage.setItem(BRIEFS_KEY, JSON.stringify([made, ...readDemoBriefs()].slice(0, 50)));
        } catch {
          // This visit only.
        }
        setPayload((p) => (p ? { ...p, briefs: [made, ...p.briefs] } : p));
        return { ok: true, value: { id: made.id } };
      }
      const res = await post({ action: "brief", ...input, sourceAdId: input.sourceAdId ?? null });
      if (!res.ok) return { ok: false, message: (res.body.message as Bilingual | undefined) ?? msg("The brief could not be saved.", "No se pudo guardar el brief.") };
      await reload();
      return { ok: true, value: { id: String((res.body.brief as { id?: string } | undefined)?.id ?? "") } };
    },
    [live, post, refuse, reload, viewer],
  );

  /** «Sync now»: the cron's read of Meta, at once. In the demo there is nothing to read. */
  const sync = useCallback(async (): Promise<AdsResult<{ rows: number }>> => {
    const denied = refuse("ads.view");
    if (denied) return denied;
    if (!live) return { ok: false, message: msg("The demo has no Meta account to read: these are sample numbers.", "La demo no tiene una cuenta de Meta que leer: son números de muestra.") };
    const res = await post({ action: "sync" });
    await reload();
    if (res.ok && res.body.ok === true) return { ok: true, value: { rows: Number(res.body.rows ?? 0) } };
    if (Array.isArray(res.body.missing)) return { ok: false, message: msg(`Meta is not connected: ${res.body.missing.join(", ")} missing on the server.`, `Meta no está conectada: faltan ${res.body.missing.join(", ")} en el servidor.`) };
    if (res.status === 429) return { ok: false, message: msg("Synced several times already this hour. The automatic sync keeps it current.", "Ya se sincronizó varias veces esta hora. La sincronización automática lo mantiene al día.") };
    return { ok: false, message: msg(`The sync did not finish: ${String(res.body.error ?? "no answer")}`, `La sincronización no terminó: ${String(res.body.error ?? "sin respuesta")}`) };
  }, [live, post, refuse, reload]);

  /** A video ad's file, read from Meta when a person taps play. */
  const video = useCallback(
    async (adId: string): Promise<{ src: string | null; poster: string | null; reason: string | null }> => {
      if (!live) return { src: null, poster: null, reason: "sample" };
      try {
        const res = await fetch(`/api/staff/ads?video=${encodeURIComponent(adId)}`, { cache: "no-store" });
        return res.ok ? ((await res.json()) as { src: string | null; poster: string | null; reason: string | null }) : { src: null, poster: null, reason: "meta_error" };
      } catch {
        return { src: null, poster: null, reason: "meta_error" };
      }
    },
    [live],
  );

  return useMemo(
    () => ({ live, seesNumbers, payload, error, loading, reload, draft, brief, sync, video }),
    [live, seesNumbers, payload, error, loading, reload, draft, brief, sync, video],
  );
}
