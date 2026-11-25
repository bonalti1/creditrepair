import { AGREEMENT_VERSION } from "../agreement/documents";
import { unverifiedStatuteCitations } from "../agreement/readiness";
import { resolveTerms, TERM_ENV, type TermKey, type TermsSource } from "../agreement/terms";
import { ACH_AUTHORIZATION_VERSION } from "../billing/achAuthorization";
import { PAYMENT_AUTHORIZATION_VERSION } from "../billing/authorization";
import { getPaymentGateway } from "../billing/gateway";

// What Launch readiness may know about the hosting settings. Server only.
//
// THE RULE: nothing that leaves this file says anything about a secret's
// value: not the value, not its length, not its first or last characters.
// Only "set" or "not set" per variable NAME, and a few words that can be told
// safely: a Lob key's "test" or "live" (its documented prefix, reduced to the
// one word), the processor's NAME and whether Authorize.Net points at
// production (AUTHORIZE_NET_ENV, not a secret), whether an attorney's approval
// variable equals the CURRENT version string (a yes or no), and the template
// NAMES listed in WHATSAPP_APPROVED_TEMPLATES (names Meta shows publicly, not
// secrets). A test (launchReadiness.test.ts) checks that two settings that
// differ only in their secrets give the same answer, byte for byte.

/** Every variable whose value is a secret: never read for anything but "set". */
export const SECRET_ENV: readonly string[] = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "LOB_API_KEY",
  "LOB_WEBHOOK_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "EMAIL_API_KEY",
  "UNSUBSCRIBE_SECRET",
  "MONITORING_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "N8N_WEBHOOK_SECRET",
  "HIGHLEVEL_WEBHOOK_SECRET",
  "HIGHLEVEL_API_TOKEN",
  "NMI_SECURITY_KEY",
  "NMI_WEBHOOK_SIGNING_KEY",
  "AUTHORIZE_NET_API_LOGIN_ID",
  "AUTHORIZE_NET_TRANSACTION_KEY",
  "AUTHORIZE_NET_SIGNATURE_KEY",
  "VAPID_PRIVATE_KEY",
  "CONTENT_TOKEN_KEY",
  "META_APP_SECRET",
  "TIKTOK_CLIENT_SECRET",
  "YOUTUBE_CLIENT_SECRET",
  // Webhook addresses carry their own secret token in the path.
  "ERROR_WEBHOOK_URL",
  "SALES_WEBHOOK_URL",
  "TEAM_WEBHOOK_URL",
  "HIGHLEVEL_INBOUND_WEBHOOK_URL",
];

export type LobMode = "test" | "live" | "unknown";
export type GatewayName = "nmi" | "authorize_net" | "demo" | "other";

export interface EnvFacts {
  /** Variable name → set (non-blank). Names only. */
  set: Record<string, boolean>;
  lobMode: LobMode | null;
  gateway: GatewayName | null;
  /** The processor's adapter could be built from its variables (every required one is set). */
  gatewayComplete: boolean;
  /** Authorize.Net: "live" when AUTHORIZE_NET_ENV is production; NMI cannot be told apart. */
  gatewayMode: "live" | "sandbox" | "demo" | "unknown" | null;
  /** The processor's webhook signing key (NMI or Authorize.Net, per the processor) is set. */
  gatewayWebhookKey: boolean;
  agreementApproved: boolean;
  paymentAuthorizationApproved: boolean;
  achAuthorizationApproved: boolean;
  /** The agreement's facts that are not set or not readable (variable names). */
  termsMissing: string[];
  /** Statutory passages not yet compared with the official text. */
  unverifiedStatutes: number;
  lettersAllowUnapproved: boolean;
  /** Template names listed in WHATSAPP_APPROVED_TEMPLATES. */
  templatesListed: string[];
  tiktokAudited: boolean;
  monitoringProvider: "demo" | "identityiq" | "other";
  /** NEXT_PUBLIC_SERVICE_MODE: full service unless "self_serve". */
  selfServe: boolean;
}

const blank = (v: string | undefined) => !v || v.trim() === "";

/** Facts about the settings, as safe words and yes/no. */
export function envFacts(env: Record<string, string | undefined> = process.env, names: readonly string[] = []): EnvFacts {
  const set: Record<string, boolean> = {};
  for (const name of names) set[name] = !blank(env[name]);

  const lob = env.LOB_API_KEY?.trim() ?? "";
  const lobMode: LobMode | null = !lob ? null : lob.startsWith("test_") ? "test" : lob.startsWith("live_") ? "live" : "unknown";

  const rawGateway = (env.BILLING_GATEWAY ?? "").trim().toLowerCase();
  const gateway: GatewayName | null = !rawGateway ? null : rawGateway === "nmi" || rawGateway === "authorize_net" || rawGateway === "demo" ? rawGateway : "other";
  const resolution = getPaymentGateway(env);
  const gatewayComplete = resolution.configured;
  const gatewayMode =
    gateway === null
      ? null
      : gateway === "demo"
        ? "demo"
        : gateway === "authorize_net"
          ? env.AUTHORIZE_NET_ENV?.trim() === "production"
            ? "live"
            : "sandbox"
          : "unknown";
  const gatewayWebhookKey = gateway === "nmi" ? !blank(env.NMI_WEBHOOK_SIGNING_KEY) : gateway === "authorize_net" ? !blank(env.AUTHORIZE_NET_SIGNATURE_KEY) : false;

  const source = Object.fromEntries(Object.entries(TERM_ENV).map(([key, name]) => [key, env[name]])) as TermsSource;
  const terms = resolveTerms(source);
  const required: TermKey[] = ["companyLegalName", "companyAddress", "companyEmail", "monthlyFee", "estimatedMonths", "texasRegistrationNumber", "bondSuretyName", "bondSuretyAddress", "texasAgentName", "texasAgentAddress"];
  const termsMissing = required.filter((key) => terms[key] === null).map((key) => TERM_ENV[key]);

  const provider = (env.MONITORING_PROVIDER ?? "").trim().toLowerCase();
  return {
    set,
    lobMode,
    gateway,
    gatewayComplete,
    gatewayMode,
    gatewayWebhookKey,
    agreementApproved: (env.NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION ?? "").trim() === AGREEMENT_VERSION,
    paymentAuthorizationApproved: (env.NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION ?? "").trim() === PAYMENT_AUTHORIZATION_VERSION,
    achAuthorizationApproved: (env.NEXT_PUBLIC_ACH_AUTHORIZATION_APPROVED_VERSION ?? "").trim() === ACH_AUTHORIZATION_VERSION,
    termsMissing,
    unverifiedStatutes: unverifiedStatuteCitations().length,
    lettersAllowUnapproved: (env.LETTERS_ALLOW_UNAPPROVED ?? "").trim() === "1",
    templatesListed: (env.WHATSAPP_APPROVED_TEMPLATES ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^[a-z0-9_]{2,80}$/.test(t)),
    tiktokAudited: (env.TIKTOK_AUDITED ?? "").trim() === "true",
    monitoringProvider: !provider || provider === "demo" ? "demo" : provider === "identityiq" ? "identityiq" : "other",
    selfServe: (env.NEXT_PUBLIC_SERVICE_MODE ?? "").trim() === "self_serve",
  };
}

/**
 * Removes every secret's value (and anything that looks like a token) from a
 * text before it is shown: a heartbeat's error message could, in principle,
 * echo a request. What is left is safe to show an administrator.
 */
export function redactSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const value = env[name]?.trim();
    if (value && value.length >= 6) out = out.split(value).join("[hidden]");
  }
  // Long runs of key-like characters (tokens, keys, signatures).
  return out.replace(/[A-Za-z0-9_\-+/=]{24,}/g, "[hidden]");
}
