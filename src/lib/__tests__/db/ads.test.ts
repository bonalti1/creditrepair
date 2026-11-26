import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { templateAdDraft } from "../../ads/copy";
import { buildReport } from "../../ads/report";
import { loadAdLeads, loadAdsPayload, runAdsSync } from "../../ads/server";
import { adWindow } from "../../ads/window";
import { receiveLead } from "../../leads/server";
import { startSignupCase } from "../../signup/server";
import { fakeMeta, META_ENV } from "../fixtures/meta-ads/http";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff, signAgreement } from "./seed";

// Migration 0037 (the Ads Manager, docs/ADS.md) against the real migrations,
// with row level security: the sync (READ ONLY against a mocked Meta: fixture
// JSON, no live call) caches the account, campaigns, ad sets, ads and numbers;
// only administrators read them; the content team reads the video briefs;
// sales, a client and anon read nothing. The routes run as in production with
// the two Supabase clients swapped for the test database's. And the ad a lead
// came from travels from the chat signup (and a HighLevel form) into the
// lead's first touch, where the report credits it.

const session = vi.hoisted(() => ({ reader: null as unknown, admin: null as unknown }));
vi.mock("@/lib/supabase/server", () => {
  const user = async () => {
    const reader = session.reader as SupabaseClient | null;
    return reader ? (await reader.auth.getUser()).data.user : null;
  };
  return {
    getServerSupabase: async () => session.reader,
    getSessionUser: user,
    resolveActingUser: async () => {
      const u = await user();
      return u ? { userId: u.id, via: "session" as const } : null;
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => session.admin }));

let h: Harness;
let ip = 0;
const as = (who: SupabaseClient | null) => {
  session.reader = who;
  session.admin = h.service;
};
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.37.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

const NOW = new Date("2026-11-25T18:00:00.000Z");
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let client: string;

const count = async (reader: SupabaseClient, table: string) => {
  const { data, error } = await reader.from(table).select("*");
  return error ? `error: ${error.message}` : ((data as unknown[] | null) ?? []).length;
};
/** Signed out, the staff check itself is refused (as on every staff table): nothing is read either way. */
const nothing = (n: number | string) => n === 0 || (typeof n === "string" && /permission denied/.test(n));

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.META_ADS_ACCESS_TOKEN;
  delete process.env.META_AD_ACCOUNT_ID;
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  client = await addClient(h, { name: "Rosa Martínez" });
}, 60_000);

afterAll(() => {
  vi.useRealTimers();
});

describe("the sync: Meta, read only, cached", () => {
  it("without the two variables it calls nothing and records nothing", async () => {
    const meta = fakeMeta();
    expect(await runAdsSync(h.service, NOW, { http: meta.http, env: {} })).toEqual({ ok: false, missing: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] });
    expect(meta.calls).toEqual([]);
    expect(await h.sql("select * from public.ads_sync_runs")).toEqual([]);
  });

  it("the first sync reads 90 days; the next ones the last 7, and the numbers are upserted, never doubled", async () => {
    const meta = fakeMeta();
    const first = await runAdsSync(h.service, NOW, { http: meta.http, env: META_ENV });
    expect(first).toEqual({ ok: true, since: "2026-08-28", until: "2026-11-25", rows: 5 });
    expect(meta.calls.every((c) => c.method === "GET")).toBe(true);
    const second = await runAdsSync(h.service, NOW, { http: fakeMeta().http, env: META_ENV, by: "carmen" });
    expect(second).toMatchObject({ ok: true, since: "2026-11-19", until: "2026-11-25" });
    expect(await h.sql("select count(*)::int as n from public.ads_insights_daily")).toEqual([{ n: 5 }]);
    expect(await h.sql("select level, count(*)::int as n from public.ads_objects group by level order by level")).toEqual([
      { level: "ad", n: 3 },
      { level: "adset", n: 3 },
      { level: "campaign", n: 2 },
    ]);
    const [account] = await h.sql<{ time_zone: string; status: string; last_synced_at: string | null }>("select time_zone, status, last_synced_at from public.ads_accounts");
    expect(account).toMatchObject({ time_zone: "America/Chicago", status: "active" });
    expect(account!.last_synced_at).toBeTruthy();
    const [spend] = await h.sql<{ cents: number }>("select spend_cents::int as cents from public.ads_insights_daily where ad_id = '120200000000000101' and day = '2026-11-23'");
    expect(spend!.cents).toBe(4025);
    expect(await h.sql("select ok, by_handle from public.ads_sync_runs order by at")).toEqual([
      { ok: true, by_handle: "cron" },
      { ok: true, by_handle: "carmen" },
    ]);
  });

  it("a failed read is recorded with Meta's reason and changes nothing else", async () => {
    const before = await h.sql("select count(*)::int as n from public.ads_insights_daily");
    const out = await runAdsSync(h.service, NOW, { http: fakeMeta({ failWith: "error-token" }).http, env: META_ENV });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^Meta: Error validating access token/);
    expect(await h.sql("select count(*)::int as n from public.ads_insights_daily")).toEqual(before);
    const [last] = await h.sql<{ ok: boolean; error: string }>("select ok, error from public.ads_sync_runs order by at desc limit 1");
    expect(last).toMatchObject({ ok: false });
    expect(last!.error).not.toContain("EAAtesttoken");
  });

  it("the sync runs are a record: never changed, never deleted", async () => {
    await expect(h.sql("update public.ads_sync_runs set ok = true")).rejects.toThrow(/cannot be changed or deleted/);
    await expect(h.sql("delete from public.ads_sync_runs")).rejects.toThrow(/cannot be changed or deleted/);
  });
});

describe("who reads the ads (row level security)", () => {
  const TABLES = ["ads_accounts", "ads_objects", "ads_insights_daily", "ads_sync_runs"];

  it("administrators read the account, campaigns, numbers and syncs", async () => {
    const reader = h.as(admin.userId);
    expect(await count(reader, "ads_accounts")).toBe(1);
    expect(await count(reader, "ads_objects")).toBe(8);
    expect(await count(reader, "ads_insights_daily")).toBe(5);
    expect(await count(reader, "ads_sync_runs")).toBe(3);
  });

  it("a specialist, sales, a client and anyone signed out read none of it", async () => {
    for (const reader of [h.as(marta.userId), h.as(ana.userId), h.as(client)]) {
      for (const table of TABLES) expect(await count(reader, table), table).toBe(0);
    }
    for (const table of [...TABLES, "ads_briefs"]) expect(nothing(await count(h.anon, table)), table).toBe(true);
  });

  it("nobody writes through their own connection", async () => {
    const reader = h.as(admin.userId);
    const { error } = await reader.from("ads_insights_daily").update({ spend_cents: 1 }).eq("ad_id", "120200000000000101");
    // No update policy: the row is invisible to the update, or refused.
    const [row] = await h.sql<{ cents: number }>("select spend_cents::int as cents from public.ads_insights_daily where ad_id = '120200000000000101' and day = '2026-11-23'");
    expect(row!.cents).toBe(4025);
    expect(error === null || /policy|permission/i.test(error.message)).toBe(true);
    const insert = await h.as(marta.userId).from("ads_briefs").insert({ created_by_handle: "marta", title: "Sneaky", format: "video", goal: "whatsapp", language: "en", copy: {} });
    expect(insert.error).not.toBeNull();
  });
});

describe("the routes", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => vi.useRealTimers());

  const get = async (path: string) => json(await (await import("@/app/api/staff/ads/route")).GET(request(path)));
  const post = async (body: unknown) => json(await (await import("@/app/api/staff/ads/route")).POST(request("/api/staff/ads", body)));

  it("the numbers: an administrator only", async () => {
    as(h.as(admin.userId));
    const ok = await get("/api/staff/ads?preset=7");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ window: { since: "2026-11-19", until: "2026-11-25", preset: 7 }, meta: { configured: false, missing: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] }, sample: false });
    const snapshot = ok.body.snapshot as { ads: unknown[]; days: unknown[]; account: { timeZone: string } };
    expect(snapshot.ads).toHaveLength(3);
    expect(snapshot.days).toHaveLength(5);
    expect(JSON.stringify(ok.body)).not.toContain("EAAtesttoken");
    const summary = await get("/api/staff/ads?summary=1");
    expect(summary.body.summary).toMatchObject({ connected: false, spend7dCents: 4025 + 3810 + 799 + 2100 + 100 });
    expect((await get("/api/staff/ads?monthly=1")).body.monthly).toEqual([{ month: "2026-11", spendCents: 10_834 }]);
    for (const who of [marta, ana]) {
      as(h.as(who.userId));
      expect((await get("/api/staff/ads?preset=7")).status, who.role).toBe(403);
      expect((await get("/api/staff/ads?summary=1")).status, who.role).toBe(403);
    }
  });

  it("Alti's ad copy: the content team; without a Claude key, a pre-checked template", async () => {
    as(h.as(marta.userId));
    const draft = await post({ action: "draft", angle: "Your rights under the FCRA", format: "video", goal: "whatsapp", language: "both" });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ source: "templates", draft: true, note: "not_configured" });
    as(h.as(ana.userId));
    expect((await post({ action: "draft", angle: "Your rights", format: "video", goal: "whatsapp", language: "en" })).status).toBe(403);
  });

  it("a video brief from a clean draft; a draft that breaks a rule is refused; the words never change after", async () => {
    as(h.as(marta.userId));
    const copy = templateAdDraft({ angle: "rights", format: "video", goal: "whatsapp", language: "both" });
    const made = await post({ action: "brief", title: "Your credit report rights", format: "video", goal: "whatsapp", language: "both", sourceAdId: "120200000000000101", copy });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const bad = await post({ action: "brief", title: "Free help", format: "video", goal: "whatsapp", language: "en", copy: { ...copy, primaryText: { en: "Free credit repair for moms. We remove bad items.", es: "" } } });
    expect(bad.status).toBe(422);
    expect(bad.body.issues).toEqual(expect.arrayContaining(["no-free", "ad-targeting", "diy-positioning"]));
    expect(await count(h.as(marta.userId), "ads_briefs")).toBe(1);
    expect(await count(h.as(admin.userId), "ads_briefs")).toBe(1);
    expect(await count(h.as(ana.userId), "ads_briefs")).toBe(0);
    expect(await count(h.as(client), "ads_briefs")).toBe(0);
    const briefs = await get("/api/staff/ads?briefs=1");
    expect((briefs.body.briefs as Array<{ by: string; sourceAdId: string }>)[0]).toMatchObject({ by: "marta", sourceAdId: "120200000000000101" });
    await expect(h.sql("update public.ads_briefs set copy = '{}'::jsonb")).rejects.toThrow(/never change/);
    await expect(h.sql("delete from public.ads_briefs")).rejects.toThrow(/cannot be deleted/);
    await h.sql("update public.ads_briefs set status = 'planned'");
    as(h.as(ana.userId));
    expect((await get("/api/staff/ads?briefs=1")).status).toBe(403);
  });

  it("«Sync now»: an administrator; without the variables it says which are missing", async () => {
    as(h.as(marta.userId));
    expect((await post({ action: "sync" })).status).toBe(403);
    as(h.as(admin.userId));
    expect((await post({ action: "sync" })).body).toEqual({ ok: false, missing: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] });
  });

  it("the cron needs the shared secret", async () => {
    const route = await import("@/app/api/cron/ads/route");
    process.env.N8N_WEBHOOK_SECRET = "cron-secret";
    as(null);
    expect((await route.POST(request("/api/cron/ads", {}))).status).toBe(401);
    expect((await route.POST(request("/api/cron/ads", {}, { "x-webhook-secret": "wrong" }))).status).toBe(401);
    expect(await json(await route.POST(request("/api/cron/ads", {}, { "x-webhook-secret": "cron-secret" })))).toEqual({ status: 200, body: { ok: false, skipped: "not_configured", missing: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] } });
  });
});

describe("the ad a lead came from, from the signup and a form, into the report", () => {
  it("a chat signup started from a tagged link: its first touch carries the ad; signing makes a signed client", async () => {
    const started = await startSignupCase(h.service, { locale: "es", attribution: { utm: { source: "facebook", content: "120200000000000101" }, ad: { adId: "120200000000000101", fbclid: true, via: "link" } } });
    const rosa = await addClient(h, { name: "Rosa Elena Gutiérrez", phone: "+17135550901" });
    await h.service.from("signup_cases").update({ user_id: rosa }).eq("case_ref", started.caseRef);
    const [lead] = await h.sql<{ first_touch: Record<string, unknown>; source: string }>("select first_touch, source from public.leads where phone_e164 = '+17135550901'");
    expect(lead).toMatchObject({ source: "signup_chat", first_touch: { caseRef: started.caseRef, utm: { source: "facebook", content: "120200000000000101" }, ad: { adId: "120200000000000101", fbclid: true, via: "link" } } });
    await signAgreement(h, rosa, { signedDaysAgo: 0 });

    // A signup with no tags is a lead as before.
    const plain = await startSignupCase(h.service, { locale: "en" });
    const james = await addClient(h, { name: "James Carter", phone: "+18325550902" });
    await h.service.from("signup_cases").update({ user_id: james }).eq("case_ref", plain.caseRef);
    expect((await h.sql<{ first_touch: unknown }>("select first_touch from public.leads where phone_e164 = '+18325550902'"))[0]!.first_touch).toEqual({ caseRef: plain.caseRef });
  });

  it("a HighLevel form that passed the ad's id", async () => {
    await receiveLead(
      h.service,
      { source: "highlevel", firstName: "Kevin", lastName: "Nguyen", phone: "+12145550903", email: null, state: "TX", goal: "card", contactId: null, campaign: "Lead form", utm: { source: "facebook" }, ad: { adId: "120200000000000103", via: "form" }, consentText: "Acepto que Credalti me contacte por WhatsApp.", consentAt: NOW.toISOString(), salespersonHint: null, partner: null },
      NOW,
    );
    const [lead] = await h.sql<{ first_touch: Record<string, unknown> }>("select first_touch from public.leads where phone_e164 = '+12145550903'");
    expect(lead!.first_touch).toMatchObject({ ad: { adId: "120200000000000103", via: "form" } });
  });

  it("the report credits them, read through the administrator's own connection; sales and a specialist get no numbers", async () => {
    const reader = h.as(admin.userId);
    const leads = await loadAdLeads(reader, "2026-01-01T00:00:00.000Z");
    const rosa = leads.find((l) => l.ad?.adId === "120200000000000101");
    expect(rosa).toMatchObject({ ad: { adId: "120200000000000101" }, utm: { source: "facebook" } });
    expect(rosa!.signedAt).toBeTruthy();
    // Nothing but a first name and an initial: no phone.
    expect(JSON.stringify(leads)).not.toMatch(/\+1713555/);
    const payload = await loadAdsPayload(reader, { preset: 7 }, new Date(), META_ENV);
    const report = buildReport(payload.snapshot, payload.leads, adWindow({ preset: 7 }, new Date(), "America/Chicago"));
    const ad = report.ads.find((a) => a.ad.id === "120200000000000101")!;
    expect(ad.metrics.leads).toBe(1);
    expect(ad.metrics.signed).toBe(1);
    expect(report.ads.find((a) => a.ad.id === "120200000000000103")!.metrics.leads).toBe(1);
    expect(payload.meta.configured).toBe(true);
    // Sales sees its leads under the inbox's policies but no ad numbers at all.
    const sales = await loadAdsPayload(h.as(ana.userId), { preset: 7 }, new Date(), {});
    expect(sales.snapshot.account).toBeNull();
    expect(sales.snapshot.days).toEqual([]);
    const specialist = await loadAdsPayload(h.as(marta.userId), { preset: 7 }, new Date(), {});
    expect(specialist.snapshot.ads).toEqual([]);
    expect(specialist.leads).toEqual([]);
  });
});
