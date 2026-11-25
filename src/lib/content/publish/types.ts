import type { ContentType, PublishChannel, ResultMetric } from "../types";

// Publishing to social networks (docs/CONTENT.md, "Publishing"). One interface,
// three providers: Meta (Facebook Page and Instagram Business, Graph API),
// TikTok (Content Posting API) and YouTube (Data API v3). Each is off unless
// its environment variables are set, and nothing is posted unless the owner
// connected the account, turned publishing on (globally and for the
// channel), and the piece is approved with exactly the words and files it
// carries now (gates.ts). Every call goes through an injected `Http`, so the
// tests mock every provider and nothing live is ever called from a test.

export type ProviderId = "meta" | "tiktok" | "youtube";

export const PROVIDER_OF: Record<PublishChannel, ProviderId> = { facebook: "meta", instagram: "meta", tiktok: "tiktok", youtube: "youtube" };

export type Http = (url: string, init?: RequestInit) => Promise<Response>;

/** Non-secret facts about the connected account, safe to show to an administrator. */
export interface ConnectionAccount {
  /** Facebook Page id and name. */
  pageId?: string;
  pageName?: string;
  /** The Instagram Business account linked to the Page. */
  igUserId?: string;
  igUsername?: string;
  /** TikTok open_id and display name. */
  openId?: string;
  displayName?: string;
  /** YouTube channel id and title. */
  channelId?: string;
  channelTitle?: string;
}

/** What a successful OAuth exchange gives (before encryption). */
export interface ConnectionGrant {
  account: ConnectionAccount;
  scopes: string[];
  accessToken: string;
  refreshToken: string | null;
  /** When the access token expires; null when it does not (a Page token from a long-lived user token). */
  expiresAt: string | null;
  refreshExpiresAt: string | null;
}

/** A connection with its tokens decrypted, server only, for one publish or metrics call. */
export interface ConnectionSecrets {
  provider: ProviderId;
  account: ConnectionAccount;
  scopes: string[];
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

/** The connection as an administrator sees it: never a token. */
export interface ConnectionView {
  provider: ProviderId;
  configured: boolean;
  connected: boolean;
  status: "not_configured" | "not_connected" | "connected" | "expired" | "error";
  account: ConnectionAccount | null;
  scopes: string[];
  /** Scopes publishing needs that the account did not grant. */
  missingScopes: string[];
  expiresAt: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: string | null;
}

export interface PublishMedia {
  /** A short-lived signed https URL the provider fetches (or the app streams, for YouTube). */
  url: string;
  mediaType: string;
  altText: string;
}

/** Exactly what goes out: built by compose.ts from the approved piece. */
export interface PublishJob {
  scheduleId: string;
  pieceId: string;
  channel: PublishChannel;
  contentType: ContentType;
  /** The post's text (caption, with the tracked link). */
  text: string;
  /** A title, for YouTube (the hook). */
  title: string;
  media: PublishMedia[];
  language: "en" | "es";
}

export type PublishOutcome =
  | { ok: true; externalId: string; url: string | null; note?: string | null }
  | {
      ok: false;
      /** temporary: retried with backoff; permanent: the piece is marked Failed; auth: the account must be connected again. */
      kind: "temporary" | "permanent" | "auth";
      /** A plain sentence for the owner, in English (the log keeps it as said). */
      reason: string;
      /** The provider's own code or status, for the log. */
      detail?: string | null;
    };

export type MetricsOutcome = { ok: true; values: Partial<Record<ResultMetric, number | null>>; url?: string | null } | { ok: false; reason: string };

export interface PublishProvider {
  id: ProviderId;
  channels: readonly PublishChannel[];
  /** The scopes publishing and reading metrics need. */
  scopes: readonly string[];
  /** True when the env vars it needs are set. */
  configured(env: NodeJS.ProcessEnv): boolean;
  authorizeUrl(input: { state: string; redirectUri: string; env: NodeJS.ProcessEnv }): string;
  exchangeCode(input: { code: string; redirectUri: string; env: NodeJS.ProcessEnv }, http: Http): Promise<ConnectionGrant>;
  /** A fresh access token when the provider has refresh tokens; null when it cannot. */
  refresh?(connection: ConnectionSecrets, env: NodeJS.ProcessEnv, http: Http): Promise<ConnectionGrant | null>;
  publish(job: PublishJob, connection: ConnectionSecrets, http: Http, env: NodeJS.ProcessEnv): Promise<PublishOutcome>;
  metrics(post: { channel: PublishChannel; externalId: string }, connection: ConnectionSecrets, http: Http): Promise<MetricsOutcome>;
}

/** Thrown inside a provider for an HTTP answer; turned into a PublishOutcome by classify(). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** How an error is treated: rate limits, server errors and network failures are temporary; expired or revoked tokens need a new connection; the rest is permanent. */
export function classify(error: unknown, what: string): Extract<PublishOutcome, { ok: false }> {
  if (error instanceof ProviderError) {
    const detail = [error.status, error.code].filter((v) => v !== null && v !== undefined).join(" ") || null;
    if (error.status === null || error.status === 429 || error.status >= 500) {
      return { ok: false, kind: "temporary", reason: `${what} did not answer properly (${detail ?? "network"}). The app will try again.`, detail };
    }
    if (error.status === 401 || error.code === "190" || error.code === "access_token_invalid" || error.code === "invalid_grant") {
      return { ok: false, kind: "auth", reason: `The ${what} connection expired or was removed. An administrator has to connect the account again.`, detail };
    }
    return { ok: false, kind: "permanent", reason: `${what} refused the post: ${error.message.slice(0, 200)}`, detail };
  }
  const message = error instanceof Error ? error.message : String(error);
  // fetch() failing (DNS, reset, timeout) is temporary.
  return { ok: false, kind: "temporary", reason: `Could not reach ${what} (${message.slice(0, 80)}). The app will try again.`, detail: "network" };
}

/** Read a JSON answer, throwing a ProviderError with the provider's own message when it is not OK. */
export async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const err = body.error as Record<string, unknown> | string | undefined;
  const tiktokOk = typeof err === "object" && err !== null && err.code === "ok";
  if (!res.ok || (err && !tiktokOk)) {
    const message =
      typeof err === "string" ? err : typeof err === "object" && err ? String(err.message ?? err.error_user_msg ?? err.code ?? "error") : `${what} answered ${res.status}`;
    const code = typeof err === "object" && err ? String(err.code ?? err.status ?? "") || null : typeof body.error === "string" ? body.error : null;
    throw new ProviderError(message, res.ok ? 400 : res.status, code);
  }
  return body;
}
