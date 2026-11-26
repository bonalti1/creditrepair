import type { SupabaseClient } from "@supabase/supabase-js";
import { CRON_JOB_NAMES, type CronJobName } from "../control/heartbeat";
import { ORIGINAL_TEMPLATE_KEYS } from "../letters/templates";
import { listLetterVersions } from "../letters/versions/server";
import { lettersMayBeMailed, type LetterVersion } from "../letters/versions/versions";
import { recentErrorTimes } from "../observability/errors";
import type { StaffMember } from "../staff/access";
import { LAUNCH_ITEMS, MANUAL_ITEMS, MIGRATION_SENTINELS, type DbFacts, type Heartbeat, type LaunchFacts, type ProbeResult, type ProbeService, type Tick } from "./checklist";
import { envFacts, redactSecrets } from "./env";
import { systemHealth, type SystemHealth } from "./health";
import { PROBE_SERVICES, runProbe, type ProbeOutcome } from "./probes";
import { launchReport, type LaunchReport } from "./status";

// Launch readiness on the server (an administrator's: requireCapability
// ("launch")). The facts come from the settings (env.ts: set or not, never a
// value), the database through the service role (counts, yes/no and times:
// no client's data), the heartbeats, the last «Check now» per service and the
// owner's ticks. Heartbeat error texts are redacted before they leave.

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);

/** Every variable name the checklist or the health view asks about. */
export function launchEnvNames(): string[] {
  return [...new Set(LAUNCH_ITEMS.flatMap((i) => i.env ?? []))];
}

async function ok(query: PromiseLike<{ error: unknown }>): Promise<boolean> {
  try {
    const { error } = await query;
    return !error;
  } catch {
    return false;
  }
}

async function newest(db: SupabaseClient, table: string, column: string, eq: Array<[string, string]> = []): Promise<string | null> {
  try {
    let query = db.from(table).select(column);
    for (const [c, v] of eq) query = query.eq(c, v);
    const { data, error } = await query.order(column, { ascending: false }).limit(1);
    if (error) return null;
    return iso(((data as unknown as Row[] | null) ?? [])[0]?.[column]);
  } catch {
    return null;
  }
}

export async function loadDbFacts(db: SupabaseClient): Promise<DbFacts> {
  const connected = await ok(db.from("staff_members").select("user_id", { head: true, count: "exact" }).limit(1));
  if (!connected) {
    return { connected: false, latestMigration: null, missingMigrations: [], admins: null, bucketPrivate: null, lettersUnapproved: null, plansActive: null, defaultPlan: null, texasOpen: null, otherStatesOpen: [], lastWhatsappInbound: null, lastLobEvent: null, lastHighlevelReceipt: null };
  }
  const checks = await Promise.all(
    Object.entries(MIGRATION_SENTINELS).map(async ([migration, sentinel]) => ({
      migration,
      applied: sentinel === null ? null : await ok(db.from(sentinel.table).select(sentinel.column ?? "*", { head: true, count: "exact" }).limit(1)),
    })),
  );
  const applied = checks.filter((c) => c.applied === true).map((c) => c.migration).sort();
  const missingMigrations = checks.filter((c) => c.applied === false).map((c) => c.migration).sort();

  const { count: admins, error: adminError } = await db.from("staff_members").select("user_id", { head: true, count: "exact" }).eq("role", "admin").eq("active", true);

  let bucketPrivate: boolean | null = null;
  try {
    const { data: bucket } = await db.storage.getBucket("identity-docs");
    bucketPrivate = bucket ? bucket.public === false : null;
  } catch {
    bucketPrivate = null;
  }

  let lettersUnapproved: number | null = null;
  try {
    const approved: LetterVersion[] = await listLetterVersions(db, { approvedOnly: true });
    const check = lettersMayBeMailed(ORIGINAL_TEMPLATE_KEYS, approved, {});
    lettersUnapproved = check.ok ? 0 : check.unapproved.length;
  } catch {
    lettersUnapproved = null;
  }

  let plansActive: number | null = null;
  let defaultPlan: boolean | null = null;
  try {
    const { data, error } = await db.from("billing_plans").select("status, is_default").eq("status", "active");
    if (!error) {
      const plans = (data as Row[] | null) ?? [];
      plansActive = plans.length;
      defaultPlan = plans.some((p) => p.is_default === true);
    }
  } catch {
    // Unreadable: null.
  }

  let texasOpen: boolean | null = null;
  let otherStatesOpen: string[] = [];
  try {
    const { data, error } = await db.from("state_openings").select("state, opened");
    if (!error) {
      const open = ((data as Row[] | null) ?? []).filter((r) => r.opened === true).map((r) => String(r.state));
      texasOpen = open.includes("TX");
      otherStatesOpen = open.filter((s) => s !== "TX").sort();
    }
  } catch {
    // Unreadable: null.
  }

  const [lastWhatsappInbound, lastLobEvent, lastHighlevelReceipt] = await Promise.all([
    newest(db, "chat_messages", "created_at", [["channel", "whatsapp"], ["role", "user"]]),
    newest(db, "mail_events", "received_at"),
    newest(db, "webhook_receipts", "received_at"),
  ]);

  return {
    connected,
    latestMigration: applied.at(-1) ?? null,
    missingMigrations,
    admins: adminError ? null : (admins ?? 0),
    bucketPrivate,
    lettersUnapproved,
    plansActive,
    defaultPlan,
    texasOpen,
    otherStatesOpen,
    lastWhatsappInbound,
    lastLobEvent,
    lastHighlevelReceipt,
  };
}

async function loadRows(db: SupabaseClient, table: string, build: (q: ReturnType<SupabaseClient["from"]>) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  try {
    const { data, error } = await build(db.from(table));
    return error ? [] : ((data as Row[] | null) ?? []);
  } catch {
    return [];
  }
}

/** Everything the report and the health view read. `db` null: the database keys are not set. */
export async function loadLaunchFacts(db: SupabaseClient | null, now: Date, env: Record<string, string | undefined> = process.env): Promise<LaunchFacts> {
  const facts: LaunchFacts = { env: envFacts(env, launchEnvNames()), db: null, heartbeats: {}, probes: {}, ticks: {}, now: now.toISOString() };
  if (!db) return facts;
  facts.db = await loadDbFacts(db);
  if (!facts.db.connected) return facts;

  for (const r of await loadRows(db, "cron_heartbeats", (q) => q.select("job, last_run_at, last_ok_at, last_error"))) {
    const job = String(r.job) as CronJobName;
    if (!(CRON_JOB_NAMES as readonly string[]).includes(job)) continue;
    const beat: Heartbeat = { lastRunAt: iso(r.last_run_at) ?? facts.now, lastOkAt: iso(r.last_ok_at), lastError: typeof r.last_error === "string" ? redactSecrets(r.last_error, env) : null };
    facts.heartbeats[job] = beat;
  }
  for (const r of await loadRows(db, "launch_probes", (q) => q.select("service, checked_at, ok, code, http_status, by_name"))) {
    const service = String(r.service) as ProbeService;
    if (!PROBE_SERVICES.includes(service)) continue;
    const probe: ProbeResult = { checkedAt: iso(r.checked_at) ?? facts.now, ok: r.ok === true, code: String(r.code), httpStatus: typeof r.http_status === "number" ? r.http_status : null, byName: String(r.by_name ?? "") };
    facts.probes[service] = probe;
  }
  for (const r of await loadRows(db, "launch_ticks", (q) => q.select("item, done, by_name, note, created_at").order("created_at", { ascending: false }).limit(2000))) {
    const item = String(r.item);
    if (facts.ticks[item] || !MANUAL_ITEMS.includes(item)) continue;
    const t: Tick = { done: r.done === true, byName: String(r.by_name ?? ""), at: iso(r.created_at) ?? facts.now, note: (r.note as string | null) ?? null };
    facts.ticks[item] = t;
  }
  return facts;
}

export async function loadLaunch(db: SupabaseClient | null, now: Date): Promise<{ report: LaunchReport; health: SystemHealth }> {
  const facts = await loadLaunchFacts(db, now);
  const report = launchReport(facts);
  return { report, health: systemHealth(facts, report, recentErrorTimes()) };
}

/** The owner's tick (or untick) on an item the software cannot detect. */
export async function recordTick(db: SupabaseClient, member: StaffMember, item: string, done: boolean, note: string | null): Promise<{ ok: true } | { ok: false; status: number; code: string }> {
  if (!MANUAL_ITEMS.includes(item)) return { ok: false, status: 400, code: "not_manual" };
  const { error } = await db.from("launch_ticks").insert({ item, done, by_user: member.userId, by_name: member.name, note });
  if (error) throw new Error(`launch_ticks: ${error.message}`);
  return { ok: true };
}

/** One check, at most once a minute per service (the route also limits each caller). */
export const PROBE_COOLDOWN_MS = 60_000;

export async function checkService(
  db: SupabaseClient,
  member: StaffMember,
  service: ProbeService,
  now: Date,
  run: (service: ProbeService) => Promise<ProbeOutcome> = (s) => runProbe(s),
): Promise<{ ok: true; outcome: ProbeOutcome } | { ok: false; status: number; code: string }> {
  const { data } = await db.from("launch_probes").select("checked_at").eq("service", service).maybeSingle();
  const last = iso((data as Row | null)?.checked_at);
  if (last && now.getTime() - Date.parse(last) < PROBE_COOLDOWN_MS) return { ok: false, status: 429, code: "cooldown" };
  const outcome = await run(service);
  const { error } = await db.from("launch_probes").upsert({ service, checked_at: now.toISOString(), ok: outcome.ok, code: outcome.code, http_status: outcome.httpStatus, by_name: member.name });
  if (error) throw new Error(`launch_probes: ${error.message}`);
  return { ok: true, outcome };
}
