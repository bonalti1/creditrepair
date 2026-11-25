import { classify, ProviderError, readJson, type ConnectionGrant, type Http, type PublishProvider } from "./types";

// YouTube, through the Data API v3 (resumable upload). Needs YOUTUBE_CLIENT_ID
// and YOUTUBE_CLIENT_SECRET from a Google Cloud project with the YouTube Data
// API enabled, its OAuth consent screen verified (the youtube.upload scope is
// sensitive), and enough upload quota: an upload costs 1,600 units of the
// default 10,000 a day (docs/CONTENT.md). A vertical video of 3 minutes or
// less with "#Shorts" in the title is shown as a Short.

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"] as const;

async function token(http: Http, params: Record<string, string>) {
  const res = await http(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  return readJson(res, "YouTube");
}

function grantFrom(out: Record<string, unknown>, refreshToken: string | null, now = Date.now()): Omit<ConnectionGrant, "account"> {
  const expiresIn = Number(out.expires_in ?? 0);
  return {
    scopes: String(out.scope ?? "").split(/\s+/).filter(Boolean),
    accessToken: String(out.access_token ?? ""),
    refreshToken: out.refresh_token ? String(out.refresh_token) : refreshToken,
    expiresAt: expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null,
    refreshExpiresAt: null,
  };
}

export const youtubeProvider: PublishProvider = {
  id: "youtube",
  channels: ["youtube"],
  scopes: YOUTUBE_SCOPES,
  configured: (env) => Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET),
  authorizeUrl({ state, redirectUri, env }) {
    const q = new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `${AUTH}?${q.toString()}`;
  },
  async exchangeCode({ code, redirectUri, env }, http) {
    const out = await token(http, { code, client_id: env.YOUTUBE_CLIENT_ID ?? "", client_secret: env.YOUTUBE_CLIENT_SECRET ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" });
    const grant = grantFrom(out, null);
    const res = await http(`${API}/channels?part=snippet&mine=true`, { headers: { authorization: `Bearer ${grant.accessToken}` } });
    const channels = await readJson(res, "YouTube");
    const channel = (Array.isArray(channels.items) ? channels.items[0] : null) as Record<string, unknown> | null;
    if (!channel) throw new ProviderError("This Google account has no YouTube channel", 400, "no_channel");
    return { ...grant, account: { channelId: String(channel.id), channelTitle: String((channel.snippet as Record<string, unknown> | undefined)?.title ?? "") } };
  },
  async refresh(conn, env, http) {
    if (!conn.refreshToken) return null;
    const out = await token(http, { client_id: env.YOUTUBE_CLIENT_ID ?? "", client_secret: env.YOUTUBE_CLIENT_SECRET ?? "", refresh_token: conn.refreshToken, grant_type: "refresh_token" });
    return { ...grantFrom(out, conn.refreshToken), account: conn.account };
  },
  async publish(job, conn, http) {
    const video = job.media.find((m) => m.mediaType.startsWith("video/"));
    if (!video) return { ok: false, kind: "permanent", reason: "YouTube needs a video, and this piece has none." };
    const short = job.contentType !== "youtube";
    const title = `${job.title}${short && !/#shorts/i.test(job.title) ? " #Shorts" : ""}`.slice(0, 100);
    try {
      const file = await http(video.url);
      if (!file.ok) throw new ProviderError("The video file could not be read from storage", file.status >= 500 ? file.status : 404, "file");
      const bytes = await file.arrayBuffer();
      const start = await http(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${conn.accessToken}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": video.mediaType,
          "x-upload-content-length": String(bytes.byteLength),
        },
        body: JSON.stringify({
          snippet: { title, description: job.text.slice(0, 5000), categoryId: "22", defaultLanguage: job.language, defaultAudioLanguage: job.language },
          status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
        }),
      });
      if (!start.ok) await readJson(start, "YouTube");
      const location = start.headers.get("location");
      if (!location) throw new ProviderError("YouTube gave no upload address", 502);
      const put = await http(location, { method: "PUT", headers: { "content-type": video.mediaType }, body: bytes });
      const out = await readJson(put, "YouTube");
      const id = String(out.id ?? "");
      if (!id) throw new ProviderError("YouTube gave no video id", 502);
      return { ok: true, externalId: id, url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
    } catch (error) {
      return classify(error, "YouTube");
    }
  },
  async metrics({ externalId }, conn, http) {
    try {
      const res = await http(`${API}/videos?part=statistics&id=${encodeURIComponent(externalId)}`, { headers: { authorization: `Bearer ${conn.accessToken}` } });
      const out = await readJson(res, "YouTube");
      const stats = ((Array.isArray(out.items) ? out.items[0] : null) as Record<string, unknown> | null)?.statistics as Record<string, unknown> | undefined;
      if (!stats) return { ok: false, reason: "YouTube returned no numbers for the video." };
      const n = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
      return { ok: true, values: { views: n(stats.viewCount), likes: n(stats.likeCount), comments: n(stats.commentCount) } };
    } catch (error) {
      return { ok: false, reason: classify(error, "YouTube").reason };
    }
  },
};
