import { cleanBrief } from "./rules";
import { VIDEO_FORMATS, type VideoBrief, type VideoFormat } from "./types";

// A brief sent from another screen (the Ads Manager's «Send to Video
// Studio»): a link to /equipo/video?brief=<brief>, where <brief> is the
// brief record as JSON, base64url-encoded (or plain URL-encoded JSON):
//
//   { "title": "…", "goal": "…", "hook": "…", "script": "…",
//     "format": "reel" | "tiktok" | "short" | "feed_square" | "feed_portrait" | "landscape" | "9:16" | "1:1" | "4:5" | "16:9",
//     "id": "the sender's own id (optional)", "language": "en" | "es" (optional) }
//
// Nothing is created from the link by itself: the screen shows the brief and
// a person creates the video (or opens the one already made from it).

export interface IncomingBrief {
  brief: VideoBrief;
  language: "en" | "es";
}

const FORMAT_ALIASES: Record<string, VideoFormat> = {
  "9:16": "reel",
  reels: "reel",
  instagram: "reel",
  story: "reel",
  stories: "reel",
  shorts: "short",
  youtube_short: "short",
  "1:1": "feed_square",
  square: "feed_square",
  feed: "feed_square",
  "4:5": "feed_portrait",
  portrait: "feed_portrait",
  "16:9": "landscape",
  youtube: "landscape",
  wide: "landscape",
};

export function formatFrom(value: unknown): VideoFormat {
  const v = String(value ?? "").trim().toLowerCase();
  if ((VIDEO_FORMATS as readonly string[]).includes(v)) return v as VideoFormat;
  return FORMAT_ALIASES[v] ?? "reel";
}

function base64UrlDecode(text: string): string | null {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    const binary = atob(b64);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** The brief in a link, or null when it is missing or unreadable. At most 8 KB. */
export function parseBriefParam(param: string | null | undefined): IncomingBrief | null {
  if (!param || param.length > 8192) return null;
  const candidates = [param.trim().startsWith("{") ? param : null, base64UrlDecode(param.trim())];
  for (const text of candidates) {
    if (!text) continue;
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const brief = cleanBrief({
        title: String(raw.title ?? ""),
        goal: String(raw.goal ?? ""),
        hook: String(raw.hook ?? ""),
        script: String(raw.script ?? ""),
        format: formatFrom(raw.format),
        source: "ads",
        ref: typeof raw.id === "string" ? raw.id : typeof raw.ref === "string" ? raw.ref : null,
      });
      if (brief.title.length < 2) continue;
      return { brief, language: raw.language === "es" ? "es" : "en" };
    } catch {
      // Not this encoding: try the next.
    }
  }
  return null;
}

/** The link another screen builds to send a brief here. */
export function briefLink(brief: { title: string; goal?: string; hook?: string; script?: string; format?: string; id?: string; language?: "en" | "es" }): string {
  const json = JSON.stringify(brief);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `/equipo/video?brief=${encoded}`;
}
