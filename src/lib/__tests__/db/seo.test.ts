import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { guideHash } from "../../seo/guides";
import { syncSearchConsole, type Http } from "../../seo/searchConsole";
import { listPublishedGuides, loadGuides, publishedGuide, forgetPublishedCache } from "../../seo/server";
import { STARTER_GUIDES } from "../../seo/starters";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff } from "./seed";

// Migration 0039 against the real migrations, with row level security: the
// SEO department's guides, history, phrases, Search Console rows and
// settings, and the public path to published guides. The routes run as in
// production with the two Supabase clients swapped for the test database's;
// Google is a mocked fetch (no live call).

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
const request = (path: string, body?: unknown) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.39.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

async function post(body: unknown) {
  const route = await import("@/app/api/staff/seo/route");
  return json(await route.POST(request("/api/staff/seo", body)));
}
async function get(path = "/api/staff/seo") {
  const route = await import("@/app/api/staff/seo/route");
  return json(await route.GET(request(path)));
}

let admin: Awaited<ReturnType<typeof addStaff>>;
let specialist: Awaited<ReturnType<typeof addStaff>>;
let sales: Awaited<ReturnType<typeof addStaff>>;
let client: string;
const starter = STARTER_GUIDES[0]!;

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  specialist = await addStaff(h, "specialist", "marta", "Marta Leal");
  sales = await addStaff(h, "sales", "ana", "Ana Prieto");
  client = await addClient(h, { name: "Rosa Martínez" });
}, 60_000);

describe("seo: guides through the routes", () => {
  it("a specialist adds the starter drafts and works one; only an administrator publishes it, and only when it is ready", async () => {
    as(h.as(specialist.userId));
    const added = await post({ action: "add_starters" });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.added).toBe(STARTER_GUIDES.length);
    // Twice adds nothing.
    expect((await post({ action: "add_starters" })).body.added).toBe(0);
    const [row] = await h.sql<{ status: string; published: unknown; blocking_issues: number; content_hash: string }>(`select status, published, blocking_issues, content_hash from public.seo_guides where id = $1`, [starter.id]);
    expect(row).toMatchObject({ status: "draft", published: null, blocking_issues: 0 });
    expect(row!.content_hash).toBe(guideHash(starter));

    expect((await post({ action: "submit", id: starter.id })).status).toBe(200);
    // The specialist cannot publish.
    const denied = await post({ action: "publish", id: starter.id });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("forbidden_for_role");
    // The administrator cannot either until a person ticked the boxes.
    as(h.as(admin.userId));
    const blocked = await post({ action: "publish", id: starter.id });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toBe("blocked");
    expect((await post({ action: "update", id: starter.id, patch: { checklist: { sourcesOpened: true, bothLanguagesRead: true, noAdvice: true } } })).status).toBe(200);
    const published = await post({ action: "publish", id: starter.id });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const [live] = await h.sql<{ status: string; published_hash: string; approved_hash: string; content_hash: string; approved_by: string; first_published_at: string }>(`select * from public.seo_guides where id = $1`, [starter.id]);
    expect(live!.status).toBe("published");
    expect(live!.published_hash).toBe(live!.content_hash);
    expect(live!.approved_hash).toBe(live!.content_hash);
    expect(live!.approved_by).toBe(admin.userId);
    expect(live!.first_published_at).toBeTruthy();
  });

  it("the public reads only published versions, through the functions; anon reads no table", async () => {
    forgetPublishedCache();
    const list = await listPublishedGuides(h.anon);
    expect(list.map((g) => g.slug)).toEqual([starter.slug]);
    expect(list[0]!.body.en.title).toBe(starter.body.en.title);
    expect(await publishedGuide(starter.slug, h.anon)).not.toBeNull();
    // A draft is not found.
    expect(await publishedGuide(STARTER_GUIDES[2]!.slug, h.anon)).toBeNull();
    // The tables themselves: nothing for anon, a client or sales.
    for (const who of [h.anon, h.as(client), h.as(sales.userId)]) {
      for (const table of ["seo_guides", "seo_guide_events", "seo_keywords", "seo_search_rows", "seo_settings"]) {
        const { data } = await who.from(table).select("*");
        expect(data ?? [], table).toEqual([]);
      }
    }
    // The team reads them.
    expect(((await h.as(specialist.userId).from("seo_guides").select("id")).data ?? []).length).toBe(STARTER_GUIDES.length);
    expect(((await h.as(admin.userId).from("seo_guide_events").select("id")).data ?? []).length).toBeGreaterThan(3);
  });

  it("an edit after publishing sends the working copy back to draft and keeps the published version live", async () => {
    as(h.as(specialist.userId));
    const current = (await loadGuides(h.service)).find((g) => g.id === starter.id)!;
    const body = structuredClone(current.body);
    body.en.intro = `${body.en.intro} Keep a copy of every letter.`;
    expect((await post({ action: "update", id: starter.id, patch: { body } })).status).toBe(200);
    const after = (await loadGuides(h.service)).find((g) => g.id === starter.id)!;
    expect(after.status).toBe("draft");
    expect(after.approval).toBeNull();
    expect(after.published?.body.en.intro).toBe(starter.body.en.intro);
    forgetPublishedCache();
    expect((await publishedGuide(starter.slug, h.anon))?.body.en.intro).toBe(starter.body.en.intro);
    // The address of a live guide never changes.
    const moved = await post({ action: "update", id: starter.id, patch: { slug: "another-address" } });
    expect(moved.status).toBe(422);
    expect(moved.body.error).toBe("slug_locked");
    // Archiving it would take it off the site: the specialist may not.
    expect((await post({ action: "archive", id: starter.id })).status).toBe(403);
    as(h.as(admin.userId));
    expect((await post({ action: "unpublish", id: starter.id })).status).toBe(200);
    forgetPublishedCache();
    expect(await listPublishedGuides(h.anon)).toEqual([]);
  });

  it("sales and clients get nothing from the routes", async () => {
    as(h.as(sales.userId));
    expect((await get()).status).toBe(403);
    expect((await post({ action: "create", topic: "A topic" })).status).toBe(403);
    as(h.as(client));
    expect((await get()).status).toBe(403);
  });
});

describe("seo: the database holds the rules again", () => {
  it("refuses to publish a version that was not approved, to delete a guide, or to change history", async () => {
    const id = STARTER_GUIDES[3]!.id;
    const fake = "f".repeat(64);
    await expect(h.sql(`update public.seo_guides set published = '{"slug":"x"}'::jsonb, published_hash = $2, published_at = now() where id = $1`, [id, fake])).rejects.toThrow(/approved version|published_slug|published_holds/);
    await expect(h.sql(`delete from public.seo_guides where id = $1`, [id])).rejects.toThrow(/archived, never deleted/);
    await expect(h.sql(`update public.seo_guide_events set note = 'x'`)).rejects.toThrow(/append-only/);
    await expect(h.sql(`update public.seo_guides set body = '{"en":{},"es":{}}'::jsonb where id = $1`, [id])).rejects.toThrow(/content_hash must change/);
    await expect(
      h.sql(`insert into public.seo_guides (id, slug, topic, body, content_hash, created_by_handle, status, approved_hash, approved_at) values ('gd_forged', 'forged-guide', 'Forged', '{"en":{},"es":{}}', $1, 'x', 'published', $1, now())`, [fake]),
    ).rejects.toThrow(/starts as a draft/);
  });

  it("phrases: Texas cities only, never Georgia, one of each", async () => {
    as(h.as(specialist.userId));
    expect((await post({ action: "add_phrase", phrase: "credit repair houston", lang: "en", city: "Houston", targetPath: "/" })).status).toBe(200);
    expect((await post({ action: "add_phrase", phrase: "credit repair houston", lang: "en", city: "Houston", targetPath: "/" })).status).toBe(422);
    expect((await post({ action: "add_phrase", phrase: "credit repair atlanta georgia", lang: "en", city: null, targetPath: null })).status).toBe(422);
    expect((await post({ action: "add_phrase", phrase: "credit repair miami", lang: "en", city: "Miami", targetPath: null })).status).toBe(400);
    await expect(h.sql(`insert into public.seo_keywords (id, phrase, lang, city, created_by_handle) values ('kw_bad1', 'credit repair', 'en', 'Miami', 'x')`)).rejects.toThrow();
    await expect(h.sql(`insert into public.seo_keywords (id, phrase, lang, created_by_handle) values ('kw_bad2', 'credit repair georgia', 'en', 'x')`)).rejects.toThrow(/not_georgia/);
    const listed = await get();
    expect((listed.body.phrases as unknown[]).length).toBe(1);
  });

  it("the local checklist keeps who ticked what", async () => {
    as(h.as(admin.userId));
    const res = await post({ action: "local_tick", key: "gbpCreate", done: true });
    expect(res.status).toBe(200);
    const [row] = await h.sql<{ local_ticks: Record<string, { done: boolean; by: string }> }>(`select local_ticks from public.seo_settings`);
    expect(row!.local_ticks.gbpCreate).toMatchObject({ done: true, by: "carmen" });
    expect((await post({ action: "local_tick", key: "not-an-item", done: true })).status).toBe(400);
  });
});

describe("seo: Search Console sync (mocked Google)", () => {
  const env = {
    GOOGLE_SEARCH_CONSOLE_SITE: "sc-domain:credalti.example",
    GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "id",
    GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "secret",
    GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: "refresh",
  };
  const rows = [
    { keys: ["2026-11-20", "https://credalti.example/?lang=en", "credit repair houston"], clicks: 3, impressions: 40, position: 8.2 },
    { keys: ["2026-11-21", "https://credalti.example/?lang=en", "credit repair houston"], clicks: 1, impressions: 20, position: 9.5 },
  ];
  const calls: string[] = [];
  const http: Http = async (url, init) => {
    calls.push(url);
    if (url.includes("oauth2")) {
      expect(init.body).toContain("grant_type=refresh_token");
      return { ok: true, status: 200, json: async () => ({ access_token: "token" }) };
    }
    expect(init.headers.authorization).toBe("Bearer token");
    expect(url).toContain(encodeURIComponent("sc-domain:credalti.example"));
    return { ok: true, status: 200, json: async () => ({ rows }) };
  };

  it("stores the rows once, however often it runs, and nothing without a connection", async () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(await syncSearchConsole(h.service, now, { http, env: {} })).toMatchObject({ connected: false, rows: 0 });
    expect(calls).toEqual([]);
    expect(await syncSearchConsole(h.service, now, { http, env })).toMatchObject({ connected: true, rows: 2, error: null, to: "2026-11-23" });
    await syncSearchConsole(h.service, now, { http, env });
    const stored = await h.sql<{ n: number }>(`select count(*)::int as n from public.seo_search_rows`);
    expect(stored[0]!.n).toBe(2);
    const [settings] = await h.sql<{ search_rows_synced: number; search_sync_error: string | null }>(`select * from public.seo_settings`);
    expect(settings).toMatchObject({ search_rows_synced: 2, search_sync_error: null });
  });

  it("an error from Google is recorded, not thrown", async () => {
    const failing: Http = async (url) => (url.includes("oauth2") ? { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) } : { ok: true, status: 200, json: async () => ({}) });
    const res = await syncSearchConsole(h.service, new Date(), { http: failing, env });
    expect(res.error).toMatch(/invalid_grant/);
    const [settings] = await h.sql<{ search_sync_error: string | null }>(`select search_sync_error from public.seo_settings`);
    expect(settings!.search_sync_error).toMatch(/invalid_grant/);
  });
});
