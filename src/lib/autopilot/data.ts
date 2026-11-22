import type { StaffClient } from "../staff/types";
import { isDemoMode } from "../supabase/config";
import { DEMO_CHANNELS, DEMO_SETTINGS } from "./demo";
import type { SettingsPatch } from "./store";
import { normalizeSettings, type AutopilotSettings, type Channel, type ChannelAvailability, type FollowupKind } from "./types";

// Where the console reads and changes the autopilot: the database routes, or
// the demo's record in this browser. Like the console's other stores
// (staff/data.ts, mail/data.ts), the pages only know this interface.

export interface AutopilotView {
  settings: AutopilotSettings;
  channels: ChannelAvailability;
  /** What each channel still needs to be configured (the server's environment). Empty in the demo. */
  gaps: Record<Channel, string[]>;
}

export type AutopilotResult = { ok: true } | { ok: false; message: string };

export interface AutopilotData {
  readonly demo: boolean;
  load(): Promise<AutopilotView>;
  saveSettings(patch: SettingsPatch, by: string): Promise<AutopilotResult>;
  hold(clientId: string, reason: string, by: string): Promise<AutopilotResult>;
  release(clientId: string, by: string): Promise<AutopilotResult>;
  /** The client told a person they want no automatic messages (or want them back). */
  setOptOut(clientId: string, optedOut: boolean, by: string): Promise<AutopilotResult>;
}

// ── Demo ────────────────────────────────────────────────────────────────

/** What a person did to the autopilot in the demo, replayed over the invented clients. */
export interface AutopilotDemoActions {
  settings: Partial<AutopilotSettings> | null;
  /** clientId → the hold placed or the release, newest. */
  holds: Record<string, { kind: "hold"; at: string; by: string; reason: string } | { kind: "release"; at: string; by: string }>;
  /** clientId → opted out or back in, by a teammate. */
  optOuts: Record<string, { kind: "opt_out" | "opt_in"; at: string; by: string }>;
}

export const EMPTY_AUTOPILOT_ACTIONS: AutopilotDemoActions = { settings: null, holds: {}, optOuts: {} };
const KEY = "credalti.autopilotDemo.v1";

export function loadAutopilotDemo(): AutopilotDemoActions {
  if (typeof window === "undefined") return structuredClone(EMPTY_AUTOPILOT_ACTIONS);
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AutopilotDemoActions>) : {};
    return { settings: parsed.settings ?? null, holds: parsed.holds ?? {}, optOuts: parsed.optOuts ?? {} };
  } catch {
    return structuredClone(EMPTY_AUTOPILOT_ACTIONS);
  }
}

function saveAutopilotDemo(actions: AutopilotDemoActions): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(actions));
  } catch {
    // Storage unavailable: the change lasts for this visit only.
  }
}

export function resetAutopilotDemo(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The demo's settings: on, so the demo shows the system at work, with whatever a person changed. */
export function demoSettings(actions: AutopilotDemoActions = loadAutopilotDemo()): AutopilotSettings {
  return normalizeSettings({ ...DEMO_SETTINGS, ...(actions.settings ?? {}) });
}

/** The invented clients with the holds and opt-outs a person recorded in the demo. Pure. */
export function applyAutopilotDemoActions(clients: StaffClient[], actions: AutopilotDemoActions): StaffClient[] {
  return clients.map((client) => {
    const hold = actions.holds[client.id];
    const opt = actions.optOuts[client.id];
    if (!hold && !opt) return client;
    let holds = client.holds ?? [];
    if (hold?.kind === "hold") {
      holds = [...holds.map((h) => (h.releasedAt ? h : { ...h, releasedAt: hold.at, releasedBy: hold.by })), { id: `${client.id}-h-${hold.at}`, at: hold.at, by: hold.by, reason: hold.reason }];
    } else if (hold?.kind === "release") {
      holds = holds.map((h) => (h.releasedAt || h.at > hold.at ? h : { ...h, releasedAt: hold.at, releasedBy: hold.by }));
    }
    const optOut = opt ? (opt.kind === "opt_out" ? { at: opt.at, keyword: "equipo", channel: "staff" as const } : null) : client.optOut;
    return { ...client, holds, optOut };
  });
}

function createDemoAutopilot(): AutopilotData {
  const change = (fn: (a: AutopilotDemoActions) => void): AutopilotResult => {
    const a = loadAutopilotDemo();
    fn(a);
    saveAutopilotDemo(a);
    return { ok: true };
  };
  return {
    demo: true,
    async load() {
      return { settings: demoSettings(), channels: DEMO_CHANNELS, gaps: { whatsapp: [], email: [] } };
    },
    async saveSettings(patch, by) {
      return change((a) => {
        const current = demoSettings(a);
        a.settings = {
          ...current,
          ...patch,
          followups: { ...current.followups, ...(patch.followups ?? {}) } as Record<FollowupKind, boolean>,
          updatedAt: new Date().toISOString(),
          updatedBy: by,
        };
      });
    },
    async hold(clientId, reason, by) {
      const why = reason.replace(/\s+/g, " ").trim();
      if (why.length < 3) return { ok: false, message: "Escribe por qué se detiene. Queda en el registro." };
      return change((a) => void (a.holds[clientId] = { kind: "hold", at: new Date().toISOString(), by, reason: why.slice(0, 500) }));
    },
    async release(clientId, by) {
      return change((a) => void (a.holds[clientId] = { kind: "release", at: new Date().toISOString(), by }));
    },
    async setOptOut(clientId, optedOut, by) {
      return change((a) => void (a.optOuts[clientId] = { kind: optedOut ? "opt_out" : "opt_in", at: new Date().toISOString(), by }));
    },
  };
}

// ── Database ────────────────────────────────────────────────────────────

async function post(body: unknown): Promise<AutopilotResult> {
  try {
    const res = await fetch("/api/staff/autopilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: unknown };
    return { ok: false, message: typeof data.message === "string" ? data.message : "No se pudo guardar. Intenta de nuevo." };
  } catch {
    return { ok: false, message: "No pudimos conectar. Revisa tu conexión e intenta de nuevo." };
  }
}

function createDatabaseAutopilot(): AutopilotData {
  return {
    demo: false,
    async load() {
      const res = await fetch("/api/staff/autopilot", { cache: "no-store" });
      if (!res.ok) throw new Error("No pudimos leer el piloto automático.");
      const data = (await res.json()) as AutopilotView;
      return { settings: normalizeSettings(data.settings), channels: data.channels, gaps: data.gaps };
    },
    saveSettings: (patch) => post({ action: "settings", ...patch }),
    hold: (clientId, reason) => post({ action: "hold", clientId, reason }),
    release: (clientId) => post({ action: "release", clientId }),
    setOptOut: (clientId, optedOut) => post({ action: optedOut ? "opt_out" : "opt_in", clientId }),
  };
}

let instance: AutopilotData | null = null;

export function getAutopilotData(): AutopilotData {
  instance ??= isDemoMode() ? createDemoAutopilot() : createDatabaseAutopilot();
  return instance;
}
