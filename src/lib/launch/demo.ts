import { CRON_JOBS, LAUNCH_ITEMS, MIGRATION_SENTINELS, type LaunchFacts, type Tick } from "./checklist";
import type { EnvFacts } from "./env";

// The demo's launch readiness (no database): SAMPLE facts for a business
// part of the way there (the database and some keys set, the attorney and
// the processor still pending), so the screen can be seen as it will look.
// The screen says plainly that nothing was checked. The owner's ticks are
// kept in this browser.

const KEY = "credalti.demo.launch.v1";
const MIN = 60_000;

/** Variables the sample says are set. */
const SAMPLE_SET = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "LOB_API_KEY",
  "LOB_WEBHOOK_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "NEXT_PUBLIC_WHATSAPP_NUMBER",
  "N8N_WEBHOOK_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_COMPANY_LEGAL_NAME",
  "NEXT_PUBLIC_COMPANY_ADDRESS",
  "NEXT_PUBLIC_COMPANY_EMAIL",
  "NEXT_PUBLIC_PLAN_MONTHLY_FEE",
  "NEXT_PUBLIC_PLAN_ESTIMATED_MONTHS",
  "ERROR_WEBHOOK_URL",
  "SALES_WEBHOOK_URL",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
  "UNSUBSCRIBE_SECRET",
]);

const SAMPLE_TEMPLATES = ["credalti_acuerdo_1", "credalti_acuerdo_2", "credalti_acuerdo_3", "credalti_cartas_enviadas", "credalti_reporte_nuevo", "credalti_resumen_equipo"];

export function readDemoTicks(): Record<string, Tick> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, Tick>;
  } catch {
    return {};
  }
}

export function writeDemoTick(item: string, tick: Tick): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readDemoTicks(), [item]: tick }));
  } catch {
    // This visit only.
  }
}

export function resetDemoLaunch(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

export function demoLaunchFacts(now: Date, ticks: Record<string, Tick> = {}): LaunchFacts {
  const names = [...new Set(LAUNCH_ITEMS.flatMap((i) => i.env ?? []))];
  const env: EnvFacts = {
    set: Object.fromEntries(names.map((n) => [n, SAMPLE_SET.has(n)])),
    lobMode: "test",
    gateway: null,
    gatewayComplete: false,
    gatewayMode: null,
    gatewayWebhookKey: false,
    agreementApproved: false,
    paymentAuthorizationApproved: false,
    achAuthorizationApproved: false,
    termsMissing: ["NEXT_PUBLIC_TX_CSO_REGISTRATION_NUMBER", "NEXT_PUBLIC_TX_BOND_SURETY_NAME", "NEXT_PUBLIC_TX_BOND_SURETY_ADDRESS", "NEXT_PUBLIC_TX_AGENT_NAME", "NEXT_PUBLIC_TX_AGENT_ADDRESS"],
    unverifiedStatutes: 3,
    lettersAllowUnapproved: false,
    templatesListed: SAMPLE_TEMPLATES,
    tiktokAudited: false,
    monitoringProvider: "demo",
    diyAgreementApproved: false,
  };
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * MIN).toISOString();
  const migrations = Object.keys(MIGRATION_SENTINELS).sort();
  const heartbeats: LaunchFacts["heartbeats"] = {};
  for (const job of CRON_JOBS) {
    if (job.job === "rounds" || job.job === "autopilot" || job.job === "billing") heartbeats[job.job] = { lastRunAt: at(22), lastOkAt: at(22), lastError: null };
    if (job.job === "leads") heartbeats[job.job] = { lastRunAt: at(3), lastOkAt: at(3), lastError: null };
    if (job.job === "staff-digest") heartbeats[job.job] = { lastRunAt: at(9), lastOkAt: at(60 * 26), lastError: "WhatsApp template credalti_resumen_equipo is not approved yet" };
  }
  return {
    env,
    db: {
      connected: true,
      latestMigration: migrations.at(-1) ?? null,
      missingMigrations: [],
      admins: 1,
      bucketPrivate: true,
      lettersUnapproved: 10,
      plansActive: 0,
      defaultPlan: false,
      texasOpen: true,
      otherStatesOpen: [],
      lastWhatsappInbound: at(41),
      lastLobEvent: at(60 * 30),
      lastHighlevelReceipt: null,
    },
    heartbeats,
    probes: {
      phone_login: { checkedAt: at(60 * 5), ok: true, code: "ok", httpStatus: 200, byName: "Carmen Ruiz" },
      anthropic: { checkedAt: at(60 * 5), ok: true, code: "ok", httpStatus: 200, byName: "Carmen Ruiz" },
    },
    ticks,
    now: now.toISOString(),
  };
}

/** Sample error times for the health view (place → when). */
export function demoErrorTimes(now: Date): Record<string, string> {
  return { "api/cron/staff-digest": new Date(now.getTime() - 9 * MIN).toISOString() };
}
