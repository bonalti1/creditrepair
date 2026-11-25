"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured } from "../supabase/config";
import { can, deniedReason } from "../staff/permissions";
import { useStaffLocale } from "../staff/i18n/StaffLocale";
import { useViewer } from "../staff/useStaff";
import { writeWithAlti, type AssistRequest, type AssistResult } from "./assist";
import { checkAsset, assetLinkProblem, ASSET_LIMITS, ASSET_PROBLEM_TEXT } from "./assets";
import { buildDemoContent, type DemoContent, type DemoSchedule } from "./demo";
import { pieceGates, DEFAULT_PUBLISH_SETTINGS, GATE_TEXT, type PublishSettings } from "./publish/gates";
import type { ConnectionView } from "./publish/types";
import { resultEntryProblem, type LeadTouch } from "./results";
import { ACTION_CAPABILITY, applyContentAction, newContentId, type ContentAction } from "./rules";
import { partnerMaterialOf } from "./share";
import type { Bilingual, Channel, ContentEvent, ContentPiece, ContentResult, PublishChannel, ResultMetric } from "./types";

// The content hub's data for the screens. With a database: /api/staff/content
// (and /assets, /assist). In the demo: this browser keeps the board, starting
// from the invented pieces in demo.ts, and applies the same rules (rules.ts)
// with the same capability checks as the routes, so the demo behaves like
// the real thing. Nothing in the demo is posted or sent anywhere.

export const CONTENT_KEY = "bonalti.content.v1";

export type ScheduleView = DemoSchedule;

export interface ContentState {
  scope: "team" | "partner";
  pieces: ContentPiece[];
  results: ContentResult[];
  schedules: ScheduleView[];
  events: ContentEvent[];
  settings: PublishSettings;
  connections: ConnectionView[] | null;
  leads: LeadTouch[];
  /** Short-lived links to view files, by asset id (database only). */
  fileUrls: Record<string, string>;
}

export type ActResult = { ok: true; piece?: ContentPiece } | { ok: false; message: Bilingual };

const EMPTY: ContentState = { scope: "team", pieces: [], results: [], schedules: [], events: [], settings: DEFAULT_PUBLISH_SETTINGS, connections: null, leads: [], fileUrls: {} };

const DEMO_CONNECTIONS: ConnectionView[] = (["meta", "tiktok", "youtube"] as const).map((provider) => ({
  provider,
  configured: false,
  connected: false,
  status: "not_configured",
  account: null,
  scopes: [],
  missingScopes: [],
  expiresAt: null,
  connectedAt: null,
  connectedBy: null,
  lastError: null,
}));

interface Local extends DemoContent {
  settings: PublishSettings;
}

function readLocal(): Local {
  try {
    const raw = window.localStorage.getItem(CONTENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Local;
      if (Array.isArray(parsed.pieces)) return { ...parsed, settings: parsed.settings ?? DEFAULT_PUBLISH_SETTINGS };
    }
  } catch {
    // Unreadable: start again from the demo.
  }
  return { ...buildDemoContent(new Date()), settings: DEFAULT_PUBLISH_SETTINGS };
}

function writeLocal(next: Local): void {
  try {
    window.localStorage.setItem(CONTENT_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the demo forgets the change.
  }
}

/** The demo's board as this browser keeps it (pieces, schedules, switches), for the Overview (control/data.ts). Demo only. */
export function readDemoContentBoard(): Pick<Local, "pieces" | "schedules" | "settings"> {
  const { pieces, schedules, settings } = readLocal();
  return { pieces, schedules, settings };
}

export function resetDemoContent(): void {
  try {
    window.localStorage.removeItem(CONTENT_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Files picked in the demo, for this visit only (never uploaded anywhere). */
const demoFiles = new Map<string, string>();

const msg = (en: string, es: string): Bilingual => ({ en, es });

export function useContent(pieceId?: string) {
  const live = isSupabaseConfigured();
  const { viewer, ready: viewerReady } = useViewer();
  const { locale } = useStaffLocale();
  const [state, setState] = useState<ContentState | null>(null);
  const role = viewer?.role ?? null;
  const handle = viewer?.handle ?? "demo";

  const reload = useCallback(async () => {
    if (!live) {
      if (!viewerReady) return;
      const local = readLocal();
      const scope = can(role, "content.view") ? "team" : "partner";
      const pieces = scope === "team" ? local.pieces : partnerMaterialOf(local.pieces);
      setState({
        scope,
        pieces,
        results: scope === "team" ? local.results : [],
        schedules: scope === "team" ? local.schedules : [],
        events: scope === "team" ? local.events : [],
        settings: local.settings,
        connections: can(role, "content.publish") ? DEMO_CONNECTIONS : null,
        leads: [],
        fileUrls: Object.fromEntries(pieces.flatMap((p) => p.assets).filter((a) => demoFiles.has(a.id)).map((a) => [a.id, demoFiles.get(a.id)!])),
      });
      return;
    }
    try {
      const res = await fetch(pieceId ? `/api/staff/content?id=${encodeURIComponent(pieceId)}` : "/api/staff/content", { cache: "no-store" });
      if (!res.ok) {
        setState({ ...EMPTY, scope: "partner" });
        return;
      }
      const body = (await res.json()) as Partial<ContentState> & { piece?: ContentPiece };
      if (pieceId && body.piece) {
        // One piece: keep the board's other parts as they were.
        setState((prev) => ({
          ...(prev ?? EMPTY),
          pieces: [body.piece!, ...(prev?.pieces ?? []).filter((p) => p.id !== body.piece!.id)],
          results: [...(prev?.results ?? []).filter((r) => r.pieceId !== pieceId), ...(body.results ?? [])],
          schedules: [...(prev?.schedules ?? []).filter((s) => s.pieceId !== pieceId), ...((body.schedules ?? []) as ScheduleView[])],
          events: body.events ?? [],
          fileUrls: { ...(prev?.fileUrls ?? {}), ...(body.fileUrls ?? {}) },
        }));
        return;
      }
      setState({ ...EMPTY, ...body, scope: body.scope === "partner" ? "partner" : "team" } as ContentState);
    } catch {
      setState(EMPTY);
    }
  }, [live, pieceId, role, viewerReady]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** The same capability check the routes make, in the member's language. */
  const refuse = useCallback((capability: Parameters<typeof can>[1]): ActResult | null => (can(role, capability) ? null : { ok: false, message: { en: deniedReason(capability, "en"), es: deniedReason(capability, "es") } }), [role]);

  const post = useCallback(
    async (url: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
      } catch {
        return { ok: false, body: { message: msg("No connection. Nothing changed.", "Sin conexión. No cambió nada.") } };
      }
    },
    [],
  );

  const failed = (body: Record<string, unknown>): ActResult => ({
    ok: false,
    message: (body.message as Bilingual | undefined) ?? msg(typeof body.error === "string" ? body.error : "It could not be saved.", "No se pudo guardar."),
  });

  const act = useCallback(
    async (action: ContentAction): Promise<ActResult> => {
      const denied = refuse(ACTION_CAPABILITY[action.action]);
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/content", action);
        await reload();
        return res.ok ? { ok: true, piece: res.body.piece as ContentPiece } : failed(res.body);
      }
      const local = readLocal();
      const result = applyContentAction(local.pieces, action, handle, new Date());
      if (!result.ok) return { ok: false, message: result.message };
      local.pieces = result.created ? [result.piece, ...local.pieces] : local.pieces.map((p) => (p.id === result.piece.id ? result.piece : p));
      local.events = [...local.events, ...result.events];
      // An edit after approval ends the schedules of the old version, as on the server.
      if (!result.piece.approval) {
        local.schedules = local.schedules.map((s) => (s.pieceId === result.piece.id && ["scheduled", "retry"].includes(s.status) ? { ...s, status: "cancelled", lastError: "The piece changed after approval." } : s));
      }
      writeLocal(local);
      await reload();
      return { ok: true, piece: result.piece };
    },
    [handle, live, post, refuse, reload],
  );

  const addResult = useCallback(
    async (input: { id: string; channel: Channel; values: Partial<Record<ResultMetric, number | null>>; note?: string }): Promise<ActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      const problem = resultEntryProblem(input.values);
      if (problem) {
        return {
          ok: false,
          message:
            problem === "empty"
              ? msg("Type at least one number.", "Escribe al menos un número.")
              : problem === "more_clients_than_leads"
                ? msg("There can't be more new clients than leads.", "No puede haber más clientes nuevos que prospectos.")
                : msg("Use whole numbers from 0.", "Usa números enteros desde 0."),
        };
      }
      if (live) {
        const res = await post("/api/staff/content", { action: "add_result", ...input });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const local = readLocal();
      const values: ContentResult["values"] = {};
      for (const [k, v] of Object.entries(input.values)) if (typeof v === "number") values[k as ResultMetric] = v;
      local.results = [...local.results, { id: newContentId("rs"), pieceId: input.id, channel: input.channel, source: "manual", at: new Date().toISOString(), by: handle, values, note: input.note ?? null }];
      local.pieces = local.pieces.map((p) => (p.id === input.id && p.status === "posted" ? { ...p, status: "measured" } : p));
      local.events = [...local.events, { id: newContentId("ev"), pieceId: input.id, at: new Date().toISOString(), by: handle, kind: "result_added", note: input.channel }];
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [handle, live, post, refuse, reload],
  );

  const schedule = useCallback(
    async (input: { id: string; channel: PublishChannel; at: string; lang: "en" | "es" }): Promise<ActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/content", { action: "schedule", ...input });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const local = readLocal();
      const piece = local.pieces.find((p) => p.id === input.id);
      if (!piece) return { ok: false, message: msg("That piece no longer exists.", "Esa pieza ya no existe.") };
      const gates = pieceGates(piece, input.channel);
      if (gates.length > 0) return { ok: false, message: GATE_TEXT[gates[0]!] };
      if (local.schedules.some((s) => s.pieceId === piece.id && s.channel === input.channel && s.approvalHash === piece.approval!.hash && !["cancelled", "failed"].includes(s.status))) {
        return { ok: false, message: msg("This approved version is already scheduled or posted on that channel.", "Esta versión aprobada ya está programada o publicada en ese canal.") };
      }
      local.schedules = [
        ...local.schedules,
        { id: crypto.randomUUID(), pieceId: piece.id, channel: input.channel, lang: input.lang, scheduledAt: input.at, status: "scheduled", attempts: 0, nextAttemptAt: input.at, postedAt: null, externalId: null, url: null, lastError: null, note: null, createdBy: handle, approvalHash: piece.approval!.hash },
      ];
      if (piece.status === "approved") local.pieces = local.pieces.map((p) => (p.id === piece.id ? { ...p, status: "scheduled" } : p));
      local.events = [...local.events, { id: newContentId("ev"), pieceId: piece.id, at: new Date().toISOString(), by: handle, kind: "scheduled", note: `${input.channel} ${input.at}` }];
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [handle, live, post, refuse, reload],
  );

  const cancelSchedule = useCallback(
    async (scheduleId: string): Promise<ActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/content", { action: "cancel_schedule", scheduleId });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const local = readLocal();
      const target = local.schedules.find((s) => s.id === scheduleId);
      if (!target) return { ok: false, message: msg("Nothing to cancel.", "No hay nada que cancelar.") };
      local.schedules = local.schedules.map((s) => (s.id === scheduleId ? { ...s, status: "cancelled", lastError: "Cancelled by a person." } : s));
      const stillLive = local.schedules.some((s) => s.pieceId === target.pieceId && ["scheduled", "retry", "publishing"].includes(s.status));
      if (!stillLive) local.pieces = local.pieces.map((p) => (p.id === target.pieceId && p.status === "scheduled" ? { ...p, status: "approved" } : p));
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [live, post, refuse, reload],
  );

  const saveSettings = useCallback(
    async (patch: { enabled?: boolean; channels?: Partial<Record<PublishChannel, boolean>> }): Promise<ActResult> => {
      const denied = refuse("content.publish");
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/content", { action: "settings", ...patch });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const local = readLocal();
      local.settings = { enabled: patch.enabled ?? local.settings.enabled, channels: { ...local.settings.channels, ...(patch.channels ?? {}) } };
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [live, post, refuse, reload],
  );

  const disconnect = useCallback(
    async (provider: "meta" | "tiktok" | "youtube"): Promise<ActResult> => {
      const denied = refuse("content.publish");
      if (denied) return denied;
      if (!live) return { ok: true };
      const res = await post("/api/staff/content", { action: "disconnect", provider });
      await reload();
      return res.ok ? { ok: true } : failed(res.body);
    },
    [live, post, refuse, reload],
  );

  const problemText = (code: string): Bilingual => ASSET_PROBLEM_TEXT[code] ?? msg("The file could not be kept.", "No se pudo guardar el archivo.");

  /** Upload a file: pictures and PDFs through the server; videos straight to storage with a one-time link. */
  const uploadFile = useCallback(
    async (id: string, file: File, altText: string): Promise<ActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const check = checkAsset(head, file.size);
      if (!check.ok) return { ok: false, message: problemText(check.code) };
      if (!live) {
        const assetId = newContentId("as");
        demoFiles.set(assetId, URL.createObjectURL(file));
        return act({ action: "add_asset", id, asset: { id: assetId, kind: "upload", ref: `demo/${assetId}.${check.extension}`, name: file.name.slice(0, 160), mediaType: check.mediaType, bytes: file.size, altText, addedBy: handle, addedAt: new Date().toISOString() } });
      }
      if (!check.mediaType.startsWith("video/")) {
        const form = new FormData();
        form.set("file", file);
        form.set("id", id);
        form.set("altText", altText);
        try {
          const res = await fetch("/api/staff/content/assets", { method: "POST", body: form });
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          await reload();
          return res.ok ? { ok: true } : { ok: false, message: problemText(String(body.code ?? "")) };
        } catch {
          return { ok: false, message: msg("No connection. Nothing changed.", "Sin conexión. No cambió nada.") };
        }
      }
      const ticket = await post("/api/staff/content/assets", { action: "upload_url", id, name: file.name.slice(0, 160), mediaType: check.mediaType, bytes: file.size });
      if (!ticket.ok) return { ok: false, message: problemText(String(ticket.body.code ?? "")) };
      try {
        const put = await fetch(String(ticket.body.signedUrl), { method: "PUT", headers: { "content-type": check.mediaType, "x-upsert": "false" }, body: file });
        if (!put.ok) return { ok: false, message: msg("The upload did not finish. Try again.", "La subida no terminó. Inténtalo otra vez.") };
      } catch {
        return { ok: false, message: msg("The upload did not finish. Try again.", "La subida no terminó. Inténtalo otra vez.") };
      }
      const confirm = await post("/api/staff/content/assets", { action: "confirm", id, assetId: ticket.body.assetId, name: file.name.slice(0, 160), altText });
      await reload();
      return confirm.ok ? { ok: true } : { ok: false, message: problemText(String(confirm.body.code ?? "")) };
    },
    [act, handle, live, post, refuse, reload],
  );

  const addLink = useCallback(
    async (id: string, url: string, name: string, altText: string): Promise<ActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      if (assetLinkProblem(url)) return { ok: false, message: problemText("not_https") };
      if (!live) {
        return act({ action: "add_asset", id, asset: { id: newContentId("as"), kind: "url", ref: url.trim(), name: name.slice(0, 160) || url.slice(0, 160), mediaType: null, bytes: null, altText, addedBy: handle, addedAt: new Date().toISOString() } });
      }
      const res = await post("/api/staff/content/assets", { action: "link", id, url: url.trim(), name: name.slice(0, 160) || url.slice(0, 160), altText });
      await reload();
      return res.ok ? { ok: true } : { ok: false, message: problemText(String(res.body.code ?? "")) };
    },
    [act, handle, live, post, refuse, reload],
  );

  /** Alti's assistant: the server's (Claude with a key, else templates) or, in the demo, the templates here. */
  const assist = useCallback(
    async (request: AssistRequest): Promise<AssistResult | { error: Bilingual }> => {
      const denied = refuse("content.edit");
      if (denied && !denied.ok) return { error: denied.message };
      if (!live) return writeWithAlti(request, null);
      const res = await post("/api/staff/content/assist", request);
      return res.ok ? (res.body as unknown as AssistResult) : { error: (res.body.message as Bilingual | undefined) ?? msg("Alti could not write right now.", "Alti no pudo escribir ahora.") };
    },
    [live, post, refuse],
  );

  const value = state ?? EMPTY;
  return useMemo(
    () => ({
      live,
      ready: state !== null,
      viewer,
      role,
      locale,
      ...value,
      act,
      addResult,
      schedule,
      cancelSchedule,
      saveSettings,
      disconnect,
      uploadFile,
      addLink,
      assist,
      reload,
      maxFiles: ASSET_LIMITS.perPiece,
    }),
    [live, state, viewer, role, locale, value, act, addResult, schedule, cancelSchedule, saveSettings, disconnect, uploadFile, addLink, assist, reload],
  );
}
