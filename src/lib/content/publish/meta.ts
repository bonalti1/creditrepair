import { isImageAsset, isVideoAsset } from "../check";
import { classify, ProviderError, readJson, type ConnectionGrant, type ConnectionSecrets, type Http, type PublishJob, type PublishOutcome, type PublishProvider } from "./types";

// Meta: a Facebook Page and the Instagram Business account linked to it,
// through the Graph API. Needs META_APP_ID and META_APP_SECRET, a Meta app
// with business verification, and app review for pages_manage_posts and
// instagram_content_publish before it can post for real (docs/CONTENT.md).
//
// The connection keeps the Page's access token (from a long-lived user token,
// it does not expire) and the linked Instagram account. Which Page: META_PAGE_ID
// when set, else the first Page the person manages.

export const GRAPH = "https://graph.facebook.com/v21.0";
const DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
] as const;

/** How long to wait between checks of an Instagram video container. Tests set it to 0. */
export const META_TIMING = { pollMs: 3000, polls: 5 };

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function graph(http: Http, path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const res =
    method === "GET"
      ? await http(`${GRAPH}${path}?${body.toString()}`)
      : await http(`${GRAPH}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  return readJson(res, "Meta");
}

async function publishFacebook(job: PublishJob, conn: ConnectionSecrets, http: Http): Promise<PublishOutcome> {
  const pageId = conn.account.pageId;
  if (!pageId) return { ok: false, kind: "auth", reason: "No Facebook Page is connected. Connect the account again and pick a Page." };
  const token = conn.accessToken;
  const video = job.media.find((m) => isVideoAsset({ mediaType: m.mediaType, ref: m.url, kind: "upload" }));
  const images = job.media.filter((m) => isImageAsset({ mediaType: m.mediaType, ref: m.url, kind: "upload" }));
  let id: string;
  if (video) {
    const out = await graph(http, `/${pageId}/videos`, { file_url: video.url, description: job.text, access_token: token }, "POST");
    id = String(out.id ?? "");
  } else if (images.length === 1) {
    const out = await graph(http, `/${pageId}/photos`, { url: images[0]!.url, caption: job.text, alt_text_custom: images[0]!.altText, access_token: token }, "POST");
    id = String(out.post_id ?? out.id ?? "");
  } else if (images.length > 1) {
    // Several photos: uploaded unpublished, then one post with all of them.
    const ids: string[] = [];
    for (const image of images.slice(0, 10)) {
      const out = await graph(http, `/${pageId}/photos`, { url: image.url, published: "false", alt_text_custom: image.altText, access_token: token }, "POST");
      ids.push(String(out.id));
    }
    const params: Record<string, string> = { message: job.text, access_token: token };
    ids.forEach((mediaId, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: mediaId })));
    const out = await graph(http, `/${pageId}/feed`, params, "POST");
    id = String(out.id ?? "");
  } else {
    const out = await graph(http, `/${pageId}/feed`, { message: job.text, access_token: token }, "POST");
    id = String(out.id ?? "");
  }
  if (!id) throw new ProviderError("Facebook gave no post id", 502);
  return { ok: true, externalId: id, url: `https://www.facebook.com/${id}` };
}

async function waitForContainer(http: Http, id: string, token: string): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR"> {
  for (let i = 0; i < META_TIMING.polls; i++) {
    const out = await graph(http, `/${id}`, { fields: "status_code", access_token: token });
    const status = String(out.status_code ?? "");
    if (status === "FINISHED" || status === "PUBLISHED") return "FINISHED";
    if (status === "ERROR" || status === "EXPIRED") return "ERROR";
    await sleep(META_TIMING.pollMs);
  }
  return "IN_PROGRESS";
}

async function publishInstagram(job: PublishJob, conn: ConnectionSecrets, http: Http): Promise<PublishOutcome> {
  const ig = conn.account.igUserId;
  if (!ig) return { ok: false, kind: "auth", reason: "No Instagram Business account is linked to the connected Facebook Page." };
  const token = conn.accessToken;
  const video = job.media.find((m) => m.mediaType.startsWith("video/"));
  const images = job.media.filter((m) => m.mediaType.startsWith("image/"));
  if (!video && images.length === 0) return { ok: false, kind: "permanent", reason: "Instagram needs a picture or a video, and this piece has none." };
  let container: string;
  if (job.contentType === "carousel" && images.length >= 2) {
    const children: string[] = [];
    for (const image of images.slice(0, 10)) {
      const out = await graph(http, `/${ig}/media`, { image_url: image.url, is_carousel_item: "true", alt_text: image.altText, access_token: token }, "POST");
      children.push(String(out.id));
    }
    const out = await graph(http, `/${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: job.text, access_token: token }, "POST");
    container = String(out.id);
  } else if (video) {
    const out = await graph(http, `/${ig}/media`, { media_type: job.contentType === "story" ? "STORIES" : "REELS", video_url: video.url, caption: job.text, access_token: token }, "POST");
    container = String(out.id);
    const status = await waitForContainer(http, container, token);
    if (status === "ERROR") return { ok: false, kind: "permanent", reason: "Instagram could not process the video (format, length or size). Check it against Instagram's reel rules." };
    // Not ready yet: nothing was published, so trying again later cannot double-post.
    if (status === "IN_PROGRESS") return { ok: false, kind: "temporary", reason: "Instagram is still processing the video. The app will try again.", detail: "IN_PROGRESS" };
  } else {
    const image = images[0]!;
    const out = await graph(
      http,
      `/${ig}/media`,
      { image_url: image.url, caption: job.text, alt_text: image.altText, ...(job.contentType === "story" ? { media_type: "STORIES" } : {}), access_token: token },
      "POST",
    );
    container = String(out.id);
  }
  const published = await graph(http, `/${ig}/media_publish`, { creation_id: container, access_token: token }, "POST");
  const mediaId = String(published.id ?? "");
  if (!mediaId) throw new ProviderError("Instagram gave no media id", 502);
  let url: string | null = null;
  try {
    const info = await graph(http, `/${mediaId}`, { fields: "permalink", access_token: token });
    url = typeof info.permalink === "string" ? info.permalink : null;
  } catch {
    // The post is out; the link can be read later.
  }
  return { ok: true, externalId: mediaId, url };
}

function insightValue(data: unknown, name: string): number | null {
  if (!Array.isArray(data)) return null;
  const row = data.find((d) => (d as Record<string, unknown>).name === name) as Record<string, unknown> | undefined;
  if (!row) return null;
  const total = (row.total_value as Record<string, unknown> | undefined)?.value;
  const first = Array.isArray(row.values) ? (row.values[0] as Record<string, unknown> | undefined)?.value : undefined;
  const value = total ?? first;
  return typeof value === "number" ? value : null;
}

export const metaProvider: PublishProvider = {
  id: "meta",
  channels: ["facebook", "instagram"],
  scopes: META_SCOPES,
  configured: (env) => Boolean(env.META_APP_ID && env.META_APP_SECRET),
  authorizeUrl({ state, redirectUri, env }) {
    const q = new URLSearchParams({ client_id: env.META_APP_ID ?? "", redirect_uri: redirectUri, state, scope: META_SCOPES.join(","), response_type: "code" });
    return `${DIALOG}?${q.toString()}`;
  },
  async exchangeCode({ code, redirectUri, env }, http): Promise<ConnectionGrant> {
    const short = await graph(http, "/oauth/access_token", { client_id: env.META_APP_ID ?? "", client_secret: env.META_APP_SECRET ?? "", redirect_uri: redirectUri, code });
    const long = await graph(http, "/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: env.META_APP_ID ?? "",
      client_secret: env.META_APP_SECRET ?? "",
      fb_exchange_token: String(short.access_token ?? ""),
    });
    const userToken = String(long.access_token ?? short.access_token ?? "");
    const perms = await graph(http, "/me/permissions", { access_token: userToken });
    const scopes = Array.isArray(perms.data) ? (perms.data as Array<Record<string, unknown>>).filter((p) => p.status === "granted").map((p) => String(p.permission)) : [];
    const pages = await graph(http, "/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", access_token: userToken });
    const list = Array.isArray(pages.data) ? (pages.data as Array<Record<string, unknown>>) : [];
    const page = list.find((p) => p.id === env.META_PAGE_ID) ?? list[0];
    if (!page) throw new ProviderError("This Facebook account manages no Page", 400, "no_page");
    const ig = page.instagram_business_account as Record<string, unknown> | undefined;
    return {
      account: { pageId: String(page.id), pageName: String(page.name ?? ""), igUserId: ig?.id ? String(ig.id) : undefined, igUsername: ig?.username ? String(ig.username) : undefined },
      scopes,
      accessToken: String(page.access_token ?? ""),
      refreshToken: null,
      // A Page token from a long-lived user token does not expire.
      expiresAt: null,
      refreshExpiresAt: null,
    };
  },
  async publish(job, conn, http) {
    try {
      return job.channel === "instagram" ? await publishInstagram(job, conn, http) : await publishFacebook(job, conn, http);
    } catch (error) {
      return classify(error, job.channel === "instagram" ? "Instagram" : "Facebook");
    }
  },
  async metrics({ channel, externalId }, conn, http) {
    try {
      if (channel === "instagram") {
        const out = await graph(http, `/${externalId}/insights`, { metric: "views,reach,likes,comments,shares", access_token: conn.accessToken });
        return {
          ok: true,
          values: { views: insightValue(out.data, "views"), reach: insightValue(out.data, "reach"), likes: insightValue(out.data, "likes"), comments: insightValue(out.data, "comments"), shares: insightValue(out.data, "shares") },
        };
      }
      const post = await graph(http, `/${externalId}`, { fields: "shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)", access_token: conn.accessToken });
      const insights = await graph(http, `/${externalId}/insights`, { metric: "post_impressions,post_impressions_unique,post_clicks", access_token: conn.accessToken }).catch(() => ({ data: [] }));
      const summary = (key: string) => ((post[key] as Record<string, unknown> | undefined)?.summary as Record<string, unknown> | undefined)?.total_count;
      return {
        ok: true,
        values: {
          views: insightValue(insights.data, "post_impressions"),
          reach: insightValue(insights.data, "post_impressions_unique"),
          clicks: insightValue(insights.data, "post_clicks"),
          likes: typeof summary("reactions") === "number" ? (summary("reactions") as number) : null,
          comments: typeof summary("comments") === "number" ? (summary("comments") as number) : null,
          shares: typeof (post.shares as Record<string, unknown> | undefined)?.count === "number" ? ((post.shares as Record<string, unknown>).count as number) : null,
        },
      };
    } catch (error) {
      return { ok: false, reason: classify(error, "Meta").reason };
    }
  },
};
