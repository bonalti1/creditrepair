import { CRON_JOBS, type CronJob, type Heartbeat, type ItemState, type LaunchFacts, type Note, type ProbeResult, type ProbeService } from "./checklist";
import type { LaunchReport } from "./status";

// System health (ALTO Control's Infrastructure and Tech Health, Credalti's
// way): each service the app talks to, configured or not, working or failing,
// when it last did something real (from the database), when it last reported
// an error (observability's in-memory times: the place and the time, never
// the message), and its «Check now» when it has a harmless one. Plus every
// scheduled job's last run, from its heartbeat. Pure.

export const SERVICES = ["database", "phone_login", "anthropic", "lob", "whatsapp", "email", "payments", "error_alerts", "phone_alerts", "publishing", "highlevel"] as const;
export type ServiceKey = (typeof SERVICES)[number];
export type ServiceState = "not_configured" | "configured" | "working" | "failing";

export interface ServiceHealth {
  key: ServiceKey;
  state: ServiceState;
  /** "test" / "live" / "sandbox" / "demo", when it can be told safely. */
  mode: Note | null;
  probe: ProbeService | null;
  lastProbe: ProbeResult | null;
  lastActivityAt: string | null;
  lastErrorAt: string | null;
}

export interface JobHealth {
  job: CronJob["job"];
  path: string;
  everyMinutes: number;
  needed: CronJob["needed"];
  state: ItemState;
  heartbeat: Heartbeat | null;
}

export interface SystemHealth {
  services: ServiceHealth[];
  jobs: JobHealth[];
  /** Error times are this server's memory since it started. */
  errorsSince: "server_start";
  at: string;
}

/** Where (observability's `where`) each service's failures are reported, by prefix. */
export const ERROR_PLACES: Partial<Record<ServiceKey, readonly string[]>> = {
  anthropic: ["content/assist", "staff/draft", "letters/variation", "intake", "api/coach", "ideas/alti", "api/site/ask", "api/webhooks/whatsapp:coach"],
  lob: ["api/webhooks/lob", "rounds/send:mail", "rounds/send:verify", "mail/returns"],
  whatsapp: ["api/webhooks/whatsapp", "autopilot:deliver"],
  payments: ["billing:", "api/billing", "api/cron/billing"],
  publishing: ["content/publish", "api/cron/content"],
  highlevel: ["api/webhooks/highlevel", "api/cron/highlevel"],
};

const DAY = 24 * 60 * 60 * 1000;

function newestError(places: readonly string[] | undefined, errors: Record<string, string>): string | null {
  if (!places) return null;
  let best: string | null = null;
  for (const [where, at] of Object.entries(errors)) {
    if (places.some((p) => where === p || where.startsWith(p)) && (!best || at > best)) best = at;
  }
  return best;
}

const later = (a: string | null, b: string | null) => (a && (!b || Date.parse(a) > Date.parse(b)) ? a : b);

export function systemHealth(facts: LaunchFacts, report: LaunchReport, errors: Record<string, string>): SystemHealth {
  const env = facts.env;
  const set = (...names: string[]) => names.every((n) => env.set[n]);
  const now = Date.parse(facts.now);
  const configured: Record<ServiceKey, boolean> = {
    database: set("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    phone_login: set("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    anthropic: set("ANTHROPIC_API_KEY"),
    lob: set("LOB_API_KEY"),
    whatsapp: set("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"),
    email: set("EMAIL_API_KEY", "EMAIL_FROM", "UNSUBSCRIBE_SECRET"),
    payments: env.gateway !== null && env.gatewayComplete,
    error_alerts: set("ERROR_WEBHOOK_URL"),
    phone_alerts: set("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"),
    publishing: set("CONTENT_TOKEN_KEY") && (set("META_APP_ID", "META_APP_SECRET") || set("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET") || set("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET")),
    highlevel: set("HIGHLEVEL_WEBHOOK_SECRET"),
  };
  const probeOf: Partial<Record<ServiceKey, ProbeService>> = { phone_login: "phone_login", anthropic: "anthropic", lob: "lob", whatsapp: "whatsapp", ...(env.gateway === "authorize_net" ? { payments: "authorize_net" as const } : {}) };
  const activity: Partial<Record<ServiceKey, string | null>> = {
    whatsapp: facts.db?.lastWhatsappInbound ?? null,
    lob: facts.db?.lastLobEvent ?? null,
    highlevel: facts.db?.lastHighlevelReceipt ?? null,
  };
  const modeOf: Partial<Record<ServiceKey, Note | null>> = {
    lob: env.lobMode ? { code: env.lobMode === "live" ? "mode_live" : env.lobMode === "test" ? "mode_test" : "mode_unknown" } : null,
    payments: env.gatewayMode ? { code: env.gatewayMode === "live" ? "mode_live" : env.gatewayMode === "sandbox" ? "mode_sandbox" : env.gatewayMode === "demo" ? "mode_demo" : "mode_unknown" } : null,
  };

  const services: ServiceHealth[] = SERVICES.map((key) => {
    const probe = probeOf[key] ?? null;
    const lastProbe = probe ? (facts.probes[probe] ?? null) : null;
    const lastActivityAt = activity[key] ?? null;
    const lastErrorAt = newestError(ERROR_PLACES[key], errors);
    let state: ServiceState;
    if (!configured[key]) state = "not_configured";
    else if (key === "database") state = facts.db?.connected ? "working" : "failing";
    else {
      const lastGood = later(lastProbe?.ok ? lastProbe.checkedAt : null, lastActivityAt);
      const probeFailed = lastProbe && !lastProbe.ok && (!lastGood || Date.parse(lastProbe.checkedAt) >= Date.parse(lastGood));
      const recentError = lastErrorAt && now - Date.parse(lastErrorAt) < DAY && (!lastGood || Date.parse(lastErrorAt) > Date.parse(lastGood));
      if (probeFailed || recentError) state = "failing";
      else if (lastGood && now - Date.parse(lastGood) < 7 * DAY) state = "working";
      else state = "configured";
    }
    return { key, state, mode: modeOf[key] ?? null, probe, lastProbe, lastActivityAt, lastErrorAt };
  });

  const jobs: JobHealth[] = CRON_JOBS.map((job) => {
    const item = report.items.find((i) => i.key === `job_${job.job.replace(/-/g, "_")}`);
    return { job: job.job, path: job.path, everyMinutes: job.everyMinutes, needed: job.needed, state: item?.state ?? "missing", heartbeat: facts.heartbeats[job.job] ?? null };
  });

  return { services, jobs, errorsSince: "server_start", at: facts.now };
}
