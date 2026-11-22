import { PRICE_PER_MTOK } from "./config";

// Tokens per call and what they cost, estimated from the published price per
// million tokens (config.ts). Every intake call writes one log line with these
// numbers and the estimate is kept with the document's record, so the owner
// can see the real cost per document instead of trusting the estimate in
// docs/INTAKE.md.

export interface ModelUsage {
  /** Input tokens billed at the full rate (not read from or written to the cache). */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the prompt cache (the fixed instructions, on a repeat call). */
  cacheReadTokens: number;
  /** Input tokens written to the prompt cache (the fixed instructions, on the first call). */
  cacheWriteTokens: number;
}

export const NO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Estimated US dollars for one call, rounded to a hundredth of a cent. */
export function estimateCostUsd(usage: ModelUsage, prices: { input: number; output: number; cacheWrite: number; cacheRead: number } = PRICE_PER_MTOK): number {
  const dollars =
    (usage.inputTokens * prices.input +
      usage.outputTokens * prices.output +
      usage.cacheWriteTokens * prices.cacheWrite +
      usage.cacheReadTokens * prices.cacheRead) /
    1_000_000;
  return Math.round(dollars * 10_000) / 10_000;
}

/** The usage block of an API response, read defensively (fields can be missing or null). */
export function usageFrom(raw: unknown): ModelUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
  return {
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
    cacheWriteTokens: n(u.cache_creation_input_tokens),
  };
}

/**
 * One JSON log line per call. No document content and no personal data: the
 * task, the model, the tokens, the estimate and how it ended.
 */
export function logIntakeUsage(entry: { task: string; model: string; usage: ModelUsage; stopReason: string | null; ok: boolean; ms: number }): void {
  console.info(
    JSON.stringify({
      level: "info",
      at: new Date().toISOString(),
      where: "intake",
      task: entry.task,
      model: entry.model,
      ...entry.usage,
      costUsd: estimateCostUsd(entry.usage),
      stopReason: entry.stopReason,
      ok: entry.ok,
      ms: entry.ms,
    }),
  );
}
