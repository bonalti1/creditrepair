import Anthropic from "@anthropic-ai/sdk";
import { reportError } from "../observability/errors";
import { PROPOSALS_SCHEMA, type AltiCaller } from "./alti";

// The one place «Ask Alti for ideas» calls Claude. Server only; the same
// shape as the content assistant (src/lib/content/assistModel.ts): the fixed
// instructions in `system`, cached; the numbers in the user turn; JSON out
// through structured outputs; the API's refusal fallback. Without
// ANTHROPIC_API_KEY it returns null and the screen says Alti is not
// connected. Tests replace it with a mock: no live call. No key and no
// prompt is ever logged.

export const DEFAULT_IDEAS_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function ideasModel(): string {
  const configured = process.env.IDEAS_MODEL?.trim();
  return configured && /^[a-z0-9.-]{3,60}$/.test(configured) ? configured : DEFAULT_IDEAS_MODEL;
}

/** True when the server can ask Alti (the key is set). Says nothing else about the key. */
export function altiConnected(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** The caller, or null when the server has no key. */
export function ideasAltiCaller(): AltiCaller | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = ideasModel();
  return async ({ system, user }) => {
    const body = {
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: PROPOSALS_SCHEMA } },
      fallbacks: "default",
    };
    let message: Anthropic.Message;
    try {
      const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
      message = await client.messages.stream(body as unknown as Anthropic.MessageStreamParams, { headers: { "anthropic-beta": FALLBACK_BETA } }).finalMessage();
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      await reportError(error, { where: "ideas/alti", extra: { status: status ?? null } });
      return { output: null, problem: "api_error", model };
    }
    if ((message.stop_reason as string | null) === "refusal") return { output: null, problem: "refusal", model };
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) return { output: null, problem: "empty", model };
    try {
      return { output: JSON.parse(text) as unknown, problem: null, model };
    } catch {
      return { output: null, problem: "invalid_json", model };
    }
  };
}
