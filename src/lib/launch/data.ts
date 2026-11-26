import { isDemoMode } from "../supabase/config";
import type { Viewer } from "../staff/permissions";
import type { ProbeService } from "./checklist";
import { demoErrorTimes, demoLaunchFacts, readDemoTicks, writeDemoTick } from "./demo";
import { systemHealth, type SystemHealth } from "./health";
import type { ProbeOutcome } from "./probes";
import { launchReport, type LaunchReport } from "./status";

// Where Launch readiness reads and writes. With a database: /api/staff/launch
// (administrators only, checked again on the server). In the demo: the sample
// facts, worked out by the same rules, with the ticks kept in this browser;
// «Check now» checks nothing and says so.

export interface LaunchView {
  report: LaunchReport;
  health: SystemHealth;
}

export interface LaunchData {
  readonly demo: boolean;
  load(): Promise<LaunchView>;
  tick(item: string, done: boolean, note: string): Promise<{ ok: boolean }>;
  probe(service: ProbeService): Promise<{ ok: true; outcome: ProbeOutcome } | { ok: false; code: string }>;
}

export function demoLaunchView(now: Date = new Date()): LaunchView {
  const facts = demoLaunchFacts(now, readDemoTicks());
  const report = launchReport(facts, { sample: true });
  return { report, health: systemHealth(facts, report, demoErrorTimes(now)) };
}

export function getLaunchData(viewer: Viewer | null): LaunchData {
  if (isDemoMode()) {
    return {
      demo: true,
      async load() {
        return demoLaunchView();
      },
      async tick(item, done, note) {
        writeDemoTick(item, { done, byName: viewer?.name ?? "", at: new Date().toISOString(), note: note.trim() || null });
        return { ok: true };
      },
      async probe() {
        return { ok: false, code: "demo" };
      },
    };
  }
  return {
    demo: false,
    async load() {
      const res = await fetch("/api/staff/launch", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as LaunchView;
    },
    async tick(item, done, note) {
      const res = await fetch("/api/staff/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "tick", item, done, ...(note.trim() ? { note: note.trim() } : {}) }) }).catch(() => null);
      return { ok: Boolean(res?.ok) };
    },
    async probe(service) {
      try {
        const res = await fetch("/api/staff/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "probe", service }) });
        const json = (await res.json().catch(() => ({}))) as { outcome?: ProbeOutcome; code?: string };
        return res.ok && json.outcome ? { ok: true, outcome: json.outcome } : { ok: false, code: json.code ?? (res.status === 429 ? "cooldown" : "error") };
      } catch {
        return { ok: false, code: "error" };
      }
    },
  };
}
