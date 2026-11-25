import { ALL_TEMPLATES } from "../autopilot/templates";
import { CALL_TEMPLATES } from "../calls/messages";
import type { CronJobName } from "../control/heartbeat";
import { LEAD_TEMPLATES } from "../leads/templates";
import { DIGEST_TEMPLATE as PARTNER_DIGEST_TEMPLATE, SHARE_REQUEST_TEMPLATE } from "../partners/portal";
import { DIGEST_TEMPLATE as STAFF_DIGEST_TEMPLATE } from "../staff/digest";
import type { EnvFacts } from "./env";

// Launch readiness (docs/LAUNCH.md): ONE registry of everything that has to be
// true before Credalti serves real clients, from docs/GO-LIVE.md and the docs
// it points to. Each item says who does it, why it matters (text.ts), the next
// step, the doc section, what it blocks, and how its status is known:
//
//   auto    read from the settings or the database (env.ts, server.ts)
//   probe   needs a check: an administrator taps «Check now» (probes.ts)
//   job     a scheduled job: its last run, from its heartbeat (cron_heartbeats)
//   manual  the software cannot know it: the owner ticks it, with who and when
//
// Statuses: ready · missing · check (needs a check, or late) · manual (owner
// ticks by hand) · failing. Only "ready" counts as ready: the summary never
// says the business can go live while a required item is anything else.
//
// Adding an item: add it here, its words in text.ts (both languages), and, if
// it is a variable, nothing else: the test checks that every variable in
// .env.example is covered by an item or listed in NOT_FOR_LAUNCH with why.

export const LAUNCH_GROUPS = ["legal", "accounts", "database", "jobs", "content", "business"] as const;
export type LaunchGroup = (typeof LAUNCH_GROUPS)[number];

/** required: no launch without it · recommended: launch works, worse · later: only for a later feature. */
export type Needed = "required" | "recommended" | "later";
export type Who = "owner" | "attorney" | "developer" | "identityiq" | "processor";
export type ItemKind = "auto" | "probe" | "job" | "manual";
export type ItemState = "ready" | "missing" | "check" | "manual" | "failing";

/** What a missing item stops. */
export const OUTCOMES = ["everything", "login", "signup", "charging", "mail", "whatsapp", "leads", "automation", "alti", "monitoring", "alerts", "publishing"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type ProbeService = "phone_login" | "anthropic" | "lob" | "whatsapp" | "authorize_net";

export interface Heartbeat {
  lastRunAt: string;
  lastOkAt: string | null;
  /** Already redacted (env.ts redactSecrets). */
  lastError: string | null;
}

export interface ProbeResult {
  checkedAt: string;
  ok: boolean;
  code: string;
  httpStatus: number | null;
  byName: string;
}

export interface Tick {
  done: boolean;
  byName: string;
  at: string;
  note: string | null;
}

export interface DbFacts {
  /** A query worked with the service role. */
  connected: boolean;
  /** The newest migration whose tables are there, and those that are missing. */
  latestMigration: string | null;
  missingMigrations: string[];
  admins: number | null;
  bucketPrivate: boolean | null;
  /** Letters the rounds use with no attorney-approved version; null when it could not be read. */
  lettersUnapproved: number | null;
  plansActive: number | null;
  defaultPlan: boolean | null;
  texasOpen: boolean | null;
  otherStatesOpen: string[];
  lastWhatsappInbound: string | null;
  lastLobEvent: string | null;
  lastHighlevelReceipt: string | null;
}

export interface LaunchFacts {
  env: EnvFacts;
  /** Null when there is no database to read (the keys are not set) or it could not be read. */
  db: DbFacts | null;
  heartbeats: Partial<Record<CronJobName, Heartbeat>>;
  probes: Partial<Record<ProbeService, ProbeResult>>;
  ticks: Record<string, Tick>;
  now: string;
}

/** A note on an item's status: a key of text.ts LAUNCH_TEXT.notes, with its values. */
export interface Note {
  code: NoteCode;
  args?: Array<string | number>;
}

export type NoteCode =
  | "not_set"
  | "set"
  | "waits_on"
  | "mode_test"
  | "mode_live"
  | "mode_unknown"
  | "mode_sandbox"
  | "mode_demo"
  | "approved_current"
  | "not_approved_current"
  | "statutes_unverified"
  | "must_be_empty"
  | "never_ran"
  | "ran_ok"
  | "ran_late"
  | "ran_failed"
  | "probe_needed"
  | "probe_ok"
  | "probe_off"
  | "probe_failed"
  | "db_unreadable"
  | "migrations_missing"
  | "migrations_ok"
  | "count"
  | "none_yet"
  | "ticked"
  | "not_ticked"
  | "templates_listed"
  | "texas_open"
  | "texas_closed"
  | "audited"
  | "not_audited"
  | "demo_provider"
  | "provider_set";

export interface Evaluation {
  state: ItemState;
  notes: Note[];
  /** The variable names still to set (names only). */
  missingEnv?: string[];
}

export interface LaunchItem {
  key: string;
  group: LaunchGroup;
  needed: Needed;
  who: Who;
  kind: ItemKind;
  /** The variables this item covers. For a "one of" item, every alternative. */
  env?: readonly string[];
  /** Where the full steps are: "docs/FILE.md" and a section. */
  docs: { file: string; section: string };
  blocks: readonly Outcome[];
  /** Items that must be ready first (shown as "waits on"). */
  waitsOn?: readonly string[];
  probe?: ProbeService;
  job?: CronJobName;
  /** Lower comes first in "the next things to do". */
  priority: number;
  evaluate?(facts: LaunchFacts): Evaluation;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const unset = (f: LaunchFacts, names: readonly string[]) => names.filter((n) => !f.env.set[n]);

/** Ready when every variable is set; missing (with their names) otherwise. */
function allSet(names: readonly string[]) {
  return (f: LaunchFacts): Evaluation => {
    const missing = unset(f, names);
    return missing.length === 0 ? { state: "ready", notes: [{ code: "set" }] } : { state: "missing", notes: [{ code: "not_set", args: [missing.join(", ")] }], missingEnv: missing };
  };
}

/** Search Console: the site, plus a service account (email + key) or an OAuth client (id + secret + refresh token). */
function searchConsoleSet(f: LaunchFacts): Evaluation {
  const site = unset(f, ["GOOGLE_SEARCH_CONSOLE_SITE"]);
  const service = unset(f, ["GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL", "GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY"]);
  const oauth = unset(f, ["GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN"]);
  if (site.length === 0 && (service.length === 0 || oauth.length === 0)) return { state: "ready", notes: [{ code: "set" }] };
  const missing = [...site, ...(service.length <= oauth.length ? service : oauth)];
  return { state: "missing", notes: [{ code: "not_set", args: [missing.join(", ")] }], missingEnv: missing };
}

/** Ready when at least one of them is set. */
function anySet(names: readonly string[]) {
  return (f: LaunchFacts): Evaluation =>
    names.some((n) => f.env.set[n]) ? { state: "ready", notes: [{ code: "set" }] } : { state: "missing", notes: [{ code: "not_set", args: [names.join(" / ")] }], missingEnv: [...names] };
}

const SUPABASE_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function needsDb(f: LaunchFacts, evaluate: (db: DbFacts) => Evaluation): Evaluation {
  if (unset(f, SUPABASE_ENV).length > 0) return { state: "missing", notes: [{ code: "waits_on", args: ["supabase"] }] };
  if (!f.db || !f.db.connected) return { state: "failing", notes: [{ code: "db_unreadable" }] };
  return evaluate(f.db);
}

/** A probe item: missing without its variables; then the last «Check now». */
function probed(service: ProbeService, names: readonly string[], waitsOn?: string) {
  return (f: LaunchFacts): Evaluation => {
    const missing = unset(f, names);
    if (missing.length > 0) return { state: "missing", notes: [waitsOn ? { code: "waits_on", args: [waitsOn] } : { code: "not_set", args: [missing.join(", ")] }], missingEnv: waitsOn ? undefined : missing };
    const p = f.probes[service];
    if (!p) return { state: "check", notes: [{ code: "probe_needed" }] };
    if (p.ok) return { state: "ready", notes: [{ code: "probe_ok", args: [p.checkedAt, p.byName] }] };
    if (p.code === "off") return { state: "missing", notes: [{ code: "probe_off", args: [p.checkedAt] }] };
    return { state: "failing", notes: [{ code: "probe_failed", args: [p.code, p.checkedAt] }] };
  };
}

/** Set, and not failing its last check (when it has one). */
function setAndNotFailing(service: ProbeService, names: readonly string[]) {
  return (f: LaunchFacts): Evaluation => {
    const base = allSet(names)(f);
    if (base.state !== "ready") return base;
    const p = f.probes[service];
    if (p && !p.ok) return { state: "failing", notes: [{ code: "probe_failed", args: [p.code, p.checkedAt] }] };
    return p ? { state: "ready", notes: [{ code: "probe_ok", args: [p.checkedAt, p.byName] }] } : base;
  };
}

// ── The scheduled jobs (docs/n8n.md) ──────────────────────────────────────

export interface CronJob {
  job: CronJobName;
  path: string;
  workflow: number;
  /** How often n8n should call it, in minutes. */
  everyMinutes: number;
  needed: Needed;
}

export const CRON_JOBS: readonly CronJob[] = [
  { job: "rounds", path: "/api/cron/rounds", workflow: 1, everyMinutes: 60, needed: "required" },
  { job: "autopilot", path: "/api/cron/autopilot", workflow: 3, everyMinutes: 60, needed: "required" },
  { job: "billing", path: "/api/cron/billing", workflow: 4, everyMinutes: 60, needed: "required" },
  { job: "leads", path: "/api/cron/leads", workflow: 6, everyMinutes: 5, needed: "required" },
  { job: "staff-digest", path: "/api/cron/staff-digest", workflow: 5, everyMinutes: 15, needed: "recommended" },
  { job: "content", path: "/api/cron/content", workflow: 7, everyMinutes: 10, needed: "recommended" },
  { job: "partners", path: "/api/cron/partners", workflow: 11, everyMinutes: 60, needed: "recommended" },
  { job: "highlevel", path: "/api/cron/highlevel", workflow: 12, everyMinutes: 30, needed: "later" },
  { job: "ads", path: "/api/cron/ads", workflow: 8, everyMinutes: 180, needed: "later" },
  { job: "seo", path: "/api/cron/seo", workflow: 9, everyMinutes: 24 * 60, needed: "later" },
  { job: "ideas", path: "/api/cron/ideas", workflow: 10, everyMinutes: 7 * 24 * 60, needed: "later" },
];

/** A job is late after three of its intervals with no good run (and never less than two hours). */
export function lateAfterMinutes(job: CronJob): number {
  return Math.max(120, job.everyMinutes * 3);
}

function jobStatus(job: CronJob) {
  return (f: LaunchFacts): Evaluation => {
    if (!f.env.set.N8N_WEBHOOK_SECRET) return { state: "missing", notes: [{ code: "waits_on", args: ["n8n_secret"] }] };
    if (unset(f, SUPABASE_ENV).length > 0) return { state: "missing", notes: [{ code: "waits_on", args: ["supabase"] }] };
    const beat = f.heartbeats[job.job];
    if (!beat) return { state: "missing", notes: [{ code: "never_ran", args: [job.path] }] };
    const failedLast = beat.lastError !== null && (!beat.lastOkAt || Date.parse(beat.lastOkAt) < Date.parse(beat.lastRunAt));
    if (failedLast) return { state: "failing", notes: [{ code: "ran_failed", args: [beat.lastRunAt, beat.lastError ?? ""] }] };
    const okAt = beat.lastOkAt ?? beat.lastRunAt;
    if (Date.parse(f.now) - Date.parse(okAt) > lateAfterMinutes(job) * 60_000) return { state: "check", notes: [{ code: "ran_late", args: [okAt] }] };
    return { state: "ready", notes: [{ code: "ran_ok", args: [okAt] }] };
  };
}

// ── WhatsApp templates (docs/AUTOPILOT.md, «WhatsApp templates to get approved in Meta») ──

/** Every WhatsApp template name the app sends, for the owner's list. */
export const WHATSAPP_TEMPLATE_NAMES: readonly string[] = [
  ...new Set([
    ...ALL_TEMPLATES.map((t) => t.name),
    ...LEAD_TEMPLATES.map((t) => t.name),
    ...Object.values(CALL_TEMPLATES).map((t) => t.name),
    // partners/sharingServer.ts PARTNER_NOTICE_TEMPLATE (a server file; a test keeps the two equal).
    "credalti_socio_avance",
    SHARE_REQUEST_TEMPLATE,
    PARTNER_DIGEST_TEMPLATE,
    STAFF_DIGEST_TEMPLATE,
  ]),
].sort();

// ── Migrations (the database part) ────────────────────────────────────────

/**
 * One table (or column) each migration creates, to tell which migrations a
 * database has without reading its migration history (Supabase's SQL editor
 * keeps none). Null: the migration only changes functions, triggers or
 * defaults, which the app's database API cannot see. Every migration file has
 * an entry; a test fails when one is added without it.
 */
export const MIGRATION_SENTINELS: Record<string, { table: string; column?: string } | null> = {
  "0001_init": { table: "events" },
  "0002_review_states_and_outcomes": { table: "letter_items", column: "outcome" },
  "0003_waitlist_documents": { table: "identity_documents" },
  "0004_chat_messages": { table: "chat_messages" },
  "0005_profile_onboarding": { table: "profiles", column: "referred_by" },
  "0006_server_written_tables": null,
  "0007_staff": { table: "staff_members" },
  "0008_dispute_reason": { table: "item_flags", column: "reason_code" },
  "0009_chat_author": { table: "chat_messages", column: "author_name" },
  "0010_service_agreements": { table: "service_agreements" },
  "0011_billing": { table: "billing_pauses" },
  "0012_team": { table: "team_audit" },
  "0013_mail_tracking": { table: "furnisher_changes" },
  "0014_staff_records": { table: "report_samples" },
  "0015_autopilot": { table: "autopilot_ready_rounds" },
  "0016_intake": { table: "intake_documents" },
  "0017_partners_highlevel": { table: "webhook_receipts" },
  "0018_client_experience": { table: "client_pulses" },
  "0019_letter_versions": { table: "letter_template_versions" },
  "0020_staff_assist": { table: "staff_digests" },
  "0021_data_checks": { table: "item_flags", column: "check_ids" },
  "0022_self_healing": { table: "autopilot_resolutions" },
  "0023_partner_sharing": { table: "partner_notices" },
  "0024_english_default": { table: "partners", column: "locale" },
  "0025_staff_locale": { table: "staff_preferences", column: "locale" },
  "0026_billing_plans": { table: "gateway_events" },
  "0027_cards_households": { table: "household_members" },
  "0028_round_timing": null,
  "0029_reviews": { table: "review_requests" },
  "0030_state_openings": { table: "state_openings" },
  "0031_aftercare": { table: "loan_officer_requests" },
  "0032_calls": { table: "call_messages" },
  "0033_partner_portal": { table: "partner_digests" },
  "0034_control_leads": { table: "cron_heartbeats" },
  "0035_content": { table: "content_publish_log" },
  "0036_accounting": { table: "accounting_audit" },
  "0037_ads": { table: "ads_sync_runs" },
  "0038_video": { table: "video_music" },
  "0039_seo": { table: "seo_settings" },
  "0040_ideas_launch": { table: "launch_probes" },
};

// ── The registry ──────────────────────────────────────────────────────────

const GO_LIVE = "docs/GO-LIVE.md";
const tick = (key: string) => (f: LaunchFacts): Evaluation => {
  const t = f.ticks[key];
  return t?.done ? { state: "ready", notes: [{ code: "ticked", args: [t.byName, t.at] }] } : { state: "manual", notes: [{ code: "not_ticked" }] };
};

const ITEMS: LaunchItem[] = [
  // ── Legal & licensing ──
  { key: "attorney_review", group: "legal", needed: "required", who: "attorney", kind: "manual", docs: { file: GO_LIVE, section: "Step 1 — Three messages to send today" }, blocks: ["signup"], priority: 1 },
  {
    key: "agreement_approved",
    group: "legal",
    needed: "required",
    who: "attorney",
    kind: "auto",
    env: ["NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION"],
    docs: { file: "docs/AGREEMENT.md", section: "Going live" },
    blocks: ["signup"],
    waitsOn: ["attorney_review"],
    priority: 2,
    evaluate: (f) => (f.env.agreementApproved ? { state: "ready", notes: [{ code: "approved_current" }] } : { state: "missing", notes: [{ code: "not_approved_current" }], missingEnv: ["NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION"] }),
  },
  {
    key: "statutes_verified",
    group: "legal",
    needed: "required",
    who: "developer",
    kind: "auto",
    docs: { file: "docs/AGREEMENT.md", section: "Verification of the statutory text" },
    blocks: ["signup"],
    priority: 6,
    evaluate: (f) => (f.env.unverifiedStatutes === 0 ? { state: "ready", notes: [] } : { state: "missing", notes: [{ code: "statutes_unverified", args: [f.env.unverifiedStatutes] }] }),
  },
  {
    key: "payment_authorization",
    group: "legal",
    needed: "required",
    who: "attorney",
    kind: "auto",
    env: ["NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION"],
    docs: { file: "docs/BILLING.md", section: "What the owner must do" },
    blocks: ["charging"],
    waitsOn: ["attorney_review"],
    priority: 3,
    evaluate: (f) => (f.env.paymentAuthorizationApproved ? { state: "ready", notes: [{ code: "approved_current" }] } : { state: "missing", notes: [{ code: "not_approved_current" }], missingEnv: ["NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION"] }),
  },
  {
    key: "ach_authorization",
    group: "legal",
    needed: "recommended",
    who: "attorney",
    kind: "auto",
    env: ["NEXT_PUBLIC_ACH_AUTHORIZATION_APPROVED_VERSION"],
    docs: { file: "docs/BILLING.md", section: "Payment methods: card and ACH bank debit" },
    blocks: ["charging"],
    waitsOn: ["attorney_review"],
    priority: 30,
    evaluate: (f) => (f.env.achAuthorizationApproved ? { state: "ready", notes: [{ code: "approved_current" }] } : { state: "missing", notes: [{ code: "not_approved_current" }], missingEnv: ["NEXT_PUBLIC_ACH_AUTHORIZATION_APPROVED_VERSION"] }),
  },
  { key: "tx_registration", group: "legal", needed: "required", who: "owner", kind: "auto", env: ["NEXT_PUBLIC_TX_CSO_REGISTRATION_NUMBER"], docs: { file: "docs/AGREEMENT.md", section: "What the owner fills in" }, blocks: ["signup"], priority: 4, evaluate: allSet(["NEXT_PUBLIC_TX_CSO_REGISTRATION_NUMBER"]) },
  { key: "tx_bond", group: "legal", needed: "required", who: "owner", kind: "auto", env: ["NEXT_PUBLIC_TX_BOND_SURETY_NAME", "NEXT_PUBLIC_TX_BOND_SURETY_ADDRESS"], docs: { file: "docs/AGREEMENT.md", section: "What the owner fills in" }, blocks: ["signup"], priority: 5, evaluate: allSet(["NEXT_PUBLIC_TX_BOND_SURETY_NAME", "NEXT_PUBLIC_TX_BOND_SURETY_ADDRESS"]) },
  { key: "tx_agent", group: "legal", needed: "required", who: "owner", kind: "auto", env: ["NEXT_PUBLIC_TX_AGENT_NAME", "NEXT_PUBLIC_TX_AGENT_ADDRESS"], docs: { file: "docs/AGREEMENT.md", section: "What the owner fills in" }, blocks: ["signup"], priority: 7, evaluate: allSet(["NEXT_PUBLIC_TX_AGENT_NAME", "NEXT_PUBLIC_TX_AGENT_ADDRESS"]) },
  {
    key: "letters_approved",
    group: "legal",
    needed: "required",
    who: "attorney",
    kind: "auto",
    docs: { file: GO_LIVE, section: "Step 5 — Before the first real letter" },
    blocks: ["mail"],
    waitsOn: ["supabase", "attorney_review"],
    priority: 8,
    evaluate: (f) =>
      needsDb(f, (db) =>
        db.lettersUnapproved === null ? { state: "failing", notes: [{ code: "db_unreadable" }] } : db.lettersUnapproved === 0 ? { state: "ready", notes: [] } : { state: "missing", notes: [{ code: "count", args: [db.lettersUnapproved] }] },
      ),
  },
  {
    key: "letters_test_switch_off",
    group: "legal",
    needed: "required",
    who: "developer",
    kind: "auto",
    env: ["LETTERS_ALLOW_UNAPPROVED"],
    docs: { file: GO_LIVE, section: "Step 5 — Before the first real letter" },
    blocks: ["mail"],
    priority: 9,
    evaluate: (f) => (f.env.lettersAllowUnapproved ? { state: "failing", notes: [{ code: "must_be_empty", args: ["LETTERS_ALLOW_UNAPPROVED"] }] } : { state: "ready", notes: [] }),
  },
  {
    key: "texas_only",
    group: "legal",
    needed: "required",
    who: "owner",
    kind: "auto",
    docs: { file: "docs/STATES.md", section: "What the app enforces" },
    blocks: ["signup"],
    waitsOn: ["supabase"],
    priority: 10,
    evaluate: (f) =>
      needsDb(f, (db) =>
        db.texasOpen === null ? { state: "failing", notes: [{ code: "db_unreadable" }] } : db.texasOpen ? { state: "ready", notes: [{ code: "texas_open", args: [db.otherStatesOpen.join(", ")] }] } : { state: "missing", notes: [{ code: "texas_closed" }] },
      ),
  },

  // ── Accounts & keys ──
  { key: "supabase", group: "accounts", needed: "required", who: "owner", kind: "auto", env: SUPABASE_ENV, docs: { file: "docs/DATABASE.md", section: "5. Put the keys into Render" }, blocks: ["everything"], priority: 11, evaluate: allSet(SUPABASE_ENV) },
  { key: "phone_login", group: "accounts", needed: "required", who: "owner", kind: "probe", probe: "phone_login", docs: { file: "docs/DATABASE.md", section: "4. Turn on phone login" }, blocks: ["login"], waitsOn: ["supabase"], priority: 12, evaluate: probed("phone_login", SUPABASE_ENV, "supabase") },
  { key: "anthropic", group: "accounts", needed: "required", who: "owner", kind: "auto", env: ["ANTHROPIC_API_KEY"], probe: "anthropic", docs: { file: GO_LIVE, section: "Step 2 — Open the accounts" }, blocks: ["alti"], priority: 13, evaluate: setAndNotFailing("anthropic", ["ANTHROPIC_API_KEY"]) },
  {
    key: "lob_key",
    group: "accounts",
    needed: "required",
    who: "owner",
    kind: "auto",
    env: ["LOB_API_KEY"],
    probe: "lob",
    docs: { file: GO_LIVE, section: "Step 2 — Open the accounts" },
    blocks: ["mail"],
    priority: 14,
    evaluate: (f) => {
      const base = setAndNotFailing("lob", ["LOB_API_KEY"])(f);
      if (base.state !== "ready") return base;
      return { ...base, notes: [...base.notes, { code: f.env.lobMode === "live" ? "mode_live" : f.env.lobMode === "test" ? "mode_test" : "mode_unknown" }] };
    },
  },
  {
    key: "lob_live",
    group: "accounts",
    needed: "required",
    who: "owner",
    kind: "auto",
    docs: { file: GO_LIVE, section: "Step 4 — Check it" },
    blocks: ["mail"],
    waitsOn: ["lob_key", "test_pass"],
    priority: 40,
    evaluate: (f) =>
      f.env.lobMode === null
        ? { state: "missing", notes: [{ code: "waits_on", args: ["lob_key"] }] }
        : f.env.lobMode === "live"
          ? { state: "ready", notes: [{ code: "mode_live" }] }
          : f.env.lobMode === "test"
            ? { state: "missing", notes: [{ code: "mode_test" }] }
            : { state: "check", notes: [{ code: "mode_unknown" }] },
  },
  { key: "lob_webhook", group: "accounts", needed: "required", who: "owner", kind: "auto", env: ["LOB_WEBHOOK_SECRET"], docs: { file: GO_LIVE, section: "Step 3 — Three one-time setups" }, blocks: ["mail"], waitsOn: ["lob_key"], priority: 15, evaluate: allSet(["LOB_WEBHOOK_SECRET"]) },
  { key: "whatsapp", group: "accounts", needed: "required", who: "owner", kind: "auto", env: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"], probe: "whatsapp", docs: { file: GO_LIVE, section: "Step 2 — Open the accounts" }, blocks: ["whatsapp", "leads"], priority: 16, evaluate: setAndNotFailing("whatsapp", ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) },
  { key: "whatsapp_webhook", group: "accounts", needed: "required", who: "owner", kind: "auto", env: ["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"], docs: { file: GO_LIVE, section: "Step 3 — Three one-time setups" }, blocks: ["leads"], waitsOn: ["whatsapp"], priority: 17, evaluate: allSet(["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"]) },
  { key: "whatsapp_number", group: "accounts", needed: "required", who: "owner", kind: "auto", env: ["NEXT_PUBLIC_WHATSAPP_NUMBER"], docs: { file: GO_LIVE, section: "Step 2 — Open the accounts" }, blocks: ["leads"], priority: 18, evaluate: allSet(["NEXT_PUBLIC_WHATSAPP_NUMBER"]) },
  {
    key: "payment_gateway",
    group: "accounts",
    needed: "required",
    who: "processor",
    kind: "auto",
    env: ["BILLING_GATEWAY", "NMI_SECURITY_KEY", "NEXT_PUBLIC_NMI_TOKENIZATION_KEY", "AUTHORIZE_NET_API_LOGIN_ID", "AUTHORIZE_NET_TRANSACTION_KEY", "NEXT_PUBLIC_AUTHORIZE_NET_API_LOGIN_ID", "NEXT_PUBLIC_AUTHORIZE_NET_CLIENT_KEY", "AUTHORIZE_NET_ENV"],
    probe: "authorize_net",
    docs: { file: "docs/BILLING.md", section: "Gateways (BILLING_GATEWAY=nmi|authorize_net|demo)" },
    blocks: ["charging"],
    priority: 19,
    evaluate: (f) => {
      if (f.env.gateway === null) return { state: "missing", notes: [{ code: "not_set", args: ["BILLING_GATEWAY"] }], missingEnv: ["BILLING_GATEWAY"] };
      if (f.env.gateway === "demo") return { state: "missing", notes: [{ code: "mode_demo" }] };
      if (!f.env.gatewayComplete) return { state: "missing", notes: [{ code: "not_set", args: [f.env.gateway === "nmi" ? "NMI_SECURITY_KEY, NEXT_PUBLIC_NMI_TOKENIZATION_KEY" : f.env.gateway === "authorize_net" ? "AUTHORIZE_NET_API_LOGIN_ID, AUTHORIZE_NET_TRANSACTION_KEY, NEXT_PUBLIC_AUTHORIZE_NET_CLIENT_KEY" : "BILLING_GATEWAY"] }] };
      const p = f.env.gateway === "authorize_net" ? f.probes.authorize_net : undefined;
      if (p && !p.ok) return { state: "failing", notes: [{ code: "probe_failed", args: [p.code, p.checkedAt] }] };
      const mode: Note = { code: f.env.gatewayMode === "live" ? "mode_live" : f.env.gatewayMode === "sandbox" ? "mode_sandbox" : "mode_unknown" };
      // Authorize.Net's sandbox moves no money: not ready for real clients.
      if (f.env.gatewayMode === "sandbox") return { state: "missing", notes: [mode] };
      return { state: "ready", notes: [mode] };
    },
  },
  {
    key: "payment_webhook_key",
    group: "accounts",
    needed: "required",
    who: "processor",
    kind: "auto",
    env: ["NMI_WEBHOOK_SIGNING_KEY", "AUTHORIZE_NET_SIGNATURE_KEY"],
    docs: { file: "docs/BILLING.md", section: "What the owner must do" },
    blocks: ["charging"],
    waitsOn: ["payment_gateway"],
    priority: 20,
    evaluate: (f) =>
      f.env.gateway === "nmi" || f.env.gateway === "authorize_net"
        ? f.env.gatewayWebhookKey
          ? { state: "ready", notes: [{ code: "set" }] }
          : { state: "missing", notes: [{ code: "not_set", args: [f.env.gateway === "nmi" ? "NMI_WEBHOOK_SIGNING_KEY" : "AUTHORIZE_NET_SIGNATURE_KEY"] }] }
        : { state: "missing", notes: [{ code: "waits_on", args: ["payment_gateway"] }] },
  },
  { key: "payment_webhook_pointed", group: "accounts", needed: "required", who: "owner", kind: "manual", docs: { file: GO_LIVE, section: "Billing plans and payments" }, blocks: ["charging"], waitsOn: ["payment_gateway"], priority: 21 },
  { key: "payment_sandbox_checks", group: "accounts", needed: "required", who: "developer", kind: "manual", docs: { file: "docs/BILLING.md", section: "Gateways (BILLING_GATEWAY=nmi|authorize_net|demo)" }, blocks: ["charging"], waitsOn: ["payment_gateway"], priority: 22 },
  { key: "n8n_secret", group: "accounts", needed: "required", who: "owner", kind: "auto", env: ["N8N_WEBHOOK_SECRET"], docs: { file: "docs/n8n.md", section: "Workflow 1: hourly round check" }, blocks: ["automation"], priority: 23, evaluate: allSet(["N8N_WEBHOOK_SECRET"]) },
  { key: "app_url", group: "accounts", needed: "required", who: "owner", kind: "auto", env: ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL"], docs: { file: GO_LIVE, section: "Step 2 — Open the accounts" }, blocks: ["whatsapp", "signup"], priority: 24, evaluate: allSet(["NEXT_PUBLIC_APP_URL"]) },
  { key: "identityiq_link", group: "accounts", needed: "required", who: "identityiq", kind: "auto", env: ["NEXT_PUBLIC_MONITORING_SIGNUP_URL"], docs: { file: "docs/IDENTITYIQ.md", section: "Going live checklist" }, blocks: ["monitoring"], priority: 25, evaluate: allSet(["NEXT_PUBLIC_MONITORING_SIGNUP_URL"]) },
  { key: "identityiq_price", group: "accounts", needed: "required", who: "identityiq", kind: "auto", env: ["NEXT_PUBLIC_MONITORING_PRICE"], docs: { file: GO_LIVE, section: "Step 2 — Open the accounts" }, blocks: ["monitoring"], waitsOn: ["identityiq_link"], priority: 26, evaluate: allSet(["NEXT_PUBLIC_MONITORING_PRICE"]) },
  {
    key: "identityiq_reports",
    group: "accounts",
    needed: "later",
    who: "identityiq",
    kind: "auto",
    env: ["MONITORING_PROVIDER", "MONITORING_API_KEY", "MONITORING_API_BASE_URL"],
    docs: { file: "docs/IDENTITYIQ.md", section: "What is blocked, and what unblocks it" },
    blocks: [],
    priority: 90,
    evaluate: (f) => (f.env.monitoringProvider === "demo" ? { state: "missing", notes: [{ code: "demo_provider" }] } : { state: "ready", notes: [{ code: "provider_set" }] }),
  },
  { key: "email", group: "accounts", needed: "recommended", who: "owner", kind: "auto", env: ["EMAIL_API_KEY", "EMAIL_FROM", "UNSUBSCRIBE_SECRET", "EMAIL_API_URL"], docs: { file: "docs/AUTOPILOT.md", section: "Channels" }, blocks: ["automation"], priority: 31, evaluate: allSet(["EMAIL_API_KEY", "EMAIL_FROM", "UNSUBSCRIBE_SECRET"]) },
  { key: "error_alerts", group: "accounts", needed: "recommended", who: "owner", kind: "auto", env: ["ERROR_WEBHOOK_URL"], docs: { file: GO_LIVE, section: "Step 2 — Open the accounts" }, blocks: ["alerts"], priority: 32, evaluate: allSet(["ERROR_WEBHOOK_URL"]) },
  { key: "team_alerts", group: "accounts", needed: "recommended", who: "owner", kind: "auto", env: ["SALES_WEBHOOK_URL", "TEAM_WEBHOOK_URL"], docs: { file: GO_LIVE, section: "Step 2 — Open the accounts" }, blocks: ["alerts"], priority: 33, evaluate: anySet(["SALES_WEBHOOK_URL", "TEAM_WEBHOOK_URL"]) },
  { key: "vapid", group: "accounts", needed: "recommended", who: "developer", kind: "auto", env: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"], docs: { file: "docs/CONTROL.md", section: "Phone alerts (OFF for everyone)" }, blocks: ["alerts"], priority: 34, evaluate: allSet(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) },
  { key: "content_token_key", group: "accounts", needed: "later", who: "developer", kind: "auto", env: ["CONTENT_TOKEN_KEY"], docs: { file: "docs/CONTENT.md", section: "Connecting the accounts" }, blocks: ["publishing"], priority: 91, evaluate: allSet(["CONTENT_TOKEN_KEY"]) },
  { key: "meta_app", group: "accounts", needed: "later", who: "owner", kind: "auto", env: ["META_APP_ID", "META_APP_SECRET", "META_PAGE_ID"], docs: { file: "docs/CONTENT.md", section: "Connecting the accounts" }, blocks: ["publishing"], waitsOn: ["content_token_key"], priority: 92, evaluate: allSet(["META_APP_ID", "META_APP_SECRET"]) },
  {
    key: "tiktok_app",
    group: "accounts",
    needed: "later",
    who: "owner",
    kind: "auto",
    env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_AUDITED"],
    docs: { file: "docs/CONTENT.md", section: "Connecting the accounts" },
    blocks: ["publishing"],
    waitsOn: ["content_token_key"],
    priority: 93,
    evaluate: (f) => {
      const base = allSet(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"])(f);
      return base.state === "ready" ? { ...base, notes: [...base.notes, { code: f.env.tiktokAudited ? "audited" : "not_audited" }] } : base;
    },
  },
  { key: "youtube_app", group: "accounts", needed: "later", who: "owner", kind: "auto", env: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"], docs: { file: "docs/CONTENT.md", section: "Connecting the accounts" }, blocks: ["publishing"], waitsOn: ["content_token_key"], priority: 94, evaluate: allSet(["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]) },
  { key: "meta_ads", group: "accounts", needed: "later", who: "owner", kind: "auto", env: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"], docs: { file: "docs/ADS.md", section: "For the owner" }, blocks: [], priority: 94.1, evaluate: allSet(["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]) },
  { key: "search_console", group: "accounts", needed: "later", who: "owner", kind: "auto", env: ["GOOGLE_SEARCH_CONSOLE_SITE", "GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL", "GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY", "GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN"], docs: { file: "docs/SEO.md", section: "Search Console" }, blocks: [], priority: 94.2, evaluate: searchConsoleSet },
  { key: "transcribe", group: "accounts", needed: "later", who: "owner", kind: "auto", env: ["TRANSCRIBE_API_KEY", "TRANSCRIBE_PROVIDER", "TRANSCRIBE_MODEL", "TRANSCRIBE_API_URL"], docs: { file: "docs/VIDEO.md", section: "What needs the owner" }, blocks: [], priority: 94.3, evaluate: allSet(["TRANSCRIBE_API_KEY"]) },
  { key: "highlevel", group: "accounts", needed: "later", who: "owner", kind: "auto", env: ["HIGHLEVEL_WEBHOOK_SECRET", "HIGHLEVEL_INBOUND_WEBHOOK_URL", "LEAD_CONVERSATIONS_PROVIDER", "HIGHLEVEL_API_TOKEN", "HIGHLEVEL_LOCATION_ID"], docs: { file: "docs/HIGHLEVEL.md", section: "1. In the app (once)" }, blocks: [], priority: 95, evaluate: allSet(["HIGHLEVEL_WEBHOOK_SECRET"]) },

  // ── Database ──
  { key: "db_connected", group: "database", needed: "required", who: "developer", kind: "auto", docs: { file: "docs/DATABASE.md", section: "2. Create the tables" }, blocks: ["everything"], waitsOn: ["supabase"], priority: 27, evaluate: (f) => needsDb(f, () => ({ state: "ready", notes: [] })) },
  {
    key: "db_migrations",
    group: "database",
    needed: "required",
    who: "developer",
    kind: "auto",
    docs: { file: "docs/DATABASE.md", section: "2. Create the tables" },
    blocks: ["everything"],
    waitsOn: ["db_connected"],
    priority: 28,
    evaluate: (f) =>
      needsDb(f, (db) =>
        db.missingMigrations.length === 0 ? { state: "ready", notes: [{ code: "migrations_ok", args: [db.latestMigration ?? ""] }] } : { state: "missing", notes: [{ code: "migrations_missing", args: [db.missingMigrations.join(", ")] }] },
      ),
  },
  {
    key: "db_admin",
    group: "database",
    needed: "required",
    who: "owner",
    kind: "auto",
    docs: { file: "docs/DATABASE.md", section: "6. Make yourself the first administrator" },
    blocks: ["everything"],
    waitsOn: ["db_connected"],
    priority: 29,
    evaluate: (f) => needsDb(f, (db) => (db.admins === null ? { state: "failing", notes: [{ code: "db_unreadable" }] } : db.admins > 0 ? { state: "ready", notes: [{ code: "count", args: [db.admins] }] } : { state: "missing", notes: [{ code: "none_yet" }] })),
  },
  {
    key: "db_id_bucket",
    group: "database",
    needed: "required",
    who: "developer",
    kind: "auto",
    docs: { file: "docs/DATABASE.md", section: "3. Check the storage bucket" },
    blocks: ["signup"],
    waitsOn: ["db_connected"],
    priority: 35,
    evaluate: (f) => needsDb(f, (db) => (db.bucketPrivate === true ? { state: "ready", notes: [] } : db.bucketPrivate === false ? { state: "failing", notes: [] } : { state: "missing", notes: [{ code: "none_yet" }] })),
  },

  // ── Scheduled jobs ──
  ...CRON_JOBS.map(
    (job): LaunchItem => ({
      key: `job_${job.job.replace(/-/g, "_")}`,
      group: "jobs",
      needed: job.needed,
      who: "owner",
      kind: "job",
      job: job.job,
      docs: { file: "docs/n8n.md", section: `Workflow ${job.workflow}` },
      blocks: ["automation"],
      waitsOn: ["n8n_secret", "supabase"],
      priority: job.needed === "required" ? 36 : job.needed === "recommended" ? 50 : 96,
      evaluate: jobStatus(job),
    }),
  ),

  // ── Content ──
  { key: "whatsapp_templates_meta", group: "content", needed: "required", who: "owner", kind: "manual", docs: { file: "docs/AUTOPILOT.md", section: "WhatsApp templates to get approved in Meta" }, blocks: ["whatsapp"], waitsOn: ["whatsapp"], priority: 37 },
  {
    key: "whatsapp_templates_listed",
    group: "content",
    needed: "recommended",
    who: "owner",
    kind: "auto",
    env: ["WHATSAPP_APPROVED_TEMPLATES"],
    docs: { file: "docs/AUTOPILOT.md", section: "WhatsApp templates to get approved in Meta" },
    blocks: ["whatsapp"],
    waitsOn: ["whatsapp_templates_meta"],
    priority: 38,
    evaluate: (f) => {
      const listed = WHATSAPP_TEMPLATE_NAMES.filter((n) => f.env.templatesListed.includes(n)).length;
      const note: Note = { code: "templates_listed", args: [listed, WHATSAPP_TEMPLATE_NAMES.length] };
      return listed === WHATSAPP_TEMPLATE_NAMES.length ? { state: "ready", notes: [note] } : listed === 0 ? { state: "missing", notes: [note], missingEnv: ["WHATSAPP_APPROVED_TEMPLATES"] } : { state: "check", notes: [note] };
    },
  },
  { key: "social_accounts", group: "content", needed: "later", who: "owner", kind: "manual", docs: { file: "docs/CONTENT.md", section: "Connecting the accounts" }, blocks: ["publishing"], priority: 97 },

  // ── Business setup ──
  { key: "company_details", group: "business", needed: "required", who: "owner", kind: "auto", env: ["NEXT_PUBLIC_COMPANY_LEGAL_NAME", "NEXT_PUBLIC_COMPANY_ADDRESS", "NEXT_PUBLIC_COMPANY_EMAIL", "NEXT_PUBLIC_COMPANY_PHONE"], docs: { file: "docs/AGREEMENT.md", section: "What the owner fills in" }, blocks: ["signup"], priority: 39, evaluate: (f) => termsItem(f, ["NEXT_PUBLIC_COMPANY_LEGAL_NAME", "NEXT_PUBLIC_COMPANY_ADDRESS", "NEXT_PUBLIC_COMPANY_EMAIL"]) },
  { key: "prices", group: "business", needed: "required", who: "owner", kind: "auto", env: ["NEXT_PUBLIC_PLAN_MONTHLY_FEE", "NEXT_PUBLIC_PLAN_ESTIMATED_MONTHS"], docs: { file: "docs/AGREEMENT.md", section: "What the owner fills in" }, blocks: ["signup", "charging"], priority: 41, evaluate: (f) => termsItem(f, ["NEXT_PUBLIC_PLAN_MONTHLY_FEE", "NEXT_PUBLIC_PLAN_ESTIMATED_MONTHS"]) },
  {
    key: "plans_approved",
    group: "business",
    needed: "required",
    who: "attorney",
    kind: "auto",
    docs: { file: "docs/BILLING.md", section: "Plans (/equipo/planes, administrators)" },
    blocks: ["signup"],
    waitsOn: ["supabase", "attorney_review"],
    priority: 42,
    evaluate: (f) => needsDb(f, (db) => (db.plansActive === null ? { state: "failing", notes: [{ code: "db_unreadable" }] } : db.plansActive > 0 ? { state: "ready", notes: [{ code: "count", args: [db.plansActive] }] } : { state: "missing", notes: [{ code: "none_yet" }] })),
  },
  {
    key: "default_plan",
    group: "business",
    needed: "required",
    who: "owner",
    kind: "auto",
    docs: { file: "docs/BILLING.md", section: "Plans (/equipo/planes, administrators)" },
    blocks: ["signup"],
    waitsOn: ["plans_approved"],
    priority: 43,
    evaluate: (f) => needsDb(f, (db) => (db.defaultPlan === null ? { state: "failing", notes: [{ code: "db_unreadable" }] } : db.defaultPlan ? { state: "ready", notes: [] } : { state: "missing", notes: [{ code: "none_yet" }] })),
  },
  {
    key: "fee_estimates",
    group: "business",
    needed: "later",
    who: "owner",
    kind: "auto",
    env: ["NEXT_PUBLIC_BILLING_FEE_CARD_BPS", "NEXT_PUBLIC_BILLING_FEE_CARD_FIXED_CENTS", "NEXT_PUBLIC_BILLING_FEE_ACH_BPS", "NEXT_PUBLIC_BILLING_FEE_ACH_FIXED_CENTS", "NEXT_PUBLIC_BILLING_FEE_ACH_CAP_CENTS"],
    docs: { file: GO_LIVE, section: "Billing plans and payments" },
    blocks: [],
    waitsOn: ["payment_gateway"],
    priority: 98,
    evaluate: allSet(["NEXT_PUBLIC_BILLING_FEE_CARD_BPS", "NEXT_PUBLIC_BILLING_FEE_CARD_FIXED_CENTS", "NEXT_PUBLIC_BILLING_FEE_ACH_BPS", "NEXT_PUBLIC_BILLING_FEE_ACH_FIXED_CENTS"]),
  },
  { key: "bureau_addresses", group: "business", needed: "required", who: "owner", kind: "manual", docs: { file: GO_LIVE, section: "Step 5 — Before the first real letter" }, blocks: ["mail"], priority: 44 },
  { key: "creditor_addresses", group: "business", needed: "recommended", who: "owner", kind: "manual", docs: { file: GO_LIVE, section: "Step 5 — Before the first real letter" }, blocks: ["mail"], waitsOn: ["supabase"], priority: 51 },
  { key: "test_pass", group: "business", needed: "required", who: "owner", kind: "manual", docs: { file: GO_LIVE, section: "Step 4 — Check it" }, blocks: ["signup"], waitsOn: ["supabase", "phone_login", "lob_key"], priority: 45 },
  { key: "letter_to_self", group: "business", needed: "required", who: "owner", kind: "manual", docs: { file: GO_LIVE, section: "Step 5 — Before the first real letter" }, blocks: ["mail"], waitsOn: ["lob_key", "letters_approved"], priority: 46 },
];

export const LAUNCH_ITEMS: readonly LaunchItem[] = ITEMS.map((item) => (item.kind === "manual" ? { ...item, evaluate: tick(item.key) } : item));

function termsItem(f: LaunchFacts, names: string[]): Evaluation {
  const missing = names.filter((n) => f.env.termsMissing.includes(n));
  return missing.length === 0 ? { state: "ready", notes: [{ code: "set" }] } : { state: "missing", notes: [{ code: "not_set", args: [missing.join(", ")] }], missingEnv: missing };
}

export const ITEM_BY_KEY: ReadonlyMap<string, LaunchItem> = new Map(LAUNCH_ITEMS.map((i) => [i.key, i]));

/** The items the owner ticks by hand. */
export const MANUAL_ITEMS: readonly string[] = LAUNCH_ITEMS.filter((i) => i.kind === "manual").map((i) => i.key);

/**
 * Variables in .env.example that no item covers, and why. Everything else in
 * .env.example belongs to an item (the test checks both ways).
 */
export const NOT_FOR_LAUNCH: Record<string, string> = {
  INTAKE_MODEL: "Optional: which model AI intake uses; it has a default.",
  DRAFT_MODEL: "Optional: which model drafts staff replies; it has a default.",
  CONTENT_MODEL: "Optional: which model the content assistant uses; it has a default.",
  IDEAS_MODEL: "Optional: which model Alti uses for ideas; it has a default.",
  META_GRAPH_VERSION: "Optional: the Graph API version for the ads calls; it has a default.",
  STRIPE_SECRET_KEY: "Not used with IdentityIQ: clients pay the provider directly.",
  STRIPE_WEBHOOK_SECRET: "Not used with IdentityIQ.",
  WHATSAPP_LEAD_REPLIES: "Optional: leave empty so Alti greets a lead once and a person answers.",
  NEXT_PUBLIC_SERVICE_MODE: "Leave empty for full service, the business today.",
  NEXT_PUBLIC_FEATURE_ABA_HANDOFF: "Ships off until the attorney signs off on it.",
  NEXT_PUBLIC_CALLS_ENABLED: "Built and off until the attorney answers the Telemarketing Sales Rule question.",
  SOFT_PULL_PROVIDER: "No soft-pull provider is connected; the default is correct.",
  NMI_API_URL: "Optional override of NMI's endpoint; the default is correct.",
  NMI_QUERY_URL: "Optional override of NMI's endpoint; the default is correct.",
  PARTNER_LANDING_URL: "Optional: where partner links land; empty uses this app's landing page.",
};

export type { EnvFacts };
