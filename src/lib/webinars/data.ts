"use client";

import { useMemo } from "react";
import { dayInZone } from "../ads/window";
import type { Bilingual } from "../content/types";
import { can, deniedReason, type Capability, type Viewer } from "../staff/permissions";
import { isSupabaseConfigured } from "../supabase/config";
import { matchAttendance, readAttendees } from "./attendance";
import { webinarCopyProblems } from "./check";
import {
  demoAdDays,
  demoCampaigns,
  demoCosts,
  demoFunnelEvents,
  demoFunnelLeads,
  demoPurchases,
  demoRegistrations,
  demoReportClients,
  demoValues,
  demoWebinars,
  mergeFunnelEvents,
} from "./demo";
import { demoLiveFunnelEvents } from "../live/data";
import { leadFromWebinar } from "./live";
import { TEXAS_TZ, texasToIso } from "./time";
import type { Campaign, CampaignCost, ClientPurchase, CostKind, PurchaseKind, Registration, Webinar, WebinarLanguage, WebinarPlatform } from "./types";
import { countersFor, liveLeadViews, registrantView, reminderStats, scorecardsFor, summarize, webinarLinks, type CampaignsView, type LiveView, type WebinarDetail, type WebinarSummary } from "./views";

// The webinars' data for the screens. With a database: /api/staff/webinars
// (the member's own connection; the route asks the capability again). In
// the demo: the SAMPLE webinars, registrants, campaign and leads (demo.ts),
// with the same view builders and the same capability checks; what a
// member changes in the demo stays in this browser.

const KEY = "credalti.demo.webinars.v1";
const msg = (en: string, es: string): Bilingual => ({ en, es });

interface DemoState {
  webinars: Webinar[];
  attended: Record<string, { attended: boolean; minutes: number | null; source: "zoom_csv" | "manual" | null }>;
  campaigns: Campaign[];
  costs: CampaignCost[];
  purchases: ClientPurchase[];
}

function readState(): DemoState {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as DemoState | null;
    if (raw && Array.isArray(raw.webinars)) return { webinars: raw.webinars, attended: raw.attended ?? {}, campaigns: raw.campaigns ?? [], costs: raw.costs ?? [], purchases: raw.purchases ?? [] };
  } catch {
    // Fresh.
  }
  return { webinars: [], attended: {}, campaigns: [], costs: [], purchases: [] };
}

function writeState(state: DemoState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // This visit only.
  }
}

export function resetDemoWebinars(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

/** The demo's webinars, with what this browser changed (a changed one replaces its sample by id). */
function demoWorld(now: Date) {
  const s = typeof window === "undefined" ? { webinars: [], attended: {}, campaigns: [], costs: [], purchases: [] } : readState();
  const byId = new Map(demoWebinars(now).map((w) => [w.id, w]));
  for (const w of s.webinars) byId.set(w.id, w);
  const webinars = [...byId.values()];
  const registrations: Registration[] = demoRegistrations(now).map((r) => {
    const mark = s.attended[r.id];
    return mark ? { ...r, attended: mark.attended, attendedMinutes: mark.minutes, attendanceSource: mark.source } : r;
  });
  const campaignById = new Map(demoCampaigns(now).map((c) => [c.id, c]));
  for (const c of s.campaigns) campaignById.set(c.id, c);
  // Webinars follow their campaign link, as on the server.
  const campaigns = [...campaignById.values()].map((c) => ({ ...c, webinarIds: webinars.filter((w) => w.campaignId === c.id).map((w) => w.id) }));
  const costs = [...demoCosts(now).filter((c) => !s.costs.some((x) => x.id === c.id)), ...s.costs];
  const purchases = [...demoPurchases(now).filter((p) => !s.purchases.some((x) => x.id === p.id)), ...s.purchases];
  return { state: s, webinars, registrations, campaigns, costs, purchases };
}

export type ActResult = { ok: true; body: Record<string, unknown> } | { ok: false; message: Bilingual; body?: Record<string, unknown> };

export interface WebinarInputForm {
  id: string | null;
  slug: string;
  titleEn: string;
  titleEs: string;
  host: string;
  day: string;
  time: string;
  durationMinutes: number;
  language: WebinarLanguage;
  topic: string;
  campaignTag: string | null;
  keyword: string;
  links: Partial<Record<WebinarPlatform, string | null>>;
  replayUrl: string | null;
  campaignId: string | null;
}

export function useWebinarsData(viewer: Viewer | null) {
  const role = viewer?.role ?? null;
  const live = isSupabaseConfigured();
  return useMemo(() => {
    const origin = () => (typeof window === "undefined" ? "" : window.location.origin);
    const denied = (capability: Capability): ActResult | null => (can(role, capability) ? null : { ok: false, message: { en: deniedReason(capability, "en"), es: deniedReason(capability, "es") } });
    const contact = can(role, "leads.work");
    const getJson = async <T,>(q: string): Promise<T | null> => {
      try {
        const res = await fetch(`/api/staff/webinars${q}`, { cache: "no-store" });
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };
    const post = async (body: Record<string, unknown>): Promise<ActResult> => {
      try {
        const res = await fetch("/api/staff/webinars", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok) return { ok: true, body: out };
        const code = String(out.code ?? "");
        const message =
          code === "slug_taken"
            ? msg("Another webinar already uses that link. Change the link.", "Otro webinar ya usa ese enlace. Cambia el enlace.")
            : code === "copy_rules"
              ? msg("The title or topic breaks a rule (a promise, “free”, pressure or score talk). Change the words.", "El título o el tema rompe una regla (una promesa, «gratis», presión o hablar de puntaje). Cambia las palabras.")
              : code === "locked"
                ? msg("A published webinar keeps its link, and a cancelled one stays cancelled.", "Un webinar publicado conserva su enlace, y uno cancelado sigue cancelado.")
                : code === "no_header" || code === "empty"
                  ? msg("That file has no attendee list with emails or phones. Export Zoom's attendee report as CSV.", "Ese archivo no tiene una lista de asistentes con correos o teléfonos. Exporta el reporte de asistentes de Zoom como CSV.")
                  : msg("That could not be saved right now. Try again in a minute.", "No se pudo guardar ahora. Inténtalo en un minuto.");
        return { ok: false, message, body: out };
      } catch {
        return { ok: false, message: msg("No connection. Try again in a minute.", "Sin conexión. Inténtalo en un minuto.") };
      }
    };

    return {
      live,
      async list(): Promise<{ webinars: WebinarSummary[]; sample: boolean } | null> {
        if (!can(role, "webinars.view")) return null;
        if (!live) {
          const now = new Date();
          const w = demoWorld(now);
          return { webinars: summarize(w.webinars, w.registrations, now), sample: true };
        }
        return getJson("");
      },
      async detail(id: string): Promise<WebinarDetail | null> {
        if (!can(role, "webinars.view")) return null;
        if (!live) {
          const now = new Date();
          const w = demoWorld(now);
          const webinar = w.webinars.find((x) => x.id === id);
          if (!webinar) return null;
          const regs = w.registrations.filter((r) => r.webinarId === id);
          const phones = new Set(regs.map((r) => r.phone));
          const leads = demoFunnelLeads(now).filter((l) => leadFromWebinar(l, webinar, phones) && Date.parse(l.createdAt) <= now.getTime());
          return {
            webinar,
            phase: summarize([webinar], regs, now)[0]!.phase,
            links: webinarLinks(webinar, origin()),
            registrants: regs.map((r) => registrantView(r, contact)),
            contact,
            reminders: role === "admin" ? reminderStats(demoReminderLog(webinar, regs, now)) : null,
            counters: countersFor(webinar, regs, leads, demoReportClients(now), demoVideos(now)),
            sample: true,
          };
        }
        return getJson(`?id=${encodeURIComponent(id)}`);
      },
      async liveView(id: string): Promise<LiveView | null> {
        if (!can(role, "webinars.view")) return null;
        if (!live) {
          const now = new Date();
          const w = demoWorld(now);
          const webinar = w.webinars.find((x) => x.id === id);
          if (!webinar) return null;
          const regs = w.registrations.filter((r) => r.webinarId === id);
          const phones = new Set(regs.map((r) => r.phone));
          // The live demo's keyword messages arrive as the minutes pass.
          const leads = demoFunnelLeads(now).filter((l) => leadFromWebinar(l, webinar, phones) && Date.parse(l.createdAt) <= now.getTime());
          return { webinar, phase: summarize([webinar], regs, now)[0]!.phase, links: webinarLinks(webinar, origin()), counters: countersFor(webinar, regs, leads, demoReportClients(now), demoVideos(now)), leads: liveLeadViews(leads), sample: true };
        }
        return getJson(`?live=${encodeURIComponent(id)}`);
      },
      async campaigns(): Promise<CampaignsView | null> {
        if (!can(role, "campaigns.view")) return null;
        if (!live) {
          const now = new Date();
          const w = demoWorld(now);
          const scorecards = scorecardsFor({
            campaigns: w.campaigns,
            costs: w.costs,
            adDays: demoAdDays(now),
            webinars: w.webinars,
            registrations: w.registrations,
            leads: demoFunnelLeads(now).filter((l) => Date.parse(l.createdAt) <= now.getTime()),
            reportClients: demoReportClients(now),
            videos: demoVideos(now),
            values: demoValues(now),
            dayOf: (at) => dayInZone(at, TEXAS_TZ),
          });
          return {
            campaigns: w.campaigns,
            costs: w.costs,
            purchases: w.purchases,
            scorecards,
            metaCampaigns: [
              { id: "120210000000000101", name: "WhatsApp · Know your rights (TX)" },
              { id: "120210000000000102", name: "Website · Start my review" },
              { id: "120210000000000103", name: "Lead form · Credit report questions" },
              { id: "120210000000000104", name: "Retargeting · Site visitors" },
            ],
            webinars: w.webinars.map((x) => ({ id: x.id, title: x.title.en, startsAt: x.startsAt })),
            adsConnected: false,
            sample: true,
          };
        }
        return getJson("?campaigns=1");
      },

      async saveWebinar(form: WebinarInputForm): Promise<ActResult> {
        const no = denied("webinars.manage");
        if (no) return no;
        if ([form.titleEn, form.titleEs, form.topic].some((t) => webinarCopyProblems(t).length > 0)) {
          return { ok: false, message: msg("The title or topic breaks a rule (a promise, “free”, pressure or score talk). Change the words.", "El título o el tema rompe una regla (una promesa, «gratis», presión o hablar de puntaje). Cambia las palabras.") };
        }
        if (!live) {
          const now = new Date();
          const startsAt = texasToIso(form.day, form.time);
          if (!startsAt) return { ok: false, message: msg("That date or time is not complete.", "Esa fecha u hora no está completa.") };
          const world = demoWorld(now);
          if (world.webinars.some((w) => w.slug === form.slug && w.id !== form.id)) return { ok: false, message: msg("Another webinar already uses that link. Change the link.", "Otro webinar ya usa ese enlace. Cambia el enlace.") };
          const prior = form.id ? world.webinars.find((w) => w.id === form.id) : undefined;
          const links: Partial<Record<WebinarPlatform, string>> = {};
          for (const [k, v] of Object.entries(form.links)) if (v) links[k as WebinarPlatform] = v;
          const webinar: Webinar = {
            id: prior?.id ?? `demo-webinar-${Date.now().toString(36)}`,
            slug: form.slug,
            title: { en: form.titleEn.trim(), es: form.titleEs.trim() },
            host: form.host.trim(),
            startsAt,
            durationMinutes: form.durationMinutes,
            language: form.language,
            topic: form.topic.trim(),
            campaignTag: form.campaignTag,
            keyword: form.keyword.toUpperCase(),
            links,
            replayUrl: form.replayUrl,
            status: prior?.status ?? "draft",
            campaignId: form.campaignId,
            createdAt: prior?.createdAt ?? now.toISOString(),
            createdBy: prior?.createdBy ?? viewer?.name ?? "Demo",
          };
          const s = world.state;
          writeState({ ...s, webinars: [...s.webinars.filter((w) => w.id !== webinar.id), webinar] });
          return { ok: true, body: { webinar } };
        }
        return post({ action: "save_webinar", ...form, id: form.id ?? null, campaignTag: form.campaignTag || null, campaignId: form.campaignId || null, replayUrl: form.replayUrl || null });
      },
      async setStatus(id: string, status: "published" | "cancelled"): Promise<ActResult> {
        const no = denied("webinars.manage");
        if (no) return no;
        if (!live) {
          const world = demoWorld(new Date());
          const w = world.webinars.find((x) => x.id === id);
          if (!w) return { ok: false, message: msg("Not found.", "No se encontró.") };
          if (w.status === "cancelled") return { ok: false, message: msg("A cancelled webinar stays cancelled.", "Un webinar cancelado sigue cancelado.") };
          writeState({ ...world.state, webinars: [...world.state.webinars.filter((x) => x.id !== id), { ...w, status }] });
          return { ok: true, body: {} };
        }
        return post({ action: status === "published" ? "publish" : "cancel", id });
      },
      async attendance(id: string, csv: string, apply: boolean): Promise<ActResult> {
        const no = denied("webinars.manage");
        if (no) return no;
        if (!live) {
          const read = readAttendees(csv);
          if (!read.ok) return { ok: false, message: msg("That file has no attendee list with emails or phones. Export Zoom's attendee report as CSV.", "Ese archivo no tiene una lista de asistentes con correos o teléfonos. Exporta el reporte de asistentes de Zoom como CSV.") };
          const world = demoWorld(new Date());
          const plan = matchAttendance(read.attendees, world.registrations.filter((r) => r.webinarId === id));
          if (apply) {
            const attended = { ...world.state.attended };
            for (const m of plan.matches) attended[m.registrationId] = { attended: true, minutes: m.minutes, source: "zoom_csv" };
            writeState({ ...world.state, attended });
          }
          return { ok: true, body: { attendees: read.attendees.length, matched: plan.matches.length, unmatched: plan.unmatched.length } };
        }
        return post({ action: "attendance", id, csv, apply });
      },
      async markAttended(id: string, registrationId: string, attended: boolean): Promise<ActResult> {
        const no = denied("webinars.manage");
        if (no) return no;
        if (!live) {
          const world = demoWorld(new Date());
          writeState({ ...world.state, attended: { ...world.state.attended, [registrationId]: { attended, minutes: null, source: attended ? "manual" : null } } });
          return { ok: true, body: {} };
        }
        return post({ action: "mark_attended", id, registrationId, attended });
      },
      async saveCampaign(input: Omit<Campaign, "id" | "createdAt"> & { id: string | null }): Promise<ActResult> {
        const no = denied("campaigns.view");
        if (no) return no;
        if (input.endDay < input.startDay) return { ok: false, message: msg("The end is before the start.", "El final es antes del inicio.") };
        if (!live) {
          const world = demoWorld(new Date());
          const id = input.id ?? `demo-campaign-${Date.now().toString(36)}`;
          const campaign: Campaign = { ...input, id, createdAt: new Date().toISOString() };
          const webinars = world.webinars.map((w) => (input.webinarIds.includes(w.id) ? { ...w, campaignId: id } : w.campaignId === id ? { ...w, campaignId: null } : w));
          writeState({ ...world.state, campaigns: [...world.state.campaigns.filter((c) => c.id !== id), campaign], webinars });
          return { ok: true, body: { id } };
        }
        return post({ action: "save_campaign", ...input, id: input.id ?? null });
      },
      async addCost(input: { campaignId: string; label: string; kind: CostKind; amountCents: number; day: string }): Promise<ActResult> {
        const no = denied("campaigns.view");
        if (no) return no;
        if (!live) {
          const world = demoWorld(new Date());
          writeState({ ...world.state, costs: [...world.state.costs, { ...input, id: `demo-cost-${Date.now().toString(36)}`, by: viewer?.name ?? "Demo", voidedAt: null }] });
          return { ok: true, body: {} };
        }
        return post({ action: "add_cost", ...input });
      },
      async voidCost(id: string): Promise<ActResult> {
        const no = denied("campaigns.view");
        if (no) return no;
        if (!live) {
          const world = demoWorld(new Date());
          const cost = world.costs.find((c) => c.id === id);
          if (cost) writeState({ ...world.state, costs: [...world.state.costs.filter((c) => c.id !== id), { ...cost, voidedAt: new Date().toISOString() }] });
          return { ok: true, body: {} };
        }
        return post({ action: "void_cost", id });
      },
      async addPurchase(input: { clientId: string; kind: PurchaseKind; amountCents: number | null; day: string; note: string | null }): Promise<ActResult> {
        const no = denied("campaigns.view");
        if (no) return no;
        if (!live) {
          const world = demoWorld(new Date());
          writeState({ ...world.state, purchases: [...world.state.purchases, { ...input, id: `demo-purchase-${Date.now().toString(36)}`, by: viewer?.name ?? "Demo", voidedAt: null }] });
          return { ok: true, body: {} };
        }
        return post({ action: "add_purchase", ...input });
      },
      async voidPurchase(id: string): Promise<ActResult> {
        const no = denied("campaigns.view");
        if (no) return no;
        if (!live) {
          const world = demoWorld(new Date());
          const p = world.purchases.find((x) => x.id === id);
          if (p) writeState({ ...world.state, purchases: [...world.state.purchases.filter((x) => x.id !== id), { ...p, voidedAt: new Date().toISOString() }] });
          return { ok: true, body: {} };
        }
        return post({ action: "void_purchase", id });
      },
    };
  }, [live, role, viewer]);
}

export type WebinarsData = ReturnType<typeof useWebinarsData>;

/** The live funnel's facts in the demo: the sample's, and what a member did in this browser (a video sent, the video page watched, «Get started»). */
function demoVideos(now: Date) {
  return mergeFunnelEvents(demoFunnelEvents(now), demoLiveFunnelEvents(now));
}

/** The demo's reminder log: what would have gone, by the schedule, for the reminders' table. */
function demoReminderLog(webinar: Webinar, regs: readonly Registration[], now: Date): Array<{ kind: import("./types").ReminderKind; status: string }> {
  const start = Date.parse(webinar.startsAt);
  const out: Array<{ kind: import("./types").ReminderKind; status: string }> = [];
  const consenting = regs.filter((r) => r.remindersConsent && !r.optedOutAt);
  const passed = (ms: number) => now.getTime() >= ms;
  const H = 3_600_000;
  const plan: Array<[import("./types").ReminderKind, number]> = [["week", start - 168 * H], ["day", start - 24 * H], ["hour", start - H], ["live", start], ["replay", start + H], ["followup_2", start + 48 * H], ["followup_5", start + 120 * H]];
  for (const [kind, at] of plan) {
    if (!passed(at)) continue;
    if (kind === "replay" && !webinar.replayUrl) continue;
    const who = consenting.filter((r) => Date.parse(r.createdAt) < at && (!kind.startsWith("followup") || r.served === "texas"));
    who.forEach((r, i) => out.push({ kind, status: i % 23 === 7 ? "failed" : "sent" }));
  }
  return out;
}
