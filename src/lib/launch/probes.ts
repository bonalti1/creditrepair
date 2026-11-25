import Anthropic from "@anthropic-ai/sdk";
import { parseAnetResponse } from "../billing/gateways/authorizeNet";
import type { ProbeService } from "./checklist";

// «Check now» on the system health view: one harmless, authenticated request
// per service, made only when an administrator taps it (the route limits how
// often, and the database keeps the last answer per service). Each one READS
// something trivial; none sends, charges, mails or changes anything.
//
//   phone_login    Supabase Auth's public settings: is the phone provider on?
//   anthropic      list one model (no tokens are used)
//   lob            list one address
//   whatsapp       read the phone number's id
//   authorize_net  authenticateTestRequest (Authorize.Net's own "are these keys right?")
//
// What comes back is a short code and the HTTP status, never the provider's
// words (they could echo something) and never anything about the key. NMI has
// no call this harmless: its sandbox checks are a person's (docs/BILLING.md).
//
// UNVERIFIED (could not be opened from the build environment): the shape of
// Supabase's /auth/v1/settings answer ("external.phone"), and that Lob and the
// Graph API answer 401/400 to a bad key on these reads. A wrong guess shows as
// "error", never as "ok".

export const PROBE_SERVICES: readonly ProbeService[] = ["phone_login", "anthropic", "lob", "whatsapp", "authorize_net"];

export type ProbeCode = "ok" | "refused" | "unreachable" | "off" | "not_configured" | "error";

export interface ProbeOutcome {
  ok: boolean;
  code: ProbeCode;
  httpStatus: number | null;
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 6_000;

const result = (code: ProbeCode, httpStatus: number | null = null): ProbeOutcome => ({ ok: code === "ok", code, httpStatus });

function byStatus(status: number): ProbeOutcome {
  if (status >= 200 && status < 300) return result("ok", status);
  if (status === 401 || status === 403) return result("refused", status);
  return result("error", status);
}

async function get(fetchImpl: Fetch, url: string, headers: Record<string, string>): Promise<ProbeOutcome> {
  try {
    const res = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    return byStatus(res.status);
  } catch {
    return result("unreachable");
  }
}

export function probeConfigured(service: ProbeService, env: Record<string, string | undefined>): boolean {
  switch (service) {
    case "phone_login":
      return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    case "anthropic":
      return Boolean(env.ANTHROPIC_API_KEY);
    case "lob":
      return Boolean(env.LOB_API_KEY);
    case "whatsapp":
      return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
    case "authorize_net":
      return (env.BILLING_GATEWAY ?? "").trim().toLowerCase() === "authorize_net" && Boolean(env.AUTHORIZE_NET_API_LOGIN_ID && env.AUTHORIZE_NET_TRANSACTION_KEY);
  }
}

/** Runs one check. Never throws; never returns anything about the key. */
export async function runProbe(service: ProbeService, env: Record<string, string | undefined> = process.env, fetchImpl: Fetch = fetch): Promise<ProbeOutcome> {
  if (!probeConfigured(service, env)) return result("not_configured");
  switch (service) {
    case "phone_login": {
      const base = env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "");
      if (!/^https:\/\//.test(base)) return result("error");
      try {
        const res = await fetchImpl(`${base}/auth/v1/settings`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
        if (!res.ok) return byStatus(res.status);
        const body = (await res.json().catch(() => null)) as { external?: { phone?: unknown } } | null;
        if (!body || typeof body.external?.phone !== "boolean") return result("error", res.status);
        return body.external.phone ? result("ok", res.status) : result("off", res.status);
      } catch {
        return result("unreachable");
      }
    }
    case "anthropic": {
      try {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY!, timeout: TIMEOUT_MS, maxRetries: 0, fetch: fetchImpl });
        await client.models.list({ limit: 1 });
        return result("ok", 200);
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return result("refused", error.status ?? null);
        if (error instanceof Anthropic.APIConnectionError) return result("unreachable");
        if (error instanceof Anthropic.APIError) return result("error", typeof error.status === "number" ? error.status : null);
        return result("error");
      }
    }
    case "lob":
      return get(fetchImpl, "https://api.lob.com/v1/addresses?limit=1", { Authorization: `Basic ${Buffer.from(`${env.LOB_API_KEY}:`).toString("base64")}` });
    case "whatsapp": {
      const id = env.WHATSAPP_PHONE_NUMBER_ID!.trim();
      if (!/^\d{5,25}$/.test(id)) return result("error");
      const outcome = await get(fetchImpl, `https://graph.facebook.com/v21.0/${id}?fields=id`, { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` });
      // The Graph API answers 400 to an expired or wrong token.
      return outcome.httpStatus === 400 ? result("refused", 400) : outcome;
    }
    case "authorize_net": {
      const url = env.AUTHORIZE_NET_ENV?.trim() === "production" ? "https://api.authorize.net/xml/v1/request.api" : "https://apitest.authorize.net/xml/v1/request.api";
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ authenticateTestRequest: { merchantAuthentication: { name: env.AUTHORIZE_NET_API_LOGIN_ID, transactionKey: env.AUTHORIZE_NET_TRANSACTION_KEY } } }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
        if (!res.ok) return byStatus(res.status);
        const answer = parseAnetResponse(await res.text()) as { messages?: { resultCode?: string } };
        return answer.messages?.resultCode === "Ok" ? result("ok", res.status) : result("refused", res.status);
      } catch {
        return result("unreachable");
      }
    }
  }
}
