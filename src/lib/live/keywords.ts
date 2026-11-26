import { OPT_IN_WORDS, OPT_OUT_WORDS } from "../autopilot/optout";

// The live funnel's keywords (docs/LIVE-FUNNEL.md). During a webinar or in an
// ad the host says "send the word CREDIT to our WhatsApp"; a message that IS
// a keyword gets one automatic reply with the link to /live.
//
// Configurable: LIVE_KEYWORDS, comma-separated, each "WORD" or
// "WORD=campaign" (the campaign the word stands for, e.g. "CREDITO=webinar-dic").
// Unset: CREDIT and WEBINAR, and CREDITO (CREDIT in Spanish).
//
// A message counts only when it is the keyword and nothing else, the way the
// opt-out words work (autopilot/optout.ts): case, accents, punctuation, emoji
// and spaces around it do not matter, so "Crédito!" and "credit 🙌" count and
// "I need credit help" does not. The /live page's WhatsApp button may add a
// campaign tag after it ("CREDIT #webinar-nov"); that is the one extra token
// allowed, and it must start with "#".
//
// A keyword never collides with STOP, BAJA, START, ALTA or the other opt-out
// and opt-in words: those are dropped from the list (and the test says so).

export interface LiveKeyword {
  /** Upper case, letters and digits, 2–20: "CREDIT". */
  word: string;
  /** The campaign the word stands for, when the config names one. */
  campaign: string | null;
  /** The language the word itself is in, when it says (CREDITO is Spanish); null: the person's language. */
  locale: "en" | "es" | null;
}

export const DEFAULT_KEYWORDS = "CREDIT,CREDITO,WEBINAR";

/** Spanish words a keyword may be: the reply goes in Spanish. */
const SPANISH_WORDS = new Set(["CREDITO", "REPORTE", "SEMINARIO", "AYUDA", "INFORMACION", "ENLACE"]);

/** Upper case, no accents, no punctuation or emoji, single spaces. */
export function plainWord(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}#\-_ ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const RESERVED = new Set<string>([...OPT_OUT_WORDS, ...OPT_IN_WORDS].map((w) => w.replace(/\s+/g, "")));

/** A campaign or source tag: lowercase letters, digits, dot, dash, underscore; 1–60. */
export function cleanCampaign(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 60);
  return v.length >= 1 && /^[a-z0-9][a-z0-9._-]{0,59}$/.test(v) ? v : null;
}

/** The configured keywords; the defaults when the setting is empty. Opt-out and opt-in words are dropped. */
export function parseKeywords(config: string | null | undefined = process.env.LIVE_KEYWORDS): LiveKeyword[] {
  const source = (config ?? "").trim() || DEFAULT_KEYWORDS;
  const out: LiveKeyword[] = [];
  for (const part of source.split(",")) {
    const [rawWord, rawCampaign] = part.split("=");
    const word = plainWord(rawWord ?? "").replace(/[\s#\-_]/g, "");
    if (!/^[A-Z0-9]{2,20}$/.test(word) || RESERVED.has(word) || out.some((k) => k.word === word)) continue;
    out.push({ word, campaign: cleanCampaign(rawCampaign), locale: SPANISH_WORDS.has(word) ? "es" : null });
  }
  return out;
}

export interface KeywordMatch {
  keyword: LiveKeyword;
  /** The campaign: the message's own "#tag", else the keyword's. */
  campaign: string | null;
}

/** The keyword this message is, or null when it is an ordinary message. */
export function matchKeyword(text: string, keywords: readonly LiveKeyword[] = parseKeywords()): KeywordMatch | null {
  if (text.length > 120) return null;
  const words = plainWord(text).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 2) return null;
  const word = words[0]!.replace(/[#\-_]/g, "");
  const keyword = keywords.find((k) => k.word === word);
  if (!keyword) return null;
  let campaign = keyword.campaign;
  if (words.length === 2) {
    if (!words[1]!.startsWith("#")) return null;
    const tag = cleanCampaign(words[1]!.slice(1));
    if (!tag) return null;
    campaign = tag;
  }
  return { keyword, campaign };
}

/** The text the /live page's WhatsApp button prefills: the keyword, with the campaign as a #tag. */
export function prefillText(keyword: string, campaign: string | null): string {
  return campaign ? `${keyword} #${campaign}` : keyword;
}

// ── Where a person came from ────────────────────────────────────────────

export const FUNNEL_TAGS = ["webinar", "ad", "comment", "bio", "link", "other"] as const;
export type FunnelTag = (typeof FUNNEL_TAGS)[number];

export const FUNNEL_PLATFORMS = ["zoom", "facebook", "youtube", "instagram", "tiktok", "whatsapp", "sms", "web"] as const;
export type FunnelPlatform = (typeof FUNNEL_PLATFORMS)[number];

export interface FunnelOrigin {
  tag: FunnelTag;
  platform: FunnelPlatform | null;
  keyword: string | null;
  campaign: string | null;
  src: string | null;
}

/**
 * The origin a /live link carries: `src` (webinar, ad, comment, bio…, or a
 * platform: "ig", "tiktok"…), `kw` (the keyword) and `c` (the campaign).
 * Anything unknown is "link". Never throws.
 */
export function originFromParams(params: { get(name: string): string | null }): FunnelOrigin {
  const src = cleanCampaign(params.get("src"));
  const kwRaw = plainWord(params.get("kw") ?? "").replace(/[\s#\-_]/g, "");
  const keyword = /^[A-Z0-9]{2,20}$/.test(kwRaw) ? kwRaw : null;
  const campaign = cleanCampaign(params.get("c") ?? params.get("campaign"));
  const platform = platformOf(src) ?? platformOf(cleanCampaign(params.get("p")));
  const tag: FunnelTag =
    src && (FUNNEL_TAGS as readonly string[]).includes(src)
      ? (src as FunnelTag)
      : src === "whatsapp" || src === "wa" || src === "sms"
        ? "webinar"
        : platform && src && /(comment|comentario)/.test(src)
          ? "comment"
          : src && /^(ig|fb|tt|yt)-?comment/.test(src)
            ? "comment"
            : src && /(ad|anuncio)/.test(src)
              ? "ad"
              : src && /bio/.test(src)
                ? "bio"
                : src && /(webinar|live|vivo|zoom)/.test(src)
                  ? "webinar"
                  : "link";
  return { tag, platform, keyword, campaign, src };
}

function platformOf(value: string | null): FunnelPlatform | null {
  if (!value) return null;
  if (/^(ig|insta|instagram)/.test(value)) return "instagram";
  if (/^(fb|facebook|meta)/.test(value)) return "facebook";
  if (/^(yt|youtube)/.test(value)) return "youtube";
  if (/^(tt|tiktok)/.test(value)) return "tiktok";
  if (/^zoom/.test(value)) return "zoom";
  if (/^(wa|whatsapp)/.test(value)) return "whatsapp";
  if (/^sms/.test(value)) return "sms";
  return null;
}

/** The /live link an automatic reply carries: the keyword and the campaign, and the language. */
export function liveLink(appUrl: string, input: { src: string; keyword: string | null; campaign: string | null; locale: "en" | "es" }): string {
  const base = (appUrl || "").replace(/\/+$/, "") || "https://credalti.com";
  const params = new URLSearchParams();
  params.set("src", input.src);
  if (input.keyword) params.set("kw", input.keyword.toLowerCase());
  if (input.campaign) params.set("c", input.campaign);
  params.set("lang", input.locale);
  return `${base}/live?${params.toString()}`;
}
