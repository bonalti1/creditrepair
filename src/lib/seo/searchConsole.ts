import { createSign } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchRow } from "./types";

// Google Search Console, read-only (docs/SEO.md, "Search Console"). Server
// only. Two ways to connect, both from the environment:
//
//   Service account (recommended):
//     GOOGLE_SEARCH_CONSOLE_SITE          the property: "sc-domain:credalti.com" or "https://credalti.com/"
//     GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL  the service account's email (added as a user of the property)
//     GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY   its private key (PEM; "\n" may be written as \\n)
//
//   OAuth (the owner's own Google account):
//     GOOGLE_SEARCH_CONSOLE_SITE
//     GOOGLE_SEARCH_CONSOLE_CLIENT_ID, GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET
//     GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN  (granted once with the scope below)
//
// The only scope asked is webmasters.readonly: nothing is ever changed in
// Search Console. No dependency: the service account's token request is a
// JWT signed here with node:crypto (RS256). The numbers are synced by the
// cron (/api/cron/seo) into seo_search_rows; the screens read the table.

export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/webmasters/v3/sites";

export type SearchConsoleConfig =
  | { mode: "service_account"; site: string; clientEmail: string; privateKey: string }
  | { mode: "oauth"; site: string; clientId: string; clientSecret: string; refreshToken: string };

export type Env = Partial<Record<string, string | undefined>>;

/** The variable names, for the «Connect» card (names only, never values). */
export const SEARCH_CONSOLE_ENV = {
  site: "GOOGLE_SEARCH_CONSOLE_SITE",
  serviceAccount: ["GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL", "GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY"],
  oauth: ["GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN"],
} as const;

/** The configuration, or null when Search Console is not connected (the normal state before launch). */
export function searchConsoleConfig(env: Env = process.env): SearchConsoleConfig | null {
  const site = env.GOOGLE_SEARCH_CONSOLE_SITE?.trim();
  if (!site || !/^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+\/)$/i.test(site)) return null;
  const email = env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL?.trim();
  const key = env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (email && key && key.includes("PRIVATE KEY")) return { mode: "service_account", site, clientEmail: email, privateKey: key };
  const clientId = env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN?.trim();
  if (clientId && clientSecret && refreshToken) return { mode: "oauth", site, clientId, clientSecret, refreshToken };
  return null;
}

/** What the screen may know about the connection: never a secret. */
export function connectionView(env: Env = process.env): { connected: boolean; mode: SearchConsoleConfig["mode"] | null; site: string | null } {
  const config = searchConsoleConfig(env);
  return { connected: config !== null, mode: config?.mode ?? null, site: config?.site ?? null };
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The signed assertion a service account trades for a token. */
export function serviceAccountAssertion(config: Extract<SearchConsoleConfig, { mode: "service_account" }>, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: config.clientEmail, scope: SEARCH_CONSOLE_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(config.privateKey))}`;
}

export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class SearchConsoleError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export async function accessToken(config: SearchConsoleConfig, http: Http, now: Date): Promise<string> {
  const form =
    config.mode === "service_account"
      ? new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(config, now) })
      : new URLSearchParams({ grant_type: "refresh_token", client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken });
  const res = await http(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new SearchConsoleError(`Google refused the sign-in (${res.status}${body.error ? `: ${body.error}` : ""}).`, res.status);
  return body.access_token;
}

interface ApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  position?: number;
}

/** Every row (date, page, query) for the dates, page by page of 25,000 rows, at most `maxRows`. */
export async function querySearchAnalytics(config: SearchConsoleConfig, token: string, range: { from: string; to: string }, http: Http, maxRows = 100_000): Promise<SearchRow[]> {
  const rows: SearchRow[] = [];
  const url = `${API}/${encodeURIComponent(config.site)}/searchAnalytics/query`;
  for (let startRow = 0; startRow < maxRows; startRow += 25_000) {
    const res = await http(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate: range.from, endDate: range.to, dimensions: ["date", "page", "query"], rowLimit: 25_000, startRow, dataState: "final" }),
    });
    const body = (await res.json().catch(() => ({}))) as { rows?: ApiRow[]; error?: { message?: string } };
    if (!res.ok) throw new SearchConsoleError(`Search Console answered ${res.status}${body.error?.message ? `: ${body.error.message.slice(0, 160)}` : ""}.`, res.status);
    const page = body.rows ?? [];
    for (const r of page) {
      const [day, pageUrl, query] = r.keys ?? [];
      if (!day || !pageUrl || query === undefined) continue;
      rows.push({ day, page: pageUrl.slice(0, 600), query: query.slice(0, 300), clicks: Math.max(0, Math.round(r.clicks ?? 0)), impressions: Math.max(0, Math.round(r.impressions ?? 0)), position: Math.max(0, Math.round((r.position ?? 0) * 100) / 100) });
    }
    if (page.length < 25_000) break;
  }
  return rows;
}

const DAY = 86_400_000;

/** The cron's sync: the last `days` days with final numbers (they end about 2 days ago), into seo_search_rows. Idempotent (upsert by day, page, query). */
export async function syncSearchConsole(db: SupabaseClient, now: Date, deps: { http: Http; env?: Env; days?: number }): Promise<{ connected: boolean; rows: number; from: string | null; to: string | null; error: string | null }> {
  const config = searchConsoleConfig(deps.env ?? process.env);
  if (!config) return { connected: false, rows: 0, from: null, to: null, error: null };
  const to = new Date(now.getTime() - 2 * DAY).toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (2 + (deps.days ?? 10) - 1) * DAY).toISOString().slice(0, 10);
  try {
    const token = await accessToken(config, deps.http, now);
    const rows = await querySearchAnalytics(config, token, { from, to }, deps.http);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, synced_at: now.toISOString() }));
      const { error } = await db.from("seo_search_rows").upsert(chunk, { onConflict: "day,page,query" });
      if (error) throw new SearchConsoleError(`The numbers could not be saved: ${error.message}`, null);
    }
    await db.from("seo_settings").update({ search_synced_at: now.toISOString(), search_sync_error: null, search_rows_synced: rows.length, updated_at: now.toISOString() }).eq("id", true);
    return { connected: true, rows: rows.length, from, to, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "The sync stopped.";
    await db.from("seo_settings").update({ search_sync_error: message, updated_at: now.toISOString() }).eq("id", true);
    return { connected: true, rows: 0, from, to, error: message };
  }
}
