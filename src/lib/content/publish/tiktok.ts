import { classify, ProviderError, readJson, type ConnectionGrant, type Http, type PublishProvider } from "./types";

// TikTok, through the Content Posting API. Needs TIKTOK_CLIENT_KEY and
// TIKTOK_CLIENT_SECRET, the Content Posting API approved for the app, and the
// domain that serves the files verified with TikTok (PULL_FROM_URL). Until the
// app passes TikTok's audit, TikTok only allows private posts: the app posts
// as SELF_ONLY unless TIKTOK_AUDITED=true, and says so (docs/CONTENT.md).
//
// A TikTok post is accepted first and processed after: the publish_id comes
// back at once and the public video id later. The app never sends the same
// post again after TikTok accepted it (no double posting); the metrics pull
// reads the final id.

const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.list"] as const;

async function form(http: Http, url: string, params: Record<string, string>) {
  const res = await http(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  return readJson(res, "TikTok");
}

async function api(http: Http, path: string, token: string, body: unknown) {
  const res = await http(`${API}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
  return readJson(res, "TikTok");
}

function grantFrom(out: Record<string, unknown>, now = Date.now()): Omit<ConnectionGrant, "account"> {
  const expiresIn = Number(out.expires_in ?? 0);
  const refreshIn = Number(out.refresh_expires_in ?? 0);
  return {
    scopes: String(out.scope ?? "").split(/[,\s]+/).filter(Boolean),
    accessToken: String(out.access_token ?? ""),
    refreshToken: out.refresh_token ? String(out.refresh_token) : null,
    expiresAt: expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null,
    refreshExpiresAt: refreshIn > 0 ? new Date(now + refreshIn * 1000).toISOString() : null,
  };
}

export const tiktokProvider: PublishProvider = {
  id: "tiktok",
  channels: ["tiktok"],
  scopes: TIKTOK_SCOPES,
  configured: (env) => Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
  authorizeUrl({ state, redirectUri, env }) {
    const q = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY ?? "", scope: TIKTOK_SCOPES.join(","), response_type: "code", redirect_uri: redirectUri, state });
    return `${AUTH}?${q.toString()}`;
  },
  async exchangeCode({ code, redirectUri, env }, http) {
    const out = await form(http, `${API}/oauth/token/`, {
      client_key: env.TIKTOK_CLIENT_KEY ?? "",
      client_secret: env.TIKTOK_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const grant = grantFrom(out);
    let displayName: string | undefined;
    try {
      const res = await http(`${API}/user/info/?fields=open_id,display_name`, { headers: { authorization: `Bearer ${grant.accessToken}` } });
      const info = await readJson(res, "TikTok");
      displayName = String(((info.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined)?.display_name ?? "") || undefined;
    } catch {
      displayName = undefined;
    }
    return { ...grant, account: { openId: String(out.open_id ?? ""), displayName } };
  },
  async refresh(conn, env, http) {
    if (!conn.refreshToken) return null;
    const out = await form(http, `${API}/oauth/token/`, {
      client_key: env.TIKTOK_CLIENT_KEY ?? "",
      client_secret: env.TIKTOK_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken,
    });
    return { ...grantFrom(out), account: conn.account };
  },
  async publish(job, conn, http, env) {
    const video = job.media.find((m) => m.mediaType.startsWith("video/"));
    const photos = job.media.filter((m) => m.mediaType.startsWith("image/"));
    if (!video && photos.length === 0) return { ok: false, kind: "permanent", reason: "TikTok needs a video (or photos), and this piece has none." };
    const privacy = env.TIKTOK_AUDITED === "true" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
    try {
      const out = video
        ? await api(http, "/post/publish/video/init/", conn.accessToken, {
            post_info: { title: job.text.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
            source_info: { source: "PULL_FROM_URL", video_url: video.url },
          })
        : await api(http, "/post/publish/content/init/", conn.accessToken, {
            post_info: { title: job.title.slice(0, 90), description: job.text.slice(0, 4000), privacy_level: privacy, disable_comment: false },
            source_info: { source: "PULL_FROM_URL", photo_images: photos.slice(0, 35).map((p) => p.url), photo_cover_index: 0 },
            post_mode: "DIRECT_POST",
            media_type: "PHOTO",
          });
      const publishId = String((out.data as Record<string, unknown> | undefined)?.publish_id ?? "");
      if (!publishId) throw new ProviderError("TikTok gave no publish id", 502);
      const who = conn.account.displayName ? `https://www.tiktok.com/@${encodeURIComponent(conn.account.displayName)}` : null;
      return {
        ok: true,
        externalId: publishId,
        url: who,
        note: privacy === "SELF_ONLY" ? "Posted as private: TikTok allows only private posts until the app passes its audit." : "TikTok is processing the video; the link to it appears after the next check.",
      };
    } catch (error) {
      return classify(error, "TikTok");
    }
  },
  async metrics({ externalId }, conn, http) {
    try {
      // A publish id first becomes the public video id.
      let videoId = externalId;
      if (!/^\d{8,25}$/.test(externalId)) {
        const status = await api(http, "/post/publish/status/fetch/", conn.accessToken, { publish_id: externalId });
        const ids = (status.data as Record<string, unknown> | undefined)?.publicaly_available_post_id;
        if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: "TikTok has not finished the post yet." };
        videoId = String(ids[0]);
      }
      const out = await api(http, "/video/query/?fields=id,view_count,like_count,comment_count,share_count,share_url", conn.accessToken, { filters: { video_ids: [videoId] } });
      const video = (((out.data as Record<string, unknown> | undefined)?.videos as Array<Record<string, unknown>> | undefined) ?? [])[0];
      if (!video) return { ok: false, reason: "TikTok returned no numbers for the video." };
      const n = (v: unknown) => (typeof v === "number" ? v : null);
      return {
        ok: true,
        values: { views: n(video.view_count), likes: n(video.like_count), comments: n(video.comment_count), shares: n(video.share_count) },
        url: typeof video.share_url === "string" ? video.share_url : null,
      };
    } catch (error) {
      return { ok: false, reason: classify(error, "TikTok").reason };
    }
  },
};
