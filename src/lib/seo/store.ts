"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured } from "../supabase/config";
import { can, deniedReason, type Capability } from "../staff/permissions";
import { useStaffLocale } from "../staff/i18n/StaffLocale";
import { useViewer } from "../staff/useStaff";
import { draftGuide, type DraftRequest, type DraftResult } from "./draft";
import { applyGuideAction, capabilityFor, newSeoId, type GuideAction } from "./guides";
import { demoPhrases, phraseProblem, PHRASE_PROBLEM_TEXT, targetOptions } from "./keywords";
import { seoNeeds } from "./needs";
import { defaultRange, demoSearchRows, grandTotal, inRange, totalsBy } from "./search";
import { starterGuides } from "./starters";
import type { Bilingual, Guide, GuideEvent, HealthReport, Lang, LocalTicks, SearchTotals, TrackedPhrase } from "./types";

// The SEO department's data for the screens. With a database:
// /api/staff/seo (and /health, /draft). In the demo: this browser keeps the
// guides (starting from the four unpublished starter drafts), the phrases,
// the local ticks and the last site-health run, and applies the same rules
// (guides.ts) with the same capability checks as the routes. The site-health
// check runs for real in the demo too: the server reads its own pages.
// Nothing in the demo is published: the public site never sees it.

export const SEO_KEY = "credalti.seo.v1";

export interface Connection {
  connected: boolean;
  mode: "service_account" | "oauth" | null;
  site: string | null;
}

interface Local {
  guides: Guide[];
  events: GuideEvent[];
  phrases: TrackedPhrase[];
  localTicks: LocalTicks;
  health: HealthReport | null;
}

export interface SeoState {
  guides: Guide[];
  events: GuideEvent[];
  phrases: TrackedPhrase[];
  localTicks: LocalTicks;
  health: HealthReport | null;
  connection: Connection;
  syncedAt: string | null;
  syncError: string | null;
}

export type ActResult = { ok: true; guide?: Guide } | { ok: false; message: Bilingual };

export interface SearchView {
  /** True in the demo: invented numbers, labelled sample. */
  sample: boolean;
  connection: Connection;
  range: { from: string; to: string };
  syncedAt: string | null;
  syncError: string | null;
  total: SearchTotals;
  byPage: SearchTotals[];
  byQuery: SearchTotals[];
}

const NOT_CONNECTED: Connection = { connected: false, mode: null, site: null };
const EMPTY: SeoState = { guides: [], events: [], phrases: [], localTicks: {}, health: null, connection: NOT_CONNECTED, syncedAt: null, syncError: null };
const msg = (en: string, es: string): Bilingual => ({ en, es });

function freshLocal(): Local {
  const now = new Date();
  return { guides: starterGuides(now), events: [], phrases: demoPhrases(now), localTicks: {}, health: null };
}

export function readLocal(): Local {
  try {
    const raw = window.localStorage.getItem(SEO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Local>;
      if (Array.isArray(parsed.guides)) return { ...freshLocal(), ...parsed } as Local;
    }
  } catch {
    // Unreadable: start again from the demo.
  }
  return freshLocal();
}

function writeLocal(next: Local): void {
  try {
    window.localStorage.setItem(SEO_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("credalti-seo-changed"));
  } catch {
    // Storage full or blocked: the demo forgets the change.
  }
}

export function resetDemoSeo(): void {
  try {
    window.localStorage.removeItem(SEO_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** The SEO count for the menu, for a role, from the demo's browser copy or the server's answer. */
export function needsFor(state: Pick<SeoState, "guides" | "health">, role: Parameters<typeof can>[0]): number {
  return seoNeeds({ guides: state.guides, health: state.health, canPublish: can(role, "seo.publish"), canEdit: can(role, "seo.edit") }).total;
}

export function useSeo(guideId?: string) {
  const live = isSupabaseConfigured();
  const { viewer, ready: viewerReady } = useViewer();
  const { locale } = useStaffLocale();
  const [state, setState] = useState<SeoState | null>(null);
  const role = viewer?.role ?? null;
  const handle = viewer?.handle ?? "demo";

  const reload = useCallback(async () => {
    if (!live) {
      if (!viewerReady) return;
      const local = readLocal();
      setState({ ...EMPTY, ...local, events: guideId ? local.events.filter((e) => e.guideId === guideId) : [] });
      return;
    }
    try {
      const res = await fetch(guideId ? `/api/staff/seo?id=${encodeURIComponent(guideId)}` : "/api/staff/seo", { cache: "no-store" });
      if (!res.ok) {
        setState(EMPTY);
        return;
      }
      const body = (await res.json()) as Partial<SeoState>;
      setState({ ...EMPTY, ...body } as SeoState);
    } catch {
      setState(EMPTY);
    }
  }, [live, guideId, viewerReady]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refuse = useCallback((capability: Capability): ActResult | null => (can(role, capability) ? null : { ok: false, message: { en: deniedReason(capability, "en"), es: deniedReason(capability, "es") } }), [role]);

  const post = useCallback(async (url: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { ok: false, body: { message: msg("No connection. Nothing changed.", "Sin conexión. No cambió nada.") } };
    }
  }, []);

  const failed = (body: Record<string, unknown>): ActResult => ({ ok: false, message: (body.message as Bilingual | undefined) ?? msg("It could not be saved.", "No se pudo guardar.") });

  const act = useCallback(
    async (action: GuideAction): Promise<ActResult> => {
      const denied = refuse(capabilityFor(action));
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/seo", action);
        await reload();
        return res.ok ? { ok: true, guide: res.body.guide as Guide } : failed(res.body);
      }
      const local = readLocal();
      if (action.action === "archive" && local.guides.find((g) => g.id === action.id)?.published) {
        const publisher = refuse("seo.publish");
        if (publisher) return publisher;
      }
      const result = applyGuideAction(local.guides, action, handle, new Date());
      if (!result.ok) return { ok: false, message: result.message };
      local.guides = result.created ? [result.guide, ...local.guides] : local.guides.map((g) => (g.id === result.guide.id ? result.guide : g));
      local.events = [...local.events, ...result.events];
      writeLocal(local);
      await reload();
      return { ok: true, guide: result.guide };
    },
    [handle, live, post, refuse, reload],
  );

  const addStarters = useCallback(async (): Promise<ActResult> => {
    const denied = refuse("seo.edit");
    if (denied) return denied;
    if (live) {
      const res = await post("/api/staff/seo", { action: "add_starters" });
      await reload();
      return res.ok ? { ok: true } : failed(res.body);
    }
    const local = readLocal();
    const have = new Set(local.guides.map((g) => g.id));
    local.guides = [...local.guides, ...starterGuides(new Date()).filter((g) => !have.has(g.id))];
    writeLocal(local);
    await reload();
    return { ok: true };
  }, [live, post, refuse, reload]);

  const addPhrase = useCallback(
    async (input: { phrase: string; lang: Lang; city: string | null; targetPath: string | null; note?: string }): Promise<ActResult> => {
      const denied = refuse("seo.edit");
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/seo", { action: "add_phrase", ...input });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const local = readLocal();
      const problem = phraseProblem(input, local.phrases, targetOptions(local.guides).map((t) => t.path));
      if (problem) return { ok: false, message: PHRASE_PROBLEM_TEXT[problem] };
      local.phrases = [...local.phrases, { id: newSeoId("kw"), phrase: input.phrase.replace(/\s+/g, " ").trim(), lang: input.lang, city: input.city, targetPath: input.targetPath, note: input.note ?? "", createdBy: handle, createdAt: new Date().toISOString() }];
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [handle, live, post, refuse, reload],
  );

  const removePhrase = useCallback(
    async (phraseId: string): Promise<ActResult> => {
      const denied = refuse("seo.edit");
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/seo", { action: "remove_phrase", phraseId });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const local = readLocal();
      local.phrases = local.phrases.filter((p) => p.id !== phraseId);
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [live, post, refuse, reload],
  );

  const tickLocal = useCallback(
    async (key: string, done: boolean): Promise<ActResult> => {
      const denied = refuse("seo.edit");
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/seo", { action: "local_tick", key, done });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const local = readLocal();
      local.localTicks = { ...local.localTicks, [key]: { done, by: handle, at: new Date().toISOString() } };
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [handle, live, post, refuse, reload],
  );

  /** Run the site-health check now (the server reads its own pages, in the demo too). */
  const runHealth = useCallback(async (): Promise<ActResult> => {
    const denied = refuse("seo.view");
    if (denied) return denied;
    const res = await post("/api/staff/seo/health", {});
    if (!res.ok) return failed(res.body);
    const report = res.body.report as HealthReport;
    if (!live) {
      const local = readLocal();
      local.health = report;
      writeLocal(local);
    }
    await reload();
    return { ok: true };
  }, [live, post, refuse, reload]);

  /** Alti's draft: the server's (Claude with a key, else the outline) or, in the demo, the outline here. */
  const draft = useCallback(
    async (request: DraftRequest): Promise<DraftResult | { error: Bilingual }> => {
      const denied = refuse("seo.edit");
      if (denied && !denied.ok) return { error: denied.message };
      if (!live) return draftGuide(request, null);
      const res = await post("/api/staff/seo/draft", request);
      return res.ok ? (res.body as unknown as DraftResult) : { error: (res.body.message as Bilingual | undefined) ?? msg("Alti could not write right now.", "Alti no pudo escribir ahora.") };
    },
    [live, post, refuse],
  );

  /** Search Console's totals for the dates: the server's (only when connected) or, in the demo, sample numbers. */
  const search = useCallback(
    async (range: { from: string; to: string }): Promise<SearchView | null> => {
      if (!live) {
        const rows = inRange(demoSearchRows(new Date()), range);
        return { sample: true, connection: NOT_CONNECTED, range, syncedAt: null, syncError: null, total: grandTotal(rows), byPage: totalsBy(rows, "page"), byQuery: totalsBy(rows, "query") };
      }
      try {
        const res = await fetch(`/api/staff/seo?view=search&from=${range.from}&to=${range.to}`, { cache: "no-store" });
        if (!res.ok) return null;
        return { sample: false, ...((await res.json()) as Omit<SearchView, "sample">) };
      } catch {
        return null;
      }
    },
    [live],
  );

  const value = state ?? EMPTY;
  return useMemo(
    () => ({ live, ready: state !== null, viewer, role, locale, handle, ...value, act, addStarters, addPhrase, removePhrase, tickLocal, runHealth, draft, search, reload, defaultRange }),
    [live, state, viewer, role, locale, handle, value, act, addStarters, addPhrase, removePhrase, tickLocal, runHealth, draft, search, reload],
  );
}
