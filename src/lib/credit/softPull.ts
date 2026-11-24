import type { NormalizedReport } from "../domain/types";

// An instant soft credit pull, for the "Your report" step of the chat signup
// (docs/SIGNUP-CHAT.md). A soft inquiry does not affect the person's credit
// and lets the chat show what the report lists before they sign.
//
// No provider is connected. The default is `none`: the step then takes the
// existing path, the credit monitoring subscription (IdentityIQ,
// src/lib/monitoring/offer.ts), turned on after the agreement is signed.
// Nothing in this file calls any credit bureau or reseller.
//
// To plug a provider in later:
//   1. Write a SoftPullProvider (below). Its `pull` runs on the server only,
//      with keys from the environment; it never sees an SSN typed in the app
//      (the app has no field for one) unless the provider's own hosted form
//      collects it.
//   2. registerSoftPullProvider(provider) at start-up, and set
//      SOFT_PULL_PROVIDER to its id.
//   3. Before going live: the attorney and the provider's contract decide the
//      permissible purpose (FCRA §604: the consumer's written instruction),
//      the consent wording and whether a pull before the agreement is signed
//      is a "service" under CROA (docs/SIGNUP-CHAT.md, attorney questions).

export interface SoftPullRequest {
  userId: string;
  /** The consent the person ticked, with its version and the hash of its words. */
  consent: { version: string; textHash: string; at: string };
  locale: "es" | "en";
}

export type SoftPullResult =
  | { ok: true; report: NormalizedReport }
  | { ok: false; reason: "not_configured" | "no_file" | "identity_not_verified" | "provider_error" };

export interface SoftPullProvider {
  /** Lowercase id, the value of SOFT_PULL_PROVIDER. */
  id: string;
  /** The name shown to the person ("a soft pull from …"). */
  displayName: string;
  /** True when its keys are configured. */
  isAvailable(env?: Record<string, string | undefined>): boolean;
  pull(request: SoftPullRequest): Promise<SoftPullResult>;
}

/** The default: no provider. The step uses the monitoring subscription instead. */
export const NO_SOFT_PULL: SoftPullProvider = {
  id: "none",
  displayName: "",
  isAvailable: () => false,
  pull: async () => ({ ok: false, reason: "not_configured" }),
};

const registry = new Map<string, SoftPullProvider>([[NO_SOFT_PULL.id, NO_SOFT_PULL]]);

export function registerSoftPullProvider(provider: SoftPullProvider): void {
  if (!/^[a-z0-9_-]{2,40}$/.test(provider.id)) throw new Error(`softPull: invalid provider id "${provider.id}"`);
  registry.set(provider.id, provider);
}

/** The provider SOFT_PULL_PROVIDER names, when registered and configured; `none` otherwise. */
export function softPullProvider(env: Record<string, string | undefined> = process.env): SoftPullProvider {
  const id = (env.SOFT_PULL_PROVIDER ?? "none").trim().toLowerCase() || "none";
  const provider = registry.get(id);
  return provider && provider.isAvailable(env) ? provider : NO_SOFT_PULL;
}

/** What the "Your report" step does. */
export type ReportStepMode =
  /** A report is on file: show what it lists, in counts. */
  | "summary"
  /** A provider is connected: offer the instant soft pull. */
  | "soft_pull"
  /** No provider: the monitoring subscription, turned on right after signing. */
  | "monitoring";

export function reportStepMode(input: { providerId: string; hasReport: boolean }): ReportStepMode {
  if (input.hasReport) return "summary";
  return input.providerId !== NO_SOFT_PULL.id ? "soft_pull" : "monitoring";
}

/** The consent the person ticks before a soft pull. Attorney-pending wording. */
export const SOFT_PULL_CONSENT = {
  version: "2026-11-24-draft.1",
  en: "I instruct Credalti to get my credit report through a soft inquiry, to show me what it lists. A soft inquiry does not affect my credit.",
  es: "Le pido a Credalti que obtenga mi reporte de crédito con una consulta suave, para mostrarme lo que contiene. Una consulta suave no afecta mi crédito.",
} as const;
