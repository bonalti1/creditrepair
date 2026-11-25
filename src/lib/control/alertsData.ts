import { isDemoMode } from "../supabase/config";
import type { Viewer } from "../staff/permissions";
import { DEFAULT_ALERT_PREFS, topicsFor, type AlertPrefs, type AlertTopic } from "./alerts";

// The alerts screen's data in the browser: the member's topics, whether this
// browser gets phone alerts, the recent alerts. In the demo the topics are
// kept in this browser and nothing is pushed (there is no server to push from).

export interface AlertsView {
  prefs: AlertPrefs;
  topics: AlertTopic[];
  push: { configured: boolean; publicKey: string | null; devices: number };
  recent: Array<{ id: string; topic: string; title: string; body: string | null; url: string; created_at: string; pushed_at: string | null }>;
}

export interface AlertsData {
  readonly demo: boolean;
  load(): Promise<AlertsView>;
  setTopic(topic: AlertTopic, enabled: boolean, waitingMinutes?: number): Promise<boolean>;
  /** Turns phone alerts on in this browser: permission, the service worker, the subscription. */
  enablePush(publicKey: string): Promise<"on" | "denied" | "unsupported" | "failed">;
  disablePush(): Promise<void>;
  test(): Promise<{ ok: boolean; created?: number; pushed?: number }>;
}

const DEMO_KEY = (handle: string) => `credalti.demo.alerts.v1.${handle}`;

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const padded = (text + "=".repeat((4 - (text.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** True when this browser can receive web push at all (an iPhone needs the console added to the Home Screen). */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

const SW_URL = "/staff-sw.js";
const SW_SCOPE = "/equipo/";

export function getAlertsData(viewer: Viewer | null): AlertsData {
  if (isDemoMode()) {
    const handle = viewer?.handle ?? "demo";
    const read = (): AlertPrefs => {
      try {
        return { ...structuredClone(DEFAULT_ALERT_PREFS), ...(JSON.parse(window.localStorage.getItem(DEMO_KEY(handle)) ?? "{}") as Partial<AlertPrefs>) };
      } catch {
        return structuredClone(DEFAULT_ALERT_PREFS);
      }
    };
    return {
      demo: true,
      async load() {
        return { prefs: read(), topics: topicsFor(viewer?.role), push: { configured: false, publicKey: null, devices: 0 }, recent: [] };
      },
      async setTopic(topic, enabled, waitingMinutes) {
        const prefs = read();
        prefs[topic] = { enabled, waitingMinutes: waitingMinutes ?? prefs[topic].waitingMinutes };
        try {
          window.localStorage.setItem(DEMO_KEY(handle), JSON.stringify(prefs));
        } catch {
          // This visit only.
        }
        return true;
      },
      async enablePush() {
        return "unsupported";
      },
      async disablePush() {},
      async test() {
        return { ok: false };
      },
    };
  }
  const post = async (body: unknown) => {
    try {
      const res = await fetch("/api/staff/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { ok: false, data: {} };
    }
  };
  return {
    demo: false,
    async load() {
      const res = await fetch("/api/staff/alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as AlertsView;
    },
    async setTopic(topic, enabled, waitingMinutes) {
      return (await post({ action: "topic", topic, enabled, ...(waitingMinutes ? { waitingMinutes } : {}) })).ok;
    },
    async enablePush(publicKey) {
      if (!pushSupported()) return "unsupported";
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return "denied";
      try {
        const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
        const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        const saved = await post({ action: "subscribe", endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } });
        return saved.ok ? "on" : "failed";
      } catch {
        return "failed";
      }
    },
    async disablePush() {
      if (!pushSupported()) return;
      const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await post({ action: "unsubscribe", endpoint: subscription.endpoint });
        await subscription.unsubscribe().catch(() => false);
      }
    },
    async test() {
      const answer = await post({ action: "test" });
      return { ok: answer.ok, created: Number(answer.data.created ?? 0), pushed: Number(answer.data.pushed ?? 0) };
    },
  };
}
