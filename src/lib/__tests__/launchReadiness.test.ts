import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { CRON_JOB_NAMES } from "../control/heartbeat";
import {
  CRON_JOBS,
  ITEM_BY_KEY,
  LAUNCH_ITEMS,
  MANUAL_ITEMS,
  MIGRATION_SENTINELS,
  NOT_FOR_LAUNCH,
  WHATSAPP_TEMPLATE_NAMES,
  type DbFacts,
  type LaunchFacts,
} from "../launch/checklist";
import { demoLaunchFacts } from "../launch/demo";
import { envFacts, redactSecrets, SECRET_ENV, type EnvFacts } from "../launch/env";
import { systemHealth } from "../launch/health";
import { probeConfigured, runProbe } from "../launch/probes";
import { launchEnvNames, loadLaunchFacts } from "../launch/server";
import { launchReport, summarize } from "../launch/status";
import { LAUNCH_TEXT } from "../launch/text";
import { PARTNER_NOTICE_TEMPLATE } from "../partners/sharingServer";
import { can, deniedReason, STAFF_ROLES } from "../staff/permissions";

// Launch readiness (docs/LAUNCH.md): the registry covers every setting the
// launch needs, its words exist in both languages, the status logic never
// says "live" while something required is not ready, and nothing it returns
// says anything about a secret's value.

const NOW = new Date("2026-11-25T15:00:00.000Z");
const envExample = readFileSync(".env.example", "utf8");
const exampleNames = [...envExample.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
const covered = new Set(LAUNCH_ITEMS.flatMap((i) => i.env ?? []));

describe("the registry: every setting is covered", () => {
  it("every variable in .env.example belongs to an item, or is listed as not needed for launch with a reason", () => {
    const uncovered = exampleNames.filter((n) => !covered.has(n) && !(n in NOT_FOR_LAUNCH));
    expect(uncovered).toEqual([]);
    for (const [name, why] of Object.entries(NOT_FOR_LAUNCH)) {
      expect(exampleNames, name).toContain(name);
      expect(covered.has(name), `${name} is both covered and excluded`).toBe(false);
      expect(why.length).toBeGreaterThan(10);
    }
  });

  it("every variable an item names exists in .env.example", () => {
    for (const name of covered) expect(exampleNames, name).toContain(name);
  });

  it("every variable docs/GO-LIVE.md asks the owner to set is covered by an item", () => {
    const goLive = readFileSync("docs/GO-LIVE.md", "utf8");
    const named = [...new Set([...goLive.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1]!))].filter((n) => exampleNames.includes(n));
    expect(named.length).toBeGreaterThan(20);
    for (const name of named) expect(covered.has(name) || name in NOT_FOR_LAUNCH, name).toBe(true);
  });

  it("the attorney's approvals, Texas registration, bond and agent, the processor and n8n are required items", () => {
    const requiredEnv = new Set(LAUNCH_ITEMS.filter((i) => i.needed === "required").flatMap((i) => i.env ?? []));
    for (const name of [
      "NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION",
      "NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION",
      "NEXT_PUBLIC_TX_CSO_REGISTRATION_NUMBER",
      "NEXT_PUBLIC_TX_BOND_SURETY_NAME",
      "NEXT_PUBLIC_TX_AGENT_NAME",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "ANTHROPIC_API_KEY",
      "LOB_API_KEY",
      "LOB_WEBHOOK_SECRET",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
      "BILLING_GATEWAY",
      "N8N_WEBHOOK_SECRET",
      "NEXT_PUBLIC_MONITORING_SIGNUP_URL",
      "NEXT_PUBLIC_MONITORING_PRICE",
      "NEXT_PUBLIC_COMPANY_LEGAL_NAME",
      "NEXT_PUBLIC_PLAN_MONTHLY_FEE",
      "NEXT_PUBLIC_APP_URL",
    ]) {
      expect(requiredEnv.has(name), name).toBe(true);
    }
  });

  it("every secret is a variable of .env.example, and every name the server reads is one of the items'", () => {
    for (const name of SECRET_ENV) expect(exampleNames, name).toContain(name);
    expect(new Set(launchEnvNames())).toEqual(covered);
  });

  it("every item has its words in both languages, and only those", () => {
    for (const locale of ["en", "es"] as const) {
      expect(Object.keys(LAUNCH_TEXT[locale].items).sort()).toEqual(LAUNCH_ITEMS.map((i) => i.key).sort());
      for (const item of LAUNCH_ITEMS) {
        const t = LAUNCH_TEXT[locale].items[item.key as keyof (typeof LAUNCH_TEXT)["en"]["items"]];
        for (const line of [t.title, t.why, t.next]) {
          expect(line.length, `${locale} ${item.key}`).toBeGreaterThan(3);
          expect(checkClaimGuardrails(line), `${locale} ${item.key}: ${line}`).toEqual([]);
        }
      }
    }
  });

  it("keys are unique, prerequisites exist, and the doc each item points to has that section", () => {
    expect(new Set(LAUNCH_ITEMS.map((i) => i.key)).size).toBe(LAUNCH_ITEMS.length);
    for (const item of LAUNCH_ITEMS) {
      for (const w of item.waitsOn ?? []) expect(ITEM_BY_KEY.has(w), `${item.key} waits on ${w}`).toBe(true);
      expect(existsSync(item.docs.file), item.docs.file).toBe(true);
      const headings = readFileSync(item.docs.file, "utf8")
        .split("\n")
        .filter((l) => /^#{1,4} /.test(l))
        .map((l) => l.replace(/^#+ /, "").replace(/`/g, ""));
      expect(headings.some((h) => h.startsWith(item.docs.section.replace(/`/g, ""))), `${item.key}: ${item.docs.file} «${item.docs.section}»`).toBe(true);
      expect(typeof item.evaluate, item.key).toBe("function");
    }
  });

  it("manual items are the ones the software cannot know; probe items name a check", () => {
    expect(MANUAL_ITEMS).toEqual(expect.arrayContaining(["attorney_review", "test_pass", "letter_to_self", "whatsapp_templates_meta", "payment_webhook_pointed", "payment_sandbox_checks", "bureau_addresses"]));
    for (const item of LAUNCH_ITEMS.filter((i) => i.kind === "probe")) expect(item.probe).toBeTruthy();
  });
});

describe("the registry: scheduled jobs and migrations", () => {
  it("one job per /api/cron route, each recording its heartbeat, each in docs/n8n.md", () => {
    const routes = readdirSync("src/app/api/cron").filter((d) => statSync(join("src/app/api/cron", d)).isDirectory());
    expect([...CRON_JOB_NAMES].sort()).toEqual(routes.sort());
    expect(CRON_JOBS.map((j) => j.job).sort()).toEqual([...CRON_JOB_NAMES].sort());
    const n8n = readFileSync("docs/n8n.md", "utf8");
    for (const job of CRON_JOBS) {
      const source = readFileSync(`src/app/api/cron/${job.job}/route.ts`, "utf8");
      expect(source, job.job).toMatch(new RegExp(`(safeBeat|beat)\\(db, "${job.job}"`));
      expect(n8n, job.path).toContain(job.path);
      expect(n8n, `Workflow ${job.workflow}`).toMatch(new RegExp(`## Workflow ${job.workflow}\\b`));
      expect(ITEM_BY_KEY.has(`job_${job.job.replace(/-/g, "_")}`)).toBe(true);
    }
  });

  it("every migration has a sentinel (or says why it has none), found in that migration's SQL", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, ""));
    expect(Object.keys(MIGRATION_SENTINELS).sort()).toEqual(files.sort());
    for (const [migration, sentinel] of Object.entries(MIGRATION_SENTINELS)) {
      if (!sentinel) continue;
      const sql = readFileSync(`supabase/migrations/${migration}.sql`, "utf8");
      if (sentinel.column) expect(sql, migration).toMatch(new RegExp(`add column (if not exists )?${sentinel.column}\\b`));
      else expect(sql, migration).toMatch(new RegExp(`create table (if not exists )?public\\.${sentinel.table}\\b`));
    }
  });

  it("the WhatsApp template list holds every template name the app sends", () => {
    expect(PARTNER_NOTICE_TEMPLATE).toBe("credalti_socio_avance");
    const names = new Set<string>();
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (f !== "__tests__") walk(p);
        } else if (p.endsWith(".ts")) for (const m of readFileSync(p, "utf8").matchAll(/"(credalti_[a-z0-9_]+)"/g)) names.add(m[1]!);
      }
    };
    walk("src/lib");
    names.delete("credalti_json");
    // Not a template: the partner referral cookie (partners/copy.ts).
    names.delete("credalti_socio");
    for (const n of names) expect(WHATSAPP_TEMPLATE_NAMES, n).toContain(n);
  });
});

// ── Facts for the status logic ─────────────────────────────────────────────

const DB_OK: DbFacts = {
  connected: true,
  latestMigration: "0040_ideas_launch",
  missingMigrations: [],
  admins: 1,
  bucketPrivate: true,
  lettersUnapproved: 0,
  plansActive: 2,
  defaultPlan: true,
  texasOpen: true,
  otherStatesOpen: [],
  lastWhatsappInbound: null,
  lastLobEvent: null,
  lastHighlevelReceipt: null,
};

function perfectFacts(): LaunchFacts {
  const env: EnvFacts = {
    set: Object.fromEntries([...covered].map((n) => [n, n !== "LETTERS_ALLOW_UNAPPROVED"])),
    lobMode: "live",
    gateway: "authorize_net",
    gatewayComplete: true,
    gatewayMode: "live",
    gatewayWebhookKey: true,
    agreementApproved: true,
    paymentAuthorizationApproved: true,
    achAuthorizationApproved: true,
    termsMissing: [],
    unverifiedStatutes: 0,
    lettersAllowUnapproved: false,
    templatesListed: [...WHATSAPP_TEMPLATE_NAMES],
    tiktokAudited: true,
    monitoringProvider: "identityiq",
    diyAgreementApproved: true,
  };
  const at = new Date(NOW.getTime() - 5 * 60_000).toISOString();
  return {
    env,
    db: DB_OK,
    heartbeats: Object.fromEntries(CRON_JOBS.map((j) => [j.job, { lastRunAt: at, lastOkAt: at, lastError: null }])),
    probes: { phone_login: { checkedAt: at, ok: true, code: "ok", httpStatus: 200, byName: "Carmen" } },
    ticks: Object.fromEntries(MANUAL_ITEMS.map((k) => [k, { done: true, byName: "Carmen", at, note: null }])),
    now: NOW.toISOString(),
  };
}

describe("the status logic", () => {
  it("with everything in place, every item is ready and the business can go live", () => {
    const report = launchReport(perfectFacts());
    expect(report.items.filter((i) => i.state !== "ready").map((i) => i.key)).toEqual([]);
    expect(report.summary.live).toBe(true);
    expect(report.summary.next).toEqual([]);
    expect(report.summary.blocked).toEqual([]);
  });

  it("never says live while one required item is anything but ready", () => {
    const report = launchReport(perfectFacts());
    for (const item of report.items.filter((i) => i.needed === "required")) {
      for (const state of ["missing", "check", "manual", "failing"] as const) {
        const items = report.items.map((i) => (i.key === item.key ? { ...i, state } : i));
        expect(summarize(items).live, `${item.key} ${state}`).toBe(false);
      }
    }
    // A recommended or later item does not hold the launch back.
    const items = report.items.map((i) => (i.needed !== "required" ? { ...i, state: "missing" as const } : i));
    expect(summarize(items).live).toBe(true);
  });

  it("a fresh server (nothing set, no database) is far from live, with the next steps in order", () => {
    const facts: LaunchFacts = { env: envFacts({}, launchEnvNames()), db: null, heartbeats: {}, probes: {}, ticks: {}, now: NOW.toISOString() };
    const report = launchReport(facts);
    expect(report.summary.live).toBe(false);
    expect(report.summary.required.ready).toBeLessThan(5);
    expect(report.summary.next).toHaveLength(3);
    // What blocks signup includes the agreement, Texas registration and the bond.
    const signup = report.summary.blocked.find((b) => b.outcome === "signup")!;
    expect(signup.by).toEqual(expect.arrayContaining(["agreement_approved", "tx_registration", "tx_bond"]));
    expect(report.summary.blocked.find((b) => b.outcome === "everything")!.by).toContain("supabase");
    // Database items wait on Supabase.
    expect(report.items.find((i) => i.key === "db_migrations")!.waitingOn).toContain("db_connected");
  });

  it("each required item, broken on its own, breaks the launch (the evaluators read their facts)", () => {
    const breakers: Array<[string, (f: LaunchFacts) => void]> = [
      ["agreement_approved", (f) => (f.env.agreementApproved = false)],
      ["statutes_verified", (f) => (f.env.unverifiedStatutes = 2)],
      ["tx_bond", (f) => (f.env.set.NEXT_PUBLIC_TX_BOND_SURETY_ADDRESS = false)],
      ["letters_approved", (f) => (f.db = { ...DB_OK, lettersUnapproved: 3 })],
      ["letters_test_switch_off", (f) => (f.env.lettersAllowUnapproved = true)],
      ["texas_only", (f) => (f.db = { ...DB_OK, texasOpen: false })],
      ["phone_login", (f) => (f.probes = { phone_login: { checkedAt: NOW.toISOString(), ok: false, code: "off", httpStatus: 200, byName: "x" } })],
      ["lob_live", (f) => (f.env.lobMode = "test")],
      ["payment_gateway", (f) => (f.env.gatewayMode = "sandbox")],
      ["db_migrations", (f) => (f.db = { ...DB_OK, missingMigrations: ["0040_ideas_launch"] })],
      ["db_admin", (f) => (f.db = { ...DB_OK, admins: 0 })],
      ["plans_approved", (f) => (f.db = { ...DB_OK, plansActive: 0 })],
      ["job_rounds", (f) => delete f.heartbeats.rounds],
      ["attorney_review", (f) => (f.ticks.attorney_review = { done: false, byName: "x", at: NOW.toISOString(), note: null })],
    ];
    for (const [key, breakIt] of breakers) {
      const facts = perfectFacts();
      breakIt(facts);
      const report = launchReport(facts);
      expect(report.items.find((i) => i.key === key)!.state, key).not.toBe("ready");
      expect(report.summary.live, key).toBe(false);
    }
  });

  it("a scheduled job: never ran, good, late, failing", () => {
    const facts = perfectFacts();
    const state = () => launchReport(facts).items.find((i) => i.key === "job_leads")!.state;
    expect(state()).toBe("ready");
    facts.heartbeats.leads = { lastRunAt: new Date(NOW.getTime() - 5 * 3600_000).toISOString(), lastOkAt: new Date(NOW.getTime() - 5 * 3600_000).toISOString(), lastError: null };
    expect(state()).toBe("check");
    facts.heartbeats.leads = { lastRunAt: NOW.toISOString(), lastOkAt: new Date(NOW.getTime() - 3600_000).toISOString(), lastError: "boom" };
    expect(state()).toBe("failing");
    delete facts.heartbeats.leads;
    expect(state()).toBe("missing");
    facts.env.set.N8N_WEBHOOK_SECRET = false;
    expect(launchReport(facts).items.find((i) => i.key === "job_leads")!.notes[0]).toEqual({ code: "waits_on", args: ["n8n_secret"] });
  });

  it("a hand tick: the newest tick decides; unticked is the owner's to do", () => {
    const facts = perfectFacts();
    facts.ticks = {};
    expect(launchReport(facts).items.find((i) => i.key === "test_pass")).toMatchObject({ state: "manual", tick: null });
    facts.ticks.test_pass = { done: true, byName: "Carmen", at: NOW.toISOString(), note: "Done with Marta's phone" };
    expect(launchReport(facts).items.find((i) => i.key === "test_pass")).toMatchObject({ state: "ready", tick: { byName: "Carmen" } });
  });

  it("Lob says only test or live; a probe never claims ready before it is checked", () => {
    const facts = perfectFacts();
    facts.probes = {};
    expect(launchReport(facts).items.find((i) => i.key === "phone_login")!.state).toBe("check");
    facts.env.lobMode = "test";
    const lob = launchReport(facts).items.find((i) => i.key === "lob_key")!;
    expect(lob.state).toBe("ready");
    expect(lob.notes.map((n) => n.code)).toContain("mode_test");
  });

  it("the demo's sample is clearly part of the way: not live, labelled as sample", () => {
    const report = launchReport(demoLaunchFacts(NOW), { sample: true });
    expect(report.sample).toBe(true);
    expect(report.summary.live).toBe(false);
    expect(report.summary.required.ready).toBeGreaterThan(5);
    expect(report.summary.required.ready).toBeLessThan(report.summary.required.total);
  });

  it("only an administrator opens it", () => {
    expect(STAFF_ROLES.filter((r) => can(r, "launch"))).toEqual(["admin"]);
    expect(deniedReason("launch", "en")).toMatch(/^Only an administrator can/);
  });
});

describe("secrets are never revealed", () => {
  const base: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-public",
    LOB_API_KEY: "test_9f8e7d6c5b4a39281706f5e4d3c2b1a0",
    BILLING_GATEWAY: "authorize_net",
    AUTHORIZE_NET_ENV: "sandbox",
    NEXT_PUBLIC_AUTHORIZE_NET_API_LOGIN_ID: "pub-login",
    NEXT_PUBLIC_AUTHORIZE_NET_CLIENT_KEY: "pub-client",
    WHATSAPP_APPROVED_TEMPLATES: "credalti_acuerdo_1, credalti_recibo",
  };
  const secretsA: Record<string, string> = Object.fromEntries(SECRET_ENV.map((n, i) => [n, `${n === "LOB_API_KEY" ? "test_" : "sk"}AAAA${i}secretvalue${"x".repeat(i)}`]));
  const secretsB: Record<string, string> = Object.fromEntries(SECRET_ENV.map((n, i) => [n, `${n === "LOB_API_KEY" ? "test_" : "zz"}${"Q".repeat(50 + i)}`]));

  it("two settings that differ only in their secrets give the same facts, byte for byte", () => {
    const a = envFacts({ ...base, ...secretsA }, launchEnvNames());
    const b = envFacts({ ...base, ...secretsB }, launchEnvNames());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the whole report and health view carry no value, length or prefix of any secret", async () => {
    for (const secrets of [secretsA, secretsB]) {
      const env = { ...base, ...secrets };
      const facts = await loadLaunchFacts(null, NOW, env);
      const report = launchReport(facts);
      const health = systemHealth(facts, report, {});
      const out = JSON.stringify({ report, health });
      for (const [name, value] of Object.entries(secrets)) {
        expect(out.includes(value), name).toBe(false);
        expect(out.includes(value.slice(0, 8)), `${name} prefix`).toBe(false);
      }
      // Nothing after Lob's "test_" either.
      expect(out.includes(secrets.LOB_API_KEY!.slice(5, 13))).toBe(false);
    }
    // Lob's mode is one word.
    const facts = await loadLaunchFacts(null, NOW, { ...base, ...secretsA });
    expect(facts.env.lobMode).toBe("test");
    expect((await loadLaunchFacts(null, NOW, { ...base, LOB_API_KEY: "live_abc123def456" })).env.lobMode).toBe("live");
  });

  it("redacts secret values and anything that looks like a token from heartbeat errors", () => {
    const env = { LOB_API_KEY: "test_supersecret123" };
    expect(redactSecrets("Lob said 401 for test_supersecret123", env)).toBe("Lob said 401 for [hidden]");
    expect(redactSecrets("Bearer EAAGm0PX4ZCpsBAKZCZBabcdefghij1234567890", {})).toBe("Bearer [hidden]");
    expect(redactSecrets("WhatsApp template credalti_resumen_equipo is not approved yet", {})).toBe("WhatsApp template credalti_resumen_equipo is not approved yet");
  });

  it("a check says ok or a short code, never the provider's words; the key is only in a header", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const answer = (status: number, body: unknown = {}) => async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    };
    const env = { ...base, LOB_API_KEY: "test_lobsecret", WHATSAPP_ACCESS_TOKEN: "wa-token-secret", WHATSAPP_PHONE_NUMBER_ID: "1234567890", AUTHORIZE_NET_API_LOGIN_ID: "login", AUTHORIZE_NET_TRANSACTION_KEY: "txkey" };
    expect(await runProbe("lob", env, answer(200) as typeof fetch)).toEqual({ ok: true, code: "ok", httpStatus: 200 });
    expect(calls.at(-1)!.url).not.toContain("lobsecret");
    expect(await runProbe("lob", env, answer(401, { error: { message: "Your API key test_lobsecret is invalid" } }) as typeof fetch)).toEqual({ ok: false, code: "refused", httpStatus: 401 });
    expect(await runProbe("whatsapp", env, answer(400) as typeof fetch)).toEqual({ ok: false, code: "refused", httpStatus: 400 });
    expect(calls.at(-1)!.url).not.toContain("wa-token-secret");
    expect(await runProbe("phone_login", env, answer(200, { external: { phone: false } }) as typeof fetch)).toEqual({ ok: false, code: "off", httpStatus: 200 });
    expect(await runProbe("phone_login", env, answer(200, { external: { phone: true } }) as typeof fetch)).toMatchObject({ ok: true, code: "ok" });
    expect(await runProbe("phone_login", env, answer(200, { unexpected: true }) as typeof fetch)).toMatchObject({ ok: false, code: "error" });
    expect(await runProbe("authorize_net", env, answer(200, { messages: { resultCode: "Error" } }) as typeof fetch)).toMatchObject({ ok: false, code: "refused" });
    expect(await runProbe("authorize_net", env, answer(200, { messages: { resultCode: "Ok" } }) as typeof fetch)).toMatchObject({ ok: true });
    const down = (async () => {
      throw new Error("connect ECONNREFUSED with key test_lobsecret");
    }) as unknown as typeof fetch;
    expect(await runProbe("lob", env, down)).toEqual({ ok: false, code: "unreachable", httpStatus: null });
    expect(await runProbe("anthropic", {}, down)).toEqual({ ok: false, code: "not_configured", httpStatus: null });
    expect(probeConfigured("authorize_net", { ...env, BILLING_GATEWAY: "nmi" })).toBe(false);
  });

  it("the launch route never logs a key: it names only the place and the service", () => {
    const route = readFileSync("src/app/api/staff/launch/route.ts", "utf8");
    expect(route).toMatch(/requireCapability\("launch"\)/);
    expect(route).not.toMatch(/process\.env/);
    expect(readFileSync("src/lib/launch/probes.ts", "utf8")).not.toMatch(/console\.|reportError/);
  });
});
