import { describe, expect, it } from "vitest";
import { buildDemoContent } from "../content/demo";
import { newNonce, signState, verifyState } from "../content/publish/crypto";
import { composePost, DEFAULT_PUBLISH_SETTINGS, mediaProblem, pieceGates, publishGates, PROVIDERS } from "../content/publish/gates";
import { META_TIMING, metaProvider } from "../content/publish/meta";
import { tiktokProvider } from "../content/publish/tiktok";
import { classify, ProviderError, type ConnectionSecrets, type ConnectionView, type Http, type PublishJob } from "../content/publish/types";
import { youtubeProvider } from "../content/publish/youtube";
import { applyContentAction } from "../content/rules";

// Publishing (docs/CONTENT.md, "Publishing"): the providers against a mocked
// fetch (no live call), the gates, the OAuth state and how errors are sorted.

const NOW = new Date("2026-12-07T16:00:00.000Z");
const KEY = Buffer.alloc(32, 3);
META_TIMING.pollMs = 0;
const NOENV = {} as NodeJS.ProcessEnv;

type Call = { method: string; url: string; body: string | null; headers: Record<string, string> };
function mock(answers: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>): { http: Http; calls: Call[] } {
  const calls: Call[] = [];
  const http: Http = async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method: init?.method ?? "GET", url, body: typeof init?.body === "string" ? init.body : init?.body ? "[bytes]" : null, headers });
    const next = answers.shift() ?? { body: {} };
    return new Response(next.body instanceof ArrayBuffer ? next.body : JSON.stringify(next.body ?? {}), { status: next.status ?? 200, headers: next.headers ?? {} });
  };
  return { http, calls };
}

const conn = (over: Partial<ConnectionSecrets> = {}): ConnectionSecrets => ({ provider: "meta", account: { pageId: "PAGE", igUserId: "IG" }, scopes: [], accessToken: "TOKEN", refreshToken: null, expiresAt: null, ...over });
const job = (over: Partial<PublishJob> = {}): PublishJob => ({ scheduleId: "s1", pieceId: "pc_x", channel: "facebook", contentType: "short_video", text: "Caption. Results vary.", title: "A hook", media: [], language: "en", ...over });
const connected: ConnectionView = { provider: "meta", configured: true, connected: true, status: "connected", account: {}, scopes: [], missingScopes: [], expiresAt: null, connectedAt: null, connectedBy: null, lastError: null };

describe("publishing: the gates", () => {
  const demo = buildDemoContent(NOW);
  const scheduled = demo.pieces.find((p) => p.id === "pc_demo0008")!;
  const on = { enabled: true, channels: { facebook: true, instagram: true, tiktok: true, youtube: true } };

  it("off by default: the global switch and each channel start off", () => {
    expect(DEFAULT_PUBLISH_SETTINGS.enabled).toBe(false);
    expect(Object.values(DEFAULT_PUBLISH_SETTINGS.channels).every((v) => v === false)).toBe(true);
    expect(publishGates({ piece: scheduled, channel: "instagram", settings: DEFAULT_PUBLISH_SETTINGS, connection: connected, now: NOW })).toEqual(["publishing_off", "channel_off"]);
  });

  it("an approved piece with its file and an account connected passes; every other case names its gate", () => {
    expect(publishGates({ piece: scheduled, channel: "instagram", settings: on, connection: connected, now: NOW })).toEqual([]);
    expect(publishGates({ piece: scheduled, channel: "instagram", settings: on, connection: null, now: NOW })).toEqual(["not_configured"]);
    expect(publishGates({ piece: scheduled, channel: "instagram", settings: on, connection: { ...connected, connected: false }, now: NOW })).toEqual(["not_connected"]);
    expect(publishGates({ piece: scheduled, channel: "instagram", settings: on, connection: { ...connected, status: "expired" }, now: NOW })).toEqual(["token_expired"]);
    expect(pieceGates(scheduled, "youtube")).toEqual(["channel_not_on_piece"]);
    expect(pieceGates({ ...scheduled, channels: [...scheduled.channels, "youtube"], assets: [] }, "youtube")).toEqual(expect.arrayContaining(["media_missing", "approval_changed"]));
    const review = demo.pieces.find((p) => p.status === "review")!;
    expect(pieceGates(review, "instagram")).toEqual(expect.arrayContaining(["not_approved", "approval_changed", "checklist_open"]));
    const bad = demo.pieces.find((p) => p.id === "pc_demo0003")!;
    expect(pieceGates(bad, "instagram")).toContain("blocking_issues");
  });

  it("an edit after approval fails the approval gate, even if someone set the status back by hand", () => {
    const edited = applyContentAction([scheduled], { action: "update", id: scheduled.id, patch: { copy: { hook: { en: "Changed.", es: "Cambiado." } } } }, "marta", NOW);
    if (!edited.ok) throw new Error("edit");
    expect(edited.piece.status).toBe("review");
    const forced = { ...edited.piece, status: "scheduled" as const, approval: scheduled.approval };
    expect(pieceGates(forced, "instagram")).toContain("approval_changed");
  });

  it("composes exactly the approved caption, with the first link tagged with the piece's code", () => {
    const post = composePost(scheduled, "instagram", "es", [], "s1");
    expect(post.text).toContain(scheduled.copy.caption.es);
    expect(post.text).toMatch(new RegExp(`utm_content=${scheduled.campaignCode}`));
    expect(post.text).toMatch(/utm_source=instagram/);
    expect(post.title).toBe(scheduled.copy.hook.es);
    expect(mediaProblem({ ...scheduled, assets: [] }, "instagram")).toBe(true);
    expect(mediaProblem({ ...scheduled, assets: [] }, "facebook")).toBe(false);
  });
});

describe("publishing: Meta (Facebook Page and Instagram)", () => {
  it("posts text to the Page feed with the Page token", async () => {
    const { http, calls } = mock([{ body: { id: "PAGE_99" } }]);
    const out = await metaProvider.publish(job(), conn(), http, NOENV);
    expect(out).toEqual({ ok: true, externalId: "PAGE_99", url: "https://www.facebook.com/PAGE_99" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://graph.facebook.com/v21.0/PAGE/feed" });
    expect(calls[0]!.body).toContain("access_token=TOKEN");
    expect(calls[0]!.body).toContain("Results+vary");
  });

  it("Instagram reel: container, wait until processed, publish, read the permalink", async () => {
    const { http, calls } = mock([{ body: { id: "C1" } }, { body: { status_code: "IN_PROGRESS" } }, { body: { status_code: "FINISHED" } }, { body: { id: "M1" } }, { body: { permalink: "https://www.instagram.com/reel/M1" } }]);
    const out = await metaProvider.publish(job({ channel: "instagram", media: [{ url: "https://storage.test/v.mp4", mediaType: "video/mp4", altText: "" }] }), conn(), http, NOENV);
    expect(out).toEqual({ ok: true, externalId: "M1", url: "https://www.instagram.com/reel/M1" });
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      "POST https://graph.facebook.com/v21.0/IG/media",
      "GET https://graph.facebook.com/v21.0/C1",
      "GET https://graph.facebook.com/v21.0/C1",
      "POST https://graph.facebook.com/v21.0/IG/media_publish",
      "GET https://graph.facebook.com/v21.0/M1",
    ]);
    expect(calls[0]!.body).toContain("media_type=REELS");
  });

  it("a video still processing is temporary (nothing was published, so a retry cannot double-post)", async () => {
    const answers = [{ body: { id: "C1" } }, ...Array.from({ length: META_TIMING.polls }, () => ({ body: { status_code: "IN_PROGRESS" } }))];
    const { http, calls } = mock(answers);
    const out = await metaProvider.publish(job({ channel: "instagram", media: [{ url: "https://s/v.mp4", mediaType: "video/mp4", altText: "" }] }), conn(), http, NOENV);
    expect(out).toMatchObject({ ok: false, kind: "temporary" });
    expect(calls.some((c) => c.url.includes("media_publish"))).toBe(false);
  });

  it("a carousel uploads each picture with its alt text, then one carousel post", async () => {
    const { http, calls } = mock([{ body: { id: "K1" } }, { body: { id: "K2" } }, { body: { id: "CAR" } }, { body: { id: "M2" } }, { body: {} }]);
    const media = [
      { url: "https://s/1.png", mediaType: "image/png", altText: "First slide" },
      { url: "https://s/2.png", mediaType: "image/png", altText: "Second slide" },
    ];
    const out = await metaProvider.publish(job({ channel: "instagram", contentType: "carousel", media }), conn(), http, NOENV);
    expect(out).toMatchObject({ ok: true, externalId: "M2", url: null });
    expect(calls[0]!.body).toContain("is_carousel_item=true");
    expect(calls[0]!.body).toContain("alt_text=First+slide");
    expect(calls[2]!.body).toContain("children=K1%2CK2");
  });

  it("OAuth: the consent link asks for the posting scopes; the exchange keeps the Page token and the linked Instagram", async () => {
    const env = { META_APP_ID: "APP", META_APP_SECRET: "SECRET" } as unknown as NodeJS.ProcessEnv;
    const url = new URL(metaProvider.authorizeUrl({ state: "S", redirectUri: "https://app.test/cb", env }));
    expect(url.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(url.searchParams.get("scope")).toContain("instagram_content_publish");
    expect(url.searchParams.get("state")).toBe("S");
    const { http } = mock([
      { body: { access_token: "short" } },
      { body: { access_token: "long", expires_in: 5_000_000 } },
      { body: { data: [{ permission: "pages_manage_posts", status: "granted" }, { permission: "instagram_content_publish", status: "declined" }] } },
      { body: { data: [{ id: "P1", name: "Credalti", access_token: "PAGE_TOKEN", instagram_business_account: { id: "IG1", username: "credalti" } }] } },
    ]);
    const grant = await metaProvider.exchangeCode({ code: "C", redirectUri: "https://app.test/cb", env }, http);
    expect(grant).toMatchObject({ accessToken: "PAGE_TOKEN", scopes: ["pages_manage_posts"], expiresAt: null, account: { pageId: "P1", igUserId: "IG1", igUsername: "credalti" } });
    expect(metaProvider.configured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(metaProvider.configured(env)).toBe(true);
  });
});

describe("publishing: TikTok and YouTube", () => {
  it("TikTok posts privately until the app is audited, and never re-sends an accepted post", async () => {
    const { http, calls } = mock([{ body: { data: { publish_id: "PUB1" }, error: { code: "ok" } } }]);
    const out = await tiktokProvider.publish(job({ channel: "tiktok", media: [{ url: "https://s/v.mp4", mediaType: "video/mp4", altText: "" }] }), conn({ provider: "tiktok", account: { displayName: "credalti" } }), http, NOENV);
    expect(out).toMatchObject({ ok: true, externalId: "PUB1", url: "https://www.tiktok.com/@credalti" });
    expect(out.ok && out.note).toMatch(/private/);
    expect(JSON.parse(calls[0]!.body!).post_info.privacy_level).toBe("SELF_ONLY");
    expect(calls[0]!.headers.authorization).toBe("Bearer TOKEN");
    const audited = mock([{ body: { data: { publish_id: "PUB2" }, error: { code: "ok" } } }]);
    await tiktokProvider.publish(job({ channel: "tiktok", media: [{ url: "https://s/v.mp4", mediaType: "video/mp4", altText: "" }] }), conn({ provider: "tiktok" }), audited.http, { TIKTOK_AUDITED: "true" } as unknown as NodeJS.ProcessEnv);
    expect(JSON.parse(audited.calls[0]!.body!).post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(await tiktokProvider.publish(job({ channel: "tiktok" }), conn({ provider: "tiktok" }), mock([]).http, NOENV)).toMatchObject({ ok: false, kind: "permanent" });
  });

  it("TikTok's own error codes are read even on HTTP 200", async () => {
    const { http } = mock([{ body: { data: {}, error: { code: "spam_risk_too_many_posts", message: "Too many posts" } } }]);
    const out = await tiktokProvider.publish(job({ channel: "tiktok", media: [{ url: "https://s/v.mp4", mediaType: "video/mp4", altText: "" }] }), conn({ provider: "tiktok" }), http, NOENV);
    expect(out).toMatchObject({ ok: false, kind: "permanent" });
    expect(!out.ok && out.reason).toMatch(/Too many posts/);
  });

  it("YouTube uploads the file with a resumable upload; a short gets #Shorts and a /shorts link", async () => {
    const bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]).buffer;
    const { http, calls } = mock([{ body: bytes }, { status: 200, headers: { location: "https://upload.test/session1" } }, { body: { id: "VID1" } }]);
    const out = await youtubeProvider.publish(job({ channel: "youtube", media: [{ url: "https://storage.test/v.mp4", mediaType: "video/mp4", altText: "" }] }), conn({ provider: "youtube" }), http, NOENV);
    expect(out).toEqual({ ok: true, externalId: "VID1", url: "https://www.youtube.com/shorts/VID1" });
    expect(calls[1]!.url).toContain("uploadType=resumable");
    expect(JSON.parse(calls[1]!.body!).snippet.title).toBe("A hook #Shorts");
    expect(JSON.parse(calls[1]!.body!).status.selfDeclaredMadeForKids).toBe(false);
    expect(calls[2]).toMatchObject({ method: "PUT", url: "https://upload.test/session1" });
    const quota = mock([{ body: bytes }, { status: 403, body: { error: { message: "quotaExceeded", code: 403 } } }]);
    expect(await youtubeProvider.publish(job({ channel: "youtube", contentType: "youtube", media: [{ url: "https://s/v.mp4", mediaType: "video/mp4", altText: "" }] }), conn({ provider: "youtube" }), quota.http, NOENV)).toMatchObject({ ok: false, kind: "permanent" });
  });

  it("refreshes tokens where the provider can, and reads metrics read-only", async () => {
    const env = { YOUTUBE_CLIENT_ID: "ID", YOUTUBE_CLIENT_SECRET: "S" } as unknown as NodeJS.ProcessEnv;
    const refreshed = mock([{ body: { access_token: "NEW", expires_in: 3600, scope: "a b" } }]);
    const grant = await youtubeProvider.refresh!(conn({ provider: "youtube", refreshToken: "R" }), env, refreshed.http);
    expect(grant).toMatchObject({ accessToken: "NEW", refreshToken: "R" });
    expect(refreshed.calls[0]!.body).toContain("grant_type=refresh_token");
    const stats = mock([{ body: { items: [{ statistics: { viewCount: "1500", likeCount: "40", commentCount: "3" } }] } }]);
    expect(await youtubeProvider.metrics({ channel: "youtube", externalId: "VID1" }, conn({ provider: "youtube" }), stats.http)).toEqual({ ok: true, values: { views: 1500, likes: 40, comments: 3 } });
    expect(stats.calls[0]!.method).toBe("GET");
    const tt = mock([{ body: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7300000000123] }, error: { code: "ok" } } }, { body: { data: { videos: [{ id: "7300000000123", view_count: 900, like_count: 50, comment_count: 4, share_count: 7 } ] }, error: { code: "ok" } } }]);
    expect(await tiktokProvider.metrics({ channel: "tiktok", externalId: "PUB1" }, conn({ provider: "tiktok" }), tt.http)).toMatchObject({ ok: true, values: { views: 900, likes: 50, comments: 4, shares: 7 } });
  });

  it("each provider is off unless its env vars are set", () => {
    for (const provider of Object.values(PROVIDERS)) expect(provider.configured({} as NodeJS.ProcessEnv), provider.id).toBe(false);
    expect(tiktokProvider.configured({ TIKTOK_CLIENT_KEY: "k", TIKTOK_CLIENT_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("publishing: errors and the OAuth state", () => {
  it("sorts errors: rate limits, server errors and the network are temporary; expired tokens need a reconnect; the rest is permanent", () => {
    expect(classify(new ProviderError("busy", 429), "Meta").kind).toBe("temporary");
    expect(classify(new ProviderError("down", 502), "Meta").kind).toBe("temporary");
    expect(classify(new TypeError("fetch failed"), "Meta").kind).toBe("temporary");
    expect(classify(new ProviderError("expired", 400, "190"), "Meta").kind).toBe("auth");
    expect(classify(new ProviderError("nope", 401), "Meta").kind).toBe("auth");
    expect(classify(new ProviderError("Invalid parameter", 400, "100"), "Meta")).toMatchObject({ kind: "permanent", reason: "Meta refused the post: Invalid parameter" });
  });

  it("the state is signed, bound to the person and the provider, and expires", () => {
    const nonce = newNonce();
    const state = signState({ provider: "meta", userId: "u1", nonce, expires: NOW.getTime() + 600_000 }, KEY);
    expect(verifyState(state, KEY, NOW.getTime())).toMatchObject({ provider: "meta", userId: "u1", nonce });
    expect(verifyState(state, Buffer.alloc(32, 4), NOW.getTime())).toBeNull();
    expect(verifyState(state, KEY, NOW.getTime() + 700_000)).toBeNull();
    const [body, sig] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ provider: "meta", userId: "attacker", nonce, expires: NOW.getTime() + 600_000 })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, KEY, NOW.getTime())).toBeNull();
    expect(body!.length).toBeGreaterThan(10);
  });
});
